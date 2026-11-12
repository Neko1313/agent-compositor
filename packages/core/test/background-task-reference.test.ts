import {expect,it} from 'vitest';
import {AgentCore,ScriptedProvider,replayTranscript} from '../src/index.js';
import {TokenBudget} from '@agent-compositor/context';
import type {SessionEvent} from '@agent-compositor/session';
const task='Refactor the parser and preserve the user draft.';
const wake='Automated background completion: controlled build finished; continue the original task.';
async function enqueue(core:AgentCore){
 expect((await core.host.emit('service.agent.enqueue',{plugin:'background-owner',key:'build',text:wake})).value).toMatchObject({value:{queued:true}});
}
it.each(['user','agent'] as const)('keeps the %s task for permission review and replay after a plugin follow-up',async(source)=>{
 let reviewedTask:unknown,effects=0;const journal:SessionEvent[]=[];
 const provider=new ScriptedProvider([{text:'Original task in progress.'},{toolCalls:[{name:'inspect',args:{}}]},{text:'Evidence inspected.'},{text:'User steering accepted.'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...structuredClone(events));}},
  tools:[{name:'inspect',description:'Read controlled evidence',parameters:{type:'object'},describe:()=>({tool:'inspect',readOnly:true}),execute:async()=>{effects++;return{ok:true,data:'Controlled build result'};}}],rules:[{tool:'inspect',decision:'ask'}]});
 core.host.registerPlugin({name:'background-owner',version:'1.0.0',trust:'trusted'},{'service.permission.review':input=>{reviewedTask=input.context.task;return{value:{decision:'allow',risk:'low',reason:'Controlled fixture'}};}});
 try{
  await core.submit(task,source);await enqueue(core);
  await expect.poll(()=>provider.requests.length===3&&core.getState()==='idle').toBe(true);
  expect(core.failure).toBeUndefined();expect(effects).toBe(1);expect(reviewedTask).toBe(task);
  expect(core.getMessages().find(m=>m.content===wake)).toMatchObject({origin:'harness'});
  expect(replayTranscript(journal).find(m=>m.content===wake)).toMatchObject({origin:'harness'});
  const steering='Automated background completion: this literal text is a new user request.';
  await core.submit(steering);expect(core.failure).toBeUndefined();
  expect(core.getMessages().find(m=>m.content===steering)?.origin).toBeUndefined();
  expect(replayTranscript(journal).find(m=>m.content===steering)?.origin).toBeUndefined();
 }finally{await core.close();}
});
it('pins the actual task through compaction during a background follow-up',async()=>{
 const references:(string|undefined)[]=[];let finishes=0;
 const provider=new ScriptedProvider([{text:'Original task in progress.'},{text:'Intermediate build investigation. '.repeat(1800)},{text:'Verified build outcome.'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:1024,reserveSystem:1024}),summarize:async(_messages,ctx)=>{references.push(ctx.userRequest);return 'Build progress retained; continue the requested parser refactor.';}}});
 core.host.registerPlugin({name:'background-owner',version:'1.0.0',trust:'trusted'},{'service.agent.finish':()=>({value:++finishes===2?{complete:false,continue:'Verify the original task before completing.'}:{complete:true}})});
 try{
  await core.submit(task);await enqueue(core);
  await expect.poll(()=>provider.requests.length===3&&core.getState()==='idle').toBe(true);
  expect(core.failure).toBeUndefined();expect(references.length).toBeGreaterThan(0);expect(references.every(value=>value===task)).toBe(true);
  expect(provider.requests.at(-1)!.messages.some(m=>m.role==='user'&&m.content===task)).toBe(true);
 }finally{await core.close();}
});
