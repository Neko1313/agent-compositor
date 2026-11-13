/** @jsxImportSource @opentui/react */
import {createCliRenderer} from '@opentui/core';
import {createRoot} from '@opentui/react';
import {ConversationView} from './view.js';
import type {ComposerMedia} from './ghost.js';
import type {PluginTableSource} from './table.js';
import type {PluginManagerSource} from './plugins.js';
import type {ConversationSession} from './session.js';

export async function runConversationPrototype(sessions: ConversationSession[], options: {
  animations?: boolean;
  workflowTable?: PluginTableSource;
  pluginManager?: PluginManagerSource;
  composerMedia?: ComposerMedia;
} = {}) {
  if (!sessions.length) throw new Error('At least one conversation is required.');
  if (new Set(sessions.map(session => session.id)).size !== sessions.length) throw new Error('Conversation IDs must be unique.');
  const renderer = await createCliRenderer({exitOnCtrlC: true, kittyImageTransport: 'zlib'});
  try {
    createRoot(renderer).render(<ConversationView sessions={sessions} workflowTable={options.workflowTable}
      pluginManager={options.pluginManager} animations={options.animations ?? true} composerMedia={options.composerMedia} />);
    await renderer.closed;
  } finally {
    renderer.destroy();
    await renderer.closed;
  }
}
export type {PluginTableSource} from './table.js';
export type {PluginManagerSource, PluginManagerSnapshot, PluginManagerRow, PluginManagerAction} from './plugins.js';
export type {ComposerMedia} from './ghost.js';
export type {ConversationSession, ConversationSnapshot, ConversationApproval, Message} from './session.js';
