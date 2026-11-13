/** @jsxImportSource @opentui/react */
import {createCliRenderer} from '@opentui/core';
import {createRoot} from '@opentui/react';
import {ConversationView} from './view.js';
import type {ComposerMedia} from './ghost.js';
import type {PluginTableSource} from './table.js';
import type {PluginManagerSource} from './plugins.js';
import type {ConversationSession} from './session.js';
import type {WindowLayoutSource} from './layout.js';
import type {UiSurfaceRegistry} from './surface.js';
import {useKeyboard} from '@opentui/react';

// Closed windows keep native widgets resident. The host admits at most 256
// panes, each with up to two keyboard hooks; SDK and desktop handlers use the
// remaining bounded allowance. Keep leak warnings active above that capacity.
const keyboardListenerLimit = 256 * 2 + 16;

export interface OpenTuiOptions {
  animations?: boolean;
  workflowTable?: PluginTableSource;
  pluginManager?: PluginManagerSource;
  surfaces?: UiSurfaceRegistry;
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
  const abort=()=>renderer.destroy();
  options.signal?.addEventListener('abort',abort,{once:true});
  function Desktop(){
    useKeyboard(key=>{
      if(key.defaultPrevented||!options.onCtrlC||!key.ctrl||key.meta||key.name!=='c')return;
      key.preventDefault();
      if(!key.repeated&&options.onCtrlC()==='exit')renderer.destroy();
    });
    return <ConversationView sessions={sessions} workflowTable={options.workflowTable}
      pluginManager={options.pluginManager} windowLayout={options.windowLayout} surfaces={options.surfaces}
      animations={options.animations??true} composerMedia={options.composerMedia} />;
  }
  try {
    renderer.keyInput.setMaxListeners(keyboardListenerLimit);
    if(options.signal?.aborted)return;
    createRoot(renderer).render(<Desktop />);
    await renderer.closed;
  } finally {
    options.signal?.removeEventListener('abort',abort);
    renderer.destroy();
    await renderer.closed;
  }
}
export const runOpenTuiRenderer=runConversationPrototype;
export type {UiSurfaceRegistry,UiSurfaceSource,UiSurfaceSnapshot} from './surface.js';
export type {PluginTableSource} from './table.js';
export type {PluginManagerSource, PluginManagerSnapshot, PluginManagerRow, PluginManagerAction} from './plugins.js';
export type {ComposerMedia} from './ghost.js';
export type {ConversationSession, ConversationSnapshot, ConversationApproval, ConversationInteraction, Message} from './session.js';
export type {WindowLayoutSource, WindowLayoutSnapshot, WindowLayoutAction, WindowFrame, WindowDirection, WindowDropEdge} from './layout.js';
