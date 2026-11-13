import {expect,it} from 'vitest';
import {createSummarizer} from '../src/summarizer.js';
import type {CompletionRequest,ProviderEvent} from '@agent-compositor/core';
import {compactTranscript} from '@agent-compositor/context';
const messages=[{role:'user',content:'Preserve the original plugin task and pending checks.'}];

it('retries a truncated segment with more output space and discards partial summaries',async()=>{
 const requests:CompletionRequest[]=[];
 const summarize=createSummarizer(async function*(request){
  requests.push(request);
  yield{type:'text_delta',text:requests.length===1?'Incomplete draft':'Verified progress and next checks'};
  yield{type:'finish',reason:requests.length===1?'length':'stop'};
 },()=>24576);
 expect(await summarize(messages,{signal:new AbortController().signal})).toBe('Verified progress and next checks');
 expect(requests.map(r=>r.maxOutputTokens)).toEqual([2048,4096]);
 expect(requests[1].messages).toEqual(requests[0].messages);
 expect(requests.every(r=>r.toolChoice==='none'&&r.tools.length===0)).toBe(true);
});
it.each(['stop','length','tool_calls'] as const)('rejects tool events even with finish %s, without retrying',async reason=>{
 let calls=0;
 const summarize=createSummarizer(async function*(){
  calls++;
  yield{type:'text_delta',text:'A plausible but incomplete summary'};
  yield{type:'tool_call',id:'unexpected',name:'exec',args:{command:'must not execute'}};
  yield{type:'usage',inputTokens:100,outputTokens:50};
  yield{type:'finish',reason};
 },()=>32768);
 await expect(summarize(messages,{signal:new AbortController().signal})).rejects.toThrow('unexpected tool call');
 expect(calls).toBe(1);
});
it.each([
 {window:24576,expected:[2048,4096,6144]},
 {window:1050000,expected:[2048,4096,8192]},
])('bounds repeated truncation at context size $window',async({window,expected})=>{
 const limits:number[]=[];
 const summarize=createSummarizer(async function*(request){limits.push(request.maxOutputTokens!);yield{type:'finish',reason:'length'};},()=>window);
 await expect(summarize(messages,{signal:new AbortController().signal})).rejects.toThrow('output limit');
 expect(limits).toEqual(expected);
});
it.each(['error','tool_calls',undefined] as const)('does not retry an incomplete stream with finish %s',async reason=>{
 let calls=0;
 const summarize=createSummarizer(async function*(){calls++;yield{type:'text_delta',text:'Unverified partial summary'};if(reason)yield{type:'finish',reason} as ProviderEvent;},()=>32768);
 await expect(summarize(messages,{signal:new AbortController().signal})).rejects.toThrow('did not complete');
 expect(calls).toBe(1);
});
it('does not retry after cancellation during a truncated attempt',async()=>{
 const abort=new AbortController();let calls=0;
 const summarize=createSummarizer(async function*(){calls++;abort.abort();yield{type:'finish',reason:'length'};},()=>32768);
 await expect(summarize(messages,{signal:abort.signal})).rejects.toThrow();expect(calls).toBe(1);
});
it('retains the original transcript when a provider violates text-only compaction',async()=>{
 let drained=false;
 const summarize=createSummarizer(async function*(){
  yield{type:'text_delta',text:'Do not commit this candidate'};
  yield{type:'tool_call',id:'unexpected',name:'exec',args:{command:'must not execute'}};
  yield{type:'usage',inputTokens:100,outputTokens:50};
  yield{type:'finish',reason:'stop'};
  drained=true;
 },()=>32768);
 const transcript=[...messages,{role:'assistant',content:'Important pending work. '.repeat(1000)},{role:'user',content:'Continue the original task'}];
 const result=await compactTranscript(transcript,summarize,{keepTail:0,preserveLastUser:true});
 expect(result.messages).toBe(transcript);
 expect(result.foldedCount).toBe(0);
 expect(result.failure).toContain('unexpected tool call');
 expect(drained).toBe(true);
});
