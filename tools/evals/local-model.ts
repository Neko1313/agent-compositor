import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {evaluationEnvironment} from './environment.js';
export type ModelPin={model:string;manifest:string;source:string;layers:{digest:string;size:number}[]};

/** Refuse missing/changed cached layers instead of downloading or adopting a cloud stub. */
export async function verifyLocalCache(cache:string,pin:ModelPin,signal?:AbortSignal){
 signal?.throwIfAborted();
 if(!/^[\w.-]+:[\w.-]+$/.test(pin.model)||pin.manifest.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid local model pin');
 const manifest=JSON.parse(await readFile(join(cache,'manifests',pin.manifest),'utf8'));
 if(manifest.remote_host||manifest.remote_model)throw Error('Cloud models are not a local CPU cache');
 const layers=[manifest.config,...(manifest.layers??[])];
 if(layers.length!==pin.layers.length||layers.some((layer,index)=>layer?.digest!==pin.layers[index].digest||layer.size!==pin.layers[index].size))throw Error('Cached manifest differs from pinned layers');
 for(const layer of pin.layers){
  if(!/^sha256:[a-f0-9]{64}$/.test(layer.digest)||!Number.isSafeInteger(layer.size)||layer.size<0)throw Error('Invalid layer pin');
  const hash=createHash('sha256');let size=0;
  for await(const chunk of createReadStream(join(cache,'blobs',layer.digest.replace(':','-')))){signal?.throwIfAborted();hash.update(chunk);size+=chunk.length;}
  if(size!==layer.size||'sha256:'+hash.digest('hex')!==layer.digest)throw Error('Cached model layer failed verification');
 }
 return {model:pin.model,source:pin.source,layers:pin.layers,verified:true};
}

/** A local endpoint cannot redirect a completion to a different origin/model. */
export function localCompletionFetch(base:string,model:string,transport:typeof fetch=fetch):typeof fetch{
 const origin=new URL(base);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port)throw Error('CPU evaluation requires an explicit loopback port');
 return async(input,init)=>{
  if(String(input)!==origin.origin+'/v1/chat/completions'||init?.method!=='POST'||typeof init.body!=='string')throw Error('Refusing a nonlocal completion route');
  const body=JSON.parse(init.body);if(body.model!==model)throw Error('Refusing an unpinned model route');
  return transport(input,{...init,redirect:'error'});
 };
}

/** Own a separate server/cache namespace; never reconfigure the user's Ollama service. */
export async function localModelServer(cache:string,pin:ModelPin,signal:AbortSignal){
 const temp=await mkdtemp(join(tmpdir(),'compositor-cpu-model-'));
 const port=await new Promise<number>((done,fail)=>{const server=createServer();server.once('error',fail);server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>done(typeof address==='object'&&address?address.port:0));});});
 const base='http://127.0.0.1:'+port;
 const child=spawn('ollama',['serve'],{detached:true,env:{...evaluationEnvironment(temp,temp),OLLAMA_HOST:'127.0.0.1:'+port,OLLAMA_MODELS:cache,OLLAMA_NO_CLOUD:'1',OLLAMA_CONTEXT_LENGTH:'16384',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_MAX_QUEUE:'1',CUDA_VISIBLE_DEVICES:'-1',ROCR_VISIBLE_DEVICES:'-1',GGML_VK_VISIBLE_DEVICES:'-1',OLLAMA_VULKAN:'false'},stdio:'ignore'});
 let exited=false,spawnError:unknown;child.once('error',error=>{spawnError=error;exited=true;});child.once('exit',()=>{exited=true;});
 const exit=new Promise<void>(done=>{child.once('exit',()=>done());child.once('error',()=>done());});
 const stop=async()=>{
  if(!exited){try{process.kill(-child.pid!,'SIGTERM');}catch{child.kill('SIGTERM');}
   const kill=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}},3000);
   await exit;clearTimeout(kill);
  }
  // A server can exit before a runner that ignored SIGTERM; drain its owned group too.
  if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}
  await rm(temp,{recursive:true,force:true});return{pid:child.pid,ownedServerExited:exited};
 };
 const request=async(path:string,body?:unknown)=>{
  if(!['/api/version','/api/create','/api/show','/api/ps'].includes(path))throw Error('Unexpected local model operation');
  const response=await fetch(base+path,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
  if(!response.ok)throw Error('Local model API failed: '+response.status);return response.json();
 };
 try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   signal.throwIfAborted();if(exited)throw Error('Owned Ollama server failed: '+String(spawnError??'exited'));
   try{const response=await fetch(base+'/api/version',{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(500)])});if(response.ok){ready=true;break;}}catch{}
   await delay(100,undefined,{signal});
  }
  if(!ready)throw Error('Owned Ollama server startup timed out');
  const model='compositor-local-eval';
  await request('/api/create',{model,from:pin.model,parameters:{num_ctx:16384,num_thread:2,temperature:0,seed:17},stream:false});
  return{base,model,pid:child.pid,stop,metadata:()=>request('/api/show',{model}),cpu:async()=>{
   const result=await request('/api/ps');
   if(!Array.isArray(result.models)||!result.models.length||result.models.some((entry:any)=>entry.name!==model&&entry.name!==model+':latest'||entry.size_vram!==0))throw Error('Runtime did not confirm the pinned model on CPU');
   return result;
  }};
 }catch(error){await stop();throw error;}
}
