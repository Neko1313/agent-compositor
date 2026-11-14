import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {NativeProvider} from '../../packages/provider/src/native.js';
import {NetworkClient} from '../../packages/provider/src/network.js';
import {readSettings,storagePaths} from '../../packages/config/src/storage.js';
import type {ModelProvider,CompletionRequest,ProviderEvent} from '../../packages/core/src/provider.js';
import {EvalBudget,type EvaluationBudgetAudit} from './budget.js';
import {normalizeResponsesRequest,RESPONSES_MODEL} from './responses-contract.js';
import {startProfileAttempt,type ProfileAttempt,type ProfileAttemptCallbacks} from './profile-attempt.js';

export interface EvaluationProfileOptions {existingOnly?:boolean;parentScope?:{cwd:string;env:NodeJS.ProcessEnv}}
export interface EvaluationProfileDescriptor {
 profile:string;type:'openai-responses';baseUrl:'https://api.openai.com/v1';endpoint:'https://api.openai.com/v1/responses';
 model:'gpt-6.1-sol';reasoningEffort?:string;maxOutputTokens:number;
}
export interface EvaluationProfileSession {
 readonly descriptor:EvaluationProfileDescriptor;readonly model:'gpt-6.1-sol';readonly reasoningEffort?:string;readonly maxOutputTokens:number;
 readonly budget:EvalBudget;
 auditStatus():Promise<EvaluationBudgetAudit>;
 start(body:Record<string,unknown>,signal:AbortSignal,callbacks?:ProfileAttemptCallbacks):Promise<ProfileAttempt>;
 sanitizeError(error:unknown):string;
}

/** Capture only the parent scope; credentials and proxy configuration never leave this closure. */
export async function openEvaluationProfile(name:string,maxUsd:number,options:EvaluationProfileOptions={}):Promise<EvaluationProfileSession>{
 if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name))throw Error('Invalid evaluation profile name');
 const cwd=options.parentScope?.cwd??process.cwd(),env={...(options.parentScope?.env??process.env)};
 const paths=storagePaths(cwd,env),settings=await readSettings(cwd,'providers.json',env),profile=settings.profiles?.[name];
 if(profile?.type!=='openai-responses'||profile.model!==RESPONSES_MODEL||profile.baseUrl!=='https://api.openai.com/v1')throw Error('Budgeted profiles currently require official OpenAI Responses with gpt-6.1-sol');
 const credentials=JSON.parse(await readFile(join(paths.home,'credentials.json'),'utf8'));
 const apiKey=credentials[name]?.accessToken;if(typeof apiKey!=='string'||!apiKey)throw Error('Evaluation profile has no saved credential');
 const budget=new EvalBudget(join(paths.home,'eval-budgets',name+'.json'),name,profile.model,maxUsd,{existingOnly:options.existingOnly});
 await budget.status();
 const proxy=await readSettings(cwd,'proxy.json',env);
 const maxOutputTokens=Math.min(profile.maxOutputTokens??8192,8192),timeoutMs=Math.min(profile.timeoutMs??120000,180000);
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||
  (profile.reasoningEffort!==undefined&&typeof profile.reasoningEffort!=='string'))throw Error('Invalid bounded evaluation profile configuration');
 const secrets=new Set<string>([apiKey]);
 if(typeof proxy.url==='string'){
  secrets.add(proxy.url);try{const url=new URL(proxy.url);for(const part of [url.username,url.password])if(part){secrets.add(part);try{secrets.add(decodeURIComponent(part));}catch{}}}catch{}
 }
 for(const secret of [...secrets])secrets.add(encodeURIComponent(secret));
 const sanitizeError=(error:unknown)=>{
  let text=String(error);for(const secret of [...secrets].filter(Boolean).sort((a,b)=>b.length-a.length))text=text.split(secret).join('[redacted]');
  return text.replace(/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/gi,'[redacted-proxy]@').replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,1000);
 };
 const descriptor:EvaluationProfileDescriptor=Object.freeze({profile:name,type:'openai-responses',baseUrl:'https://api.openai.com/v1',
  endpoint:'https://api.openai.com/v1/responses',model:RESPONSES_MODEL,...(profile.reasoningEffort?{reasoningEffort:profile.reasoningEffort}:{}),maxOutputTokens});
 return Object.freeze({descriptor,model:descriptor.model,reasoningEffort:descriptor.reasoningEffort,maxOutputTokens,budget,
  auditStatus:()=>budget.auditStatus(),sanitizeError,
  async start(body:Record<string,unknown>,signal:AbortSignal,callbacks:ProfileAttemptCallbacks={}){
   let network:NetworkClient|undefined;
   try{
    signal.throwIfAborted();
    const normalized=normalizeResponsesRequest(body,{model:descriptor.model,maxOutputTokens,reasoningEffort:descriptor.reasoningEffort});
    return await startProfileAttempt({body:normalized,budget,signal,timeoutMs,beforeEgress:callbacks.beforeEgress,onChunk:callbacks.onChunk,sanitizeError,
     dispatch:async(serialized,signal)=>{
      network=new NetworkClient();network.configure(proxy);
      return network.fetch('models')(descriptor.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+apiKey},
       body:serialized,signal,redirect:'error'});
     },close:async()=>{await network?.close();},
    });
   }catch(error){throw Error(sanitizeError(error));}
  },
 });
}

/** The typed facade and raw gateway share the same parent collector and ledger authority. */
export async function evaluationProfile(name:string,maxUsd:number):Promise<{model:string;provider:ModelProvider;budget:EvalBudget}>{
 const session=await openEvaluationProfile(name,maxUsd);
 const provider:ModelProvider={name:'budgeted-openai-responses',async *complete(request:CompletionRequest):AsyncIterable<ProviderEvent>{
  let attempt:ProfileAttempt|undefined;
  try{
   const boundedFetch:typeof fetch=async(url,init)=>{
    if(String(url)!==session.descriptor.endpoint||init?.method!=='POST'||typeof init.body!=='string')throw Error('Unexpected endpoint in paid evaluation');
    attempt=await session.start(JSON.parse(init.body),init.signal??request.signal);return attempt.response;
   };
   const native=new NativeProvider({type:'openai-responses',baseUrl:session.descriptor.baseUrl,model:session.model,apiKey:'parent-owned-evaluation',
    timeoutMs:180000,maxOutputTokens:session.maxOutputTokens,retries:0,reasoningEffort:session.reasoningEffort,fetch:boundedFetch});
   for await(const event of native.complete({...request,model:session.model,maxOutputTokens:Math.min(request.maxOutputTokens??session.maxOutputTokens,session.maxOutputTokens)})){
    if(attempt&&(event.type==='usage'||event.type==='finish'))await attempt.settled;
    yield event;
   }
  }catch(error){if(!request.signal.aborted)yield{type:'finish',reason:'error',error:session.sanitizeError(error)};}
  finally{await attempt?.settled.catch(()=>{});}
 }};
 return{model:session.model,provider,budget:session.budget};
}
