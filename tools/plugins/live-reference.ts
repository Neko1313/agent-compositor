import {randomUUID} from 'node:crypto';
import type {ModelProvider,CompletionRequest,ProviderEvent} from '@agent-compositor/core';
export class LiveReference implements ModelProvider{
 name='ollama';frames:any[]=[];onStart?:()=>void;unavailable=false;
 constructor(readonly policy:any){}
 async *complete(req:CompletionRequest):AsyncIterable<ProviderEvent>{
  if(this.frames.length>=this.policy.configuration.maxSteps)throw Error('Live task call budget exhausted');
  const names=new Map<string,string>();for(const m of req.messages)for(const t of m.toolCalls??[])names.set(t.id,t.name);
  const body={model:this.policy.name,stream:false,think:false,messages:req.messages.map(m=>({role:m.role,content:m.content,...(m.toolCalls?{tool_calls:m.toolCalls.map(t=>({type:'function',function:{name:t.name,arguments:t.args}}))}:{}),...(m.role==='tool'?{tool_name:names.get(m.toolCallId??'')}: {})})),...(req.tools?.length?{tools:req.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}))}:{}),options:{temperature:this.policy.configuration.temperature,num_predict:Math.min(req.maxOutputTokens??this.policy.configuration.maxOutputTokens,this.policy.configuration.maxOutputTokens)}};
  const frame:any={startedAt:new Date().toISOString(),request:body};this.frames.push(frame);
  if(this.unavailable){frame.blocked='controlled dependency outage';throw Error('Live provider deliberately unavailable for failure-path fixture');}
  if(this.tokens()>=this.policy.configuration.maxTokensPerTask)throw Error('Live task token budget exhausted');
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(this.policy.configuration.requestTimeoutMs)]);
  try{
   const pending=fetch((process.env.PLUGIN_LIVE_OLLAMA_URL??'http://127.0.0.1:11434')+'/api/chat',{method:'POST',headers:{'content-type':'application/json',...(process.env.PLUGIN_LIVE_OLLAMA_TOKEN?{authorization:'Bearer '+process.env.PLUGIN_LIVE_OLLAMA_TOKEN}:{})},body:JSON.stringify(body),signal});this.onStart?.();
   const response=await pending;const raw=await response.json() as any;frame.response=raw;frame.finishedAt=new Date().toISOString();
   if(!response.ok||raw.error)throw Error('Reference provider failed: '+(raw.error??response.status));
   if(this.tokens()>this.policy.configuration.maxTokensPerTask)throw Error('Live task token budget exceeded');
   if(raw.message?.content)yield{type:'text_delta',text:raw.message.content};
   for(const call of raw.message?.tool_calls??[])yield{type:'tool_call',id:randomUUID(),name:call.function.name,args:call.function.arguments};
   yield{type:'usage',inputTokens:raw.prompt_eval_count??0,outputTokens:raw.eval_count??0};yield{type:'finish',reason:raw.message?.tool_calls?.length?'tool_calls':'stop'};
  }catch(error){frame.error=String(error);frame.finishedAt=new Date().toISOString();throw error;}
 }
 async text(request:any,signal:AbortSignal){let text='';for await(const event of this.complete({...request,messages:request.messages,tools:[],signal})){if(event.type==='text_delta')text+=event.text;}return text;}
 tokens(){return this.frames.reduce((n,f)=>n+(f.response?.prompt_eval_count??0)+(f.response?.eval_count??0),0);}
}
