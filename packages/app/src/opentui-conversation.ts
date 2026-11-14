import type {createApprovalInbox} from './opentui-approvals.js';
import type {createInteractionInbox} from './opentui-interactions.js';
import type {AgentCore, ChatMessage, ChatToolCall} from '@agent-compositor/core';
import type {ConversationApproval, ConversationSession, ConversationSnapshot, Message, PluginTableSource} from '@agent-compositor/renderer-opentui';
import {uiTextViewSchema} from '@agent-compositor/events';
import {clean} from './presentation.js';

type ToolState = NonNullable<Extract<Message, {role: 'tool'}>['tool']>['state'];
type ToolPresentation = {state: ToolState; text?: string};
function resultPresentation(name: string, ok: unknown, output: unknown): ToolPresentation {
  if (ok !== true) return {state: 'error'};
  if (name !== 'exec' && name !== 'exec_output') return {state: 'done'};
  // Shell invocation success is not command success. Read only the known
  // structured contract, never stdout, model text or a custom tool's body.
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return {state: 'complete'};
  const result = output as Record<string, unknown>, code = result.exitCode;
  if ((name === 'exec' || result.done === true) && typeof code === 'number' && Number.isSafeInteger(code))
    return {state: code === 0 ? 'done' : 'error', text: `exit ${code}`};
  if (name === 'exec' && result.started === true && typeof result.shellId === 'string' && result.shellId.trim())
    return {state: 'complete', text: 'started'};
  if (name === 'exec_output' && result.done === false && code === null)
    return {state: 'complete', text: 'process running'};
  return {state: 'complete'};
}
function argumentsText(name: string, value: unknown): string | undefined {
  // Human-input arguments belong to the selected private request presenter.
  if (name === 'ask_user' || name === 'ask_questions') return;
  try {
    const text = clean(JSON.stringify(value) ?? '');
    if (!text) return;
    if (text.length <= 8000) return text;
    let end = 7950;if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    return text.slice(0, end) + '… arguments truncated';
  } catch {return;}
}

function conversation(messages: readonly ChatMessage[], liveStates: ReadonlyMap<ChatToolCall, ToolPresentation>): Message[] {
  const visible: Message[] = [];
  for (const message of messages) {
    if (message.role === 'user' && message.origin !== 'harness')
      visible.push({role: 'user', text: message.userRequest ?? message.content});
    if (message.role === 'assistant' && message.content)
      visible.push({role: 'assistant', text: message.content});
    if (message.role === 'assistant') for (const call of message.toolCalls ?? []) {
      const presentation = liveStates.get(call);
      if (presentation === undefined) continue;
      const args = argumentsText(call.name, call.args);
      visible.push({role: 'tool', text: presentation.text ?? '', tool: {callId: call.id, name: clean(call.name),
        ...(args === undefined ? {} : {args}), state: presentation.state}});
    }
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
  // Old journals cannot distinguish idle UI calls from Main. Admit only exact
  // call occurrences observed executing in this binding's noninteractive turn.
  // Provider IDs can repeat, so neither provenance nor outcomes are keyed by ID.
  const toolStates = new Map<ChatToolCall, ToolPresentation>();
  let context = core.getMessages(), mainTurn: string | undefined;
  let turnBaseline = new Set<ChatToolCall>();
  const calls = (messages: readonly ChatMessage[]) => messages.flatMap(message => message.toolCalls ?? []);
  const resetProvenance = () => {
    context = core.getMessages();toolStates.clear();turnBaseline = new Set(calls(context));
  };
  const currentCalls = () => {
    const messages = core.getMessages();
    if (messages !== context) resetProvenance();
    const current = new Set(calls(messages));
    for (const call of toolStates.keys()) if (!current.has(call)) toolStates.delete(call);
    return current;
  };
  const project = () => {
    currentCalls();return conversation(core.getMessages(), toolStates);
  };
  let state: ConversationSnapshot = {messages: project(), running: core.getState() === 'running',
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
    if (event.event === 'tool.call' || event.event === 'tool.result') {
      if (!mainTurn || event.input.operationId || core.isUserInvocation || core.host.currentServiceScope?.origin !== undefined) return;
      const candidates = [...currentCalls()].filter(call => call.id === event.input.callId && call.name === event.input.tool &&
        !turnBaseline.has(call) && (event.event === 'tool.call' ? !toolStates.has(call) : toolStates.get(call)?.state === 'running'));
      // Ambiguous duplicates and result-only events cannot establish provenance.
      if (candidates.length !== 1) return;
      toolStates.set(candidates[0], event.event === 'tool.call' ? {state: 'running'} : resultPresentation(candidates[0].name, event.input.ok, event.input.output));
      committed = project();streaming = '';
      update({messages: committed, running: core.getState() === 'running'});
      return;
    }
    if (event.input.operationId) return;
    switch (event.event) {
      case 'context.restored':
      case 'context.compacted':
        resetProvenance();committed = project();streaming = '';
        update({messages: committed, running: core.getState() === 'running'});
        break;
      case 'turn.start':
        mainTurn = !event.input.interactiveTool && !core.isUserInvocation && core.host.currentServiceScope?.origin === undefined &&
          typeof event.input.turnId === 'string' ? event.input.turnId : undefined;
        currentCalls();turnBaseline = new Set(calls(core.getMessages()));
        notice = undefined;
        // Refresh the submitted user message and reset any previous stream.
        committed = project();
        streaming = '';
        update({messages: committed, running: true});
        break;
      case 'turn.step':
        committed = project();
        streaming = '';
        update({messages: committed, running: true});
        break;
      case 'turn.complete':
      case 'turn.failed':
      case 'turn.interrupted':
        if (event.input.turnId === mainTurn) mainTurn = undefined;
        committed = project();
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
    disconnect() { disconnected = true; toolStates.clear();turnBaseline.clear();mainTurn = undefined;
      offInbox?.(); unsubscribe(); listeners.clear(); inbox?.close(); },
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
