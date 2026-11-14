import type {createApprovalInbox} from './opentui-approvals.js';
import type {createInteractionInbox} from './opentui-interactions.js';
import type {AgentCore, ChatMessage} from '@agent-compositor/core';
import type {ConversationApproval, ConversationSession, ConversationSnapshot, Message, PluginTableSource} from '@agent-compositor/renderer-opentui';
import {uiTextViewSchema} from '@agent-compositor/events';

function conversation(messages: readonly ChatMessage[]): Message[] {
  const visible: Message[] = [];
  for (const message of messages) {
    if (message.role === 'user' && message.origin !== 'harness')
      visible.push({role: 'user', text: message.userRequest ?? message.content});
    if (message.role === 'assistant' && message.content)
      visible.push({role: 'assistant', text: message.content});
  }
  return visible;
}

type ConversationInbox = Pick<ReturnType<typeof createApprovalInbox>, 'subscribe' | 'answer' | 'close'> & {
  snapshot(): ConversationApproval | undefined;
} & Partial<Pick<ReturnType<typeof createInteractionInbox>,
  'interactionSnapshot' | 'answerInteraction' | 'cancelInteraction' | 'controllerSnapshot' | 'controllerInput' | 'controllerViewport' | 'cancelController'>>;

export function connectConversation(core: AgentCore, label: string, inbox?: ConversationInbox,
  submit: (text: string) => Promise<void> = text => core.submit(text)): ConversationSession & {disconnect(): void} {
  const listeners = new Set<() => void>();
  let state: ConversationSnapshot = {messages: conversation(core.getMessages()), running: core.getState() === 'running',
    approval: inbox?.snapshot(), interaction: inbox?.interactionSnapshot?.(), controller: inbox?.controllerSnapshot?.()};
  let committed = state.messages;
  let streaming = '';
  let notice: string | undefined;
  let disconnected = false;
  function update(next: ConversationSnapshot) {
    if (disconnected) return;
    state = {...next, notice, approval: inbox?.snapshot(), interaction: inbox?.interactionSnapshot?.(), controller: inbox?.controllerSnapshot?.()};
    for (const listener of listeners) listener();
  }
  const offInbox = inbox?.subscribe(() => update(state));
  const unsubscribe = core.subscribe(event => {
    if (event.kind === 'catalog' && event.event === 'ui.notification') {
      notice = String(event.input.message);
      update(state);
      return;
    }
    if (event.kind === 'text') {
      streaming += event.delta;
      update({messages: [...committed, {role: 'assistant', text: streaming}], running: true});
      return;
    }
    if (event.input.operationId) return;
    switch (event.event) {
      case 'turn.start':
        notice = undefined;
        // Refresh the submitted user message and reset any previous stream.
        committed = conversation(core.getMessages());
        streaming = '';
        update({messages: committed, running: true});
        break;
      case 'turn.step':
        committed = conversation(core.getMessages());
        streaming = '';
        update({messages: committed, running: true});
        break;
      case 'turn.complete':
      case 'turn.failed':
      case 'turn.interrupted':
        committed = conversation(core.getMessages());
        streaming = '';
        update({messages: committed, running: false, ...(event.event === 'turn.failed' ? {error: String(event.input.error)} : {})});
        break;
    }
  });
  return {
    id: core.sessionId, label, answerApproval: inbox?.answer,
    answerInteraction: inbox?.answerInteraction, cancelInteraction: inbox?.cancelInteraction,
    controllerInput(id, input, revision) {if (!disconnected)return inbox?.controllerInput?.(id, input, revision);},
    controllerViewport(id, columns, rows) {if (!disconnected)inbox?.controllerViewport?.(id, columns, rows);},
    cancelController(id) {if (!disconnected)inbox?.cancelController?.(id);},
    subscribe(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    snapshot: () => state,
    submit(text) {
      if (disconnected || !text.trim()) return;
      void submit(text).catch(error => update({...state, running: core.getState() === 'running', error: String(error)}));
    },
    disconnect() { disconnected = true; offInbox?.(); unsubscribe(); listeners.clear(); inbox?.close(); },
  };
}

/** Rows and their expansion state are supplied by the plugin's normal ui.surface updates. */
export function connectPluginTable(core: AgentCore, owner: string, site: string, title: string): PluginTableSource & {disconnect(): void} {
  let snapshot: ReturnType<PluginTableSource['snapshot']> = {title};
  let active = true;
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    if (!active) return;
    snapshot = next;
    for (const fn of listeners) fn();
  };
  const off = core.subscribe(e => {
    if (e.kind !== 'catalog' || e.input.id !== site) return;
    if (e.event === 'ui.surfaceRemoved') publish({title});
    if (e.event !== 'ui.surface' || e.input.plugin !== owner) return;
    const view = uiTextViewSchema.safeParse(e.input.view);
    publish({title: String(e.input.title ?? title), table: view.success ? view.data.table : undefined});
  });
  return {
    snapshot: () => snapshot,
    subscribe(fn) {listeners.add(fn); return () => {listeners.delete(fn);};},
    press(action) {
      if (!active || !snapshot.table?.rows.some(row => row.action === action)) return;
      void core.host.emit('ui.press', {site, key: action}).then(result => {
        if (result.faults.length) throw new Error(JSON.stringify(result.faults));
      }).catch(error => publish({...snapshot, error: String(error)}));
    },
    disconnect() {active = false; off(); listeners.clear();},
  };
}
