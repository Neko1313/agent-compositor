import {afterEach,expect,it} from 'vitest';
import {AgentCore,type AgentCoreOptions} from '../src/loop.js';
import {ScriptedProvider,type ScriptedStep} from '../src/provider.js';
import {ApprovalSession} from '@agent-compositor/permissions';
import type {ToolSpec} from '@agent-compositor/tools';

const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
const call=(args:unknown={command:'npm test'}):ScriptedStep=>({toolCalls:[{name:'check',args}]});
function fixture(steps:ScriptedStep[],options:Partial<AgentCoreOptions>={}){
 let effects=0;
 const tool:ToolSpec<any>={name:'check',description:'Run a configured project check',parameters:{type:'object'},describe:args=>({tool:'check',command:[args.command]}),execute:async()=>{effects++;return{ok:true,data:'checked'};}};
 const provider=new ScriptedProvider(steps),core=new AgentCore({cwd:process.cwd(),provider,tools:[tool],controlTools:[],...options});cores.push(core);
 return{core,provider,effects:()=>effects};
}
it('asks once for identical refused proposals in a model turn and reports every denial',async()=>{
 let questions=0,reviews=0;
 const f=fixture([call({command:'npm test',cwd:'a'}),call({cwd:'a',command:'npm test'}),call(),call(),{text:'Blocked.'}],{permissionReview:async()=>{reviews++;return{value:{decision:'ask'}};},onApproval:async()=>{questions++;return false;}});
 const results:any[]=[];f.core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.result')results.push(e.input);});
 await f.core.submit('Run the project checks');
 expect(questions).toBe(2);expect(reviews).toBe(2);expect(f.effects()).toBe(0);
 expect(results).toHaveLength(4);expect(results.every(result=>result.denied===true&&result.ok===false)).toBe(true);
 expect(results[1].error).toContain('already refused');expect(results[3].error).toContain('already refused');
});
it('does not repeat automatic refusals or convert them into human questions',async()=>{
 let reviews=0,questions=0;
 const f=fixture([call(),call(),{text:'Refused.'}],{permissionReview:async()=>{reviews++;return{value:{decision:'deny',reason:'Outside the authorized task'}};},onApproval:async()=>{questions++;return true;}});
 await f.core.submit('Inspect the current task');expect(reviews).toBe(1);expect(questions).toBe(0);expect(f.effects()).toBe(0);
});
it('never caches allows: repeated once approvals each authorize one execution',async()=>{
 let questions=0;
 const f=fixture([call(),call(),{text:'Checked twice.'}],{onApproval:async()=>{questions++;return{allow:true,scope:'once'};}});
 await f.core.submit('Run twice');expect(questions).toBe(2);expect(f.effects()).toBe(2);
});
it('does not reuse an automatic allow for the next identical call',async()=>{
 let reviews=0;
 const f=fixture([call(),call(),{text:'Only the first call was approved.'}],{permissionReview:async()=>({value:++reviews===1?{decision:'allow',risk:'low',reason:'Approved once'}:{decision:'deny',reason:'Current review refused'}})});
 await f.core.submit('Run the requested check');expect(reviews).toBe(2);expect(f.effects()).toBe(1);
});
it('keeps independent user operations and new turns outside an earlier refusal',async()=>{
 let questions=0;
 const f=fixture([call(),{text:'First refused.'},call(),{text:'Second refused.'}],{onApproval:async()=>{questions++;return false;}});
 await f.core.submit('First task');await f.core.invokeTool('check',{command:'npm test'});await f.core.invokeUserTool('check',{command:'npm test'});await f.core.submit('New request');
 expect(questions).toBe(4);expect(f.effects()).toBe(0);
});
it('respects a fresh session approval even after refusing the same proposal',async()=>{
 const approvals=new ApprovalSession();let questions=0;
 const f=fixture([call(),call(),{text:'Fresh approval used.'}],{approvals,onApproval:async()=>{questions++;return false;}});
 let denied=false;f.core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.result'&&e.input.denied&&!denied){denied=true;approvals.approve({tool:'check',command:['npm test']});}});
 await f.core.submit('Run the check');expect(questions).toBe(1);expect(f.effects()).toBe(1);
});
it('lets a concurrent explicit user operation request its own approval',async()=>{
 let questions=0;
 const f=fixture([call(),{text:'Blocked.',hold:true}],{onApproval:async()=>{questions++;return false;}});
 const turn=f.core.submit('Run the check');
 try{
  await expect.poll(()=>f.provider.requests.length).toBe(2);
  expect(await f.core.invokeUserTool('check',{command:'npm test'})).toMatchObject({ok:false});
  expect(questions).toBe(2);expect(f.core.getState()).toBe('running');expect(f.provider.requests[1].signal.aborted).toBe(false);
 }finally{f.provider.release();await turn;}
});
it('rechecks plugin guards and lets an explicit changed guard permit a later call',async()=>{
 let checks=0,questions=0;
 const f=fixture([call(),call(),{text:'New guard decision applied.'}],{onApproval:async()=>{questions++;return false;}});
 f.core.host.registerPlugin({name:'guard',version:'1.0.0',trust:'trusted'},{'tool.check':()=>++checks===2?{decision:'allow'}:undefined});
 await f.core.submit('Run the check');expect(checks).toBe(2);expect(questions).toBe(1);expect(f.effects()).toBe(1);
});
it('reviews a repeated proposal again after explicit user steering',async()=>{
 let questions=0;
 const f=fixture([call(),{...call(),hold:true},call(),{text:'Resolved.'}],{onApproval:async()=>++questions===2});
 const turn=f.core.submit('Run the check');await expect.poll(()=>f.provider.requests.length).toBe(2);
 await f.core.steer('I have updated the task context; review the check again.');f.provider.release();await turn;
 // The held response still belongs to the old task. Its refusal is reused;
 // only the next request consumes steering and can obtain a fresh decision.
 expect(questions).toBe(2);expect(f.effects()).toBe(1);
});
it('invalidates refusals after an explicit review-policy change',async()=>{
 let questions=0;
 const f=fixture([call(),{...call(),hold:true},{text:'New policy applied.'}],{onApproval:async()=>++questions===2});
 const turn=f.core.submit('Run the check');
 try{
  await expect.poll(()=>f.provider.requests.length).toBe(2);
  expect((await f.core.host.emit('service.permission.invalidate',{})).value).toEqual({value:true});
 }finally{f.provider.release();await turn;}
 expect(questions).toBe(2);expect(f.effects()).toBe(1);
});
it('does not repopulate new policy memory with an old in-flight refusal',async()=>{
 let entered=()=>{},release=()=>{},questions=0;
 const entry=new Promise<void>(done=>{entered=done;});
 const f=fixture([call(),call(),{text:'Fresh review resolved.'}],{onApproval:async()=>{
  if(++questions!==1)return true;entered();return new Promise<boolean>(done=>{release=()=>done(false);});
 }});
 const turn=f.core.submit('Run the check');
 try{await entry;await f.core.host.emit('service.permission.invalidate',{});}
 finally{release();await turn;}
 expect(questions).toBe(2);expect(f.effects()).toBe(1);
});
it.each([false,true])('serializes identical parallel reviews without sharing once approvals: allow=%s',async allow=>{
 let questions=0;
 const f=fixture([{toolCalls:[{name:'check',args:{command:'npm test'}},{name:'check',args:{command:'npm test'}}]},{text:'Finished.'}],{onApproval:async()=>{questions++;await new Promise<void>(done=>setTimeout(done,5));return allow;}});
 f.core.host.registerPlugin({name:'parallel',version:'1.0.0',trust:'trusted'},{'service.agent.batch':async(e:any)=>{await Promise.all(e.calls.map((call:any)=>e.context.execute(call)));return{value:true};}});
 await f.core.submit('Run the same check twice');expect(questions).toBe(allow?2:1);expect(f.effects()).toBe(allow?2:0);
});
it('rechecks a changed guard after waiting for the first parallel refusal',async()=>{
 let questions=0,guardAllows=false;
 const f=fixture([{toolCalls:[{name:'check',args:{command:'npm test'}},{name:'check',args:{command:'npm test'}}]},{text:'Updated guard used.'}],{onApproval:async()=>{questions++;await Promise.resolve();guardAllows=true;return false;}});
 f.core.host.registerPlugin({name:'parallel',version:'1.0.0',trust:'trusted'},{'service.agent.batch':async(e:any)=>{await Promise.all(e.calls.map((call:any)=>e.context.execute(call)));return{value:true};},'tool.check':()=>guardAllows?{decision:'allow'}:undefined});
 await f.core.submit('Review the two proposals');expect(questions).toBe(1);expect(f.effects()).toBe(1);
});
it('cancels a queued identical review independently of the first approval',async()=>{
 let entered=()=>{},release=()=>{},cancelled=false,checks=0,questions=0,approvalSignal:AbortSignal|undefined;
 const entry=new Promise<void>(done=>{entered=done;}),abort=new AbortController();
 const f=fixture([{toolCalls:[{name:'check',args:{command:'npm test'}},{name:'check',args:{command:'npm test'}}]}],{onApproval:async request=>{questions++;approvalSignal=request.signal;entered();return new Promise<boolean>(done=>{release=()=>done(false);});}});
 f.core.host.registerPlugin({name:'parallel',version:'1.0.0',trust:'trusted'},{'tool.check':()=>{checks++;},'service.agent.batch':async(e:any)=>{
  const first=e.context.execute(e.calls[0]);await entry;
  const second=e.context.withSignal(abort.signal).execute(e.calls[1]);second.catch(()=>{cancelled=true;});
  await Promise.allSettled([first,second]);return{value:true};
 }});
 const turn=f.core.submit('Review two identical checks');
 try{
  await entry;await expect.poll(()=>checks).toBe(2);abort.abort(Error('Queued review cancelled'));
  await expect.poll(()=>cancelled).toBe(true);expect(questions).toBe(1);expect(approvalSignal?.aborted).toBe(false);
 }finally{release();await turn;}
 expect(f.effects()).toBe(0);expect(f.core.failure).toContain('Queued review cancelled');
});
