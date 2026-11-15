import {expect,it} from 'vitest';
import type {ChatMessage} from '../../packages/core/src/provider.js';
import {deliveredHintKinds,hintCandidates} from './hint-receipts.js';
import {OpenAICompatProvider} from '../../packages/provider/src/openai-compat.js';

it('records only host-origin hints present at their exact serialized positions',()=>{
 const hint='Query recovery: consider a separate glob call with {"pattern":"**/*"}';
 const messages:ChatMessage[]=[{role:'user',content:hint},{role:'user',origin:'harness',content:hint},{role:'user',origin:'harness',content:'Verification recovery: inspect output'}];
 const candidates=hintCandidates(messages);
 expect(deliveredHintKinds(candidates,{messages:[{role:'user',content:hint},{role:'user',content:hint},{role:'user',content:'Verification recovery: inspect output'}]})).toEqual(['query-recovery','glob-example','verification-recovery']);
 expect(deliveredHintKinds(candidates,{messages:[{role:'user',content:hint},{role:'user',content:'different'}]})).toEqual([]);
 expect(deliveredHintKinds(hintCandidates([messages[0]]),{messages:[{role:'user',content:hint}]})).toEqual([]);
 expect(JSON.stringify(deliveredHintKinds(candidates,{messages:[{role:'user',content:hint},{role:'user',content:hint}]}))).not.toContain(hint);
});

it('matches host guidance against the actual compatible-provider request body',async()=>{
 const hint='Query recovery: consider a separate glob call with {"pattern":"**/*"}';
 const messages:ChatMessage[]=[{role:'user',content:'private task'},{role:'user',origin:'harness',content:hint}];
 let receipt:string[]=[];
 const fetch:typeof globalThis.fetch=async(_url,init)=>{
  receipt=deliveredHintKinds(hintCandidates(messages),JSON.parse(String(init?.body)));
  return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 const provider=new OpenAICompatProvider({baseUrl:'http://local.invalid/v1',model:'fixture',apiKey:'',retries:0,fetch});
 for await(const _ of provider.complete({messages,tools:[],signal:new AbortController().signal})){}
 expect(receipt).toEqual(['query-recovery','glob-example']);
 expect(JSON.stringify(receipt)).not.toContain('private task');
});
