import {readFile, readdir} from 'node:fs/promises';

export type ChildrenSnapshot = {count:number; rss:number; partial:boolean};

/** Best-effort snapshot of live Linux descendants; never reads command lines. */
export async function snapshotChildren(signal?:AbortSignal):Promise<ChildrenSnapshot | undefined> {
  if (process.platform !== 'linux') return undefined;
  const root=process.pid;
  const pending=[root], seen=new Set<number>([root]);
  let count=0,rss=0,partial=false;
  while(pending.length) {
    signal?.throwIfAborted();
    const pid=pending.shift()!;
    let tasks:string[];
    try {tasks=await readdir(`/proc/${pid}/task`);} catch {partial=true;continue;}
    if(tasks.length>128){tasks=tasks.slice(0,128);partial=true;}
    for(const tid of tasks) {
      signal?.throwIfAborted();
      let children:string;
      try {children=await readFile(`/proc/${pid}/task/${tid}/children`,{encoding:'utf8',signal});} catch {signal?.throwIfAborted();partial=true;continue;}
      for(const value of children.trim().split(/\s+/)) {
        if(!/^\d+$/.test(value))continue;
        const child=Number(value);
        if(!Number.isSafeInteger(child)||child<=0||seen.has(child))continue;
        if(seen.size>=513){partial=true;continue;}
        seen.add(child);pending.push(child);
      }
    }
    if(pid===root)continue;
    try {
      const status=await readFile(`/proc/${pid}/status`,{encoding:'utf8',signal});
      const match=/^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(status);
      if(!match){partial=true;continue;}
      const bytes=Number(match[1])*1024;
      if(!Number.isSafeInteger(bytes)){partial=true;continue;}
      count++;rss+=bytes;
    } catch {signal?.throwIfAborted();partial=true;}
  }
  return {count,rss,partial};
}
