import {spawn} from 'node:child_process';
/** Bound output/time and terminate the owned process group, including fixture/model/UI descendants. */
export function runBounded(command:string,args:string[],options:{cwd:string;env?:NodeJS.ProcessEnv;timeout:number;maxBuffer:number}):Promise<{stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  const grouped=process.platform!=='win32';
  const child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:grouped,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',size=0,failure:string|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
  const kill=(signal:NodeJS.Signals)=>{try{if(grouped&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch(error:any){if(error.code!=='ESRCH')failure??=String(error);}};
  const stop=(reason:string)=>{failure??=reason;kill('SIGTERM');killTimer??=setTimeout(()=>kill('SIGKILL'),500);};
  const timer=setTimeout(()=>stop('Certification command exceeded its time budget'),options.timeout);
  const collect=(stream:'stdout'|'stderr',bytes:Buffer)=>{size+=bytes.length;if(size>options.maxBuffer){stop('Certification command exceeded its output budget');return;}if(stream==='stdout')stdout+=bytes.toString();else stderr+=bytes.toString();};
  child.stdout.on('data',bytes=>collect('stdout',bytes));child.stderr.on('data',bytes=>collect('stderr',bytes));
  child.once('error',error=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);reject(Object.assign(error,{stdout,stderr}));});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);if(killTimer)clearTimeout(killTimer);
   if(grouped&&child.pid){try{process.kill(-child.pid,0);failure??='Certification command left running descendants';kill('SIGKILL');}catch(error:any){if(error.code!=='ESRCH')failure??=String(error);}}
   if(failure||code!==0)reject(Object.assign(new Error(failure??`Certification command failed (${code??signal})`),{stdout,stderr,code,signal}));else resolve({stdout,stderr});
  });
 });
}
