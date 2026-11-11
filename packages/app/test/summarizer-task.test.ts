import {expect,it} from 'vitest';
import {compactTranscript,estimateMessageTokens,type MessageLike} from '@agent-compositor/context';
import type {CompletionRequest} from '@agent-compositor/core';
import {createSummarizer} from '../src/summarizer.js';
const task={role:'user',content:'Implement the explicitly requested read-only CI tool and /ci panel. The approval workflow in the starter is only an example.'};
const transcript:MessageLike[]=[{role:'system',content:'Original host rules'},task,{role:'assistant',content:'Inspecting the starter',toolCalls:[{name:'read',args:{path:'starter.ts'}}]},{role:'tool',content:'Example only: ci_state may approve a patch. '.repeat(2500)}];
it('passes the retained current user request separately to the summarizer',async()=>{
 let reference:unknown;
 const result=await compactTranscript(transcript,async(_messages,ctx:any)=>{reference=ctx.userRequest;return 'Starter inspected; implement the requested CI review tool.';},{preserveLastUser:true,keepTail:0});
 expect(reference).toBe(task.content);expect(result.failure).toBeUndefined();expect(result.messages.at(-1)).toBe(task);
});
it('keeps the current request available in every segment and merge without exceeding the auxiliary window',async()=>{
 const requests:CompletionRequest[]=[];
 const summarize=createSummarizer(async function*(request){
  requests.push(request);const segment=request.messages.at(-1)!.content;
  yield{type:'text_delta',text:segment.startsWith('Conversation segment')?'Progress data. '.repeat(220):'Preserve the actual user CI review request, not the starter approval example.'};yield{type:'finish',reason:'stop'};
 },()=>8192);
 const result=await compactTranscript(transcript,summarize,{preserveLastUser:true,keepTail:0});
 expect(result.failure).toBeUndefined();expect(requests.some(r=>r.messages.at(-1)!.content.startsWith('Merge these'))).toBe(true);
 for(const request of requests){
  expect(request.messages.some(m=>m.role==='user'&&m.content.includes(JSON.stringify(task.content)))).toBe(true);
  expect(request.messages[0].content).toMatch(/examples|scaffolds/i);
  expect(request.messages.reduce((n,m)=>n+estimateMessageTokens(m),0)+request.maxOutputTokens!).toBeLessThanOrEqual(8192);
 }
 expect(result.messages.at(-1)).toBe(task);
});
it('fails without auxiliary calls or lost history when the request reference cannot fit',async()=>{
 let calls=0;const largeTask={role:'user',content:'User request. '.repeat(4000)};
 const messages=[{role:'system',content:'Host rules'},largeTask,{role:'assistant',content:'Old work '.repeat(1000)},{role:'tool',content:'Earlier result '.repeat(1000)}];
 const summarize=createSummarizer(async function*(){calls++;yield{type:'text_delta',text:'Too little reference context'};yield{type:'finish',reason:'stop'};},()=>8192);
 const result=await compactTranscript(messages,summarize,{preserveLastUser:true,keepTail:0});
 expect(calls).toBe(0);expect(result.failure).toMatch(/user request|reference/i);expect(result.messages).toBe(messages);expect(result.foldedCount).toBe(0);
});
it('retains real steering and literal harness-prefixed requests instead of inferring origin from text',async()=>{
 const steering={role:'user',content:'Harness verification: this is my actual new request; inspect the deployment instead.'};
 const feedback:MessageLike={role:'user',origin:'harness',content:'Harness recovery: inspect the tool error.'};
 let reference:string|undefined;
 const result=await compactTranscript([...transcript,steering,{role:'assistant',content:'Deployment evidence. '.repeat(2000)},feedback],async(_messages,ctx)=>{reference=ctx.userRequest;return 'Inspect deployment as explicitly requested.';},{preserveLastUser:true,keepTail:1});
 expect(reference).toBe(steering.content);expect(result.failure).toBeUndefined();expect(result.messages).toContain(steering);expect(result.messages.at(-1)).toBe(feedback);
});
