import {inputMessage} from '@agent-compositor/protocol';
import type {UiControllerLease, UiControllerRegistry} from '@agent-compositor/hooks';
import type {ControllerInput, ConversationController} from '@agent-compositor/renderer-opentui';

type Kind = ConversationController['kind'];
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

/** The lease and its private factory request never leave this host adapter. */
export function createOpenTuiController(options: {
  registry: UiControllerRegistry; id: string; kind: Kind; data: unknown; signal?: AbortSignal;
  current(): boolean; changed(): void; result(value: unknown): void; failed(cancelled: boolean): void;
}) {
  let active = true, columns = 80, rows = 10, revision = 0, sequence = 0, inputRevision = 0, error: string | undefined;
  let state: ConversationController | undefined, lease: UiControllerLease | undefined;
  const live = () => active && options.current() && !lease?.signal.aborted;
  const fail = (cancelled: boolean) => {
    if (!active) return;
    active = false;lease?.dispose();options.failed(cancelled);
  };
  function render() {
    if (!active || !lease) return;
    try {
      const preferredRows = lease.preferredRows(columns, rows);
      const view = lease.render(columns, rows);
      state = immutable({id: options.id, kind: options.kind, revision: ++revision, inputRevision, preferredRows,
        view: error ? {...view, lines: [...view.lines.slice(0, 1999), {text: error, tone: 'danger'}]} : view});
      options.changed();
    } catch {fail(lease.signal.aborted);}
  }
  const data = structuredClone(options.data);
  lease = options.registry.create(options.kind, data,
    () => {throw Error('The selected controller is unavailable');}, render, undefined, options.signal);
  lease.signal.addEventListener('abort', () => fail(true), {once: true});
  render();
  function normalized(input: ControllerInput): ControllerInput | undefined {
    if (!state || !input || typeof input !== 'object') return;
    if (input.kind === 'action') {
      const actions = [
        ...state.view.lines.map(line => line.action),
        ...(state.view.tabs ?? []).filter(tab => !tab.disabled).map(tab => tab.action),
        ...(state.view.table?.rows ?? []).flatMap(row => [row.action, ...(row.expanded ? row.details ?? [] : []).map(line => line.action)]),
      ];
      return typeof input.action === 'string' && actions.includes(input.action) ? {kind: 'action', action: input.action} : undefined;
    }
    if (input.kind === 'change') return input.id === state.view.input?.id && typeof input.value === 'string' && input.value.length <= 4000
      ? {kind: 'change', id: input.id, value: input.value} : undefined;
    const parsed = inputMessage.safeParse({type: 'input', surface: options.id, data: input});
    if (!parsed.success) return;
    const value = parsed.data.data;
    if (value.kind === 'mouse' && (value.col >= columns || value.row >= rows)) return;
    return value;
  }
  return {
    snapshot: () => state,
    input(input: ControllerInput, expected: number, admitted?: () => void) {
      if (!live() || state?.revision !== expected) return;
      const value = normalized(input);if (!value) return;
      const ticket = ++sequence;
      admitted?.();
      const finish = (result: unknown) => {
        if (!live()) return;
        inputRevision = ticket;
        if (result !== undefined) options.result(result);
        if (live()) render();
      };
      const failed = () => {if (active) fail(lease!.signal.aborted);};
      try {
        const result = lease!.handle(value);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function')
          void Promise.resolve(result).then(finish).catch(failed);
        else finish(result);
      } catch {failed();}
      return ticket;
    },
    viewport(nextColumns: number, nextRows: number) {
      if (!active || !Number.isInteger(nextColumns) || !Number.isInteger(nextRows)
        || nextColumns < 1 || nextRows < 1 || nextColumns > 10000 || nextRows > 10000
        || columns === nextColumns && rows === nextRows) return;
      columns = nextColumns;rows = nextRows;render();
    },
    error(message: string) {if (active) {error = message;render();}},
    close() {if (!active) return;active = false;lease!.dispose();},
  };
}
