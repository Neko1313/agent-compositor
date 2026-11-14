import {randomUUID} from 'node:crypto';
import {inputMessage} from '@agent-compositor/protocol';
import type {UiControllerLease, UiControllerRegistry, UiEditorIntent, UiEditorState} from '@agent-compositor/hooks';
import type {ControllerInput, ConversationEditor} from '@agent-compositor/renderer-opentui';
import type {AppUiControllerData} from './controller-contracts.js';

type Admission = 'submitted' | 'queued' | 'steered' | 'command' | false;
type SendIntent = Extract<UiEditorIntent, {type: 'submit' | 'steer'}>;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}
function editorState(value: unknown): UiEditorState | undefined {
  if (!value || typeof value !== 'object') return;
  const state = value as UiEditorState;
  if (typeof state.text !== 'string' || !Number.isInteger(state.cursor) || state.cursor < 0 || state.cursor > state.text.length) return;
  return {text: state.text, cursor: state.cursor};
}

/** Capability-bearing editor requests and UTF-16 checkpoints stay inside the host. */
export function createOpenTuiEditor(options: {
  registry: UiControllerRegistry;
  state: UiEditorState;
  signal: AbortSignal;
  current(): boolean;
  data(signal: AbortSignal): AppUiControllerData['editor'];
  changed(): void;
  captureIntent(): number;
  send(intent: SendIntent, windowIntent: number): Promise<Admission>;
  interrupt(): void;
}) {
  let active = true, columns = 80, rows = 4, maxRows = 4, revision = 0, sequence = 0, inputRevision = 0, generation = 0;
  let id = randomUUID(), available = false, lease: UiControllerLease | undefined, capabilities: AbortController | undefined;
  let checkpoint = editorState(options.state) ?? {text: '', cursor: 0};
  let executing: {before: UiEditorState} | undefined;
  let admission: ConversationEditor['admission'], scroll: ConversationEditor['scroll'];
  let state: ConversationEditor;
  let tail = Promise.resolve();
  const live = () => active && options.current() && !options.signal.aborted;
  const validLease = (value: UiControllerLease | undefined = lease) => live() && available && value === lease && !value?.signal.aborted;
  function publish() {
    if (!active) return;
    let view: ConversationEditor['view'] = {lines: [{text: 'Selected editor is unavailable', tone: 'danger'}]}, preferredRows = 1;
    if (validLease()) {
      const current = lease!;
      try {
        preferredRows = current.preferredRows(columns, maxRows);view = current.render(columns, rows);
        if (!validLease(current)) return;
      } catch {if (lease === current) unavailable();return;}
    }
    state = immutable({id, kind: 'editor', revision: ++revision, inputRevision, available, view, preferredRows,
      ...(admission ? {admission} : {}), ...(scroll ? {scroll} : {})});
    options.changed();
  }
  function save(): UiEditorState {
    if (executing) return {...executing.before};
    if (lease) {
      try {checkpoint = editorState(lease.snapshot()) ?? checkpoint;} catch {/* Keep the last validated private checkpoint. */}
    }
    return {...checkpoint};
  }
  function unavailable() {
    checkpoint = save();executing = undefined;available = false;
    const old = lease;lease = undefined;capabilities?.abort();capabilities = undefined;old?.dispose();
    publish();
  }
  function create(initial: UiEditorState) {
    checkpoint = {...initial};generation++;id = randomUUID();available = false;
    const lifetime = new AbortController();capabilities = lifetime;
    try {
      lease = options.registry.create('editor', options.data(AbortSignal.any([options.signal, lifetime.signal])),
        () => {throw Error('The selected editor is unavailable');}, () => publish(), {...checkpoint}, options.signal);
      available = !lease.signal.aborted;
      const current = lease;
      current.signal.addEventListener('abort', () => {if (active && lease === current) unavailable();}, {once: true});
      if (!available) unavailable();
      else if (!editorState(current.snapshot())) unavailable();
    } catch {unavailable();}
  }
  function recover(before: UiEditorState) {
    const old = lease;lease = undefined;capabilities?.abort();capabilities = undefined;old?.dispose();
    executing = undefined;scroll = undefined;create(before);
  }
  function normalized(input: ControllerInput): ControllerInput | undefined {
    if (!input || typeof input !== 'object') return;
    if (input.kind === 'action') {
      const actions = [...state.view.lines.map(line => line.action),
        ...(state.view.tabs ?? []).filter(tab => !tab.disabled).map(tab => tab.action),
        ...(state.view.table?.rows ?? []).flatMap(row => [row.action, ...(row.expanded ? row.details ?? [] : []).map(line => line.action)])];
      return typeof input.action === 'string' && actions.includes(input.action) ? {kind: 'action', action: input.action} : undefined;
    }
    if (input.kind === 'change') return input.id === state.view.input?.id && typeof input.value === 'string' && input.value.length <= 4000
      ? {kind: 'change', id: input.id, value: input.value} : undefined;
    const parsed = inputMessage.safeParse({type: 'input', surface: id, data: input});
    if (!parsed.success) return;
    const value = parsed.data.data;
    if (value.kind === 'mouse' && (value.col >= columns || value.row >= rows)) return;
    return value;
  }
  async function execute(input: ControllerInput, ticket: number, windowIntent: number) {
    if (!validLease()) return;
    const current = lease!, epoch = generation;
    let before: UiEditorState | undefined;
    try {before = editorState(current.snapshot());} catch {/* Invalid snapshots fail closed. */}
    if (!before) {unavailable();return;}
    executing = {before};
    try {
      const result = await current.handle(input);
      if (!validLease(current) || generation !== epoch) return;
      const after = editorState(current.snapshot());
      if (!after) {unavailable();return;}
      let accepted = true;
      if (result !== undefined) {
        const intent = result as UiEditorIntent;
        if (intent?.type === 'interrupt') options.interrupt();
        else if (intent?.type === 'scroll' && typeof intent.rows === 'number' && Number.isFinite(intent.rows))
          scroll = {revision: (scroll?.revision ?? 0) + 1, rows: intent.rows};
        else if ((intent?.type === 'submit' || intent?.type === 'steer') && typeof intent.text === 'string' && intent.text.trim()) {
          let receipt: Admission = false;
          try {receipt = await options.send({type: intent.type, text: intent.text}, windowIntent);} catch {/* Rejected admission recovers the visible draft. */}
          if (!validLease(current) || generation !== epoch) return;
          accepted = receipt !== false;
          admission = {sequence: ticket, type: intent.type, status: !accepted ? 'rejected' : receipt === 'queued' || receipt === 'steered' ? 'queued' : 'accepted'};
        } else accepted = false;
      }
      inputRevision = ticket;
      if (accepted) {checkpoint = after;executing = undefined;}
      else recover(before);
      if (live()) publish();
    } catch {
      if (validLease(current) && generation === epoch) {
        checkpoint = before;unavailable();
      }
    }
  }
  create(checkpoint);publish();
  return {
    snapshot: () => state,
    checkpoint: save,
    input(input: ControllerInput, expected: number) {
      if (!validLease() || state.revision !== expected) return;
      const value = normalized(input);if (!value) return;
      const ticket = ++sequence, windowIntent = options.captureIntent();
      tail = tail.then(() => execute(value, ticket, windowIntent));
      void tail.catch(() => {});
      return ticket;
    },
    viewport(nextColumns: number, nextRows: number, nextMaxRows = nextRows) {
      if (!active || !Number.isInteger(nextColumns) || !Number.isInteger(nextRows) || !Number.isInteger(nextMaxRows)
        || nextColumns < 1 || nextRows < 1 || nextMaxRows < 1 || nextColumns > 10000 || nextRows > 10000 || nextMaxRows > 10000
        || columns === nextColumns && rows === nextRows && maxRows === nextMaxRows) return;
      columns = nextColumns;rows = nextRows;maxRows = nextMaxRows;publish();
    },
    close() {
      if (!active) return;
      checkpoint = save();active = false;capabilities?.abort();lease?.dispose();
    },
  };
}
