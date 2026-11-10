import {it,expect} from 'vitest';
import {runBounded} from './process.js';
const cwd=process.cwd();
it('reports command failures and output-budget violations instead of successful empty evidence',async()=>{
 await expect(runBounded(process.execPath,['-e','process.exit(7)'],{cwd,timeout:5000,maxBuffer:10000})).rejects.toMatchObject({code:7});
 await expect(runBounded(process.execPath,['-e','process.stdout.write("x".repeat(20000))'],{cwd,timeout:5000,maxBuffer:100})).rejects.toThrow('output budget');
});
it('stops a timed-out process group including a spawned fixture child',async()=>{
 const script=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(child.pid);setInterval(()=>{},1000);`;
 let pid=0;
 try{await runBounded(process.execPath,['-e',script],{cwd,timeout:1500,maxBuffer:10000});throw Error('Timeout was not enforced');}
 catch(error:any){expect(error.message).toContain('time budget');pid=Number(error.stdout.trim());expect(pid).toBeGreaterThan(0);}
 // A reaped process or an adopted zombie has no running work; wait briefly for the OS to reap it.
 if(process.platform==='linux'){
  const{readFile}=await import('node:fs/promises');
  await expect.poll(async()=>{try{return /\) Z /.test(await readFile('/proc/'+pid+'/stat','utf8'));}catch(error:any){if(error.code==='ENOENT')return true;throw error;}},{timeout:3000}).toBe(true);
 }
});
