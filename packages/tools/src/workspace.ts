import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { realpath, stat } from "node:fs/promises";

export interface WorkspaceEntry {path:string;kind:"file"|"directory";}
/** User-selected filesystem scope. A file attachment does not grant its siblings. */
export class WorkspaceAccess {
  readonly root:string;
  private entries:WorkspaceEntry[]=[];
  constructor(cwd:string,readonly home=homedir(),additional:string[]=[]){
    try{this.root=realpathSync(cwd);}catch{this.root=resolve(cwd);}this.entries=[{path:this.root,kind:"directory"}];
    for(const value of additional){const path=realpathSync(this.expand(value));if(!statSync(path).isDirectory())throw Error(`Workspace must be a directory: ${value}`);this.insert({path,kind:"directory"});}
  }
  expand(value:string){return resolve(this.root,value==="~"?this.home:value.startsWith("~/")?resolve(this.home,value.slice(2)):value);}
  list():WorkspaceEntry[]{return this.entries.map(entry=>({...entry}));}
  private insert(entry:WorkspaceEntry){if(!this.entries.some(existing=>existing.path===entry.path&&existing.kind===entry.kind))this.entries.push(entry);}
  async add(value:string):Promise<WorkspaceEntry>{
    const path=await realpath(this.expand(value)),info=await stat(path);
    if(!info.isFile()&&!info.isDirectory())throw Error("Only regular files and directories can be attached");
    const entry:WorkspaceEntry={path,kind:info.isDirectory()?"directory":"file"};if(!this.rootFor(path))this.insert(entry);return entry;
  }
  async remove(value:string){const path=await realpath(this.expand(value)).catch(()=>this.expand(value));if(path===this.root)throw Error("The primary workspace cannot be removed");const count=this.entries.length;this.entries=this.entries.filter(entry=>entry.path!==path&&!entry.path.startsWith(path.endsWith(sep)?path:path+sep));return count!==this.entries.length;}
  restore(raw:unknown){
    if(!Array.isArray(raw))return;
    for(const entry of raw){if(!entry||typeof entry.path!=="string"||!isAbsolute(entry.path)||!["file","directory"].includes(entry.kind))continue;
      try{const path=realpathSync(entry.path),info=statSync(path);if(entry.kind==="directory"?info.isDirectory():info.isFile())this.insert({path,kind:entry.kind});}catch{/* A removed attachment must not prevent conversation resumption. */}
    }
  }
  rootFor(path:string):string|undefined{return this.entries.filter(entry=>entry.kind==="directory"&&(path===entry.path||path.startsWith(entry.path.endsWith(sep)?entry.path:entry.path+sep))).sort((a,b)=>b.path.length-a.path.length)[0]?.path;}
  /** Resolve metadata for policy matching without granting access or attaching a root. */
  async canonical(value:string,options:{missing?:boolean}={}):Promise<string>{
    const path=this.expand(value);
    const existing=async(target:string):Promise<string>=>{
      try{return await realpath(target);}catch(error){if(!options.missing||(error as NodeJS.ErrnoException).code!=="ENOENT")throw error;const parent=dirname(target);if(parent===target)throw error;return resolve(await existing(parent),basename(target));}
    };
    return existing(path);
  }
  async resolve(value:string,options:{missing?:boolean;directory?:boolean}={}):Promise<string>{
    const canonical=await this.canonical(value,options);
    const allowed=this.rootFor(canonical)||this.entries.some(entry=>entry.kind==="file"&&entry.path===canonical);
    if(!allowed)throw Error(`Path escapes attached workspaces: ${value}. Attach it with @path or /workspace add first.`);
    if(options.directory&&!(await stat(canonical)).isDirectory())throw Error(`Not a workspace directory: ${value}`);
    return canonical;
  }
}
