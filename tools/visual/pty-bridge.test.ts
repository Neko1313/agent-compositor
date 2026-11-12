import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

function bridge(script:string){
 const python=process.env.PYTHON??'python3';const child=spawn(python,['-u',resolve('tools/visual/pty_bridge.py'),python,'-u','-c',script],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 child.stdin.on('error',()=>{});
 const done=new Promise<number|null>((accept,reject)=>{child.once('error',reject);child.once('close',code=>accept(code));});
 return{child,done,get stdout(){return stdout;},get stderr(){return stderr;}};
}

it.each([0,7])('reaps a naturally exited PTY child and propagates status %s',async code=>{
 const f=bridge(`print('PTY_CHILD_DONE',flush=True);raise SystemExit(${code})`);
 try{expect(await f.done).toBe(code);expect(f.stdout).toContain('PTY_CHILD_DONE');expect(f.stderr).toBe('');}
 finally{f.child.kill('SIGTERM');f.child.stdin.destroy();}
});

it('terminates its owned child when the bridge is stopped',async()=>{
 const f=bridge("import os,time;print('OWNED_CHILD:'+str(os.getpid()),flush=True);time.sleep(60)");
 try{
  await expect.poll(()=>f.stdout.includes('OWNED_CHILD:')).toBe(true);
  const events=f.stdout.trim().split('\n').map(line=>JSON.parse(line));const pid=Number(events.map(event=>event.data).join('').match(/OWNED_CHILD:(\d+)/)![1]);
  f.child.kill('SIGTERM');expect(await f.done).toBe(0);expect(f.stderr).toBe('');
  expect(()=>process.kill(pid,0)).toThrow();
 }finally{f.child.kill('SIGTERM');f.child.stdin.destroy();}
});
