import {createHash} from 'node:crypto';
import type {EvalBudget,EvaluationBudgetAudit} from './budget.js';
import {parseResponsesTerminal,ResponsesContractError} from './responses-contract.js';

export interface ProfileReservation {id:string;requestBytes:number;requestSha256:string;maxOutputTokens:number}
export interface ProfileTerminal {
 type:'completed'|'incomplete';responseId?:string;reservation:ProfileReservation;
 usage:{inputTokens:number;outputTokens:number;cachedInputTokens:number;cacheWriteInputTokens:number};
}
export interface ProfileSettlement extends ProfileTerminal {budget:EvaluationBudgetAudit}
export interface ProfileAttempt {
 readonly response:Response;readonly reservation:ProfileReservation;readonly terminalObserved:boolean;
 readonly terminalValidated:Promise<ProfileTerminal>;readonly settled:Promise<ProfileSettlement>;
}
export interface ProfileAttemptCallbacks {
 beforeEgress?:(reservation:ProfileReservation)=>void|Promise<void>;
 onChunk?:(bytes:Uint8Array)=>void|Promise<void>;
}
interface AttemptOptions extends ProfileAttemptCallbacks {
 body:Record<string,unknown>;budget:EvalBudget;signal:AbortSignal;timeoutMs:number;
 dispatch:(body:string,signal:AbortSignal)=>Promise<Response>;close:()=>Promise<void>;sanitizeError:(error:unknown)=>string;
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return{promise,resolve,reject};}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const aborted=()=>{signal.removeEventListener('abort',aborted);reject(signal.reason);};
  signal.addEventListener('abort',aborted,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',aborted);resolve(value);},error=>{signal.removeEventListener('abort',aborted);reject(error);});
  if(signal.aborted)aborted();
 });
}

/** One parent-owned stream collector owns admission and exactly one durable charge. */
export async function startProfileAttempt(options:AttemptOptions):Promise<ProfileAttempt>{
 const controller=new AbortController(),signal=controller.signal;
 const abort=()=>controller.abort(Error('Evaluation profile request aborted; reservation retained'));
 options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();
 const timeout=setTimeout(()=>controller.abort(Error('Evaluation profile deadline reached; reservation retained')),options.timeoutMs);timeout.unref();
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;clearTimeout(timeout);options.signal.removeEventListener('abort',abort);try{await options.close();}catch(error){throw Error(options.sanitizeError(error));}};
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const cancelReader=()=>{void reader?.cancel(signal.reason).catch(()=>{});};
 signal.addEventListener('abort',cancelReader,{once:true});
 try{
  signal.throwIfAborted();const serialized=JSON.stringify(options.body),requestBytes=Buffer.byteLength(serialized);
  const id=await options.budget.reserve(requestBytes,options.body.max_output_tokens as number,'standard');
  const reservation=Object.freeze({id,requestBytes,requestSha256:createHash('sha256').update(serialized).digest('hex'),maxOutputTokens:options.body.max_output_tokens as number});
  signal.throwIfAborted();
  // Persistence callbacks are owned work: cancellation revokes egress now,
  // but settlement must join their writes before admission can transfer.
  if(options.beforeEgress)await options.beforeEgress(reservation);
  signal.throwIfAborted();
  const pending=options.dispatch(serialized,signal);
  void pending.then(response=>{if(signal.aborted)void response.body?.cancel().catch(()=>{});},()=>{});
  const upstream=await abortable(pending,signal);
  if(upstream.status!==200){void upstream.body?.cancel().catch(()=>{});throw Error('Evaluation profile upstream HTTP '+upstream.status+'; reservation retained');}
  if(!upstream.body)throw Error('Evaluation profile response has no stream; reservation retained');
  reader=upstream.body.getReader();
  let consumer:ReadableStreamDefaultController<Uint8Array>|undefined,consumerOpen=true,terminalObserved=false;
  const body=new ReadableStream<Uint8Array>({start(value){consumer=value;},cancel(){consumerOpen=false;}});
  const response=new Response(body,{status:200,headers:{'content-type':'text/event-stream'}});
  const terminal=deferred<ProfileTerminal>();
  const task=(async():Promise<ProfileSettlement>=>{
   let bytes=0,pendingLine='',data:string[]=[],eventBytes=0,count=0,observed:ProfileTerminal|undefined;
   const decoder=new TextDecoder('utf-8',{fatal:true});
   const event=async()=>{
    if(!data.length)return;
    const text=data.join('\n');data=[];eventBytes=0;if(text==='[DONE]')return;
    const value=JSON.parse(text) as {type?:string;error?:unknown};
    if(value?.error||value?.type==='error'||value?.type==='response.failed')throw Error('Evaluation profile upstream reported an error; reservation retained');
    if(value?.type!=='response.completed'&&value?.type!=='response.incomplete')return;
    let parsed:ReturnType<typeof parseResponsesTerminal>;
    try{parsed=parseResponsesTerminal(value);}catch(error){if(error instanceof ResponsesContractError&&error.code==='pricing')await options.budget.halt();throw error;}
    if(parsed.inputTokens>reservation.requestBytes+4096||parsed.outputTokens>reservation.maxOutputTokens)throw Error('Evaluation profile terminal usage exceeds its reserved token envelope; reservation retained');
    if(++count!==1)throw Error('Evaluation profile response repeated terminal usage; reservation retained');
    observed=Object.freeze({type:parsed.kind,...(parsed.responseId?{responseId:parsed.responseId}:{}),reservation,
     usage:Object.freeze({inputTokens:parsed.inputTokens,outputTokens:parsed.outputTokens,cachedInputTokens:parsed.cachedInputTokens,cacheWriteInputTokens:parsed.cacheWriteInputTokens})});
    terminalObserved=true;terminal.resolve(observed);
   };
   const line=async(value:string)=>{
    if(value.endsWith('\r'))value=value.slice(0,-1);
    if(Buffer.byteLength(value)>2_000_000)throw Error('Evaluation profile response line exceeds its bound; reservation retained');
    if(!value){await event();return;}
    if(value.startsWith('data:')){const text=value.slice(5).replace(/^ /,'');eventBytes+=Buffer.byteLength(text);if(eventBytes>2_000_000)throw Error('Evaluation profile response event exceeds its bound; reservation retained');data.push(text);}
   };
   const parse=async(text:string)=>{
    pendingLine+=text;let newline:number;
    while((newline=pendingLine.indexOf('\n'))>=0){await line(pendingLine.slice(0,newline));pendingLine=pendingLine.slice(newline+1);}
    if(Buffer.byteLength(pendingLine)>2_000_000)throw Error('Evaluation profile response line exceeds its bound; reservation retained');
   };
   try{
    for(;;){
     signal.throwIfAborted();const next=await abortable(reader!.read(),signal);signal.throwIfAborted();if(next.done)break;
     const chunk=Uint8Array.from(next.value);bytes+=chunk.byteLength;if(bytes>16_000_000)throw Error('Evaluation profile response exceeds its byte bound; reservation retained');
     let parseError:unknown;try{await parse(decoder.decode(chunk,{stream:true}));}catch(error){parseError=error;}
     signal.throwIfAborted();
     if(options.onChunk)await options.onChunk(Uint8Array.from(chunk));
     signal.throwIfAborted();if(parseError)throw parseError;if(consumerOpen)consumer!.enqueue(chunk);
    }
    await parse(decoder.decode());if(pendingLine){await line(pendingLine);pendingLine='';}await event();
    signal.throwIfAborted();if(count!==1||!observed)throw Error('Evaluation profile stream ended without validated terminal usage; reservation retained');
    const usage=observed.usage;
    await options.budget.reported(reservation.id,usage.inputTokens,usage.outputTokens,{cachedInputTokens:usage.cachedInputTokens,cacheWriteInputTokens:usage.cacheWriteInputTokens});
    const result=Object.freeze({...observed,budget:await options.budget.auditStatus()});
    if(consumerOpen){consumerOpen=false;consumer!.close();}return result;
   }catch(error){
    controller.abort(error);const safe=Error(options.sanitizeError(error));terminal.reject(safe);
    if(consumerOpen){consumerOpen=false;consumer!.error(safe);}throw safe;
   }finally{
    signal.removeEventListener('abort',cancelReader);cancelReader();await close();
   }
  })();
  void task.catch(()=>{});
  return Object.freeze({response,reservation,get terminalObserved(){return terminalObserved;},terminalValidated:terminal.promise,settled:task});
 }catch(error){controller.abort(error);signal.removeEventListener('abort',cancelReader);cancelReader();await close();throw Error(options.sanitizeError(error));}
}
