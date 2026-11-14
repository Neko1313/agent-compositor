import {AsyncLocalStorage} from 'node:async_hooks';
import {inputMessage} from '@agent-compositor/protocol';
import type {UiControllerLease, UiControllerRegistry} from '@agent-compositor/hooks';
import type {ControllerInput, ConversationController} from '@agent-compositor/renderer-opentui';
import type {PluginWindow} from './plugin-panel.js';
import type {Placement} from './placement.js';

export interface OpenTuiPlacementInputScope {current(): boolean;}
export interface OpenTuiPlacementControllerSnapshot extends Omit<ConversationController, 'kind'> {kind: 'placement';}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

/** Placement factories and their mutation capabilities never enter the renderer. */
export function createOpenTuiPlacementController<Scope extends OpenTuiPlacementInputScope>(options: {
  registry: UiControllerRegistry;
  id: string;
  signal: AbortSignal;
  current(): boolean;
  changed(): void;
  captureIntent(): number;
  inputScope(windowIntent: number, signal: AbortSignal, run: (scope: Scope) => Promise<void>): Promise<void>;
  windows(): PluginWindow[];
  anchors(): string[];
  apply(scope: Scope, id: string, placement: Placement, save?: boolean): Promise<void>;
  closed(): void;
  failed(cancelled: boolean): void;
}) {
  let active = true, columns = 80, rows = 10, maxRows = 10, revision = 0, sequence = 0, inputRevision = 0;
  let lease: UiControllerLease | undefined, state: OpenTuiPlacementControllerSnapshot | undefined;
  let tail = Promise.resolve();
  const inputContext = new AsyncLocalStorage<{scope: Scope; active: boolean}>();
  const live = () => active && options.current() && !options.signal.aborted && !lease?.signal.aborted;
  const current = () => {
    if (!live()) throw Error('Placement controller has expired');
  };
  const scope = () => {
    current();const input = inputContext.getStore();
    if (!input?.active || !input.scope.current()) throw Error('Placement input has expired');
    return input;
  };
  function fail(cancelled: boolean) {
    if (!active) return;
    active = false;lease?.dispose();options.failed(cancelled);
  }
  function render() {
    if (!live() || !lease) return;
    const selected = lease;
    try {
      const preferredRows = selected.preferredRows(columns, maxRows), view = selected.render(columns, rows);
      if (!live() || lease !== selected) return;
      state = immutable({id: options.id, kind: 'placement', revision: ++revision, inputRevision, preferredRows, view});
      options.changed();
    } catch {fail(selected.signal.aborted || options.signal.aborted);}
  }
  const data = {
    windows() {current();return structuredClone(options.windows());},
    anchors() {current();return [...options.anchors()];},
    apply(id: string, placement: Placement, save?: boolean): Promise<void> {
      const input = scope(), value = structuredClone(placement);
      const task = (async () => {
        try {
          if (scope() !== input) throw Error('Placement input has expired');
          await options.apply(input.scope, id, value, save);
          if (scope() !== input) throw Error('Placement input has expired');
        } catch {throw Error('Placement update failed');}
      })();
      // Retained calls still reject for their caller without leaking an unhandled error.
      void task.catch(() => {});return task;
    },
  };
  try {
    lease = options.registry.create('placement', data,
      () => {throw Error('The selected placement controller is unavailable');}, render, undefined, options.signal);
    lease.signal.addEventListener('abort', () => fail(true), {once: true});
    if (lease.signal.aborted) fail(true);else render();
  } catch {fail(options.signal.aborted);}
  function normalized(input: ControllerInput): ControllerInput | undefined {
    if (!state || !input || typeof input !== 'object') return;
    if (input.kind === 'action') {
      const actions = [...state.view.lines.map(line => line.action),
        ...(state.view.tabs ?? []).filter(tab => !tab.disabled).map(tab => tab.action),
        ...(state.view.table?.rows ?? []).flatMap(row => [row.action, ...(row.expanded ? row.details ?? [] : []).map(line => line.action)])];
      return typeof input.action === 'string' && actions.includes(input.action) ? {kind: 'action', action: input.action} : undefined;
    }
    if (input.kind === 'change') return input.id === state.view.input?.id && typeof input.value === 'string' && input.value.length <= 4000
      ? {kind: 'change', id: input.id, value: input.value} : undefined;
    const parsed = inputMessage.safeParse({type: 'input', surface: options.id, data: input});
    if (!parsed.success) return;
    const value = parsed.data.data;
    if (value.kind === 'mouse' && (value.col >= columns || value.row >= rows)) return;
    // The reference placement panel exposes its border/title frame coordinates.
    return value.kind === 'mouse' ? {...value, row: value.row + 2, col: value.col + 1} : value;
  }
  async function execute(input: ControllerInput, ticket: number, windowIntent: number) {
    if (!live() || !lease) return;
    const selected = lease;let invoked = false, result: unknown;
    try {
      await options.inputScope(windowIntent, selected.signal, async scope => {
        if (invoked || !live() || lease !== selected || !scope.current()) throw Error('Placement input has expired');
        invoked = true;const context = {scope, active: true};
        try {result = await inputContext.run(context, () => selected.handle(input));}
        finally {context.active = false;}
      });
      if (!live() || lease !== selected) return;
      if (!invoked) throw Error('Placement input was not admitted');
      inputRevision = ticket;
      if (result === 'close') {active = false;selected.dispose();options.closed();}
      else if (result === undefined) render();
      else fail(false);
    } catch {if (live() && lease === selected) fail(selected.signal.aborted || options.signal.aborted);}
  }
  return {
    snapshot: () => state,
    input(input: ControllerInput, expected: number) {
      if (!live() || state?.revision !== expected) return;
      const value = normalized(input);if (!value) return;
      let windowIntent: number;
      try {windowIntent = options.captureIntent();} catch {fail(false);return;}
      const ticket = ++sequence;
      tail = tail.then(() => execute(value, ticket, windowIntent));void tail.catch(() => {});
      return ticket;
    },
    viewport(nextColumns: number, nextRows: number, nextMaxRows = nextRows) {
      if (!active || !Number.isInteger(nextColumns) || !Number.isInteger(nextRows) || !Number.isInteger(nextMaxRows)
        || nextColumns < 1 || nextRows < 1 || nextMaxRows < 1 || nextColumns > 10000 || nextRows > 10000 || nextMaxRows > 10000
        || columns === nextColumns && rows === nextRows && maxRows === nextMaxRows) return;
      columns = nextColumns;rows = nextRows;maxRows = nextMaxRows;render();
    },
    close() {if (active) {active = false;lease?.dispose();}},
  };
}
