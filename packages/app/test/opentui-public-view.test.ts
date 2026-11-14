import {expect, it} from 'vitest';
import type {ConversationSnapshot, Message} from '@agent-compositor/renderer-opentui';
import {uiTextViewSchema} from '@agent-compositor/events';
import {publicConversationView, publicStatusView, publicToolsView} from '../src/opentui-public-view.js';

const metrics = {columns: 120, rows: 20, visible: true, scrollOffset: 0};

it('projects public roles and known shell outcomes without result bodies or private snapshot fields', () => {
  const state = {running: false, messages: [{role: 'user', text: 'Public task'}, {role: 'assistant', text: 'Public reply'},
    {role: 'tool', text: 'exit 1', tool: {callId: 'call', name: 'exec', args: '{"command":"exit 1"}', state: 'error'}}],
    notice: 'PRIVATE_NOTICE', editor: {state: {text: 'PRIVATE_DRAFT'}}, interaction: {title: 'PRIVATE_QUESTION'}} as unknown as ConversationSnapshot;
  const compact = publicConversationView(state, {userLabel: 'Operator', agentLabel: 'Worker'}, metrics);
  expect(compact.lines).toContainEqual({text: 'Operator', tone: 'muted', bold: true});
  expect(compact.lines).toContainEqual({text: '! exec · exit 1', tone: 'danger'});
  expect(JSON.stringify(compact)).not.toMatch(/PRIVATE_|command/);
  const detailed = publicConversationView(state, {toolDetails: true}, metrics);
  expect(JSON.stringify(detailed)).toContain('exit 1');expect(JSON.stringify(detailed)).toContain('command');
  expect(uiTextViewSchema.safeParse(detailed).success).toBe(true);
});

it('keeps Tools bounded to recent positively admitted Main records, in chronological order', () => {
  const messages: Message[] = [{role: 'user', text: 'PRIVATE_LOCAL_DIAGNOSTIC'}];
  for (let index = 0; index < 3000; index++) messages.push({role: 'tool', text: '',
    tool: {callId: String(index), name: 'tool-' + index, state: index === 2999 ? 'complete' : 'done'}});
  const view = publicToolsView(messages, metrics);
  expect(view.lines).toHaveLength(2000);expect(view.lines[0].text).toBe('✓ tool-1000');
  expect(view.lines.at(-1)?.text).toBe('· tool-2999');expect(JSON.stringify(view)).not.toContain('PRIVATE_');
  expect(uiTextViewSchema.safeParse(view).success).toBe(true);
});

it('uses constant public status and host navigation defaults rather than private request hints', () => {
  const state = {messages: [], running: true, controller: {kind: 'question', view: {hint: 'PRIVATE_CONTROLLER'}},
    editor: {view: {hint: 'PRIVATE_EDITOR'}}, interaction: {title: 'PRIVATE_FORM'}} as unknown as ConversationSnapshot;
  const view = publicStatusView(state, 3, false, {}, 180);
  expect(view.lines[0]).toEqual({text: 'Answer needed · WS 3', tone: 'accent'});
  expect(view.lines[1].text).toContain('Alt+W w Windows');expect(JSON.stringify(view)).not.toContain('PRIVATE_');
  expect(publicStatusView(state, 3, true, {hints: false}, 38).lines[1].text).toBe('');
  expect(publicStatusView(state, 3, true, {}, 38).lines[1].text).toBe('Zoomed · Alt+W f tiles');
});
