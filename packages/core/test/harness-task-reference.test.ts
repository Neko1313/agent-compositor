import {expect,it} from 'vitest';
import {AgentCore,ScriptedProvider,replayTranscript,type CompletionRequest} from '../src/index.js';
import {TokenBudget} from '@agent-compositor/context';

it.each(['verification','recovery'] as const)('preserves the actual task when %s feedback triggers compaction',async(mode)=>{
 const task='Implement the requested read-only CI review plugin; preserve the user draft.';
 const references:(string|undefined)[]=[],requests:CompletionRequest[]=[];let effects=0,checks=0;
 const scripted=new ScriptedProvider(mode==='verification'?[{text:'Intermediate draft. '.repeat(1800)},{text:'Verified final result.'}]:[
  ...Array.from({length:3},()=>({toolCalls:[{name:'inspect',args:{}}]})),{text:'Reported the concrete inspection failure.'},
 ]);
 const core=new AgentCore({cwd:process.cwd(),systemPrompt:'Follow the actual user task.',
  provider:{name:'task-reference-fixture',async *complete(request){requests.push(request);yield* scripted.complete(request);}},
  tools:[{name:'inspect',description:'Inspect controlled evidence',parameters:{type:'object'},describe:()=>({tool:'inspect',readOnly:true}),execute:async()=>{effects++;throw Error(effects===3?'Controlled failure. '.repeat(1800):'Controlled inspection failure');}}],
  rules:[{tool:'inspect',decision:'allow'}],
  compaction:{budget:new TokenBudget({contextWindow:8192,reserveOutput:1024,reserveSystem:1024}),summarize:async(_messages,ctx)=>{references.push(ctx.userRequest);return 'Inspection progress retained; continue the actual user task.';}},
 });
 if(mode==='verification')core.host.registerPlugin({name:'completion-fixture',version:'1.0.0',trust:'trusted'},{'service.agent.finish':()=>({value:++checks===1?{complete:false,continue:'Provide independently verified results.'}:{complete:true}})});
 try{
  await core.submit(task);expect(core.failure).toBeUndefined();expect(references.length).toBeGreaterThan(0);
  expect(references.every(reference=>reference===task)).toBe(true);
  expect(requests.at(-1)!.messages.some(message=>message.role==='user'&&message.content===task)).toBe(true);
  const restored=replayTranscript([{type:'context.compacted',messages:JSON.parse(JSON.stringify(core.getMessages()))}] as Parameters<typeof replayTranscript>[0]);
  expect(restored.some(message=>message.origin==='harness'&&message.content.startsWith('Harness '))).toBe(true);
  expect(effects).toBe(mode==='recovery'?3:0);
 }finally{await core.close();}
});
