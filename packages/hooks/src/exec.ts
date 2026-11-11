import {spawn} from 'node:child_process';

/** Owned process groups let cancellation stop descendants before settling. */
export function runPluginProcess(cmd:string,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;signal:AbortSignal;timeoutMs:number}) {
  options.signal.throwIfAborted();
  return new Promise<{exitCode:number;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(cmd,args,{cwd:options.cwd,env:options.env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const stdout:Buffer[]=[],stderr:Buffer[]=[];let bytes=0,reason='',failure:Error|undefined;
    const stop=()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{child.kill('SIGKILL');}};
    const abort=()=>stop();
    const timer=setTimeout(()=>{reason=`Process timed out after ${options.timeoutMs}ms`;stop();},options.timeoutMs);
    timer.unref();
    const collect=(target:Buffer[],data:Buffer)=>{
      const available=Math.max(0,1048576-bytes);
      target.push(data.subarray(0,available));bytes+=Math.min(data.length,available);
      if(data.length>available){reason='Process output exceeded 1 MiB';stop();}
    };
    child.stdout.on('data',(data:Buffer)=>collect(stdout,data));
    child.stderr.on('data',(data:Buffer)=>collect(stderr,data));
    child.on('error',error=>{failure=error;});
    child.on('close',code=>{
      stop();
      clearTimeout(timer);options.signal.removeEventListener('abort',abort);
      if(options.signal.aborted){reject(options.signal.reason??new Error('Process cancelled'));return;}
      if(failure){reject(failure);return;}
      resolve({exitCode:reason?-1:code??-1,stdout:Buffer.concat(stdout).toString(),stderr:[Buffer.concat(stderr).toString(),reason].filter(Boolean).join('\n')});
    });
    options.signal.addEventListener('abort',abort,{once:true});
    if(options.signal.aborted)abort();
  });
}
