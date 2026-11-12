import {it, expect} from 'vitest';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';

const wait = async (ready:()=>boolean) => { await expect.poll(ready).toBe(true); };
function fixture(handler:(event:any,$:any)=>unknown, options:any={}) {
  const provider=new ScriptedProvider([{text:'MAIN_WORKING',hold:true},{text:'QUEUED_DONE'}]);
  let otherCalls=0;
  const core=new AgentCore({cwd:process.cwd(),provider,userCommands:()=>[{name:'/control',plugin:'control'}],
    plugins:[{manifest:{name:'control',version:'1.0.0',trust:'trusted'},hooks:{'command.invoke':handler}},
      {manifest:{name:'other',version:'1.0.0',trust:'trusted'},hooks:{'command.invoke':()=>{otherCalls++;}}}],...options});
  return {core,provider,otherCalls:()=>otherCalls};
}
it('marks only the asynchronous user operation as user-originated while the main model remains separate',async()=>{
 let entered=false,release=()=>{},inside=false;
 const f=fixture(async()=>{entered=true;await new Promise<void>(done=>{release=done;});inside=f.core.isUserInvocation;});
 try{
  const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
  const command=f.core.invokeCommand('/control');await wait(()=>entered);
  expect(f.core.isUserInvocation).toBe(false);release();await command;expect(inside).toBe(true);
  expect(f.core.isUserInvocation).toBe(false);f.provider.release();await main;
 }finally{release();f.provider.release();await f.core.close();}
});
it('revokes user provenance from asynchronous continuations after their command settles',async()=>{
 let release=()=>{},later:Promise<boolean>|undefined;
 const f=fixture(()=>{later=new Promise<void>(done=>{release=done;}).then(()=>f.core.isUserInvocation);});
 try{await f.core.invokeCommand('/control');release();expect(await later).toBe(false);}
 finally{release();await f.core.close();}
});
it('dispatches an owned command while the model and queued user task remain intact',async()=>{
  const calls:any[]=[];const f=fixture(event=>{calls.push(event);});
  try {
    const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
    await f.core.submit('Queued task');
    await f.core.submit('/control exact arguments');
    expect(calls).toEqual([{plugin:'control',name:'/control',text:'/control exact arguments',args:'exact arguments'}]);
    expect(f.otherCalls()).toBe(0);expect(f.core.getState()).toBe('running');expect(f.provider.requests).toHaveLength(1);
    f.provider.release();await main;
    expect(f.core.getMessages().filter(m=>m.role==='user').map(m=>m.content)).toEqual(['Main task','Queued task']);
  } finally {f.provider.release();await f.core.close();}
});
it('keeps command failures outside the model turn and never falls through to a prompt',async()=>{
  const f=fixture(()=>{throw Error('CONTROL_FAILURE');});
  try {
    const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
    await expect(f.core.submit('/control')).rejects.toThrow('CONTROL_FAILURE');
    expect(f.core.getState()).toBe('running');expect(f.core.failure).toBeUndefined();
    expect(f.provider.requests).toHaveLength(1);expect(f.core.hasActiveOperations).toBe(false);
    f.provider.release();await main;
    expect(f.core.getMessages().filter(m=>m.role==='user').map(m=>m.content)).toEqual(['Main task']);
  } finally {f.provider.release();await f.core.close();}
});
it('cancels an owned command without cancelling the main model',async()=>{
  let started=false,settled=false;
  const f=fixture(async(_event,$)=>{started=true;try{await new Promise((_,reject)=>$.signal.addEventListener('abort',()=>reject($.signal.reason),{once:true}));}finally{settled=true;}});
  try {
    const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
    const command=f.core.submit('/control');const outcome=expect(command).rejects.toThrow();await wait(()=>started);
    expect(f.core.cancelOperations('other')).toBe(false);expect(f.core.cancelOperations('control')).toBe(true);
    await outcome;expect(settled).toBe(true);expect(f.core.hasActiveOperations).toBe(false);expect(f.core.getState()).toBe('running');
    f.provider.release();await main;
  } finally {f.provider.release();await f.core.close();}
});
it('uses normal tool policy and a separate user operation from inside an immediate command',async()=>{
  let result:any,executed=0,asked=0;
  const f=fixture(async(_event,$)=>{result=await $.agent.tool('guarded',{});},{
    tools:[{name:'guarded',description:'Controlled effect',parameters:{type:'object'},describe:()=>({tool:'guarded'}),execute:async()=>{executed++;return{ok:true,data:'effect'};}}],
    rules:[{tool:'guarded',decision:'deny'}],onApproval:async()=>{asked++;return true;},
  });
  try {
    const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
    await f.core.submit('/control');expect(result.ok).toBe(false);expect(executed).toBe(0);expect(asked).toBe(0);
    expect(f.provider.requests).toHaveLength(1);expect(f.core.getState()).toBe('running');expect(f.core.hasActiveOperations).toBe(false);
    f.provider.release();await main;
  } finally {f.provider.release();await f.core.close();}
});
it('does not grant agent-origin prompts the immediate user-command path',async()=>{
  let calls=0;const f=fixture(()=>{calls++;});
  try {
    expect(await f.core.invokeCommand('/unknown')).toBe(false);
    const main=f.core.submit('/control','agent');await wait(()=>f.provider.requests.length===1);
    expect(calls).toBe(0);f.provider.release();await main;
    expect(f.core.getMessages().some(m=>m.role==='user'&&m.content==='/control')).toBe(true);
  } finally {f.provider.release();await f.core.close();}
});
it('accounts auxiliary command model usage to the session without borrowing the main turn budget',async()=>{
  const provider=new ScriptedProvider([{text:'MAIN_WORKING',hold:true},{text:'AUXILIARY',usage:{inputTokens:3,outputTokens:2}}]);
  let answer:unknown;
  const f=fixture(async(_event,$)=>{answer=await $.model.complete({messages:[{role:'user',content:'Auxiliary control request'}],maxOutputTokens:8});},{provider,maxTokensPerTurn:10000,maxTokensPerSession:20000,tools:[],controlTools:[]});
  try {
    const main=f.core.submit('Main task');await wait(()=>provider.requests.length===1);
    const before=f.core.getBudget();await f.core.submit('/control');
    expect(answer).toBe('AUXILIARY');expect(f.core.getBudget().turnTokens).toBe(before.turnTokens);
    expect(f.core.getBudget().spentTokens).toBe(before.spentTokens+5);
    expect(provider.requests[0].signal.aborted).toBe(false);expect(f.core.getState()).toBe('running');
    provider.release();await main;
  } finally {provider.release();await f.core.close();}
});
it('revokes a running command on plugin unload and settles it before session teardown',async()=>{
  let started=false,settled=false;
  const f=fixture(async(_event,$)=>{started=true;try{await new Promise((_,reject)=>$.signal.addEventListener('abort',()=>reject($.signal.reason),{once:true}));}finally{settled=true;}});
  const pending=f.core.submit('/control');const outcome=expect(pending).rejects.toThrow();await wait(()=>started);
  f.core.host.unregisterPlugin('control');await outcome;expect(settled).toBe(true);expect(f.core.hasActiveOperations).toBe(false);
  expect(await f.core.invokeCommand('/control')).toBe(false);await f.core.close();
});
it('bounds concurrent commands and drains cancelled work on close',async()=>{
  let started=0,settled=0;
  const f=fixture(async(_event,$)=>{started++;try{await new Promise((_,reject)=>$.signal.addEventListener('abort',()=>reject($.signal.reason),{once:true}));}finally{settled++;}});
  const pending=Array.from({length:4},()=>f.core.submit('/control'));
  const outcomes=Promise.allSettled(pending);await wait(()=>started===4);
  await expect(f.core.submit('/control')).rejects.toThrow('Four immediate commands');
  expect(started).toBe(4);await f.core.close();expect(settled).toBe(4);
  expect((await outcomes).every(result=>result.status==='rejected')).toBe(true);
  expect(f.core.hasActiveOperations).toBe(false);expect(f.provider.requests).toHaveLength(0);
});
