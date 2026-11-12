import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider,type ScriptedStep} from '../src/provider.js';
import type {ToolSpec} from '@agent-compositor/tools';
const cores:AgentCore[]=[],roots:string[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const query=(args:unknown={path:'actual.mjs'}):ScriptedStep=>({toolCalls:[{name:'observe',args}]});
async function fixture(steps:ScriptedStep[],options:Record<string,unknown>={},tool:Partial<ToolSpec>={}){
 const cwd=await mkdtemp(join(tmpdir(),'query-loop-'));roots.push(cwd);const provider=new ScriptedProvider(steps);
 const observe:ToolSpec={name:'observe',description:'Finite read-only observation',loopGuard:'query',parameters:{type:'object'},describe:()=>({tool:'observe',readOnly:true}),execute:async()=>({ok:true,data:{files:['actual.mjs']}}),...tool};
 const effect:ToolSpec={name:'effect',description:'Non-query operation',parameters:{type:'object'},describe:()=>({tool:'effect'}),execute:async()=>({ok:true,data:'settled'})};
 const core=new AgentCore({cwd,provider,tools:[observe,effect],rules:[{tool:'observe',decision:'allow'},{tool:'effect',decision:'allow'}],...options});cores.push(core);return{core,provider};
}
it('warns once and bounds repeated successful extension queries before the step budget',async()=>{
 const f=await fixture(Array.from({length:20},()=>query()));await f.core.submit('Discover the source');
 expect(f.core.failure).toContain('Repeated query results');expect(f.provider.requests).toHaveLength(7);
 expect(f.provider.requests[4].messages.some(m=>m.content.includes('Query recovery:'))).toBe(true);
 expect(f.provider.requests.at(-1)!.messages.filter(m=>m.content.includes('Query recovery:'))).toHaveLength(1);
 expect(f.provider.requests[0].tools[0]).not.toHaveProperty('loopGuard');
});
it('treats argument key reordering as the same query',async()=>{
 const f=await fixture([query({a:1,b:2}),query({b:2,a:1}),{text:'Too late'}],{maxRepeatedQuerySteps:1});await f.core.submit('Inspect');
 expect(f.core.failure).toContain('Repeated query results');expect(f.provider.requests).toHaveLength(2);
});
it('detects alternating known observations without requiring identical consecutive calls',async()=>{
 const f=await fixture([query({path:'a'}),query({path:'b'}),query({path:'a'}),query({path:'b'}),{text:'Too late'}],{maxRepeatedQuerySteps:2});await f.core.submit('Inspect');expect(f.core.failure).toContain('Repeated query results');expect(f.provider.requests).toHaveLength(4);
});
it('lets a model recover by making a new observation after the reminder',async()=>{
 const f=await fixture([...Array.from({length:4},()=>query()),query({path:'different.mjs'}),{text:'Inspected a different file.'}]);await f.core.submit('Inspect');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(6);expect(f.provider.requests[4].messages.some(m=>m.content.includes('Query recovery:'))).toBe(true);
});
it('allows changing query results and unchanged unannotated polling results',async()=>{
 for(const polling of [false,true]){
  let version=0;const f=await fixture([...Array.from({length:9},()=>query()),{text:'Observed'}],{},polling?{loopGuard:undefined}:{execute:async()=>({ok:true,data:{version:++version}})});
  await f.core.submit('Observe');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(10);expect(f.provider.requests.at(-1)!.messages.some(m=>m.content.includes('Query recovery:'))).toBe(false);
 }
});
it('counts model steps rather than duplicate calls within one batch',async()=>{
 const f=await fixture([{toolCalls:Array.from({length:9},()=>({name:'observe',args:{path:'actual.mjs'}}))},{text:'Observed'}],{maxRepeatedQuerySteps:1});await f.core.submit('Observe');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(2);
});
it('resets observations after a non-query operation and between turns',async()=>{
 const reads=()=>Array.from({length:6},()=>query());const f=await fixture([...reads(),{toolCalls:[{name:'effect',args:{}}]},...reads(),{text:'First done'},...reads(),{text:'Second done'}]);
 await f.core.submit('Observe then perform the operation');expect(f.core.failure).toBeUndefined();await f.core.submit('Inspect again');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(21);
});
it('honors pending user steering before applying a repetition stop',async()=>{
 const f=await fixture([query(),{...query(),hold:true},query(),{text:'Steered'}],{maxRepeatedQuerySteps:1});const turn=f.core.submit('Inspect');
 const until=Date.now()+2000;while(f.provider.requests.length<2&&Date.now()<until)await new Promise(done=>setTimeout(done,5));expect(f.provider.requests).toHaveLength(2);
 await f.core.steer('Inspect the same source again for this new question');f.provider.release();await turn;
 expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(4);
});
it.each([0,-1,1.5,Infinity])('rejects invalid repetition budgets: %s',async maxRepeatedQuerySteps=>{
 await expect(fixture([],{maxRepeatedQuerySteps})).rejects.toThrow('positive integers');
});
it('bounds the observation window instead of retaining every distinct query',async()=>{
 const {QueryProgress}=await import('../src/query-progress.js');const progress=new QueryProgress();
 for(let i=0;i<257;i++)expect(progress.observe([String(i)])).toBe(0);
 expect(progress.observe(['256'])).toBe(1);expect(progress.observe(['0'])).toBe(0);
 progress.reset();expect(progress.observe(['256'])).toBe(0);
});
it('rejects an invalid query declaration before calling the model',async()=>{
 const f=await fixture([{text:'Unused'}],{},{loopGuard:'poll' as any});await f.core.submit('Inspect');expect(f.core.failure).toContain('Invalid or duplicate tool definition');expect(f.provider.requests).toHaveLength(0);
});
it('allows a fresh observation after context replacement discards earlier query results',async()=>{
 const f=await fixture([query(),query(),{text:'Inspected again after compaction'}],{maxRepeatedQuerySteps:1,serviceProviders:{'service.context.manage':'replace-context'}});let managed=0;
 f.core.host.registerPlugin({name:'replace-context',version:'1.0.0',trust:'trusted',provides:['service.context.manage']},{'service.context.manage':async(e:any)=>{if(++managed===2)await e.context.replace([{role:'user',content:'Preserved task: inspect the source again.'}]);return{value:true};}});
 await f.core.submit('Inspect');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(3);expect(f.provider.requests[1].messages[0].content).toContain('Preserved task');
});
