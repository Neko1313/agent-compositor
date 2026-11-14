/** @jsxImportSource @opentui/react */
import {createCliRenderer,type KeyEvent,type PasteEvent} from '@opentui/core';
import {createRoot,flushSync} from '@opentui/react';
import {ConversationView} from './view.js';
import type {ComposerMedia} from './ghost.js';
import type {PluginTableSource} from './table.js';
import type {PluginManagerSource} from './plugins.js';
import type {ConversationSession} from './session.js';
import {isWindowGestureCancelKey,type WindowLayoutSource} from './layout.js';
import type {UiSurfaceRegistry} from './surface.js';
import type {WindowNavigationInput,WindowNavigationSource} from './navigation.js';
import {useKeyboard} from '@opentui/react';
import {createEditorInputOwnership} from './editor-ownership.js';

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
  windowLayout: WindowLayoutSource;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  environment?: Readonly<Record<string,string>>;
  onCtrlC?(): 'exit'|'handled';
  signal?:AbortSignal;
}

export async function runConversationPrototype(sessions: ConversationSession[], options: OpenTuiOptions) {
  if (!sessions.length) throw new Error('At least one conversation is required.');
  if (new Set(sessions.map(session => session.id)).size !== sessions.length) throw new Error('Conversation IDs must be unique.');
  const paneIds = sessions.map(session => session.paneId ?? 'session:' + session.id);
  if (options.workflowTable) paneIds.push('workflows');
  if (options.pluginManager) paneIds.push('plugins');
  if (new Set(paneIds).size !== paneIds.length) throw new Error('Window pane IDs must be unique.');
  const renderer = await createCliRenderer({stdin:options.stdin,stdout:options.stdout,environment:options.environment,
    exitOnCtrlC:!options.onCtrlC, kittyImageTransport: 'zlib'});
  const editorOwnership=createEditorInputOwnership();
  const abort=()=>renderer.destroy();
  options.signal?.addEventListener('abort',abort,{once:true});
  const captureKey=(key:KeyEvent)=>{
    if(key.defaultPrevented||!options.navigation)return;
    let consumed=false;
    flushSync(()=>{
      if(options.windowLayout.snapshot().gesture&&isWindowGestureCancelKey(key)){
        options.windowLayout.act({type:'pointer',phase:'cancel',x:0,y:0});consumed=true;return;
      }
      if(key.name==='f2'&&!key.ctrl&&!key.meta&&!key.option&&!key.shift&&!key.super&&!key.hyper&&editorOwnership.ownsInput())return;
      const legacy=/^\x1b([!@#$%^&*(])$/.exec(key.sequence);
      const input:WindowNavigationInput={kind:'key',key:legacy?String('!@#$%^&*('.indexOf(legacy[1])+1):key.name,
        text:key.sequence,modifiers:[...(key.ctrl?['ctrl']:[]),...(key.meta||key.option||legacy?['alt']:[]),
          ...(key.shift||legacy?['shift']:[]),...(key.super?['super']:[]),...(key.hyper?['hyper']:[])],repeated:key.repeated};
      consumed=options.navigation!.handle(input);
    });
    if(consumed){key.preventDefault();key.stopPropagation();}
  };
  const capturePaste=(event:PasteEvent)=>{
    if(event.defaultPrevented||!options.navigation)return;
    // Paste belongs to native editors in normal/finder modes. Arrange ignores it.
    // A /windows submission and its following paste can share one parser packet.
    // Commit the newly focused native query field before paste is dispatched.
    let consumed=false;
    flushSync(()=>{
      if(options.navigation!.snapshot().mode==='arrange')consumed=options.navigation!.handle({kind:'paste',text:''});
    });
    if(consumed){event.preventDefault();event.stopPropagation();}
  };
  if(options.navigation){renderer.keyInput.prependListener('keypress',captureKey);renderer.keyInput.prependListener('paste',capturePaste);}
  function Desktop(){
    useKeyboard(key=>{
      if(key.defaultPrevented||!options.onCtrlC||!key.ctrl||key.meta||key.name!=='c')return;
      key.preventDefault();
      if(!key.repeated&&options.onCtrlC()==='exit')renderer.destroy();
    });
    return <ConversationView sessions={sessions} workflowTable={options.workflowTable}
      pluginManager={options.pluginManager} windowLayout={options.windowLayout} surfaces={options.surfaces} navigation={options.navigation}
      animations={options.animations??true} composerMedia={options.composerMedia} editorOwnership={editorOwnership} />;
  }
  try {
    renderer.keyInput.setMaxListeners(keyboardListenerLimit);
    if(options.signal?.aborted)return;
    createRoot(renderer).render(<Desktop />);
    await renderer.closed;
  } finally {
    options.signal?.removeEventListener('abort',abort);
    if(options.navigation){renderer.keyInput.off('keypress',captureKey);renderer.keyInput.off('paste',capturePaste);}
    renderer.destroy();
    await renderer.closed;
  }
}
export const runOpenTuiRenderer=runConversationPrototype;
export type {UiSurfaceRegistry,UiSurfaceSource,UiSurfaceSnapshot} from './surface.js';
export type {WindowNavigationSource,WindowNavigationSnapshot,WindowNavigationEntry,WindowNavigationInput} from './navigation.js';
export type {PluginTableSource} from './table.js';
export type {PluginManagerSource, PluginManagerSnapshot, PluginManagerRow, PluginManagerAction} from './plugins.js';
export type {ComposerMedia} from './ghost.js';
export type {ConversationSession, ConversationSnapshot, ConversationApproval, ConversationInteraction, Message} from './session.js';
export type {ConversationController, ConversationEditor, WindowController, ControllerInput, ControllerView, ControllerCell} from './controller.js';
export type {WindowLayoutSource, WindowLayoutSnapshot, WindowLayoutAction, WindowFrame, WindowDirection, WindowDropEdge, WindowSplitTarget} from './layout.js';
