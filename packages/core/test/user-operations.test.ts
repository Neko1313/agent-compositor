import {afterEach,expect,it} from 'vitest';
import {AgentCore,replayTranscript,ScriptedProvider} from '../src/index.js';
import type {ToolSpec} from '@agent-compositor/tools';
import type {SessionEvent} from '@agent-compositor/session';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
const wait=(check:()=>boolean)=>expect.poll(check,{timeout:3000}).toBe(true);
function fixture(tools:ToolSpec[],rules:any[]=[],options:any={}){
 const journal:SessionEvent[]=[],events:any[]=[];
 const provider=new ScriptedProvider([{text:'Main answer',usage:{inputTokens:30,outputTokens:10},hold:true},{text:'Next answer'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,extraTools:tools,rules:tools.map(tool=>({tool:tool.name,decision:'allow' as const})).concat(rules),sessions:{create:async()=>{},append:async(_id,entries)=>{journal.push(...entries);}},...options});cores.push(core);core.subscribe(e=>events.push(e));
 return{core,provider,journal,events};
}
const quick:ToolSpec<any>={name:'probe',description:'Read a marker',parameters:{type:'object'},describe:()=>({tool:'probe',readOnly:true}),execute:async()=>({ok:true,data:'UI result'})};
function slow():{tool:ToolSpec<any>;start:()=>boolean;finish:()=>void;signal:()=>AbortSignal|undefined}{
 let started=false,signal:AbortSignal|undefined,release=()=>{};
 const tool:ToolSpec<any>={...quick,name:'slow',describe:()=>({tool:'slow',readOnly:true}),execute:async ctx=>{
  signal=ctx.signal;started=true;await new Promise<void>(done=>{release=done;ctx.signal.addEventListener('abort',()=>done(),{once:true});});ctx.signal.throwIfAborted();return{ok:true,data:'Slow UI result'};
 }};return{tool,start:()=>started,finish:()=>release(),signal:()=>signal};
}
it('runs a guarded tool alongside a held model without altering its transcript, counters or completion',async()=>{
 const f=fixture([quick]);const running=f.core.submit('Main task');await wait(()=>f.core.getBudget().turnTokens===40);
 const messages=structuredClone(f.core.getMessages()),signal=f.provider.requests[0].signal;
 expect(await f.core.invokeUserTool('probe',{})).toMatchObject({ok:true,output:'UI result'});
 expect(f.core.getMessages()).toEqual(messages);expect(f.core.getBudget().turnTokens).toBe(40);expect(f.core.getState()).toBe('running');expect(signal.aborted).toBe(false);expect(f.provider.requests).toHaveLength(1);
 const calls=f.journal.filter(e=>e.type==='tool.call');expect(calls).toHaveLength(1);expect(calls[0].operationId).toEqual(expect.any(String));
 expect(f.journal.filter(e=>e.type==='turn.complete')).toHaveLength(0);
 f.provider.release();await running;expect(f.core.failure).toBeUndefined();expect(f.events.filter(e=>e.kind==='catalog'&&e.event==='turn.complete')).toHaveLength(1);
 expect(replayTranscript(f.journal)).toEqual(replayTranscript(f.journal.filter(e=>!e.operationId)));
 await f.core.submit('Next task');expect(JSON.stringify(f.provider.requests[1].messages)).not.toContain('UI result');
});
it('preserves deny rules and applies rewritten arguments before policy',async()=>{
 let calls=0;const guarded:ToolSpec<any>={...quick,describe:a=>({tool:'probe',path:a.path}),execute:async()=>{calls++;return{ok:true,data:'unsafe'};}};
 const f=fixture([guarded],[{tool:'probe',path:process.cwd()+'/blocked',decision:'deny'}]);
 f.core.host.registerPlugin({name:'rewrite',version:'1.0.0',trust:'trusted'},{'tool.call':(e,$)=>$.next({...e,input:{path:'blocked'}})});
 const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 expect(await f.core.invokeUserTool('probe',{path:'allowed'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});expect(calls).toBe(0);expect(f.core.getState()).toBe('running');f.provider.release();await running;
});
it('allows real file work while preserving write denials and workspace boundaries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'user-tool-write-'));
 const f=fixture([], [{tool:'write',path:root+'/allowed.txt',decision:'allow'},{tool:'write',path:root+'/blocked.txt',decision:'deny'}],{cwd:root});
 try{
  const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);const before=structuredClone(f.core.getMessages());
  expect(await f.core.invokeUserTool('write',{path:'allowed.txt',content:'Actual user change'})).toMatchObject({ok:true});
  expect(await readFile(join(root,'allowed.txt'),'utf8')).toBe('Actual user change');
  expect(await f.core.invokeUserTool('write',{path:'blocked.txt',content:'Denied change'})).toMatchObject({ok:false});
  await expect(stat(join(root,'blocked.txt'))).rejects.toMatchObject({code:'ENOENT'});
  expect(await f.core.invokeUserTool('write',{path:'../outside.txt',content:'Escape'})).toMatchObject({ok:false});
  expect(f.core.getMessages()).toEqual(before);expect(f.provider.requests[0].signal.aborted).toBe(false);
  f.provider.release();await running;
 }finally{await f.core.close();await rm(root,{recursive:true,force:true});}
});
it('keeps caller cancellation independent of the parent and records a truthful terminal outcome',async()=>{
 const worker=slow(),f=fixture([worker.tool]);const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);const abort=new AbortController();
 const work=f.core.invokeUserTool('slow',{}, {signal:abort.signal});await wait(worker.start);abort.abort(Error('Cancelled UI action'));
 expect(await work).toMatchObject({ok:false,error:expect.stringContaining('Cancelled UI action')});expect(worker.signal()!.aborted).toBe(true);expect(f.provider.requests[0].signal.aborted).toBe(false);expect(f.core.hasActiveOperations).toBe(false);expect(f.core.failure).toBeUndefined();
 expect(f.journal.filter(e=>e.type==='tool.operation').at(-1)).toMatchObject({phase:'completed',ok:false});f.provider.release();await running;
});
it('does not cancel a user tool when the parent turn is interrupted, and closes it on session teardown',async()=>{
 const worker=slow(),f=fixture([worker.tool]);const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 const work=f.core.invokeUserTool('slow',{});await wait(worker.start);f.core.interrupt();await running;expect(worker.signal()!.aborted).toBe(false);expect(f.core.hasActiveOperations).toBe(true);
 await f.core.close();expect(await work).toMatchObject({ok:false});expect(worker.signal()!.aborted).toBe(true);expect(f.core.hasActiveOperations).toBe(false);
});
it('bounds concurrent admission and blocks reload until the final operation settles',async()=>{
 const workers=Array.from({length:4},()=>slow());const tools=workers.map((worker,i)=>({...worker.tool,name:'slow'+i,describe:()=>({tool:'slow'+i})}));
 const f=fixture(tools);const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);const works=tools.map(tool=>f.core.invokeUserTool(tool.name,{}));await wait(()=>workers.every(w=>w.start()));
 expect(await f.core.invokeUserTool('slow0',{})).toMatchObject({ok:false,error:expect.stringContaining('Four')});f.core.interrupt();await running;expect(()=>f.core.replacePlugins([],[])).toThrow(/operation/);
 f.core.cancelOperations();await Promise.all(works);expect(f.core.hasActiveOperations).toBe(false);
});
it('does not count failed user tools as model failures or verified model work',async()=>{
 const fail:ToolSpec={...quick,execute:async()=>({ok:false,error:'UI-only failure'})};const f=fixture([fail],[],{maxConsecutiveToolFailures:1});
 const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);expect((await f.core.invokeUserTool('probe',{})).ok).toBe(false);f.provider.release();await running;expect(f.core.failure).toBeUndefined();
});
it('keeps the UI model allowance separate while charging the same session budget',async()=>{
 const model:ToolSpec={...quick,execute:async ctx=>{await ctx.request('service.model.complete',{plugin:'core',request:{messages:[{role:'user',content:'UI review'}],signal:ctx.signal}});return{ok:true,data:'Reviewed'};}};
 const f=fixture([model],[],{maxTokensPerTurn:20000,maxTokensPerSession:40000});const running=f.core.submit('Main task');await wait(()=>f.core.getBudget().turnTokens===40);
 expect((await f.core.invokeUserTool('probe',{})).ok).toBe(true);expect(f.core.getBudget().turnTokens).toBe(40);expect(f.core.getBudget().spentTokens).toBeGreaterThan(40);expect(f.provider.requests).toHaveLength(2);f.provider.release();await running;
});
it('retains correct model tool groups when user results interleave with a model tool batch',async()=>{
 const worker=slow();const provider=new ScriptedProvider([{text:'Model reasoning',toolCalls:[{name:'slow',args:{}}]},{text:'Model finished'}]);
 const f=fixture([worker.tool,quick],[],{provider});const running=f.core.submit('Actual model task');await wait(worker.start);
 expect(await f.core.invokeUserTool('probe',{})).toMatchObject({ok:true});worker.finish();await running;
 expect(provider.requests).toHaveLength(2);expect(provider.requests[1].messages.filter(m=>m.role==='tool')).toHaveLength(1);expect(provider.requests[1].messages.find(m=>m.role==='tool')?.content).toContain('Slow UI result');
 expect(replayTranscript(f.journal).filter(m=>m.role==='tool').some(m=>m.name==='probe')).toBe(false);expect(replayTranscript(f.journal).filter(m=>m.role==='tool')).toHaveLength(1);
});
it('cancels only the operation whose owning plugin unloads',async()=>{
 const worker=slow(),f=fixture([worker.tool]);f.core.host.registerPlugin({name:'ui-owner',version:'1.0.0',trust:'trusted'},{});
 const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);const work=f.core.invokeUserTool('slow',{}, {owner:'ui-owner'});await wait(worker.start);f.core.host.unregisterPlugin('ui-owner');
 expect(await work).toMatchObject({ok:false});expect(f.provider.requests[0].signal.aborted).toBe(false);f.provider.release();await running;
});
it('preserves the agent when a separate approval is cancelled',async()=>{
 let approvalSignal:AbortSignal|undefined;
 const approved={...quick,describe:()=>({tool:'probe',path:'/approval'})};
 const f=fixture([approved],[{tool:'probe',path:'/approval',decision:'ask'}],{onApproval:async(request:any)=>{approvalSignal=request.signal;return new Promise(done=>request.signal.addEventListener('abort',()=>done(false),{once:true}));}});
 const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);const work=f.core.invokeUserTool('probe',{});await wait(()=>!!approvalSignal);
 f.core.cancelOperations();expect(await work).toMatchObject({ok:false,error:expect.stringMatching(/cancel/i)});expect(approvalSignal!.aborted).toBe(true);expect(f.provider.requests[0].signal.aborted).toBe(false);f.provider.release();await running;
});
it('does not send an unaffordable auxiliary request or reset session usage',async()=>{
 const model:ToolSpec={...quick,execute:async ctx=>{await ctx.request('service.model.complete',{plugin:'core',request:{messages:[{role:'user',content:'x'.repeat(200000)}],signal:ctx.signal}});return{ok:true,data:'wrong'};}};
 const f=fixture([model],[],{maxTokensPerTurn:20000,maxTokensPerSession:40000});const running=f.core.submit('Main task');await wait(()=>f.core.getBudget().turnTokens===40);
 expect(await f.core.invokeUserTool('probe',{})).toMatchObject({ok:false,error:expect.stringContaining('Token budget')});expect(f.provider.requests).toHaveLength(1);expect(f.core.getBudget().spentTokens).toBe(40);f.provider.release();await running;
});
it('fails closed on a journal error before an operation executes',async()=>{
 let effects=0;const tool:ToolSpec={...quick,execute:async()=>{effects++;return{ok:true,data:'wrong'};}};
 const f=fixture([tool],[],{sessions:{create:async()=>{},append:async(_id:string,events:SessionEvent[])=>{if(events.some(e=>e.type==='tool.call'&&e.operationId))throw Error('Audit disk unavailable');}}});
 const running=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);expect(await f.core.invokeUserTool('probe',{})).toMatchObject({ok:false,error:expect.stringContaining('journal failed')});await running;expect(effects).toBe(0);expect(f.provider.requests[0].signal.aborted).toBe(true);expect(f.core.failure).toContain('journal failed');
});
