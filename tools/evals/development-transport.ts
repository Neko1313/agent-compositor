import {createServer,request,type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export interface DevelopmentLimits {
  maxRequests:number;maxRequestBytes:number;maxTotalRequestBytes:number;
  maxOutputTokens:number;maxMeasuredTokens:number;maxResponseBytes:number;deadlineMs:number;
}
export interface DevelopmentProvider {kind:'ollama'|'openai-compatible-local';baseUrl:string;model:string}
export interface DevelopmentRequestReceipt {
  id:number;requestBytes:number;requestSha256:string;maxOutputTokens:number;
  forwardedBytes:number;forwardedSha256:string;
  responseBytes:number;status?:number;inputTokens?:number;outputTokens?:number;error?:string;
}
export function validateDevelopmentProvider(input:DevelopmentProvider):URL {
  if(!['ollama','openai-compatible-local'].includes(input.kind))throw Error('Only explicit local compatible providers are supported; paid profiles require their persistent USD adapter');
  const url=new URL(input.baseUrl);
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/v1')
    throw Error('Use an explicit credential-free loopback http://127.0.0.1:PORT/v1 endpoint; no redirect, proxy or fallback');
  if(typeof input.model!=='string'||!input.model.trim()||input.model.length>200||/[\u0000-\u001f\u007f]/u.test(input.model))throw Error('An explicit model is required');
  return url;
}
export function validateDevelopmentLimits(value:DevelopmentLimits):void {
  const keys=['maxRequests','maxRequestBytes','maxTotalRequestBytes','maxOutputTokens','maxMeasuredTokens','maxResponseBytes','deadlineMs'] as const;
  if(!value||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Declare every development limit, with no unknown fields');
  for(const key of keys)if(!Number.isSafeInteger(value[key])||value[key]<1)throw Error('Positive integer development limits required: '+key);
  if(value.maxRequests>200||value.maxRequestBytes>2_000_000||value.maxTotalRequestBytes<value.maxRequestBytes||value.maxTotalRequestBytes>400_000_000||value.maxMeasuredTokens>100_000_000||value.maxOutputTokens>8192||value.deadlineMs>3_600_000||value.maxResponseBytes>16_000_000)
    throw Error('Development limits exceed the launcher envelope');
}
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;

/** Byte caps are byte caps. Reported tokens are observed usage, never an invoice. */
export async function createDevelopmentTransport(options:{provider:DevelopmentProvider;limits:DevelopmentLimits;output:string;signal?:AbortSignal}) {
  const upstream=validateDevelopmentProvider(options.provider);validateDevelopmentLimits(options.limits);
  options.signal?.throwIfAborted();
  await mkdir(options.output,{recursive:true});
  const receipts:DevelopmentRequestReceipt[]=[],active=new Set<AbortController>();
  const refusals:{phase:string;requestBytes:number;error:string}[]=[];
  let halted:string|undefined,totalBytes=0,measured=0,closed=false,accepting=false;
  const handlers=new Set<Promise<void>>();
  const halt=(reason:string)=>{halted??=reason;};
  const reject=(response:ServerResponse,reason:string)=>{response.writeHead(409,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:reason}}));};
  const stop=()=>{halt('Development transport stopped');for(const controller of active)controller.abort();};
  const live=()=>{if(halted||closed||options.signal?.aborted)throw Error(halted??'Development transport is closed or aborted');};
  options.signal?.addEventListener('abort',stop,{once:true});
  const deadline=setTimeout(()=>{halt('Development wall-clock deadline reached');stop();},options.limits.deadlineMs);deadline.unref();
  const handle=async(incoming:IncomingMessage,response:ServerResponse)=>{
    if(halted||closed||options.signal?.aborted){reject(response,halted??'Transport is closed');return;}
    if(incoming.method!=='POST'||incoming.url!=='/v1/chat/completions'){reject(response,'Only the selected chat-completions endpoint is admitted');return;}
    if(accepting){reject(response,'A prior completion is still unsettled');return;}
    accepting=true;
    let bytes=0,currentReceipt:DevelopmentRequestReceipt|undefined;const chunks:Buffer[]=[];
    try{
      for await(const chunk of incoming){const buffer=Buffer.from(chunk);bytes+=buffer.length;if(bytes>options.limits.maxRequestBytes)throw Error('Serialized request byte cap exceeded');chunks.push(buffer);}
      live();
      const original=Buffer.concat(chunks),body:unknown=JSON.parse(original.toString('utf8'));
      if(!object(body)||body.model!==options.provider.model||body.stream!==true||!Array.isArray(body.messages))throw Error('Unexpected model or nonstreaming request');
      if(body.n!==undefined&&body.n!==1)throw Error('Only one completion is admitted');
      if(receipts.length>=options.limits.maxRequests)throw Error('Whole-attempt request cap reached');
      if(measured>=options.limits.maxMeasuredTokens)throw Error('Reported token stop limit reached');
      if(!count(body.max_tokens)||body.max_tokens<1)throw Error('Installed CLI must supply a positive output-token limit');
      body.max_tokens=Math.min(body.max_tokens,options.limits.maxOutputTokens);body.stream_options={include_usage:true};
      const sent=JSON.stringify(body),forwardedBytes=Buffer.byteLength(sent);
      if(forwardedBytes>options.limits.maxRequestBytes||totalBytes+forwardedBytes>options.limits.maxTotalRequestBytes)throw Error('Whole-attempt serialized byte cap reached');
      const id=receipts.length+1,receipt:DevelopmentRequestReceipt={id,requestBytes:bytes,requestSha256:digest(original),forwardedBytes,forwardedSha256:digest(sent),maxOutputTokens:body.max_tokens as number,responseBytes:0};
      currentReceipt=receipt;
      receipts.push(receipt);totalBytes+=forwardedBytes;
      await writeFile(join(options.output,`${id}-request.json`),original,{flag:'wx',mode:0o600});
      await writeFile(join(options.output,`${id}-forwarded.json`),sent,{flag:'wx',mode:0o600});
      live();
      const controller=new AbortController();active.add(controller);
      const lost=()=>{if(!response.writableEnded)controller.abort();};response.on('close',lost);
      try{
        live();controller.signal.throwIfAborted();
        await new Promise<void>((resolve,rejectRequest)=>{
          const outgoing=request(new URL(upstream.toString().replace(/\/$/,'')+'/chat/completions'),{method:'POST',signal:controller.signal,headers:{'content-type':'application/json','content-length':Buffer.byteLength(sent)}},async result=>{
            let pending='',usageSeen=false;
            const decoder=new TextDecoder();
            const inspect=(line:string)=>{
              if(!line.startsWith('data:'))return;const text=line.slice(5).trim();if(!text||text==='[DONE]')return;
              const value:unknown=JSON.parse(text);if(!object(value)||value.usage===undefined||value.usage===null)return;
              const usage=value.usage;if(!object(usage)||!count(usage.prompt_tokens)||!count(usage.completion_tokens)||usageSeen)throw Error('Missing, duplicate or invalid provider usage');
              usageSeen=true;receipt.inputTokens=usage.prompt_tokens;receipt.outputTokens=usage.completion_tokens;
              measured+=usage.prompt_tokens+usage.completion_tokens;
              if(usage.completion_tokens>receipt.maxOutputTokens)throw Error('Provider exceeded the requested output-token cap');
              if(measured>options.limits.maxMeasuredTokens)throw Error('Reported token stop limit exceeded');
            };
            try{
              receipt.status=result.statusCode;
              if(result.statusCode!==200)throw Error('Upstream HTTP '+result.statusCode+'; no redirect/fallback');
              response.writeHead(200,{'content-type':'text/event-stream'});
              for await(const chunk of result){
                const buffer=Buffer.from(chunk);receipt.responseBytes+=buffer.length;
                if(receipt.responseBytes>options.limits.maxResponseBytes)throw Error('Response byte cap exceeded');
                await appendFile(join(options.output,`${id}-response.sse`),buffer,{mode:0o600});
                pending+=decoder.decode(buffer,{stream:true});let newline;
                while((newline=pending.indexOf('\n'))>=0){inspect(pending.slice(0,newline));pending=pending.slice(newline+1);}
                response.write(buffer);
              }
              pending+=decoder.decode();if(pending)inspect(pending);
              if(!usageSeen)throw Error('Provider omitted terminal usage; first response retained and further admission stopped');
              response.end();resolve();
            }catch(error){result.destroy();rejectRequest(error);}
          });
          outgoing.on('error',rejectRequest);outgoing.end(sent);
        });
      }catch(error){receipt.error=String(error);halt(receipt.error);if(!response.headersSent)reject(response,receipt.error);else response.destroy();}
      finally{active.delete(controller);response.off('close',lost);await writeFile(join(options.output,`${id}-receipt.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}
    }catch(error){
      if(currentReceipt)currentReceipt.error??=String(error);halt(String(error));
      const refusal={phase:currentReceipt?'admitted-evidence':'pre-admission',requestBytes:bytes,error:String(error)};refusals.push(refusal);
      try{await appendFile(join(options.output,'refusals.jsonl'),JSON.stringify(refusal)+'\n',{mode:0o600});}catch(persistence){halted+='; refusal persistence failed: '+String(persistence);}
      if(!response.headersSent)reject(response,String(error));else response.destroy();
    }
    finally{accepting=false;}
  };
  const server=createServer((incoming,response)=>{
    const task=handle(incoming,response);handlers.add(task);void task.catch(error=>{halt('Evidence persistence failed: '+String(error));response.destroy();}).finally(()=>handlers.delete(task));
  });
  await new Promise<void>((resolve,rejectListen)=>{server.once('error',rejectListen);server.listen(0,'127.0.0.1',()=>{server.off('error',rejectListen);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw Error('No development transport address');
  return{
    baseUrl:`http://127.0.0.1:${address.port}/v1`,
    snapshot:()=>({provider:options.provider,limits:options.limits,pendingRequest:accepting,receipts:structuredClone(receipts),refusals:structuredClone(refusals),totalRequestBytes:totalBytes,reportedTokens:measured,halted,
      accounting:'Serialized-byte admission caps; upstream max_tokens requested strictly; measured-token stop checked on reported usage, not pre-request tokenization or billing proof.'}),
    async close(){if(closed)return;closed=true;clearTimeout(deadline);options.signal?.removeEventListener('abort',stop);for(const controller of active)controller.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.allSettled(handlers);},
  };
}
