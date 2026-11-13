import { readFile, readdir, realpath, stat, lstat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { confinedPath, projectFiles, WorkspaceAccess, type WorkspaceEntry } from "@agent-compositor/tools";

const MAX_CONTEXT = 120_000;
const PREVIEW_BYTES = 16_000;
class ProjectInstructionsError extends Error {}
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
function completeInstructions(parts: string[]): string {
  const text = parts.filter(Boolean).join("\n\n");
  if (bytes(text) > MAX_CONTEXT)
    throw new ProjectInstructionsError(`Project instruction limit exceeded (${MAX_CONTEXT} UTF-8 bytes)`);
  return text;
}
type InstructionAccess = { resolve?: (path: string) => Promise<string>; authorize?: (path: string) => Promise<void>; signal?: AbortSignal };
const MAX_REFERENCES = 64;
const IMAGE_BYTES = 10 * 1024 * 1024;
const TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;

async function instructions(dir: string, access: InstructionAccess = {}): Promise<string> {
  const parts: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
    access.signal?.throwIfAborted();
    const file = join(dir, name);
    try {
      await lstat(file);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      throw new ProjectInstructionsError(`Cannot inspect project instructions ${file}: ${String(error)}`);
    }
    try {
      const path = access.resolve ? await access.resolve(file) : await realpath(file);
      await access.authorize?.(path);
      const info = await stat(path);
      if (!info.isFile()) throw new ProjectInstructionsError(`Project instruction path must be a regular file: ${file}`);
      if (info.size > MAX_CONTEXT) throw new ProjectInstructionsError(`Project instruction limit exceeded: ${file}`);
      const data = await readFile(path, { signal: access.signal });
      const text = data.toString("utf8");
      if (text.includes("\0") || !Buffer.from(text, "utf8").equals(data))
        throw new ProjectInstructionsError(`Project instructions require valid UTF-8 text: ${file}`);
      parts.push(`# ${name}\n${text}`);
    } catch (error) {
      access.signal?.throwIfAborted();
      if (error instanceof ProjectInstructionsError) throw error;
      throw new ProjectInstructionsError(`Cannot load project instructions ${file}: ${String(error)}`);
    }
  }
  return completeInstructions(parts);
}
export async function projectInstructions(root: string, globalRoot?: string): Promise<string> {
  return completeInstructions([
    globalRoot ? await instructions(globalRoot) : "",
    await instructions(root),
    await instructions(join(root, ".agent-compositor")),
  ]);
}

/** Select a prefix without splitting a Unicode code point or its UTF-8 encoding. */
function prefix(text: string, budget: number): string {
  let end = 0, used = 0;
  for (const point of text) {
    const size = bytes(point);
    if (used + size > budget) break;
    used += size; end += point.length;
  }
  return text.slice(0, end);
}
type Preview = { kind: "file"; path: string; content: string }
  | { kind: "directory"; header: string; files: string[]; truncated: boolean }
  | { kind: "notice"; text: string };
function renderPreview(record: Preview, budget: number): string | undefined {
  if (record.kind === "notice") return bytes(record.text) <= budget ? record.text : undefined;
  if (record.kind === "file") {
    const head = `<file path=${JSON.stringify(record.path)}>\n`, tail = "\n</file>";
    if (bytes(head) + bytes(record.content) + bytes(tail) <= budget) return head + record.content + tail;
    const marker = `\n[Preview truncated. Native read arguments: ${JSON.stringify({ path: record.path })}]`;
    const available = budget - bytes(head + marker + tail);
    return available < 0 ? undefined : head + prefix(record.content, available) + marker + tail;
  }
  const listing = [record.header, ...record.files];
  if (record.truncated) listing.push("[Listing truncated at 200 files]");
  const complete = listing.join("\n");
  if (bytes(complete) <= budget) return complete;
  const marker = "[Listing preview truncated]";
  let available = budget - bytes(record.header + "\n" + marker);
  if (available < 0) return;
  const lines = [record.header];
  for (const file of record.files) {
    const size = bytes(file) + 1;
    if (size > available) break;
    lines.push(file);
    available -= size;
  }
  return [...lines, marker].join("\n");
}

export async function expandReferences(
  root: string,
  text: string,
  options: {
    workspace?: WorkspaceAccess; attach?: (path: string) => Promise<WorkspaceEntry>;
    authorize?: (path: string) => Promise<void>; signal?: AbortSignal;
    /** Text preview budget, excluding the submitted prompt and complete instructions. */
    maxBytes?: number;
  } = {}
): Promise<{ text: string; images: { mimeType: string; data: string }[] }> {
  options.signal?.throwIfAborted();
  const budget = options.maxBytes ?? PREVIEW_BYTES;
  if (!Number.isSafeInteger(budget) || budget < 256 || budget > MAX_CONTEXT)
    throw new Error(`Reference preview maxBytes must be an integer between 256 and ${MAX_CONTEXT}`);
  const images: { mimeType: string; data: string }[] = [];
  if (text.length >= MAX_CONTEXT) return { text, images };
  const records: Preview[] = [], dirs = new Set<string>(), rules: string[] = [];
  const resolvePath = (name: string) => options.workspace
    ? options.workspace.resolve(name)
    : confinedPath(root, name).then(path => realpath(path));
  let totalImageBytes = 0, referenceCount = 0, deferred = false;
  async function addInstructions(path: string, directory: boolean) {
    const boundary = options.workspace ? options.workspace.rootFor(path) : await realpath(root);
    if (!boundary) return; // A single external file grant does not include its parent.
    let dir = directory ? path : dirname(path);
    while (true) {
      if (dirs.has(dir)) break;
      dirs.add(dir);
      const value = await instructions(dir, { resolve: resolvePath, authorize: options.authorize, signal: options.signal });
      if (value) {
        rules.push(value);
        completeInstructions(rules);
      }
      if (dir === boundary || dir === dirname(dir)) break;
      dir = dirname(dir);
    }
  }
  for (const match of text.matchAll(/(?:^|\s)@(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s"']+))/g)) {
    if (referenceCount >= MAX_REFERENCES) { deferred = true; break; }
    referenceCount++;
    let name = match[2] ?? match[3];
    if (match[1] !== undefined) {
      try { name = JSON.parse('"' + match[1] + '"'); }
      catch { records.push({ kind: "notice", text: "Invalid quoted reference" }); continue; }
    }
    if (!name) continue;
    try {
      options.signal?.throwIfAborted();
      await options.attach?.(name);
      options.signal?.throwIfAborted();
      const path = await resolvePath(name);
      const info = await stat(path);
      await options.authorize?.(path);
      options.signal?.throwIfAborted();
      await addInstructions(path, info.isDirectory());
      if (info.isDirectory()) {
        const all = await projectFiles(path, 201);
        records.push({ kind: "directory", header: `Directory @${name} (absolute path ${JSON.stringify(path)}):`, files: all.slice(0, 200), truncated: all.length > 200 });
        continue;
      }
      const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[extname(path).toLowerCase()];
      if (mime) {
        if (!info.isFile() || info.size > IMAGE_BYTES) throw new Error("Image exceeds 10MB or is not a file");
        if (totalImageBytes + info.size > TOTAL_IMAGE_BYTES) throw new Error("Attached images exceed 32 MiB combined");
        const data = await readFile(path, { signal: options.signal });
        if (data.length > IMAGE_BYTES) throw new Error("Image exceeds 10MB");
        if (totalImageBytes + data.length > TOTAL_IMAGE_BYTES) throw new Error("Attached images exceed 32 MiB combined");
        totalImageBytes += data.length;
        images.push({ mimeType: mime, data: data.toString("base64") });
        records.push({ kind: "notice", text: `Attached image @${name}` });
        continue;
      }
      if (info.size > MAX_CONTEXT || !info.isFile()) throw new Error(`File exceeds ${MAX_CONTEXT} bytes`);
      const data = await readFile(path, { signal: options.signal }), content = data.toString("utf8");
      if (data.length > MAX_CONTEXT) throw new Error(`File exceeds ${MAX_CONTEXT} bytes`);
      if (content.includes("\0") || !Buffer.from(content, "utf8").equals(data)) throw new Error("Binary file: expected valid UTF-8 text");
      records.push({ kind: "file", path, content });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof ProjectInstructionsError) throw error;
      records.push({ kind: "notice", text: `Reference @${name}: ${String(error)}` });
    }
  }
  options.signal?.throwIfAborted();
  const footer = "\n[Some reference previews omitted by the byte budget. Read explicit paths with tools.]";
  const limitNotice = deferred ? "\n[Only the first 64 references were processed. Submit the remaining paths separately.]" : "";
  function render(available: number) {
    const parts: string[] = [];
    let omitted = false;
    for (const [index, record] of records.entries()) {
      const share = Math.floor(available / (records.length - index)) - 1;
      const preview = renderPreview(record, share);
      if (preview === undefined) { omitted = true; continue; }
      parts.push("\n" + preview);
      available -= 1 + bytes(preview);
    }
    return { text: parts.join(""), omitted };
  }
  const available = budget - bytes(limitNotice);
  const firstPass = render(available);
  const previews = firstPass.omitted ? render(available - bytes(footer)).text + footer : firstPass.text;
  const instructionText = completeInstructions(rules);
  return { text: text + (instructionText ? "\n" + instructionText : "") + previews + limitNotice, images };
}

/** A partial user-authored reference in the editor, including quoted paths. */
export function activeReference(text:string,cursor=text.length):{prefix:string;start:number;end:number}|undefined {
  const match=/(?:^|\s)@(?:"((?:\\.|[^"\\])*)"?|'([^']*)'?|([^\s"']*))$/.exec(text.slice(0,cursor));
  if(!match)return;
  let prefix=match[1]??match[2]??match[3]??'';
  if(match[1]!==undefined)try{prefix=JSON.parse('"'+prefix+'"');}catch{return;}
  const quote=match[1]!==undefined?'"':match[2]!==undefined?"'":undefined;
  return{prefix,start:match.index+match[0].indexOf('@'),end:cursor+(quote&&text[cursor]===quote?1:0)};
}
/** Completion is a UI read; browsing a prefix does not grant agent tool access. */
export async function referenceFiles(workspace:WorkspaceAccess,prefix=''):Promise<string[]> {
  const normalized=prefix.replaceAll('\\','/');
  if(!normalized.includes('/')&&!normalized.startsWith('~')){
    return [...await projectFiles(workspace.root,2000),...workspace.list().filter(entry=>entry.path!==workspace.root).map(entry=>entry.path+(entry.kind==='directory'?'/':''))].filter(value=>value.startsWith(prefix)).slice(0,200);
  }
  const slash=normalized.lastIndexOf('/'),base=slash<0?(normalized==='~'?'~/':''):normalized.slice(0,slash+1);
  const path=workspace.expand(base||'.'),needle=slash<0?normalized:normalized.slice(slash+1);
  try{return(await readdir(path,{withFileTypes:true})).filter(entry=>entry.name.startsWith(needle)).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name)).slice(0,200).map(entry=>base+entry.name+(entry.isDirectory()?'/':''));}
  catch(error){if(['ENOENT','ENOTDIR','EACCES'].includes((error as NodeJS.ErrnoException).code??''))return[];throw error;}
}
