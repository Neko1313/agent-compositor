import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {validateDevelopmentLimits, type DevelopmentLimits} from './development-transport.js';
import {normalizeResponsesRequest} from './responses-contract.js';
import type {EvaluationProfileSession} from './profile.js';
import type {ProfileAttempt, ProfileReservation} from './profile-attempt.js';

export interface DevelopmentResponsesReceipt {
  id:number;requestBytes:number;requestSha256:string;forwardedBytes:number;forwardedSha256:string;
  responseBytes:number;reservation?:ProfileReservation;status?:number;settled?:boolean;
  terminal?:{type:'completed'|'incomplete';responseId?:string;usage:{inputTokens:number;outputTokens:number;cachedInputTokens:number;cacheWriteInputTokens:number}};
  error?:string;
}
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');

/** Parent-only Responses gateway. The profile session alone owns financial accounting. */
export async function createDevelopmentResponsesTransport(options:{
  session:EvaluationProfileSession;limits:DevelopmentLimits;output:string;signal?:AbortSignal;
}) {
  validateDevelopmentLimits(options.limits);options.signal?.throwIfAborted();
  await mkdir(options.output,{recursive:true});
  const receipts:DevelopmentResponsesReceipt[]=[],refusals:{phase:string;requestBytes:number;error:string}[]=[],handlers=new Set<Promise<void>>();
  let halted:string|undefined,sealed=false,closed=false,accepting=false,totalBytes=0,measured=0;
  let current:{controller:AbortController;attempt?:ProfileAttempt}|undefined;
  let waiting:{resume(value:boolean):void}|undefined;
  let closePromise:Promise<void>|undefined,finishPromise:Promise<void>|undefined;
  const message=(error:unknown)=>options.session.sanitizeError(error);
  const reject=(response:ServerResponse,reason:string)=>{
    if(response.destroyed)return;
    if(response.headersSent){if(!response.writableEnded)response.destroy();return;}
    response.writeHead(409,{'content-type':'application/json'});
    response.end(JSON.stringify({error:{code:'development_transport_refused',message:message(reason)}}));
  };
  const halt=(reason:unknown)=>{halted??=message(reason);waiting?.resume(false);};
  const stop=(reason:unknown)=>{halt(reason);current?.controller.abort(Error(halted));};
  const abort=()=>stop(options.signal?.reason??Error('Development transport stopped'));
  options.signal?.addEventListener('abort',abort,{once:true});
  const deadline=setTimeout(()=>stop(Error('Development wall-clock deadline reached')),options.limits.deadlineMs);deadline.unref();
  const enter=async(incoming:IncomingMessage,response:ServerResponse)=>{
    if(!accepting){accepting=true;return true;}
    if(waiting){reject(response,'A completion is already waiting');return false;}
    const admitted=await new Promise<boolean>(resolve=>{
      const cancel=()=>waiter.resume(false);
      const waiter={resume(value:boolean){
        if(waiting!==waiter)return;waiting=undefined;
        incoming.off('aborted',cancel);response.off('close',cancel);resolve(value);
      }};
      waiting=waiter;incoming.once('aborted',cancel);response.once('close',cancel);
      if(incoming.aborted||response.destroyed)cancel();
    });
    if(!admitted)reject(response,halted??(sealed?'Development admission is sealed':'Waiting completion was cancelled'));
    return admitted;
  };
  const leave=()=>{
    current=undefined;
    if(waiting&&!halted&&!closed&&!sealed&&!options.signal?.aborted)waiting.resume(true);
    else{accepting=false;waiting?.resume(false);}
  };
  const handle=async(incoming:IncomingMessage,response:ServerResponse)=>{
    if(halted||closed||sealed||options.signal?.aborted){reject(response,halted??'Development admission is sealed');return;}
    if(incoming.method!=='POST'||incoming.url!=='/v1/responses'){reject(response,'Only the selected Responses endpoint is admitted');return;}
    if(!await enter(incoming,response))return;
    const requestState={controller:new AbortController(),attempt:undefined as ProfileAttempt|undefined};current=requestState;
    let bytes=0,bodyComplete=false,discarding=false,receipt:DevelopmentResponsesReceipt|undefined,success=false;
    const chunks:Buffer[]=[];
    const discardBody=()=>{
      if(bodyComplete||discarding)return;discarding=true;
      if(response.destroyed||response.writableFinished){incoming.destroy();return;}
      if(!response.headersSent)response.setHeader('connection','close');
      response.once('finish',()=>incoming.destroy());
    };
    const cancelled=()=>{
      if(!bodyComplete){discardBody();reject(response,halted??message(requestState.controller.signal.reason));}
    };
    const lost=()=>{
      if(!response.writableEnded&&!requestState.attempt?.terminalObserved)
        requestState.controller.abort(Error('Completion client disconnected before a validated terminal'));
    };
    incoming.once('aborted',lost);response.on('close',lost);requestState.controller.signal.addEventListener('abort',cancelled,{once:true});
    const live=()=>{
      if(halted||closed||options.signal?.aborted)throw Error(halted??'Development transport stopped');
      if(incoming.aborted||response.destroyed)requestState.controller.abort(Error('Completion client disconnected before admission'));
      requestState.controller.signal.throwIfAborted();
    };
    const fail=async(error:unknown)=>{
      const reason=message(error);if(receipt)receipt.error??=reason;halt(reason);
      const refusal={phase:receipt?'admitted-evidence':'pre-admission',requestBytes:bytes,error:reason};refusals.push(refusal);
      try{await appendFile(join(options.output,'refusals.jsonl'),JSON.stringify(refusal)+'\n',{mode:0o600});}
      catch(error){halted+='; refusal persistence failed: '+message(error);}
      discardBody();reject(response,reason);
    };
    try{
      live();
      for await(const chunk of incoming){
        const buffer=Buffer.from(chunk);bytes+=buffer.length;
        if(bytes>options.limits.maxRequestBytes)throw Error('Serialized request byte cap exceeded');chunks.push(buffer);
      }
      bodyComplete=true;live();
      const original=Buffer.concat(chunks),body=normalizeResponsesRequest(JSON.parse(original.toString('utf8')),{
        model:options.session.model,maxOutputTokens:Math.min(options.session.maxOutputTokens,options.limits.maxOutputTokens),
        reasoningEffort:options.session.reasoningEffort,
      });
      if(receipts.length>=options.limits.maxRequests)throw Error('Whole-attempt request cap reached');
      if(measured>=options.limits.maxMeasuredTokens)throw Error('Reported token stop limit reached');
      const sent=JSON.stringify(body),forwardedBytes=Buffer.byteLength(sent);
      if(forwardedBytes>options.limits.maxRequestBytes||totalBytes+forwardedBytes>options.limits.maxTotalRequestBytes)
        throw Error('Whole-attempt serialized byte cap reached');
      const id=receipts.length+1;
      receipt={id,requestBytes:bytes,requestSha256:digest(original),forwardedBytes,forwardedSha256:digest(sent),responseBytes:0};
      receipts.push(receipt);totalBytes+=forwardedBytes;
      await writeFile(join(options.output,`${id}-request.json`),original,{flag:'wx',mode:0o600});
      await writeFile(join(options.output,`${id}-forwarded.json`),sent,{flag:'wx',mode:0o600});live();
      const owned=receipt;
      const attempt=await options.session.start(body,requestState.controller.signal,{
        beforeEgress:async reservation=>{
          owned.reservation=reservation;
          if(reservation.requestBytes!==forwardedBytes||reservation.requestSha256!==owned.forwardedSha256)
            throw Error('Profile authority changed the normalized request envelope');
          await writeFile(join(options.output,`${id}-reservation.json`),JSON.stringify(reservation,null,2)+'\n',{flag:'wx',mode:0o600});live();
        },
        onChunk:async chunk=>{
          owned.responseBytes+=chunk.byteLength;
          if(owned.responseBytes>options.limits.maxResponseBytes)throw Error('Response byte cap exceeded');
          await appendFile(join(options.output,`${id}-response.sse`),Buffer.from(chunk),{mode:0o600});
        },
      });
      requestState.attempt=attempt;owned.status=attempt.response.status;
      if(attempt.response.status!==200)throw Error('Profile authority returned a non-successful response');
      if(!attempt.response.body)throw Error('Profile authority returned an empty response');
      if(!response.destroyed)response.writeHead(200,{'content-type':'text/event-stream'});
      const reader=attempt.response.body.getReader();
      try{for(;;){const item=await reader.read();if(item.done)break;if(!response.destroyed)response.write(Buffer.from(item.value));}}
      finally{reader.releaseLock();}
      const settled=await attempt.settled;
      owned.terminal={type:settled.type,...(settled.responseId?{responseId:settled.responseId}:{}),usage:settled.usage};owned.settled=true;
      measured+=settled.usage.inputTokens+settled.usage.outputTokens;
      if(measured>options.limits.maxMeasuredTokens)throw Error('Reported token stop limit exceeded');
      requestState.controller.signal.throwIfAborted();success=true;
    }catch(error){
      requestState.controller.abort(error);
      // Revoking a caller does not release physical collector ownership early.
      await requestState.attempt?.settled.catch(()=>{});await fail(error);
    }
    finally{
      try{if(receipt)await writeFile(join(options.output,`${receipt.id}-receipt.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});}
      catch(error){success=false;await fail(error);}
      finally{
        if(success&&!response.destroyed)response.end();
        incoming.off('aborted',lost);response.off('close',lost);requestState.controller.signal.removeEventListener('abort',cancelled);leave();
      }
    }
  };
  const server=createServer((incoming,response)=>{
    const task=handle(incoming,response);handlers.add(task);
    void task.catch(error=>{halt(error);response.destroy();}).finally(()=>handlers.delete(task));
  });
  await new Promise<void>((resolve,rejectListen)=>{server.once('error',rejectListen);server.listen(0,'127.0.0.1',()=>{server.off('error',rejectListen);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw Error('No development Responses address');
  const closeServer=()=>closePromise??=Promise.resolve().then(async()=>{
    clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.allSettled([...handlers]);
  });
  return{
    baseUrl:`http://127.0.0.1:${address.port}/v1`,
    snapshot:()=>({provider:{kind:'saved-openai-profile',model:options.session.model,protocol:'responses'},limits:options.limits,
      pendingRequest:accepting,waitingRequests:waiting?1:0,sealed,receipts:structuredClone(receipts),refusals:structuredClone(refusals),
      totalRequestBytes:totalBytes,reportedTokens:measured,halted,
      accounting:'The parent profile session owns reservations and settlement in the existing persistent USD ledger; gateway bytes and reported tokens are separate limits.'}),
    close(){closed=true;sealed=true;waiting?.resume(false);if(current)stop(Error('Development transport closed'));return closeServer();},
    finish(){
      sealed=true;waiting?.resume(false);
      return finishPromise??=Promise.resolve().then(async()=>{
        if(current&&!current.attempt?.terminalObserved)stop(Error('Actor exited before a validated Responses terminal'));
        await Promise.allSettled([...handlers]);return closeServer();
      });
    },
  };
}
