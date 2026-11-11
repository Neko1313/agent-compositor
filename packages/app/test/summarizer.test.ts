import {expect,it} from 'vitest';
import {createSummarizer} from '../src/summarizer.js';
import type {CompletionRequest,ProviderEvent} from '@agent-compositor/core';
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
