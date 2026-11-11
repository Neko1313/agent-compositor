import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '@agent-compositor/runtime';
import {attach,type HooksApi} from '../src/index.js';
const roots:string[]=[],pids:number[]=[],hosts:ReturnType<typeof attach>[]=[];
async function stopped(pid:number){
 await expect.poll(async()=>{try{process.kill(pid,0);return process.platform==='linux'&&/\) Z /.test(await readFile('/proc/'+pid+'/stat','utf8'));}catch(error:any){if(['ESRCH','ENOENT'].includes(error.code))return true;throw error;}},{timeout:2000}).toBe(true);
}
afterEach(async()=>{for(const host of hosts.splice(0))host.close();for(const pid of pids.splice(0)){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}}for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'plugin-exec-'));roots.push(root);const foreground=new AbortController();
 const host=attach(new Runtime(),{session:{id:'exec-test',cwd:root},signal:()=>foreground.signal});hosts.push(host);
 let api!:HooksApi;host.registerPlugin({name:'process-owner',version:'1.0.0',trust:'trusted'},{'session.start':(_e,$)=>{api=$.background();}});
 await host.emit('session.start',{sessionId:'exec-test',cwd:root,plugins:[]});
 const worker=join(root,'worker.cjs'),pidFile=join(root,'pids.json');
 await writeFile(worker,`const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const started=async()=>{let ids:number[]=[];await expect.poll(async()=>{ids=await readFile(pidFile,'utf8').then(JSON.parse,()=>[]);return ids.length;},{timeout:2000}).toBe(2);pids.push(...ids);return ids;};
 return{root,host,api,foreground,worker,started};
}
it('cancels a direct tool service request and reaps its entire process group before settling',async()=>{
 const f=await fixture(),abort=new AbortController();
 const work=f.host.emit('service.exec.run',{plugin:'process-owner',cmd:process.execPath,args:[f.worker],timeoutMs:10000},abort.signal).then(()=> 'completed',()=> 'cancelled');
 const ids=await f.started();abort.abort(Error('Cancelled operation'));
 expect(await Promise.race([work,new Promise(done=>setTimeout(()=>done('still running'),500))])).toBe('cancelled');
 for(const pid of ids)await stopped(pid);
});
it('kills a retained background subprocess when its owning plugin is unloaded',async()=>{
 const f=await fixture();const work=f.api.exec.run(process.execPath,[f.worker],{timeoutMs:10000}).then(()=> 'completed',()=> 'cancelled');
 const ids=await f.started();f.host.unregisterPlugin('process-owner');
 expect(await Promise.race([work,new Promise(done=>setTimeout(()=>done('still running'),500))])).toBe('cancelled');for(const pid of ids)await stopped(pid);
});
it('reports a timeout truthfully and kills descendants',async()=>{
 const f=await fixture();const work=f.api.exec.run(process.execPath,[f.worker],{timeoutMs:700});const ids=await f.started();
 expect(await work).toMatchObject({exitCode:-1,stderr:expect.stringContaining('timed out')});for(const pid of ids)await stopped(pid);
});
it('does not bind UI subprocesses to an already cancelled foreground turn',async()=>{
 const f=await fixture();let result:any;
 f.host.registerPlugin({name:'settings-action',version:'1.0.0',trust:'trusted'},{'ui.press':async(_e,$)=>{result=await $.exec.run(process.execPath,['-e','process.stdout.write("UI_ACTIVE")']);}});
 f.foreground.abort();const emitted=await f.host.emit('ui.press',{site:'settings',key:'probe'});
 expect(emitted.faults).toEqual([]);expect(result).toMatchObject({exitCode:0,stdout:'UI_ACTIVE'});
});
it('does not leave a background descendant behind after the foreground command exits',async()=>{
 const f=await fixture();
 await writeFile(f.worker,`const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(join(f.root,'pids.json'))},JSON.stringify([process.pid,child.pid]));process.exit(0);`);
 expect(await f.api.exec.run(process.execPath,[f.worker])).toMatchObject({exitCode:0});
 for(const pid of await f.started())await stopped(pid);
});
it('bounds combined output and preserves spawn failures',async()=>{
 const f=await fixture();const result=await f.api.exec.run(process.execPath,['-e','process.stdout.write("x".repeat(2*1024*1024))']);
 expect(result.exitCode).not.toBe(0);expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1048576);expect(result.stderr).toContain('1 MiB');
 await expect(f.api.exec.run(join(f.root,'missing-executable'))).rejects.toMatchObject({code:'ENOENT'});
});
