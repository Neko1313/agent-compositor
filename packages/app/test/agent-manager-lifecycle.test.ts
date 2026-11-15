import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {Runtime} from '@agent-compositor/runtime';
import {attach} from '@agent-compositor/hooks';
import {agentManager} from '../src/agents.js';

const release:(()=>void)[]=[],cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const done of release.splice(0))done();for(const close of cleanup.splice(0).reverse())await close();});
const channels={approve:async()=>false,inputSource:()=> 'user' as const};
async function saved(){
  const cwd=await mkdtemp(join(tmpdir(),'agent-load-lifecycle-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const state=join(cwd,'.state'),first=await agentManager(cwd,async()=>{
    const core=new AgentCore({cwd,tools:[],controlTools:[]});return{core,close:()=>core.close(),history:async()=>[]};
  },8,state);
  const record=await first.control({action:'create',name:'Saved actor',worktree:false},channels) as {id:string};await first.close();
  return{cwd,state,id:record.id};
}
function gate(){let done!:()=>void;const promise=new Promise<void>(resolve=>{done=resolve;});release.push(done);return{promise,done};}

it('blocks new agent work while its existing runtime reloads plugins',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'agent-plugin-reload-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const pause=gate(),provider=new ScriptedProvider([{text:'after reload'}]);let entered=false;
  const manager=await agentManager(cwd,async()=>{
    const core=new AgentCore({cwd,provider,tools:[],controlTools:[]});
    return{core,close:()=>core.close(),history:async()=>[],reload:async()=>{entered=true;await pause.promise;return 'Reloaded 0 plugins.';}};
  });cleanup.push(()=>manager.close());
  const record=await manager.control({action:'create',name:'Actor',worktree:false},channels) as {id:string};
  expect(manager.beginPluginReload()).toBe(true);
  const reload=manager.reloadPlugins();
  try{
    await expect.poll(()=>entered).toBe(true);
    await expect(manager.control({action:'send',id:record.id,prompt:'Too early'},channels)).rejects.toThrow('Plugin reload in progress');
    expect(provider.requests).toHaveLength(0);
  }finally{pause.done();await reload;manager.endPluginReload();}
  await manager.control({action:'send',id:record.id,prompt:'After reload'},channels);
  await expect.poll(()=>provider.requests.length).toBe(1);
});

it('prevents sending to an agent whose plugin reload failed until a retry succeeds',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'agent-plugin-reload-failure-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const provider=new ScriptedProvider([{text:'after successful retry'}]);let fail=true;
  const manager=await agentManager(cwd,async()=>{
    const core=new AgentCore({cwd,provider,tools:[],controlTools:[]});
    return{core,close:()=>core.close(),history:async()=>[],reload:async()=>{if(fail)throw Error('fixture reload failure');return 'Reloaded 0 plugins.';}};
  });cleanup.push(()=>manager.close());
  const record=await manager.control({action:'create',name:'Actor',worktree:false},channels) as {id:string};
  expect(manager.beginPluginReload()).toBe(true);
  try{await expect(manager.reloadPlugins()).rejects.toThrow('fixture reload failure');}finally{manager.endPluginReload();}
  await expect(manager.control({action:'send',id:record.id,prompt:'Must wait'},channels)).rejects.toThrow('retry /reload');
  expect(provider.requests).toHaveLength(0);
  expect(manager.beginPluginReload()).toBe(true);manager.endPluginReload(true);
  await expect(manager.control({action:'send',id:record.id,prompt:'Still waiting'},channels)).rejects.toThrow('retry /reload');
  fail=false;expect(manager.beginPluginReload()).toBe(true);
  try{await manager.reloadPlugins();}finally{manager.endPluginReload();}
  await manager.control({action:'send',id:record.id,prompt:'Continue'},channels);
  await expect.poll(()=>provider.requests.length).toBe(1);
});

it('joins one in-flight saved actor load during shutdown and closes the factory result before returning',async()=>{
  const f=await saved(),pause=gate();let factories=0,closes=0,actor!:AgentCore;
  const manager=await agentManager(f.cwd,async()=>{
    factories++;actor=new AgentCore({cwd:f.cwd,tools:[],controlTools:[],plugins:[{manifest:{name:'lifetime',version:'1.0.0',trust:'trusted'},hooks:{}}]});
    await pause.promise;return{core:actor,close:async()=>{closes++;await actor.close();},history:async()=>[]};
  },8,f.state);cleanup.push(()=>manager.close());manager.bind(channels);
  const first=manager.control({action:'send',id:f.id,prompt:'First'},channels),second=manager.control({action:'send',id:f.id,prompt:'Second'},channels);
  void first.catch(()=>{});void second.catch(()=>{});await expect.poll(()=>factories).toBe(1);
  let stopped=false;const closing=manager.close().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
  pause.done();await closing;const results=await Promise.allSettled([first,second]);
  expect(results.every(result=>result.status==='rejected')).toBe(true);expect(factories).toBe(1);expect(closes).toBe(1);
  expect(actor.host.hasPlugin('lifetime')).toBe(false);
  await expect(manager.control({action:'send',id:f.id,prompt:'Too late'},channels)).rejects.toThrow('closed');
});

it('shares one real Core and one startup for concurrent sends while its saved actor is loading',async()=>{
  const f=await saved(),pause=gate(),provider=new ScriptedProvider([{text:'First reply'},{text:'Second reply'}]);let factories=0,starts=0;
  const manager=await agentManager(f.cwd,async(_record,current)=>{
    factories++;const actor=new AgentCore({cwd:f.cwd,provider,tools:[],controlTools:[],onApproval:current.approve,onAsk:current.ask,
      plugins:[{manifest:{name:'startup',version:'1.0.0',trust:'trusted'},hooks:{'session.start':()=>{starts++;}}}]});
    await pause.promise;return{core:actor,close:()=>actor.close(),history:async()=>[]};
  },8,f.state);cleanup.push(()=>manager.close());manager.bind(channels);
  const first=manager.control({action:'send',id:f.id,prompt:'First'},channels),second=manager.control({action:'send',id:f.id,prompt:'Second'},channels);
  await expect.poll(()=>factories).toBe(1);pause.done();await Promise.all([first,second]);
  await expect.poll(()=>provider.requests.length).toBe(2);expect(factories).toBe(1);expect(starts).toBe(1);
  await manager.close();
});

it('holds every send behind the same gated Core startup after the runtime entry has been inserted',async()=>{
  const f=await saved(),pause=gate(),provider=new ScriptedProvider([{text:'First reply'},{text:'Second reply'}]);let starts=0,factories=0;
  const manager=await agentManager(f.cwd,async()=>{
    factories++;const actor=new AgentCore({cwd:f.cwd,provider,tools:[],controlTools:[],plugins:[{
      manifest:{name:'startup-gate',version:'1.0.0',trust:'trusted'},hooks:{'session.start':async()=>{starts++;await pause.promise;}},
    }]});return{core:actor,close:()=>actor.close(),history:async()=>[]};
  },8,f.state);cleanup.push(()=>manager.close());manager.bind(channels);
  const first=manager.control({action:'send',id:f.id,prompt:'First'},channels);void first.catch(()=>{});
  await expect.poll(()=>starts).toBe(1);
  let secondAdmitted=false;const second=manager.control({action:'send',id:f.id,prompt:'Second'},channels).then(()=>{secondAdmitted=true;});void second.catch(()=>{});
  // Drain the actual in-memory provider pipeline while startup stays gated.
  await new Promise<void>(resolve=>setImmediate(resolve));
  expect(provider.requests).toEqual([]);expect(secondAdmitted).toBe(false);expect(starts).toBe(1);
  pause.done();await Promise.all([first,second]);await expect.poll(()=>provider.requests.length).toBe(2);
  expect(provider.requests.map(request=>request.messages.filter(message=>message.role==='user').at(-1)?.content)).toEqual(['First','Second']);
  expect(factories).toBe(1);expect(starts).toBe(1);await manager.close();
});

it.each(['service.agent.control','service.agent.open'])('keeps the existing long-operation budget through %s middleware',async event=>{
  const cwd=await mkdtemp(join(tmpdir(),'agent-service-budget-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const manager=await agentManager(cwd,async()=>{throw Error('No worker is required for the service-chain budget proof');});cleanup.push(()=>manager.close());
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'budget-proof',cwd}});cleanup.push(()=>host.close());
  host.registerPlugin(manager.plugin.manifest,manager.plugin.hooks);
  let entered!:()=>void,finish!:(value:unknown)=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),downstream=new Promise(resolve=>{finish=resolve;});
  runtime.setResolver(event,async()=>{entered();await downstream;return{value:'completed'};});
  vi.useFakeTimers();
  try{
    let settled=false;const pending=host.emit(event,event==='service.agent.control'?{action:'list'}:{prompt:'Inspect the project'}).then(value=>{settled=true;return value;});
    await started;await vi.advanceTimersByTimeAsync(2001);expect(settled).toBe(false);
    finish(undefined);expect(await pending).toEqual({value:{value:'completed'},faults:[]});
  }finally{finish(undefined);vi.useRealTimers();}
});
