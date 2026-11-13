import { createHash } from "node:crypto";
import { spawnCommand, stopProcess } from "./execution.js";
import { confinedPath } from "./project.js";
import {backgroundScope,type ShellStatus} from './background.js';
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TodoItem } from "./tools/todo.js";
import {editArgumentError} from './tools/edit.js';

/**
 * Default resolvers for the service.* events our tools emit. Registered at
 * the END of the hooks chain by the loop — everything here is interceptable:
 * { deny } in any handler short-circuits before these run.
 */
export interface ResolverBus {
  on(service: string, handler: (payload: unknown) => Promise<unknown>): void;
}

const fileMutationLocks=new Map<string,Promise<unknown>>();

export function registerDefaultResolvers(
  bus: ResolverBus,
  options: {
    root?: string;
    resolvePath?:(value:string,missing?:boolean)=>Promise<string>;
    signal?: () => AbortSignal;
    env?: () => Record<string, string>;
    onFilesChanged?: (path: string) => Promise<void>;
    onBackgroundComplete?:(status:ShellStatus)=>Promise<void>;
  } = {}
): (()=>Promise<void>)&{revalidate:()=>Promise<void>} {
  const jobs=backgroundScope(options.onBackgroundComplete);
  // Each dispatcher/Core owns its list; several agents can share one process.
  let todoList:TodoItem[]=[];
  const todoUpdate=async(payload:unknown)=>{
    const p=payload as {todos?:TodoItem[]};
    if(p.todos)todoList=p.todos.map(t=>({content:String(t.content),status:t.status}));
    return{todos:todoList.map(t=>({...t}))};
  };
  const locks=fileMutationLocks;
  const original = bus;
  bus = {
    on: (service, handler) =>
      original.on(service, async (payload) => {
        const value = payload as { path?: string; cwd?: string };
        if (options.root && value.path && service.startsWith("service.file."))
          if(options.resolvePath)value.path=await options.resolvePath(value.path,true);else await confinedPath(options.root, value.path, true);
        if (options.root && value.cwd)
          if(options.resolvePath)value.cwd=await options.resolvePath(value.cwd);else await confinedPath(options.root, value.cwd);
        if (service === "service.shell.exec" && options.env)
          (payload as any).env = { ...options.env(), ...(payload as any).env };
        const mutation=["service.file.write","service.file.edit"].includes(service)&&value.path;
        let result:unknown;
        if(mutation){
          const key=await fs.realpath(value.path!).catch(()=>path.resolve(value.path!));
          const prior=locks.get(key)??Promise.resolve();
          const job=prior.catch(()=>{}).then(()=>handler(payload));locks.set(key,job);
          try{result=await job;}finally{if(locks.get(key)===job)locks.delete(key);}
        }else result=await handler(payload);
        if (
          ["service.file.write", "service.file.edit"].includes(service) &&
          value.path
        )
          await options.onFilesChanged?.(value.path);
        return result;
      }),
  };
  bus.on("service.project.query", async () => {
    throw new Error("No code navigation provider installed");
  });
  bus.on("service.sandbox.run", async () => {
    throw new Error("No sandbox provider installed");
  });
  bus.on("service.shell.exec", (payload) => (payload as ExecPayload).background?jobs.start(payload as ExecPayload,options.signal?.()):runExec(payload,options));
  bus.on("service.shell.execOutput", async(payload)=>jobs.output((payload as {id:string}).id));
  bus.on("service.shell.execKill", async(payload)=>jobs.kill((payload as {id:string}).id));
  bus.on('service.shell.jobs',async(payload)=>jobs.metadata((payload as {id?:string}).id));
  bus.on("service.todo.update", todoUpdate);
  bus.on("service.file.read", readFileRange);
  bus.on("service.file.readText", readText);
  bus.on("service.file.write", writeFile);
  bus.on("service.file.edit", editFile);
  return Object.assign(()=>jobs.close(),{revalidate:()=>jobs.revalidate(cwd=>options.resolvePath?options.resolvePath(cwd):Promise.resolve())});
}

const MAX_OUTPUT = 512 * 1024;
const MAX_FILE_LINES = 10_000;

interface ExecPayload {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  background?: boolean;
}


async function runExec(
  payload: unknown,
  options: { signal?: () => AbortSignal }
): Promise<unknown> {
  const p = payload as ExecPayload;
  const process = await spawnCommand(p.command, p.cwd, p.env);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = process;
    const signal = options.signal?.();
    const abort = () => stopProcess(child);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stopProcess(child);
      reject(new Error(`exec timed out after ${p.timeoutMs}ms: ${p.command}`));
    }, p.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT)
        stdout = stdout.slice(0, MAX_OUTPUT) + "\n…[truncated]";
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT)
        stderr = stderr.slice(0, MAX_OUTPUT) + "\n…[truncated]";
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        durationMs: Date.now() - started,
      });
    });
  });
}

interface ReadPayload {
  path: string;
  offset?: number;
  limit?: number;
}

async function readFileRange(payload: unknown): Promise<unknown> {
  const p = payload as ReadPayload;
  if(p.offset!==undefined&&(!Number.isInteger(p.offset)||p.offset<1)||p.limit!==undefined&&(!Number.isInteger(p.limit)||p.limit<1||p.limit>MAX_FILE_LINES))throw Error("read: invalid line range");
  if((await fs.stat(p.path)).size>2*1024*1024)throw Error("read: file exceeds 2 MiB; use targeted search");
  const bytes=await fs.readFile(p.path),raw=bytes.toString("utf8");
  if(bytes.includes(0)||!Buffer.from(raw).equals(bytes))throw Error("read: file is not UTF-8 text");
  const lines = raw.split("\n");
  const start = Math.min(lines.length,Math.max((p.offset ?? 1) - 1, 0));
  const end =
    p.limit !== undefined
      ? Math.min(start + p.limit, lines.length)
      : Math.min(start + 200, lines.length);
  const content=lines.slice(start,end).join("\n"),startOffset=start===0?0:Math.min(raw.length,lines.slice(0,start).join("\n").length+1);
  return {
    edit:{path:p.path,expectedHash:createHash("sha256").update(bytes).digest("hex"),range:{start:startOffset,end:startOffset+content.length},strict:true},
    content,
    totalLines: lines.length,
    truncated: end < lines.length,
    ...(end < lines.length ? {nextOffset:end+1} : {}),
  };
}

async function readText(payload: unknown): Promise<unknown> {
  const p = payload as { path: string };
  try {
    const bytes = await fs.readFile(p.path);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw new Error('write: the existing file is not valid UTF-8. Cannot preserve its original bytes for undo.');
    return text;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeFile(payload: unknown): Promise<unknown> {
  const p = payload as {path: string; content: string; expectedHash?: string | null};
  const stale = () => new Error('write: the destination changed after the preimage was read. Inspect the current file before retrying.');
  if (p.expectedHash !== undefined && p.expectedHash !== null) {
    if (typeof p.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.expectedHash)) throw new Error('write: invalid expectedHash.');
    try {
      const bytes = await fs.readFile(p.path);
      if (createHash('sha256').update(bytes).digest('hex') !== p.expectedHash) throw stale();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw stale();
      throw error;
    }
  }
  await fs.mkdir(path.dirname(p.path), { recursive: true });
  try {
    await fs.writeFile(p.path, p.content, {flag: p.expectedHash === null ? 'wx' : 'w'});
  } catch (error) {
    if (p.expectedHash === null && (error as NodeJS.ErrnoException).code === 'EEXIST') throw stale();
    throw error;
  }
  return { path: p.path, bytes: Buffer.byteLength(p.content) };
}

interface EditPayload {
  path: string;
  oldText: string;
  newText: string;
  replaceAll: boolean;
  expectedHash?:string;range?:{start:number;end:number};strict?:boolean;
}

async function editFile(payload: unknown): Promise<unknown> {
  const p = payload as EditPayload;
  const invalid=editArgumentError(p);if(invalid)throw Error(invalid);
  if (!p.oldText && !(p.expectedHash && p.range && p.range.start===p.range.end)) throw new Error("edit: oldText must be non-empty outside a guarded insertion");
  const content = await fs.readFile(p.path, "utf8");

  const writeChanged=async(next:string)=>{
    if(next===content)throw Error('edit: replacement leaves the file unchanged. Supply text that implements the intended change, or omit edit if the file is already correct.');
    await fs.writeFile(p.path,next);
  };

  if(p.expectedHash!==undefined){
    if(!/^[a-f0-9]{64}$/.test(p.expectedHash)||createHash('sha256').update(content).digest('hex')!==p.expectedHash)throw Error('edit: stale file snapshot; read the symbol/file again before editing and copy its current anchor. Earlier successful edits invalidate old snapshot hashes. No file was changed.');
  }
  if(p.range){
    if(p.range.end>content.length)throw Error(`edit.range [${p.range.start}, ${p.range.end}) exceeds snapshot length ${content.length} UTF-16 code units. Offsets are not line numbers. Copy the range from the current read/read_symbol edit anchor. No file was changed.`);
    const chunk=content.slice(p.range.start,p.range.end),count=p.oldText?countOccurrences(chunk,p.oldText):1;
    if(!p.oldText&&chunk)throw Error('edit: insertion requires an empty guarded range');
    if(!count||(!p.replaceAll&&count!==1))throw Error(`edit: ${count} exact matches for oldText inside range [${p.range.start}, ${p.range.end}) (UTF-16 code units, end exclusive; not line numbers). ${count===0?'Copy oldText exactly from the selected read and preserve its complete edit anchor.':'Choose more specific oldText inside the read anchor; use replaceAll only if every match in that range is intended.'} No file was changed.`);
    const changed=!p.oldText?p.newText:p.replaceAll?chunk.split(p.oldText).join(p.newText):chunk.replace(p.oldText,()=>p.newText);
    const next=content.slice(0,p.range.start)+changed+content.slice(p.range.end),hashAfter=createHash('sha256').update(next).digest('hex');
    await writeChanged(next);
    return{path:p.path,replacements:p.replaceAll?count:1,match:'exact',hashAfter,undo:{oldText:changed,newText:chunk,range:{start:p.range.start,end:p.range.start+changed.length},expectedHash:hashAfter,strict:true}};
  }
  const exactCount = countOccurrences(content, p.oldText);
  if (p.replaceAll) {
    if (exactCount === 0) {
      if(p.strict||p.expectedHash)throw Error("edit: exact oldText not found");
      const normalized = normalizedReplace(content, p.oldText, p.newText, true);
      if (normalized.count === 0)
        throw new Error(`edit: no match for oldText in ${p.path}`);
      await writeChanged(normalized.content);
      return {
        path: p.path,
        replacements: normalized.count,
        match: "normalized",
      };
    }
    await writeChanged(content.split(p.oldText).join(p.newText));
    return { path: p.path, replacements: exactCount, match: "exact" };
  }

  if (exactCount === 1) {
    await writeChanged(content.replace(p.oldText, () => p.newText));
    return { path: p.path, replacements: 1, match: "exact" };
  }
  if (exactCount > 1)
    throw new Error(
      `edit: oldText matches ${exactCount} places — set replaceAll or narrow it`
    );

  if(p.strict||p.expectedHash)throw Error("edit: exact oldText not found");
  const normalized = normalizedReplace(content, p.oldText, p.newText, false);
  if (normalized.count === 1) {
    await writeChanged(normalized.content);
    return { path: p.path, replacements: 1, match: "normalized" };
  }
  if (normalized.count > 1)
    throw new Error(
      `edit: normalized oldText matches ${normalized.count} places — narrow it`
    );
  throw new Error(`edit: no match for oldText in ${p.path}`);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** whitespace-normalized matching: collapse whitespace runs (with a raw-index
 *  map) so indentation drift matches, then map matches back to raw offsets. */
function normalizedReplace(
  content: string,
  oldText: string,
  newText: string,
  all: boolean
): { content: string; count: number } {
  const {norm,map}=normalizeWithMap(content),needle=normalizeWithMap(oldText).norm;
  if(!needle.trim())throw Error('edit: normalized oldText must contain non-whitespace text');
  const spans:Array<[number,number]>=[];let from=0;
  while(true){const index=norm.indexOf(needle,from);if(index<0)break;spans.push([map[index],map[index+needle.length-1]+1]);from=index+needle.length;}
  if(!all&&spans.length!==1)return{content,count:spans.length};
  let result=content;for(const[start,end]of spans.reverse())result=result.slice(0,start)+newText+result.slice(end);
  return{content:result,count:spans.length};
}

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let inWhitespace = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      if (!inWhitespace) {
        norm += " ";
        map.push(i);
        inWhitespace = true;
      }
    } else {
      norm += s[i];
      map.push(i);
      inWhitespace = false;
    }
  }
  return { norm, map };
}
