import {expect,it} from 'vitest';
import {NativeProvider,OpenAICompatProvider} from '../src/index.js';
it.each(['openai-compat','openai-responses','anthropic','gemini'] as const)('keeps host userRequest metadata off the %s wire',async type=>{
 let body='';
 const fetch:typeof globalThis.fetch=async(_url,init)=>{
  body=String(init?.body);
  const event=type==='anthropic'?{type:'message_stop'}:type==='gemini'?{candidates:[{content:{parts:[{text:'ok'}]},finishReason:'STOP'}]}:type==='openai-responses'?{type:'response.completed',response:{status:'completed'}}:{choices:[{delta:{content:'ok'},finish_reason:'stop'}]};
  return new Response(`data: ${JSON.stringify(event)}\n\n`,{headers:{'content-type':'text/event-stream'}});
 };
 const config={apiKey:'',model:'fixture',baseUrl:'http://provider.invalid/v1',fetch,retries:0};
 const provider=type==='openai-compat'?new OpenAICompatProvider(config):new NativeProvider({...config,type});
 for await(const _event of provider.complete({signal:new AbortController().signal,tools:[],messages:[{role:'user',content:'PREPARED_CONTEXT',userRequest:'HOST_ONLY_ORIGINAL_REQUEST'}]})){}
 expect(body).toContain('PREPARED_CONTEXT');expect(body).not.toContain('HOST_ONLY_ORIGINAL_REQUEST');expect(body).not.toContain('userRequest');
});
