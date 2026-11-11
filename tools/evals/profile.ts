import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {NativeProvider} from '../../packages/provider/src/native.js';
import {readSettings,storagePaths} from '../../packages/config/src/storage.js';
import type {ModelProvider,CompletionRequest,ProviderEvent} from '../../packages/core/src/provider.js';
import {EvalBudget} from './budget.js';

/** Credentials stay in the parent provider, never in the model workspace or trace. */
export async function evaluationProfile(name:string,maxUsd:number):Promise<{model:string;provider:ModelProvider;budget:EvalBudget}>{
 if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name))throw Error('Invalid evaluation profile name');
 const paths=storagePaths(process.cwd()),settings=await readSettings(process.cwd(),'providers.json');
 const profile=settings.profiles?.[name];
 if(profile?.type!=='openai-responses'||profile.model!=='gpt-6.1-sol'||profile.baseUrl!=='https://api.openai.com/v1')throw Error('Budgeted profiles currently require official OpenAI Responses with gpt-6.1-sol');
 const credentials=JSON.parse(await readFile(join(paths.home,'credentials.json'),'utf8'));
 const apiKey=credentials[name]?.accessToken;if(typeof apiKey!=='string'||!apiKey)throw Error('Evaluation profile has no saved credential');
 const budget=new EvalBudget(join(paths.home,'eval-budgets',name+'.json'),name,profile.model,maxUsd);
 await budget.status();
 const provider:ModelProvider={name:'budgeted-openai-responses',async *complete(request:CompletionRequest):AsyncIterable<ProviderEvent>{
  let reservation:string|undefined;
  const boundedFetch:typeof fetch=async(url,init)=>{
   if(String(url)!=='https://api.openai.com/v1/responses'||init?.method!=='POST'||typeof init.body!=='string')throw Error('Unexpected endpoint in paid evaluation');
   const body=JSON.parse(init.body);
   if(body.model!==profile.model||body.store!==false)throw Error('Unexpected model or persistence in paid evaluation');
   reservation=await budget.reserve(Buffer.byteLength(init.body),body.max_output_tokens);
   return fetch(url,{...init,redirect:'error'});
  };
  const native=new NativeProvider({type:'openai-responses',baseUrl:profile.baseUrl,model:profile.model,apiKey,
   timeoutMs:profile.timeoutMs??120000,maxOutputTokens:8192,retries:0,reasoningEffort:profile.reasoningEffort,fetch:boundedFetch});
  for await(const event of native.complete({...request,model:profile.model,maxOutputTokens:Math.min(request.maxOutputTokens??profile.maxOutputTokens??8192,8192)})){
   if(event.type==='usage'&&reservation)await budget.reported(reservation,event.inputTokens,event.outputTokens,{cachedInputTokens:event.cachedInputTokens,cacheWriteInputTokens:event.cacheWriteInputTokens});
   yield event;
  }
 }};
 return{model:profile.model,provider,budget};
}
