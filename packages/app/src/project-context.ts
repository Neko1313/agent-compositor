import { readFile, readdir, stat } from "node:fs/promises";
import { join, dirname, relative, extname, resolve, sep } from "node:path";
import { confinedPath, projectFiles, WorkspaceAccess, type WorkspaceEntry } from "@agent-compositor/tools";
const MAX_CONTEXT = 120_000;
async function instructions(dir: string,authorize?:(path:string)=>Promise<void>): Promise<string> {
  const parts: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
    try {
      const file = join(dir, name);
      const info = await stat(file);
      if (info.size < MAX_CONTEXT){
        await authorize?.(file);parts.push(`# ${name}\n${await readFile(file, "utf8")}`);
      }
    } catch {
      /* optional project convention */
    }
  }
  return parts.join("\n\n").slice(0, MAX_CONTEXT);
}
export async function projectInstructions(
  root: string,
  globalRoot?: string
): Promise<string> {
  return [
    globalRoot ? await instructions(globalRoot) : "",
    await instructions(root),
    await instructions(join(root, ".agent-compositor")),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CONTEXT);
}
export async function expandReferences(
  root: string,
  text: string,
  options:{workspace?:WorkspaceAccess;attach?:(path:string)=>Promise<WorkspaceEntry>;authorize?:(path:string)=>Promise<void>;signal?:AbortSignal}={}
): Promise<{ text: string; images: { mimeType: string; data: string }[] }> {
  const images: { mimeType: string; data: string }[] = [];
  const parts = [text],
    dirs = new Set<string>();
  let used = text.length;
  for (const match of text.matchAll(/(?:^|\s)@(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s"']+))/g)) {
    let name=match[2]??match[3];
    if(match[1]!==undefined){try{name=JSON.parse('"'+match[1]+'"');}catch{parts.push('Invalid quoted reference');continue;}}
    if (!name || used >= MAX_CONTEXT) continue;
    try {
      options.signal?.throwIfAborted();
      await options.attach?.(name);
      options.signal?.throwIfAborted();
      const path = options.workspace?await options.workspace.resolve(name):await confinedPath(root,name);
      const info = await stat(path);await options.authorize?.(path);
      options.signal?.throwIfAborted();
      if (info.isDirectory()) {
        const all=await projectFiles(path,201),files=all.slice(0,200);
        const content = `\nDirectory @${name} (absolute path ${JSON.stringify(path)}):\n${files.join("\n")}${all.length>200?'\n[Listing truncated at 200 files]':''}`;
        parts.push(content);
        used += content.length;
        const rules=await instructions(path,options.authorize);if(rules){parts.push(rules.slice(0,Math.max(0,MAX_CONTEXT-used)));used+=rules.length;}
        continue;
      }
      const mime = (
        {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
        } as Record<string, string>
      )[extname(path).toLowerCase()];
      if (mime) {
        if (info.size > 10 * 1024 * 1024) throw new Error("Image exceeds 10MB");
        images.push({
          mimeType: mime,
          data: (await readFile(path,{signal:options.signal})).toString("base64"),
        });
        parts.push(`Attached image @${name}`);
        continue;
      }
      if (info.size > MAX_CONTEXT || !info.isFile())
        throw new Error(`File exceeds ${MAX_CONTEXT} bytes`);
      let content = await readFile(path,{encoding:"utf8",signal:options.signal});
      if (content.includes("\0"))
        throw new Error("Binary file: use --image for images");
      content = content.slice(0, MAX_CONTEXT - used);
      parts.push(`\n<file path=${JSON.stringify(path)}>\n${content}\n</file>`);
      used += content.length;
      const boundary=options.workspace?.rootFor(path)??root;
      let dir = dirname(path);
      while ((options.workspace?.rootFor(dir)&&dir!==dirname(boundary))||(!options.workspace&&relative(root,dir)&&!relative(root,dir).startsWith('..'))) {
        if (!dirs.has(dir)) {
          dirs.add(dir);
          const rules = await instructions(dir,options.authorize);
          if (rules) {
            parts.push(rules.slice(0, MAX_CONTEXT - used));
            used += rules.length;
          }
        }
        if(dir===boundary)break;dir = dirname(dir);
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      parts.push(`\nReference @${name}: ${String(error)}`);
    }
  }
  options.signal?.throwIfAborted();
  return { text:text+parts.slice(1).map(part=>"\n"+part).join("").slice(0,Math.max(0,MAX_CONTEXT-text.length)), images };
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
