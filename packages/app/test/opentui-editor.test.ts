import {afterEach, expect, it} from 'vitest';
import {UiControllerRegistry, type UiControllerFactory, type UiEditorState} from '@agent-compositor/hooks';
import {createOpenTuiEditor} from '../src/opentui-editor.js';

const cleanup: (() => void)[] = [];
afterEach(() => {for (const close of cleanup.splice(0).reverse())close();});
function gate<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {release = resolve;});
  return {promise, release};
}
function setup(factory?: UiControllerFactory, initial = {text: '', cursor: 0}, send: Parameters<typeof createOpenTuiEditor>[0]['send'] = async () => 'submitted') {
  const provider = new AbortController(), lifetime = new AbortController(), registry = new UiControllerRegistry({editor: 'chosen'});
  if (factory)registry.register('chosen', {editor: factory}, provider.signal);
  let current = true, interrupts = 0;
  const signals: AbortSignal[] = [];
  const editor = createOpenTuiEditor({registry, state: initial, signal: lifetime.signal, current: () => current,
    data: signal => {signals.push(signal);return {sessionId: 'private-session', commands: () => {signal.throwIfAborted();return [];}};},
    changed: () => {}, captureIntent: () => 7, send, interrupt: () => {interrupts++;},
  });
  cleanup.push(() => editor.close());
  const input = (value: Parameters<typeof editor.input>[0]) => editor.input(value, editor.snapshot().revision);
  return {editor, input, provider, lifetime, signals, interrupts: () => interrupts, expire() {current = false;lifetime.abort();}};
}
function draftFactory(states: UiEditorState[] = []): UiControllerFactory {
  return ({state}) => {
    let {text, cursor} = state as UiEditorState;states.push({text, cursor});
    return {snapshot: () => ({text, cursor}), preferredRows: () => 100,
      render: ({columns, rows}) => ({lines: [{text: `MASKED ${text.length} ${columns}x${rows}`, cells: [{ch: '窗', bold: true, fg: '#abcdef'}]}]}),
      handle: input => {
        if (input.kind === 'text') {text = text.slice(0, cursor) + input.text + text.slice(cursor);cursor += input.text.length;}
        if (input.kind === 'key' && input.key === 'f2') {const sent = text;text = '';cursor = 0;return {type: 'submit', text: sent};}
      }, dispose() {text = '';cursor = 0;},
    };
  };
}

it('keeps UTF-16 checkpoints and capabilities private while projecting validated bounded cells', async () => {
  const f = setup(draftFactory(), {text: 'A窗🙂B', cursor: 4});
  expect(f.editor.snapshot()).toMatchObject({kind: 'editor', available: true, inputRevision: 0, preferredRows: 4,
    view: {lines: [{text: 'MASKED 5 80x4', cells: [{ch: '窗', bold: true, fg: '#abcdef'}]}]}});
  f.editor.viewport(38, 3);expect(f.editor.snapshot().preferredRows).toBe(3);
  expect(f.input({kind: 'text', text: 'X'})).toBe(1);
  await expect.poll(() => f.editor.snapshot().inputRevision).toBe(1);
  expect(f.editor.checkpoint()).toEqual({text: 'A窗🙂XB', cursor: 5});
  expect(JSON.stringify(f.editor.snapshot())).not.toMatch(/A窗|session|commands|signal|cursor/);
  expect(Object.isFrozen(f.editor.snapshot().view.lines[0].cells)).toBe(true);
  f.editor.close();expect(f.editor.checkpoint()).toEqual({text: 'A窗🙂XB', cursor: 5});expect(f.signals[0].aborted).toBe(true);
});

it('recreates a visibly rejected pre-admission draft before applying later admitted input once', async () => {
  const receipt = gate<false>(), states: UiEditorState[] = [], sent: unknown[] = [];
  const f = setup(draftFactory(states), {text: 'draft', cursor: 2}, async (intent, epoch) => {sent.push({intent, epoch});return receipt.promise;});
  const first = f.editor.snapshot().id;
  f.input({kind: 'key', key: 'f2'});
  await expect.poll(() => sent).toHaveLength(1);
  f.input({kind: 'text', text: 'X'});
  expect(f.editor.checkpoint()).toEqual({text: 'draft', cursor: 2});
  receipt.release(false);
  await expect.poll(() => f.editor.snapshot().inputRevision).toBe(2);
  expect(states).toEqual([{text: 'draft', cursor: 2}, {text: 'draft', cursor: 2}]);
  expect(f.editor.snapshot().id).not.toBe(first);
  expect(f.editor.snapshot().admission).toEqual({sequence: 1, type: 'submit', status: 'rejected'});
  expect(f.editor.checkpoint()).toEqual({text: 'drXaft', cursor: 3});
  expect(f.signals[0].aborted).toBe(true);expect(f.signals[1].aborted).toBe(false);
  expect(sent).toEqual([{intent: {type: 'submit', text: 'draft'}, epoch: 7}]);
});

it('renders the actual content rows separately from the preferred-size capacity and admits the visible last-row action', async () => {
  const measurements: number[] = [], rendered: number[] = [], handled: unknown[] = [];
  const f = setup(({state}) => ({snapshot: () => state,
    preferredRows: (_columns, maxRows) => {measurements.push(maxRows);return Math.min(3, maxRows);},
    render: ({rows}) => {rendered.push(rows);return {lines: Array.from({length: rows}, (_, index) => index === rows - 1
      ? {text: 'Last row', action: 'last'} : {text: 'Body'})};},
    handle: input => {handled.push(input);},
  }));
  f.editor.viewport(60, 3, 18);expect(measurements.at(-1)).toBe(18);expect(rendered.at(-1)).toBe(3);
  expect(f.editor.snapshot().preferredRows).toBe(3);expect(f.editor.snapshot().view.lines[2]).toEqual({text: 'Last row', action: 'last'});
  f.input({kind: 'action', action: 'last'});await expect.poll(() => handled).toEqual([{kind: 'action', action: 'last'}]);
  f.editor.viewport(60, 3, 24);expect(measurements.at(-1)).toBe(24);expect(rendered.at(-1)).toBe(3);expect(f.editor.snapshot().preferredRows).toBe(3);
  expect(f.input({kind: 'mouse', row: 3, col: 0, button: 'left'})).toBeUndefined();
});

it('acknowledges an accepted queue receipt without recovering the consumed draft', async () => {
  const f = setup(draftFactory(), {text: 'queued draft', cursor: 5}, async () => 'queued');
  f.input({kind: 'key', key: 'f2'});
  await expect.poll(() => f.editor.snapshot().admission?.status).toBe('queued');
  expect(f.editor.checkpoint()).toEqual({text: '', cursor: 0});expect(f.signals).toHaveLength(1);
});

it('does not replay an already applied scroll receipt when a rejected send recreates the editor', async () => {
  const factory = draftFactory();
  const f = setup((request, context) => {
    const instance = factory(request, context);
    return {...instance, handle: input => input.kind === 'key' && input.key === 'f9' ? {type: 'scroll', rows: 3} : instance.handle(input)};
  }, {text: 'Unsent draft', cursor: 4}, async () => false);
  f.input({kind: 'key', key: 'f9'});await expect.poll(() => f.editor.snapshot().scroll).toEqual({revision: 1, rows: 3});
  const id = f.editor.snapshot().id;f.input({kind: 'key', key: 'f2'});
  await expect.poll(() => f.editor.snapshot().admission?.status).toBe('rejected');
  expect(f.editor.snapshot().id).not.toBe(id);expect(f.editor.snapshot().scroll).toBeUndefined();
  expect(f.editor.checkpoint()).toEqual({text: 'Unsent draft', cursor: 4});
});

it('retains an unaccepted asynchronous pre-clear draft and revokes its late intent on disposal', async () => {
  const pending = gate<void>();let sent = 0;
  const f = setup(({state}, context) => {
    let {text, cursor} = state as UiEditorState;
    return {snapshot: () => ({text, cursor}), render: () => ({lines: [{text: 'Private editor'}]}), handle: async () => {
      const value = text;text = '';cursor = 0;context.invalidate();await pending.promise;return {type: 'submit', text: value};
    }, dispose() {text = '';cursor = 0;}};
  }, {text: 'Unaccepted 🙂 draft', cursor: 13}, async () => {sent++;return 'submitted';});
  f.input({kind: 'key', key: 'f2'});await Promise.resolve();
  f.editor.close();pending.release();await Promise.resolve();await Promise.resolve();
  expect(f.editor.checkpoint()).toEqual({text: 'Unaccepted 🙂 draft', cursor: 13});expect(sent).toBe(0);
});

it('fails closed for unavailable factories, invalid snapshots and private handler failures without exposing errors', async () => {
  const unavailable = setup();expect(unavailable.editor.snapshot().available).toBe(false);
  expect(unavailable.input({kind: 'key', key: 'f2'})).toBeUndefined();
  const invalid = setup(() => ({snapshot: () => ({text: 'PRIVATE_INVALID', cursor: 999}), render: () => ({lines: []}), handle: () => {}}));
  expect(invalid.editor.snapshot().available).toBe(false);expect(invalid.editor.checkpoint()).toEqual({text: '', cursor: 0});
  const failed = setup(({state}) => ({snapshot: () => state, render: () => ({lines: []}), handle: () => {throw Error('PRIVATE_FACTORY_EXCEPTION');}}), {text: 'Retained', cursor: 2});
  failed.input({kind: 'key', key: 'f2'});await expect.poll(() => failed.editor.snapshot().available).toBe(false);
  expect(failed.editor.checkpoint()).toEqual({text: 'Retained', cursor: 2});
  expect(JSON.stringify([unavailable.editor.snapshot(), invalid.editor.snapshot(), failed.editor.snapshot()])).not.toMatch(/PRIVATE_/);
});

it('handles synchronous provider abortion during rendering without recursion or stale successful frames', () => {
  const owner = new AbortController(), registry = new UiControllerRegistry({editor: 'chosen'});
  let abort = false, disposed = 0;
  registry.register('chosen', {editor: ({state}) => ({snapshot: () => state,
    render: () => {if (abort)owner.abort();return {lines: [{text: 'LATE_RENDER'}]};}, handle: () => {}, dispose: () => {disposed++;},
  })}, owner.signal);
  const editor = createOpenTuiEditor({registry, state: {text: 'Retained', cursor: 2}, signal: new AbortController().signal,
    current: () => true, data: () => ({sessionId: 'test', commands: () => []}), changed: () => {}, captureIntent: () => 0,
    send: async () => false, interrupt: () => {},
  });cleanup.push(() => editor.close());
  abort = true;expect(() => editor.viewport(40, 3)).not.toThrow();
  expect(editor.snapshot().available).toBe(false);expect(editor.snapshot().view.lines[0].text).toBe('Selected editor is unavailable');
  expect(editor.checkpoint()).toEqual({text: 'Retained', cursor: 2});expect(disposed).toBe(1);
});

it('admits only displayed controls and valid coordinates and projects scroll and interrupt intents', async () => {
  const seen: unknown[] = [];
  const f = setup(({state}) => ({snapshot: () => state, render: () => ({lines: [{text: 'Older', action: 'older'}]}), handle: input => {
    seen.push(input);return input.kind === 'action' ? {type: 'scroll', rows: 4} : {type: 'interrupt'};
  }}));
  const revision = f.editor.snapshot().revision;
  expect(f.editor.input({kind: 'key', key: 'f2'}, revision - 1)).toBeUndefined();
  expect(f.input({kind: 'action', action: 'foreign'})).toBeUndefined();expect(f.input({kind: 'mouse', row: 4, col: 0, button: 'left'})).toBeUndefined();
  expect(seen).toEqual([]);f.input({kind: 'action', action: 'older'});
  await expect.poll(() => f.editor.snapshot().scroll).toEqual({revision: 1, rows: 4});
  f.input({kind: 'key', key: 'f3'});await expect.poll(f.interrupts).toBe(1);
});
