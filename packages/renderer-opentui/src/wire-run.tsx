/** @jsxImportSource @opentui/react */
import type {CliRenderer,KeyEvent,PasteEvent,ImageRenderProtocol,MouseEvent} from '@opentui/core';
import {answerHello,hello,helloMessage,nativeProtocolElements,wireMessage,type HelloMessage,type WireMessage} from '@agent-compositor/protocol';
import {OpenTuiWireStore} from './wire-store.js';
import {wireTextFrame} from './wire-frame.js';
import {wireKey,wireMouse} from './wire-input.js';

export type OpenTuiWireGraphics='auto'|'kitty'|'sixel'|'off';
export interface OpenTuiWireRendererOptions {
  source:AsyncIterable<WireMessage>;
  send(message:WireMessage):void;
  stdin?:NodeJS.ReadStream;
  stdout?:NodeJS.WriteStream;
  stderr?:NodeJS.WritableStream;
  localHello?:HelloMessage;
  exitOnBye?:boolean;
  hostControlsExit?:boolean;
  exit?(code:number):void;
  graphics?:OpenTuiWireGraphics;
  signal?:AbortSignal;
  environment?:Readonly<Record<string,string>>;
  /** The legacy wire has no viewport message; its owner supplies this side channel. */
  onResize?(columns:number,rows:number):void;
}
export interface OpenTuiWireRendererHandle {
  store:OpenTuiWireStore;
  stop():Promise<void>;
  waitUntilExit:Promise<void>;
  runExternal(callback:()=>Promise<void>):Promise<void>;
}

const pointerNames={default:'left_ptr',pointer:'hand2',text:'xterm',grab:'hand2',grabbing:'fleur','ew-resize':'sb_h_double_arrow','ns-resize':'sb_v_double_arrow','not-allowed':'crossed_circle'};
const asError=(error:unknown)=>error instanceof Error?error:Error(String(error));

/** Complete legacy source/send client; native application ownership is a separate negotiated bridge. */
export async function runOpenTuiWireRenderer(options:OpenTuiWireRendererOptions):Promise<OpenTuiWireRendererHandle>{
  const stdin=options.stdin??process.stdin,stdout=options.stdout??process.stdout,env=options.environment??process.env;
  const interactive=stdout.isTTY===true,mouseEnabled=interactive&&stdin.isTTY===true&&options.hostControlsExit===true;
  const mode=options.graphics??(['auto','kitty','sixel','off'].includes(env.AGENT_GRAPHICS??'')?env.AGENT_GRAPHICS as OpenTuiWireGraphics:'auto');
  const pointerMode=env.AGENT_POINTER??'auto';
  const pointerSupported=mouseEnabled&&(pointerMode==='on'||pointerMode==='x11'||pointerMode==='auto'&&/kitty|ghostty|foot/i.test([env.TERM,env.TERM_PROGRAM].join(' '))&&!env.VTE_VERSION&&!env.TMUX&&!env.STY);
  const store=new OpenTuiWireStore();
  const controller=new AbortController(),iterator=options.source[Symbol.asyncIterator]();
  let renderer:CliRenderer|undefined,acked=false,stopped=false,suspended=false,cleanup:Promise<void>|undefined;
  let sdk:typeof import('@opentui/core')|undefined;
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const done=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void done.catch(()=>{});
  let abortPull!:()=>void;const aborted=new Promise<null>(yes=>{abortPull=()=>yes(null);});
  controller.signal.addEventListener('abort',abortPull,{once:true});
  const setPointer=(shape:keyof typeof pointerNames)=>{
    if(!pointerSupported)return;
    if(pointerMode==='x11')stdout.write('\x1b]22;'+pointerNames[shape]+'\x1b\\');else{renderer?.setMousePointer(shape);renderer?.requestRender();}
  };
  async function finish(error?:unknown):Promise<void>{
    if(cleanup)return cleanup;
    if(stopped)return;
    stopped=true;acked=false;controller.abort();
    // An iterator waiting on somebody else's promise must not keep our terminal alive.
    try{void Promise.resolve(iterator.return?.()).catch(()=>{});}catch{}
    cleanup=(async()=>{
      let failure=error;
      options.signal?.removeEventListener('abort',abort);
      try{
        if(renderer){
          renderer.keyInput.off('keypress',key);renderer.keyInput.off('paste',paste);renderer.off(sdk!.CliRenderEvents.RESIZE,resize);
          renderer.off(sdk!.CliRenderEvents.RENDER_ERROR,renderError);renderer.off(sdk!.CliRenderEvents.HANDLER_ERROR,renderError);
          try{setPointer('default');}finally{renderer.destroy();}
          await renderer.closed;
        }else if(!failure){
          const frame=wireTextFrame(store.snapshot().text,stdout.columns??80);if(frame)stdout.write(frame+'\n');
        }
      }catch(cause){failure??=cause;}
      try{options.exit?.(failure?1:0);}catch(cause){failure??=cause;}
      if(failure)reject(asError(failure));else resolve();
    })();
    return cleanup;
  }
  const emit=(message:WireMessage)=>{if(stopped)return;try{options.send(message);}catch(error){void finish(error);}};
  const input=(data:Extract<WireMessage,{type:'input'}>['data'])=>{
    if(!acked||stopped||suspended)return;
    const surface=store.state.focused??(data.kind==='mouse'?'input':undefined);if(!surface)return;
    emit({type:'input',surface,data});
    if(!options.hostControlsExit&&data.kind==='key'&&data.key==='c'&&data.modifiers?.includes('ctrl')){emit({type:'bye',reason:'ctrl+c'});void finish();}
  };
  const key=(event:KeyEvent)=>{if(event.defaultPrevented)return;const data=wireKey(event);if(data){input(data);event.preventDefault();}};
  const paste=(event:PasteEvent)=>{if(event.defaultPrevented)return;input({kind:'text',text:Buffer.from(event.bytes).toString('utf8'),paste:true});event.preventDefault();};
  const mouse=(event:MouseEvent)=>{const data=wireMouse(event);if(data)input(data);};
  const resize=()=>{if(!stopped&&renderer)options.onResize?.(renderer.terminalWidth,renderer.terminalHeight);};
  const abort=()=>{void finish();};
  const renderError=(event:{error?:unknown})=>{void finish(event.error??Error('OpenTUI wire rendering failed'));};
  try{
    if(interactive){
      sdk=await import('@opentui/core');
      renderer=await sdk.createCliRenderer({stdin,stdout,environment:options.environment,exitOnCtrlC:false,useMouse:mouseEnabled,enableMouseMovement:mouseEnabled,autoFocus:false,kittyImageTransport:'zlib',consoleMode:'disabled',externalOutputMode:'passthrough'});
      renderer.keyInput.on('keypress',key);renderer.keyInput.on('paste',paste);renderer.on(sdk.CliRenderEvents.RESIZE,resize);
      renderer.on(sdk.CliRenderEvents.RENDER_ERROR,renderError);renderer.on(sdk.CliRenderEvents.HANDLER_ERROR,renderError);
      void renderer.closed.then(()=>finish(),error=>finish(error));
    }
    let protocol:ImageRenderProtocol='kitty';
    if(mouseEnabled&&mode!=='off'&&renderer){
      const requested=mode==='auto'?'auto':mode;
      protocol=sdk!.resolveImageRenderProtocol(requested,renderer.capabilities,Boolean(renderer.resolution));
      store.state.nativeImages=protocol==='kitty'&&(mode==='kitty'||renderer.capabilities?.kitty_graphics===true)
        ||protocol==='sixel'&&Boolean(renderer.resolution)&&(mode==='sixel'||renderer.capabilities?.sixel===true);
    }
    const local=structuredClone(options.localHello??hello('renderer',{surfaces:['terminal','headless'],sites:[],elements:['Text','Box','Layout','Pointer'],encodings:['jsonl']}));
    local.capabilities.elements=local.capabilities.elements.filter(name=>name!=='Raster'&&name!=='Pointer'&&!nativeProtocolElements.includes(name as typeof nativeProtocolElements[number]));
    if(pointerSupported)local.capabilities.elements.push('Pointer');if(store.state.nativeImages)local.capabilities.elements.push('Raster');
    if(renderer){
      const [{createRoot},{OpenTuiWireView}]=await Promise.all([import('@opentui/react'),import('./wire-view.js')]);
      createRoot(renderer).render(<OpenTuiWireView store={store} onMouse={mouse} protocol={protocol}/>);
    }
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted){await finish();}
    else{
      emit(local);
      void(async()=>{
        try{
          while(!stopped){
            const next=await Promise.race([iterator.next(),aborted]);if(next===null||stopped)return;
            if(next.done){await finish();return;}
            const raw=next.value;
            if(raw?.type==='hello'){
              // Preserve a useful protocol-name rejection while validating known-protocol frames.
              const remote=raw.protocol===local.protocol?helloMessage.parse(raw):raw;
              const ack=answerHello(local,remote);emit(ack);if(!ack.ok)throw Error('Wire handshake rejected: '+ack.reason);acked=true;continue;
            }
            const message=wireMessage.parse(raw);
            if(message.type==='hello-ack'){if(!message.ok)throw Error('Wire handshake rejected: '+(message.reason??'peer rejected renderer'));acked=true;continue;}
            if(message.type==='pointer'){if(acked)setPointer(message.shape);continue;}
            store.apply(message);
            if(message.type==='bye'&&options.exitOnBye!==false){await finish();return;}
          }
        }catch(error){await finish(error);}
      })();
    }
  }catch(error){await finish(error);throw error;}
  return{store,waitUntilExit:done,stop:()=>finish(),runExternal:async callback=>{
    if(stopped)throw Error('Wire renderer has stopped');if(suspended)throw Error('Wire renderer is already suspended');
    suspended=true;
    try{if(renderer){setPointer('default');await renderer.suspend();}await callback();}
    finally{suspended=false;if(renderer&&!stopped){await renderer.resume();renderer.requestRender();}}
  }};
}
