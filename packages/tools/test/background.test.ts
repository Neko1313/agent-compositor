import {it,expect} from 'vitest';
import {backgroundScope} from '../src/background.js';
it('bounds background output while preserving the tail and emits one terminal event',async()=>{
 const events:any[]=[],jobs=backgroundScope(async event=>{events.push(event);});
 try{
  const{shellId}=await jobs.start({command:`node -e 'process.stdout.write("x".repeat(600000)+"TAIL")'`,cwd:process.cwd(),timeoutMs:3000});
  await new Promise<void>(resolve=>{const check=()=>{if((jobs.metadata(shellId)as any).done)resolve();else setTimeout(check,5);};check();});
  const output=jobs.output(shellId);expect(output.truncated).toBe(true);expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(512*1024);expect(output.stdout.endsWith('TAIL')).toBe(true);expect(events).toHaveLength(1);expect(events[0]).not.toHaveProperty('stdout');
 }finally{await jobs.close();}
});
it('rejects unavailable cwd and invalid deadlines, then recovers without retained phantom jobs',async()=>{
 const jobs=backgroundScope();try{
  await expect(jobs.start({command:'true',cwd:'/nonexistent/background-fixture',timeoutMs:3000})).rejects.toThrow();
  await expect(jobs.start({command:'true',cwd:process.cwd(),timeoutMs:0})).rejects.toThrow('timeoutMs');
  expect(jobs.metadata()).toEqual([]);
  const job=await jobs.start({command:'sleep 30',cwd:process.cwd(),timeoutMs:3000});await jobs.kill(job.shellId);expect(jobs.metadata(job.shellId)).toMatchObject({done:true,reason:'cancelled'});
 }finally{await jobs.close();}
});
it('caps active background shells and drains every accepted process on teardown',async()=>{
 const jobs=backgroundScope();try{
  for(let i=0;i<16;i++)await jobs.start({command:'sleep 30',cwd:process.cwd(),timeoutMs:30000});
  await expect(jobs.start({command:'sleep 30',cwd:process.cwd(),timeoutMs:30000})).rejects.toThrow('16 background shells');
 }finally{await jobs.close();}expect(jobs.metadata()).toEqual([]);
});
