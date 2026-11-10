import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ScriptedProvider} from '@agent-compositor/core';
import {Fixture,Casebook} from './fixture.js';
const exec=promisify(execFile),pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(test:()=>Promise<boolean>){for(let i=0;i<200;i++){if(await test())return;await pause(10);}throw Error('Background condition did not settle');}
export function backgroundJobs(f:Fixture,b:Casebook){
 if(f.name!=='background-jobs')return;
 const create=async(config:any={},mode='notify')=>{await f.storage.configure('background-jobs.json',{mode});const provider=new ScriptedProvider([{text:'Completion checked'}]);const app=await f.app(config,provider);const core=app.createCore(async()=>true);const events:any[]=[];core.subscribe(e=>events.push(e));await core.start();return{app,core,provider,events};};
 const run=async(core:any,command='printf JOB_OK',timeoutMs=2000)=>{const r=await core.invokeTool('exec',{command,timeoutMs,background:true});assert.equal(r.ok,true,r.error);return r.output.shellId as string;};
 const subscription=async(core:any,id:string)=>{const r=await core.invokeTool('background_jobs',{action:'status',id});assert.equal(r.ok,true,r.error);return r.output as any;};
 b.add(['tool.success','process.success','hook.repeat','mutation.result','state.fresh'],async()=>{
  const{core,provider,events}=await create(),id=await run(core);await poll(async()=>(await subscription(core,id)).subscription?.delivery==='delivered');
  assert.equal(provider.requests.length,0);const output=await core.invokeTool('exec_output',{id});assert.equal((output.output as any).stdout,'JOB_OK');assert.equal((output.output as any).exitCode,0);
  await core.invokeTool('background_jobs',{action:'subscribe',id,mode:'wake'});assert.equal(provider.requests.length,0);assert.equal(events.filter(e=>e.input?.plugin===f.name&&e.input.message?.includes(id)).length,1);
 });
 b.add(['tool.invalid','mutation.invalid'],async()=>{const{core}=await create();for(const args of [{action:'missing'},{action:'subscribe'},{action:'subscribe',id:'missing'},{action:'subscribe',id:'missing',mode:'invalid'}])assert.equal((await core.invokeTool('background_jobs',args)).ok,false);assert.equal(((await core.invokeTool('background_jobs',{action:'list'})).output as any).jobs.length,0);});
 b.add(['tool.denied','mutation.denied'],async()=>{const{core}=await create({permissions:{rules:[{tool:'exec',decision:'deny'},{tool:'background_jobs',decision:'deny'}]}});assert.equal((await core.invokeTool('exec',{command:'touch denied-background',background:true})).ok,false);assert.equal((await core.invokeTool('background_jobs',{action:'subscribe',id:'missing'})).ok,false);await assert.rejects(readFile(join(f.cwd,'denied-background')));});
 b.add(['hook.failure','tool.failure','mutation.recovery','process.failure'],async()=>{
  const{core,provider}=await create({},'wake');core.host.registerPlugin({name:'no-wake',version:'1.0.0',trust:'trusted'},{'service.agent.enqueue':()=>({deny:'follow-up unavailable'})});
  const id=await run(core,'exit 7');await poll(async()=>(await subscription(core,id)).subscription?.delivery==='failed');assert.equal(provider.requests.length,0);assert.equal(((await core.invokeTool('exec_output',{id})).output as any).exitCode,7);
  core.host.registerPlugin({name:'no-status',version:'1.0.0',trust:'trusted'},{'service.shell.jobs':()=>({deny:'metadata unavailable'})});assert.equal((await core.invokeTool('background_jobs',{action:'list'})).ok,false);core.host.unregisterPlugin('no-status');core.host.unregisterPlugin('no-wake');
  const next=await run(core);await poll(async()=>provider.requests.length===1&&core.getState()==='idle');assert.ok(provider.requests[0].messages.at(-1)?.content.includes(next));
 });
 b.add('process.timeout',async()=>{const{core}=await create(),id=await run(core,'sleep 30',60);await poll(async()=>(await subscription(core,id)).done);assert.equal((await subscription(core,id)).reason,'timed-out');});
 b.add(['tool.cancel','process.cancel'],async()=>{const{core,provider}=await create({},'wake'),id=await run(core,'echo $$ > cancel.pid; sleep 30');await poll(async()=>!!(await readFile(join(f.cwd,'cancel.pid'),'utf8').catch(()=>'')));const pid=Number(await readFile(join(f.cwd,'cancel.pid'),'utf8'));assert.equal((await core.invokeTool('exec_kill',{id})).ok,true);assert.throws(()=>process.kill(pid,0));assert.equal((await subscription(core,id)).reason,'cancelled');assert.equal(provider.requests.length,0);});
 b.add('process.cleanup',async()=>{const{app,core,provider}=await create(),id=await run(core,'echo $$ > cleanup.pid; sleep 30');await poll(async()=>!!(await readFile(join(f.cwd,'cleanup.pid'),'utf8').catch(()=>'')));const pid=Number(await readFile(join(f.cwd,'cleanup.pid'),'utf8'));await app.close();assert.throws(()=>process.kill(pid,0));assert.equal(provider.requests.length,0);assert.ok(id);});
 b.add(['state.migration','state.invalid'],async()=>{
  const{app,core,events}=await create(),id=await run(core,'echo once >> launches.txt; sleep 0.5');
  await f.storage.write(f.name,'subscriptions',{schemaVersion:999,items:'invalid'},'session',core.sessionId);await app.reloadPlugins(core);
  await poll(async()=>(await subscription(core,id)).subscription?.delivery==='delivered');assert.equal((await readFile(join(f.cwd,'launches.txt'),'utf8')).trim(),'once');
  const saved:any=await f.storage.read(f.name,'subscriptions','session',core.sessionId);assert.equal(saved.schemaVersion,1);assert.equal(events.filter(e=>e.input?.plugin===f.name&&e.input.message?.includes(id)).length,1);
 });
 b.add('state.restart',async()=>{const{app,core}=await create();await f.storage.write(f.name,'subscriptions',{schemaVersion:1,items:[{id:'orphan',mode:'wake',delivery:'pending'}]},'session',core.sessionId);const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{timeout:10000});assert.match(result.stdout,/"jobs":\[\]/);const saved:any=await f.storage.read(f.name,'subscriptions','session',core.sessionId);assert.ok(!saved.items.some((item:any)=>item.delivery==='pending'));await app.close();});
 b.add('state.isolation',async()=>{const{app,core}=await create(),id=await run(core,'sleep 30');const other=app.createCore(async()=>true);assert.equal((await other.invokeTool('exec_output',{id})).ok,false);assert.equal((await other.invokeTool('exec_kill',{id})).ok,false);assert.equal((await other.invokeTool('background_jobs',{action:'subscribe',id})).ok,false);await core.invokeTool('exec_kill',{id});});
}
