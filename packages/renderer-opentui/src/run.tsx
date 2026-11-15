/** @jsxImportSource @opentui/react */
import {createCliRenderer,NativeSession,type KeyEvent,type PasteEvent,type TextareaRenderable} from '@opentui/core';
import {createRoot,flushSync} from '@opentui/react';
import {ConversationView} from './view.js';
import type {ComposerMedia} from './ghost.js';
import type {PluginTableSource} from './table.js';
import type {PluginManagerSource} from './plugins.js';
import type {ConversationSession} from './session.js';
import {isWindowGestureCancelKey,type WindowLayoutSource} from './layout.js';
import type {UiSurfaceRegistry,UiSurfaceSource} from './surface.js';
import type {WindowNavigationInput,WindowNavigationSource} from './navigation.js';
import {useKeyboard} from '@opentui/react';
import {useState} from 'react';
import {createEditorInputOwnership} from './editor-ownership.js';
import type {ConversationWindowRegistry} from './conversation-windows.js';
import {AppearanceProvider,type AppearanceSource} from './appearance.js';
import type {PublicRenderSlots} from './public-render.js';
import {TmuxComposer,TmuxComposerProvider} from './tmux-composer.js';

// Closed windows keep native widgets resident. The host admits at most 256
// panes, each with up to two keyboard hooks; SDK and desktop handlers use the
// remaining bounded allowance. Keep leak warnings active above that capacity.
const keyboardListenerLimit = 256 * 2 + 16;

export interface OpenTuiOptions {
  animations?: boolean;
  workflowTable?: PluginTableSource;
  pluginManager?: PluginManagerSource;
  surfaces?: UiSurfaceRegistry;
  navigation?:WindowNavigationSource;
  composerMedia?: ComposerMedia;
  conversationWindows?: ConversationWindowRegistry;
  appearance?:AppearanceSource;
  publicRender?:PublicRenderSlots;
  windowLayout: WindowLayoutSource;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  environment?: Readonly<Record<string,string>>;
  onCtrlC?(): 'exit'|'handled'|Promise<'exit'|'handled'>;
  /** Only protocol admission is awaited, never an agent or controller task. */
  inputAdmission?:{pending():boolean;settled():Promise<void>;generation():string};
  signal?:AbortSignal;
}

export async function runConversationPrototype(sessions: ConversationSession[], options: OpenTuiOptions) {
  if (!sessions.length) throw new Error('At least one conversation is required.');
  if (new Set(sessions.map(session => session.id)).size !== sessions.length) throw new Error('Conversation IDs must be unique.');
  if (new Set(sessions.map(session => session.conversationId ?? session.id)).size !== sessions.length)
    throw new Error('Logical conversation identities must be unique.');
  const paneIds = sessions.map(session => session.paneId ?? 'session:' + session.id);
  if (options.workflowTable) paneIds.push('workflows');
  if (options.pluginManager) paneIds.push('plugins');
  if (new Set(paneIds).size !== paneIds.length) throw new Error('Window pane IDs must be unique.');
  const env=options.environment??process.env,stdin=options.stdin??process.stdin,stdout=options.stdout??process.stdout;
  const tmuxEligible=Boolean(env.TMUX&&!env.STY&&stdin.isTTY&&stdout.isTTY&&env.TERM!=='dumb'&&env.NO_COLOR===undefined&&
    env.AGENT_REDUCED_MOTION!=='1'&&(!env.AGENT_GRAPHICS||env.AGENT_GRAPHICS==='auto'||env.AGENT_GRAPHICS==='kitty'));
  const session=tmuxEligible?new NativeSession(stdout):undefined,runtime=session?new TmuxComposer(session):null;
  let renderer:Awaited<ReturnType<typeof createCliRenderer>>;
  try{renderer=await createCliRenderer({stdin,stdout,environment:options.environment,nativeSession:session,
    prependInputHandlers:runtime?[sequence=>runtime.input(sequence)]:undefined,
    exitOnCtrlC:!options.onCtrlC&&!runtime, kittyImageTransport: 'zlib'});}
  catch(error){await runtime?.close();session?.dispose();throw error;}
  runtime?.start();
  let closing:Promise<void>|undefined;
  const destroy=()=>{
    if(!runtime){renderer.destroy();return;}
    closing??=runtime.close().finally(()=>renderer.destroy());
  };
  const editorOwnership=createEditorInputOwnership();
  const abort=()=>destroy();
  options.signal?.addEventListener('abort',abort,{once:true});
  let replaying=false,draining=false,inputFailure:unknown;
  type MouseResult='target-unavailable'|{selected:string;owner:UiSurfaceSource|ConversationSession;editor:TextareaRenderable}|void;
  type QueuedInput={generation:string;epoch:number}&({kind:'key';key:KeyEvent}|{kind:'paste';event:PasteEvent}|{kind:'mouse';run():MouseResult});
  const queued:QueuedInput[]=[];
  const retained:QueuedInput[]=[];let inputEpoch=0,awaitingTarget=false,showInputNotice:(notice:string|undefined)=>void=()=>{};
  const generation=()=>options.inputAdmission?.generation()??'';
  const settled=()=>options.inputAdmission?.settled()??Promise.resolve();
  function recoveryAllowed(id:string,owner?:UiSurfaceSource|ConversationSession):boolean{
    const surface=options.surfaces?.snapshot().find(source=>source.id===id);
    if(surface){const state=surface.snapshot();return Boolean((!owner||surface===owner)&&state.view?.input&&!state.approval&&!state.interaction&&!state.form&&!state.controller);}
    const session=options.conversationWindows?.snapshot().find(window=>window.id===id)?.session??sessions.find(item=>item.paneId===id);
    if(!session||owner&&session!==owner)return false;
    const state=session.snapshot();return !state.approval&&!state.interaction&&!state.controller&&!state.editor;
  }
  function consumeKey(key:KeyEvent):boolean|Promise<boolean>{
    if(!options.navigation)return false;
    let consumed=false;
    let admission:boolean|Promise<boolean>=false;
    flushSync(()=>{
      if(options.windowLayout.snapshot().gesture&&isWindowGestureCancelKey(key)){
        options.windowLayout.act({type:'pointer',phase:'cancel',x:0,y:0});consumed=true;return;
      }
      if(key.name==='f2'&&!key.ctrl&&!key.meta&&!key.option&&!key.shift&&!key.super&&!key.hyper&&editorOwnership.ownsInput())return;
      const legacy=/^\x1b([!@#$%^&*(])$/.exec(key.sequence);
      const input:WindowNavigationInput={kind:'key',key:legacy?String('!@#$%^&*('.indexOf(legacy[1])+1):key.name,
        text:key.sequence,modifiers:[...(key.ctrl?['ctrl']:[]),...(key.meta||key.option||legacy?['alt']:[]),
          ...(key.shift||legacy?['shift']:[]),...(key.super?['super']:[]),...(key.hyper?['hyper']:[])],repeated:key.repeated};
      admission=options.navigation!.handle(input);
    });
    return consumed||admission;
  }
  function consume(item:QueuedInput):boolean|Promise<boolean>{
    return item.kind==='key'?consumeKey(item.key):item.kind==='paste'?options.navigation?.handle({kind:'paste',text:''})??false:false;
  }
  function replay(item:QueuedInput,consumed:boolean){
    if(consumed||item.epoch!==inputEpoch||item.generation!==generation()||options.signal?.aborted)return;
    replaying=true;const outcome:{result:MouseResult}={result:undefined};
    try{flushSync(()=>{
      if(item.kind==='key')renderer.keyInput.processParsedKey({...item.key});
      else if(item.kind==='paste')renderer.keyInput.processPaste(item.event.bytes,item.event.metadata);
      else outcome.result=item.run();
    });}finally{replaying=false;}
    return outcome.result;
  }
  async function drain(first?:{item:QueuedInput;admission:Promise<boolean>}){
    try{
      if(first){replay(first.item,await first.admission);await settled();}
      while(queued.length&&!options.signal?.aborted){
        const item=queued.shift()!;await settled();
        if(item.epoch!==inputEpoch||item.generation!==generation())continue;
        if(awaitingTarget&&item.kind!=='mouse'){
          if(item.kind==='key'&&item.key.name==='0'&&(item.key.meta||item.key.option)&&!item.key.ctrl){
            const handled=await consume(item);await settled();
            if(handled&&options.windowLayout.snapshot().focused==='session'&&recoveryAllowed('session')&&renderer.currentFocusedEditor){
              awaitingTarget=false;showInputNotice(undefined);queued.unshift(...retained.splice(0));
            }
            continue;
          }
          // Recover text and editor navigation only. Actions and shortcuts must
          // never execute in a newly chosen window without fresh user intent.
          if(item.kind==='paste')retained.push(item);
          else if(!item.key.ctrl&&!item.key.meta&&!item.key.option&&!item.key.super&&!item.key.hyper
            &&(['backspace','delete','left','right','home','end'].includes(item.key.name)
              ||Boolean(item.key.sequence)&&![...item.key.sequence].some(char=>char.codePointAt(0)!<32||char.codePointAt(0)===127)))retained.push(item);
          continue;
        }
        const result=replay(item,await consume(item));await settled();
        if(result==='target-unavailable'){
          awaitingTarget=true;showInputNotice('Click input or Alt+0 · Esc discards · actions cancelled');
        }else if(result&&typeof result==='object'&&awaitingTarget&&options.windowLayout.snapshot().focused===result.selected
          &&recoveryAllowed(result.selected,result.owner)&&renderer.currentFocusedEditor===result.editor){
          awaitingTarget=false;showInputNotice(undefined);queued.unshift(...retained.splice(0));
        }
      }
    }catch(error){inputFailure=error;destroy();}
    finally{draining=false;}
  }
  function capture(item:QueuedInput,event:KeyEvent|PasteEvent){
    if(event.defaultPrevented||replaying)return;
    if(awaitingTarget&&item.kind==='key'&&item.key.name==='escape'){
      event.preventDefault();event.stopPropagation();inputEpoch++;retained.length=0;queued.length=0;awaitingTarget=false;showInputNotice(undefined);return;
    }
    if(awaitingTarget||draining||options.inputAdmission?.pending()){
      event.preventDefault();event.stopPropagation();queued.push(item);
      if(!draining){draining=true;void drain();}return;
    }
    const admission=consume(item);
    if(typeof admission!=='boolean'){
      event.preventDefault();event.stopPropagation();draining=true;void drain({item,admission});
    }else if(admission){event.preventDefault();event.stopPropagation();}
  }
  function scheduleMouse(run:()=>MouseResult):boolean{
    if(replaying||!awaitingTarget&&!draining&&!options.inputAdmission?.pending())return false;
    queued.push({kind:'mouse',run,generation:generation(),epoch:inputEpoch});
    if(!draining){draining=true;void drain();}return true;
  }
  const captureKey=(key:KeyEvent)=>capture({kind:'key',key,generation:generation(),epoch:inputEpoch},key);
  const capturePaste=(event:PasteEvent)=>{
    // Preserve the original bytes/caret edit while a preceding window command
    // crosses the transport. Only admission, not model completion, serializes it.
    capture({kind:'paste',event,generation:generation(),epoch:inputEpoch},event);
  };
  if(options.navigation||options.inputAdmission){renderer.keyInput.prependListener('keypress',captureKey);renderer.keyInput.prependListener('paste',capturePaste);}
  function Desktop(){
    const [inputNotice,setInputNotice]=useState<string>();showInputNotice=setInputNotice;
    useKeyboard(key=>{
      if(key.defaultPrevented||(!options.onCtrlC&&!runtime)||!key.ctrl||key.meta||key.name!=='c')return;
      key.preventDefault();
      if(!key.repeated){
        const result=options.onCtrlC?.()??'exit';
        if(typeof result==='string'){if(result==='exit')destroy();}
        else void result.then(decision=>{if(decision==='exit')destroy();},error=>{inputFailure=error;destroy();});
      }
    });
    return <TmuxComposerProvider runtime={runtime}><AppearanceProvider source={options.appearance}><ConversationView sessions={sessions} workflowTable={options.workflowTable}
      pluginManager={options.pluginManager} windowLayout={options.windowLayout} surfaces={options.surfaces} navigation={options.navigation}
      animations={options.animations??true} composerMedia={options.composerMedia} editorOwnership={editorOwnership}
      conversationWindows={options.conversationWindows} publicRender={options.publicRender} scheduleMouse={scheduleMouse} inputNotice={inputNotice} /></AppearanceProvider></TmuxComposerProvider>;
  }
  try {
    renderer.keyInput.setMaxListeners(keyboardListenerLimit);
    if(options.signal?.aborted)return;
    createRoot(renderer).render(<Desktop />);
    await renderer.closed;
    if(inputFailure)throw inputFailure;
  } finally {
    options.signal?.removeEventListener('abort',abort);
    queued.length=0;retained.length=0;
    if(options.navigation||options.inputAdmission){renderer.keyInput.off('keypress',captureKey);renderer.keyInput.off('paste',capturePaste);}
    await runtime?.close();
    renderer.destroy();
    await renderer.closed;
  }
}
export {runOpenTuiNativeRenderer,type OpenTuiNativeOptions} from './native-run.js';
export {createNativePresentationClient,type NativePresentationClient} from './native-client.js';
export {runOpenTuiWireRenderer,runOpenTuiWireRenderer as runOpenTuiRenderer} from './wire-run.js';
export type {OpenTuiWireRendererOptions,OpenTuiWireRendererHandle,OpenTuiWireGraphics} from './wire-run.js';
export {OpenTuiWireStore} from './wire-store.js';
export type {UiSurfaceRegistry,UiSurfaceSource,UiSurfaceSnapshot} from './surface.js';
export type {WindowNavigationSource,WindowNavigationSnapshot,WindowNavigationEntry,WindowNavigationInput} from './navigation.js';
export type {PluginTableSource} from './table.js';
export type {PluginManagerSource, PluginManagerSnapshot, PluginManagerRow, PluginManagerAction} from './plugins.js';
export type {ComposerMedia} from './ghost.js';
export type {ConversationSession, ConversationSnapshot, ConversationApproval, ConversationInteraction, Message} from './session.js';
export type {ConversationWindow, ConversationWindowRegistry} from './conversation-windows.js';
export type {AppearanceSource,AppearanceSnapshot} from './appearance.js';
export type {PublicRenderSlotSnapshot,PublicRenderMeasurement,PublicRenderSlotSource,PublicRenderSlots} from './public-render.js';
export type {ConversationController, ConversationEditor, WindowController, ControllerInput, ControllerView, ControllerCell} from './controller.js';
export type {WindowLayoutSource, WindowLayoutSnapshot, WindowLayoutAction, WindowFrame, WindowDirection, WindowDropEdge, WindowSplitTarget} from './layout.js';
