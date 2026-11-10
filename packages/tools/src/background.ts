import {randomUUID} from 'node:crypto';
import {spawnCommand,stopProcess} from './execution.js';
export type ShellStatus={id:string;cwd:string;done:boolean;exitCode:number|null;reason:'running'|'exited'|'cancelled'|'timed-out';startedAt:number;endedAt?:number;durationMs:number};
type Job={status:ShellStatus;child:Awaited<ReturnType<typeof spawnCommand>>;stdout:Buffer;stderr:Buffer;truncated:boolean;closed:Promise<void>};
const MAX_OUTPUT=512*1024,MAX_JOBS=128,MAX_RUNNING=16;
/** Session-owned shells. Completion is an OS close event, never a polling loop. */
export function backgroundScope(completed?:(status:ShellStatus)=>Promise<void>){
 const jobs=new Map<string,Job>();let starting=0;
 const status=(job:Job)=>({...job.status,durationMs:(job.status.endedAt??Date.now())-job.status.startedAt});
 const get=(id:string)=>{const job=jobs.get(id);if(!job)throw Error(`no such background shell in this session: ${id}`);return job;};
 const kill=(job:Job,reason:'cancelled'|'timed-out')=>{if(!job.status.done&&job.status.reason==='running'){job.status.reason=reason;stopProcess(job.child);}};
 return{
  async start(p:{command:string;cwd:string;env?:Record<string,string>;timeoutMs:number},signal?:AbortSignal){
   if(!Number.isSafeInteger(p.timeoutMs)||p.timeoutMs<1||p.timeoutMs>86400000)throw Error('Background timeoutMs must be 1..86400000');
   if([...jobs.values()].filter(job=>!job.status.done).length+starting>=MAX_RUNNING)throw Error('At most 16 background shells may run per session');
   signal?.throwIfAborted();starting++;
   let child:Awaited<ReturnType<typeof spawnCommand>>;
   try{child=await spawnCommand(p.command,p.cwd,p.env);}finally{starting--;}
   const id='shell-'+randomUUID();let close!:()=>void;
   const job:Job={status:{id,cwd:p.cwd,done:false,exitCode:null,reason:'running',startedAt:Date.now(),durationMs:0},child,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),truncated:false,closed:new Promise(resolve=>{close=resolve;})};
   jobs.set(id,job);
   for(const key of ['stdout','stderr'] as const)child[key].on('data',(bytes:Buffer)=>{const next=Buffer.concat([job[key],bytes]);job.truncated ||=next.length>MAX_OUTPUT;job[key]=next.subarray(Math.max(0,next.length-MAX_OUTPUT));});
   const timer=setTimeout(()=>kill(job,'timed-out'),p.timeoutMs);timer.unref?.();
   let spawned=false;
   const abort=()=>kill(job,'cancelled');signal?.addEventListener('abort',abort,{once:true});
   child.once('close',code=>{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);job.status.done=true;job.status.exitCode=code??-1;job.status.endedAt=Date.now();
    if(job.status.reason==='running')job.status.reason='exited';close();
    if(!spawned){jobs.delete(id);return;}
    void completed?.(status(job)).catch(()=>{});
    for(const [key,entry]of jobs)if(jobs.size>MAX_JOBS&&entry.status.done)jobs.delete(key);
   });
   return await new Promise<{shellId:string;started:true}>((accept,reject)=>{
    child.once('error',error=>{void job.closed.then(()=>reject(error));});
    child.once('spawn',()=>{spawned=true;signal?.removeEventListener('abort',abort);if(signal?.aborted){abort();void job.closed.then(()=>reject(Error('Background launch cancelled')));}else accept({shellId:id,started:true});});
   });
  },
  metadata(id?:string){return id?status(get(id)):[...jobs.values()].map(status);},
  output(id:string){const job=get(id);return{...status(job),stdout:job.stdout.toString('utf8'),stderr:job.stderr.toString('utf8'),truncated:job.truncated};},
  async kill(id:string){const job=get(id);kill(job,'cancelled');await job.closed;return{id,killed:true};},
  async revalidate(check:(cwd:string)=>Promise<unknown>){const stopped:Promise<void>[]=[];for(const job of jobs.values())if(!job.status.done)try{await check(job.status.cwd);}catch{kill(job,'cancelled');stopped.push(job.closed);}await Promise.all(stopped);},
  async close(){const current=[...jobs.values()];for(const job of current)kill(job,'cancelled');await Promise.all(current.map(job=>job.closed));jobs.clear();},
 };
}
