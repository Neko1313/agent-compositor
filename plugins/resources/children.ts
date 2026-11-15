import {readFile, readdir} from 'node:fs/promises';

export type ChildrenSnapshot = {count:number; rss:number; partial:boolean; system?:{ticks:bigint;cpus:string}; processes?:Map<number,{start:bigint;ticks:bigint}>};

/** proc stat's command can contain spaces and parentheses; its final ')' ends field 2. */
export function processCounters(stat:string):{start:bigint;ticks:bigint} {
  const end=stat.lastIndexOf(')');
  if(end<0)throw Error('Invalid process stat');
  const fields=stat.slice(end+1).trim().split(/\s+/);
  if(fields.length<20||![fields[11],fields[12],fields[19]].every(value=>/^\d+$/.test(value)))throw Error('Invalid process counters');
  return {ticks:BigInt(fields[11])+BigInt(fields[12]),start:BigInt(fields[19])};
}

export function systemCounters(stat:string):{ticks:bigint;cpus:string} {
  const lines=stat.split('\n'),total=lines.find(line=>/^cpu\s/.test(line))?.trim().split(/\s+/).slice(1,9);
  const cpus=lines.filter(line=>/^cpu\d+\s/.test(line)).map(line=>line.split(/\s+/)[0]).sort();
  if(!total||total.length<4||!total.every(value=>/^\d+$/.test(value))||!cpus.length)throw Error('Invalid system counters');
  return {ticks:total.reduce((sum,value)=>sum+BigInt(value),0n),cpus:cpus.join(',')};
}

/** Uses matching process identities only; missing or new processes make the estimate incomplete. */
export class ChildrenCpu {
  private previous?:ChildrenSnapshot;
  reset(){this.previous=undefined;}
  sample(next:ChildrenSnapshot):{cpu?:number;partial:boolean} {
    const prior=this.previous;this.previous=next;
    if(!prior?.system||!next.system||!prior.processes||!next.processes||prior.system.cpus!==next.system.cpus)return {partial:true};
    const elapsed=next.system.ticks-prior.system.ticks;
    if(elapsed<=0n)return {partial:true};
    let ticks=0n,partial=prior.partial||next.partial||prior.processes.size!==next.processes.size;
    for(const [pid,current] of next.processes){
      const old=prior.processes.get(pid);
      if(!old||old.start!==current.start||current.ticks<old.ticks){partial=true;continue;}
      ticks+=current.ticks-old.ticks;
    }
    const cpu=Number(ticks)*next.system.cpus.split(',').length/Number(elapsed)*100;
    return Number.isFinite(cpu)?{cpu,partial}:{partial:true};
  }
}

/** Best-effort snapshot of live Linux descendants; never reads command lines. */
export async function snapshotChildren(signal?:AbortSignal):Promise<ChildrenSnapshot | undefined> {
  if (process.platform !== 'linux') return undefined;
  const root=process.pid;
  const pending=[root], seen=new Set<number>([root]);
  const processes=new Map<number,{start:bigint;ticks:bigint}>();
  let system:ChildrenSnapshot['system'];
  let count=0,rss=0,partial=false;
  try{system=systemCounters(await readFile('/proc/stat',{encoding:'utf8',signal}));}catch{signal?.throwIfAborted();partial=true;}
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
      try{processes.set(pid,processCounters(await readFile(`/proc/${pid}/stat`,{encoding:'utf8',signal})));}
      catch{signal?.throwIfAborted();partial=true;}
    } catch {signal?.throwIfAborted();partial=true;}
  }
  return {count,rss,partial,system,processes};
}
