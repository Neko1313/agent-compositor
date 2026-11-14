import {wireMessage,type WireMessage} from '@agent-compositor/protocol';
import {createNativePresentationClient} from './native-client.js';
import {runConversationPrototype,type OpenTuiOptions} from './run.js';

export interface OpenTuiNativeOptions extends Pick<OpenTuiOptions,'stdin'|'stdout'|'environment'|'animations'|'signal'>{
  source:AsyncIterable<WireMessage>;
  send(message:WireMessage):void;
}

/** Native widgets consume protocol data; the transport never carries host ports. */
export async function runOpenTuiNativeRenderer(options:OpenTuiNativeOptions){
  const controller=new AbortController(),iterator=options.source[Symbol.asyncIterator]();
  let closed=false,failure:unknown;
  const send=(message:WireMessage)=>{
    if(closed)return;
    try{options.send(message);}catch(error){finish(error);}
  };
  const client=createNativePresentationClient(send);
  function finish(error?:unknown){
    if(error!==undefined&&failure===undefined)failure=error;
    if(closed)return;closed=true;controller.abort();client.close();
    // An arbitrary source can be blocked in next(). Do not make terminal cleanup
    // depend on its cooperation or await return() behind that outstanding read.
    try{void Promise.resolve(iterator.return?.()).catch(()=>{});}catch{}
  }
  const abort=()=>finish();
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)finish();
  async function next(){
    if(controller.signal.aborted)return {done:true,value:undefined} as const;
    let abortNext!:()=>void;
    const cancelled=new Promise<IteratorResult<WireMessage>>(resolve=>{
      abortNext=()=>resolve({done:true,value:undefined});controller.signal.addEventListener('abort',abortNext,{once:true});
    });
    try{return await Promise.race([iterator.next(),cancelled]);}
    finally{controller.signal.removeEventListener('abort',abortNext);}
  }
  const consume=(async()=>{
    try{
      while(!closed){const item=await next();if(item.done)break;
        const message=wireMessage.parse(item.value);
        if(message.type==='bye')break;
        client.receive(message);
      }
      finish();
    }catch(error){finish(error);}
  })();
  const display=(async()=>{
    try{
      await client.ready;if(closed)return;
      await runConversationPrototype([...client.sessions()],{stdin:options.stdin,stdout:options.stdout,environment:options.environment,
        animations:options.animations,signal:controller.signal,windowLayout:client.windowLayout,navigation:client.navigation,
        surfaces:client.surfaces,conversationWindows:client.conversationWindows,appearance:client.appearance,
        composerMedia:client.composerMedia,publicRender:client.publicRender,inputAdmission:client,onCtrlC:client.onCtrlC});
      if(!closed)send({type:'bye',reason:'Terminal closed'});
      finish();
    }catch(error){if(!closed)finish(error);}
  })();
  try{if(!closed)client.hello();}catch(error){finish(error);}
  const waitUntilExit=Promise.all([consume,display]).then(()=>{if(failure!==undefined)throw failure;})
    .finally(()=>options.signal?.removeEventListener('abort',abort));
  // Callers may first await renderer creation and attach their exit handler in
  // the next microtask; retain the original rejecting promise for that handler.
  void waitUntilExit.catch(()=>{});
  return {client,waitUntilExit,async stop(){finish();await waitUntilExit;}};
}
