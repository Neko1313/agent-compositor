import {expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {registerDefaultResolvers} from '../src/resolvers.js';

const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error:any){if(error.code==='ESRCH')return false;throw error;}};
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
it.skipIf(process.platform==='win32')('settles a foreground exec timeout only after its actual child closes, preserving a neighbor',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'exec-timeout-settlement-')),pidfile=join(cwd,'worker.pid');
  const handlers=new Map<string,(payload:unknown)=>Promise<unknown>>(),close=registerDefaultResolvers({on:(name,handler)=>{handlers.set(name,handler);}});
  const neighbor=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const neighborClosed=new Promise<void>(done=>neighbor.once('close',()=>done()));let pid=0;
  try{
    const script=`require('node:fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));setInterval(()=>{},1000);`;
    const command=`exec ${quote(process.execPath)} -e ${quote(script)}`;
    const pending=handlers.get('service.shell.exec')!({command,cwd,timeoutMs:700}).catch(error=>error);
    await expect.poll(async()=>{pid=await readFile(pidfile,'utf8').then(Number,()=>0);return pid;},{timeout:3000}).toBeGreaterThan(0);
    expect(alive(pid)).toBe(true);const result=await pending;
    expect(result).toBeInstanceOf(Error);if(!(result instanceof Error))throw Error('Timeout did not reject with an Error');
    expect(result.message).toBe(`exec timed out after 700ms: ${command}`);
    expect(alive(pid)).toBe(false);expect(alive(neighbor.pid!)).toBe(true);
  }finally{
    if(pid&&alive(pid))try{process.kill(-pid,'SIGKILL');}catch{}
    neighbor.kill('SIGKILL');await neighborClosed;await close();await rm(cwd,{recursive:true,force:true});
  }
},10000);
