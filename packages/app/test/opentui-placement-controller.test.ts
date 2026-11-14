import {afterEach, expect, it} from 'vitest';
import {UiControllerRegistry, type UiControllerFactory} from '@agent-compositor/hooks';
import {createOpenTuiPlacementController, type OpenTuiPlacementInputScope} from '../src/opentui-placement-controller.js';
import type {AppUiControllerData} from '../src/controller-contracts.js';
import type {PluginWindow} from '../src/plugin-panel.js';

const cleanup: (() => void)[] = [];
afterEach(() => {for (const close of cleanup.splice(0).reverse())close();});
function gate() {
  let release!: () => void;const promise = new Promise<void>(resolve => {release = resolve;});
  cleanup.push(release);return {promise, release};
}
type Scope = OpenTuiPlacementInputScope & {id: number; intent: number; signal: AbortSignal};
function setup(factory?: UiControllerFactory, apply?: Parameters<typeof createOpenTuiPlacementController<Scope>>[0]['apply']) {
  const provider = new AbortController(), lifetime = new AbortController(), registry = new UiControllerRegistry({placement: 'chosen'});
  if (factory)registry.register('chosen', {placement: factory}, provider.signal);
  let current = true, intent = 0, closed = 0, activeScopes = 0, maxScopes = 0;
  const failures: boolean[] = [], scopes: Scope[] = [], effects: unknown[] = [];
  const windows: PluginWindow[] = [{id: 'pane', plugin: 'PRIVATE_OWNER', surface: 'surface', title: 'PRIVATE_WINDOW', placement: {site: 'split', workspace: 1}}];
  const controller = createOpenTuiPlacementController<Scope>({registry, id: 'placement-window', signal: lifetime.signal,
    current: () => current, changed: () => {}, captureIntent: () => ++intent,
    inputScope: async (windowIntent, signal, run) => {
      signal.throwIfAborted();let active = true;
      const scope: Scope = {id: scopes.length + 1, intent: windowIntent, signal, current: () => active && current && !signal.aborted};
      scopes.push(scope);activeScopes++;maxScopes = Math.max(maxScopes, activeScopes);
      try {await run(scope);} finally {active = false;activeScopes--;}
    },
    windows: () => windows, anchors: () => ['session', 'pane'],
    apply: apply ?? (async (scope, id, placement, save) => {effects.push({scope: scope.id, intent: scope.intent, id, placement, save});}),
    closed: () => {closed++;}, failed: cancelled => {failures.push(cancelled);},
  });
  cleanup.push(() => controller.close());
  return {controller, provider, lifetime, windows, failures, scopes, effects,
    input: (input: Parameters<typeof controller.input>[0]) => controller.input(input, controller.snapshot()!.revision),
    intent: () => intent, closed: () => closed, activeScopes: () => activeScopes, maxScopes: () => maxScopes,
    replace() {current = false;lifetime.abort();},
  };
}

it('keeps callable placement data private, detaches window reads and renders actual rows separately from capacity', async () => {
  let data!: AppUiControllerData['placement'];const rendered: number[] = [], measured: number[] = [];
  const f = setup(request => {
    data = request.data as typeof data;
    return {preferredRows: (_columns, maxRows) => {measured.push(maxRows);return 3;},
      render: ({rows}) => {rendered.push(rows);data.windows();data.anchors();return {lines: Array.from({length: rows}, (_, index) => index === rows - 1
        ? {text: 'Apply 窗', action: 'apply', cells: [{ch: '窗', fg: '#abcdef', bold: true}]} : {text: 'PRIVATE DATA MASKED'})};},
      handle: async input => {if (input.kind === 'action')await data.apply('pane', {workspace: 2}, true);},
    };
  });
  const copy = data.windows();copy[0].placement.workspace = 9;copy[0].title = 'mutated';
  const anchors = data.anchors();anchors.push('foreign');expect(data.anchors()).toEqual(['session', 'pane']);
  expect(f.windows[0]).toMatchObject({title: 'PRIVATE_WINDOW', placement: {workspace: 1}});
  expect(f.scopes).toHaveLength(0);f.controller.viewport(60, 3, 18);
  expect(rendered.at(-1)).toBe(3);expect(measured.at(-1)).toBe(18);expect(f.controller.snapshot()?.preferredRows).toBe(3);
  expect(f.controller.snapshot()?.view.lines[2]).toEqual({text: 'Apply 窗', action: 'apply', cells: [{ch: '窗', fg: '#abcdef', bold: true}]});
  expect(Object.isFrozen(f.controller.snapshot()!.view.lines[2].cells)).toBe(true);
  expect(JSON.stringify(f.controller.snapshot())).not.toMatch(/PRIVATE_OWNER|PRIVATE_WINDOW|windows|anchors|signal|registry/);
  f.input({kind: 'action', action: 'apply'});await expect.poll(() => f.controller.snapshot()?.inputRevision).toBe(1);
  expect(f.effects).toEqual([{scope: 1, intent: 1, id: 'pane', placement: {workspace: 2}, save: true}]);expect(f.activeScopes()).toBe(0);
  f.controller.viewport(60, 3, 24);expect(rendered.at(-1)).toBe(3);expect(measured.at(-1)).toBe(24);
});

it('serializes input-scoped apply work and acknowledges only completed handlers while retaining input-time intent', async () => {
  const pending = gate(), calls: {value: string; intent: number}[] = [];let data!: AppUiControllerData['placement'];
  const f = setup((request, context) => {
    data = request.data as typeof data;let value = '';
    return {render: () => ({input: {id: 'placement-size', value}, lines: []}), handle: async input => {
      if (input.kind !== 'change')return;
      value = input.value;context.invalidate();await data.apply(value, {size: .3});
    }};
  }, async (scope, id) => {calls.push({value: id, intent: scope.intent});if (id === 'first')await pending.promise;});
  expect(f.input({kind: 'change', id: 'placement-size', value: 'first'})).toBe(1);
  await expect.poll(() => calls).toEqual([{value: 'first', intent: 1}]);
  expect(f.controller.snapshot()?.inputRevision).toBe(0);expect(f.activeScopes()).toBe(1);
  expect(f.input({kind: 'change', id: 'placement-size', value: 'second'})).toBe(2);
  f.controller.viewport(50, 6, 12);expect(f.controller.snapshot()?.inputRevision).toBe(0);expect(calls).toHaveLength(1);
  pending.release();await expect.poll(() => f.controller.snapshot()?.inputRevision).toBe(2);
  expect(calls).toEqual([{value: 'first', intent: 1}, {value: 'second', intent: 2}]);
  expect(f.scopes.map(scope => scope.current())).toEqual([false, false]);expect(f.maxScopes()).toBe(1);expect(f.activeScopes()).toBe(0);
});

it('rejects stale paints, undeclared semantic targets and outside local mouse input before allocating any scope', async () => {
  const handled: unknown[] = [];
  const f = setup(() => ({render: () => ({lines: [{text: 'Apply', action: 'apply'}], input: {id: 'size', value: ''}}),
    handle: input => {handled.push(input);},
  }));
  const revision = f.controller.snapshot()!.revision;
  expect(f.controller.input({kind: 'key', key: 'f5'}, revision - 1)).toBeUndefined();
  for (const input of [{kind: 'action', action: 'other'}, {kind: 'change', id: 'foreign', value: 'value'}, {kind: 'mouse', row: 10, col: 0, button: 'left'}] as const)
    expect(f.input(input)).toBeUndefined();
  expect(f.intent()).toBe(0);expect(f.scopes).toHaveLength(0);expect(handled).toEqual([]);
  const inputs: Parameters<typeof f.input>[0][] = [{kind: 'text', text: 'paste 窗', paste: true}, {kind: 'key', key: 'f5', modifiers: ['shift']},
    {kind: 'mouse', row: 0, col: 0, button: 'left', action: 'press'}, {kind: 'mouse', row: 2, col: 3, button: 'left', action: 'press'}];
  for (const input of inputs)
    f.input(input);
  await expect.poll(() => f.controller.snapshot()?.inputRevision).toBe(4);
  expect(handled).toEqual([{kind: 'text', text: 'paste 窗', paste: true}, {kind: 'key', key: 'f5', modifiers: ['shift']},
    {kind: 'mouse', row: 2, col: 1, button: 'left', action: 'press'}, {kind: 'mouse', row: 4, col: 4, button: 'left', action: 'press'}]);
});

it('permits readonly factory/render reads but rejects effect capabilities outside their exact live input scope', async () => {
  const late = gate();let data!: AppUiControllerData['placement'], escaped!: Promise<string>;
  const f = setup(request => {
    data = request.data as typeof data;data.windows();data.anchors();
    return {render: () => ({lines: []}), handle: () => {
      escaped = late.promise.then(async () => {try {await data.apply('pane', {workspace: 9});return 'allowed';} catch {return 'expired';}});
    }};
  });
  expect(() => data.apply('pane', {workspace: 2})).toThrow('Placement input has expired');
  f.input({kind: 'key', key: 'f5'});await expect.poll(() => f.controller.snapshot()?.inputRevision).toBe(1);
  late.release();expect(await escaped).toBe('expired');expect(f.effects).toEqual([]);
  f.provider.abort();expect(() => data.windows()).toThrow('Placement controller has expired');expect(() => data.anchors()).toThrow();expect(f.failures).toEqual([true]);
});

it('detaches a placement payload before awaiting host validation and sanitizes host failures seen by the controller', async () => {
  const pending = gate();let original = {workspace: 2}, received: unknown, message = '';
  const f = setup((request, context) => {
    const data = request.data as AppUiControllerData['placement'];
    return {render: () => ({lines: [{text: message || 'Ready'}]}), handle: async () => {
      const result = data.apply('pane', original, true);original.workspace = 8;
      try {await result;} catch (error) {message = String(error);context.invalidate();}
    }};
  }, async (_scope, _id, value) => {received = value;await pending.promise;throw Error('PRIVATE_SAVE_PATH');});
  f.input({kind: 'key', key: 'f5'});await expect.poll(() => received).toEqual({workspace: 2});
  pending.release();await expect.poll(() => f.controller.snapshot()?.inputRevision).toBe(1);
  expect(f.controller.snapshot()?.view.lines[0].text).toBe('Error: Placement update failed');expect(f.failures).toEqual([]);
  expect(JSON.stringify(f.controller.snapshot())).not.toContain('PRIVATE_SAVE_PATH');
});

it('revokes an awaiting apply and queued input on provider unload without closing or acknowledging a late result', async () => {
  const pending = gate(), committed: string[] = [];let continued = false;
  const f = setup(request => {
    const data = request.data as AppUiControllerData['placement'];
    return {render: () => ({lines: []}), handle: async () => {await data.apply('pane', {workspace: 2});continued = true;return 'close';}};
  }, async scope => {await pending.promise;if (scope.current())committed.push('applied');});
  f.input({kind: 'key', key: 'f5'});f.input({kind: 'key', key: 'f5'});
  await expect.poll(() => f.scopes).toHaveLength(1);f.provider.abort();pending.release();
  await expect.poll(() => f.activeScopes()).toBe(0);await Promise.resolve();
  expect(f.scopes).toHaveLength(1);expect(committed).toEqual([]);expect(continued).toBe(false);expect(f.closed()).toBe(0);expect(f.failures).toEqual([true]);expect(f.controller.snapshot()?.inputRevision).toBe(0);
});

it('disposes once for explicit close or controller close and ignores late Core-generation callbacks', async () => {
  let disposed = 0;
  const f = setup(() => ({render: () => ({lines: []}), handle: () => 'close', dispose: () => {disposed++;}}));
  f.input({kind: 'key', key: 'escape'});await expect.poll(f.closed).toBe(1);f.controller.close();f.provider.abort();
  expect(disposed).toBe(1);expect(f.failures).toEqual([]);
  const pending = gate(), stale = setup(() => ({render: () => ({lines: []}), handle: async () => {await pending.promise;return 'close';}}));
  stale.input({kind: 'key', key: 'f5'});await expect.poll(() => stale.scopes).toHaveLength(1);stale.replace();pending.release();
  await expect.poll(() => stale.activeScopes()).toBe(0);expect(stale.closed()).toBe(0);expect(stale.failures).toEqual([true]);
});

it.each([null, false, 0, {type: 'close'}])('fails closed for a malformed result %j without exposing a native fallback', async value => {
  const f = setup(() => ({render: () => ({lines: []}), handle: () => value}));f.input({kind: 'key', key: 'f5'});
  await expect.poll(() => f.failures).toEqual([false]);expect(f.closed()).toBe(0);expect(f.input({kind: 'key', key: 'f5'})).toBeUndefined();
});

it('fails constantly for unavailable factories, reentrant construction abort and effectful render', () => {
  const unavailable = setup();expect(unavailable.controller.snapshot()).toBeUndefined();expect(unavailable.failures).toEqual([false]);
  const effectful = setup(request => ({render: () => {const data = request.data as AppUiControllerData['placement'];data.apply('pane', {});return {lines: []};}, handle: () => {}}));
  expect(effectful.failures).toEqual([false]);expect(effectful.effects).toEqual([]);expect(effectful.controller.snapshot()).toBeUndefined();
  const lifetime = new AbortController(), registry = new UiControllerRegistry({placement: 'chosen'});let disposed = 0;
  registry.register('chosen', {placement: () => {lifetime.abort(Error('PRIVATE_ABORT_REASON'));return {render: () => ({lines: []}), handle: () => {}, dispose: () => {disposed++;}};}}, lifetime.signal);
  const failures: boolean[] = [];
  const controller = createOpenTuiPlacementController({registry, id: 'reentrant', signal: new AbortController().signal, current: () => true,
    changed: () => {}, captureIntent: () => 0, inputScope: async (_intent, _signal, run) => {await run({current: () => true});},
    windows: () => [], anchors: () => [], apply: async () => {}, closed: () => {}, failed: cancelled => failures.push(cancelled),
  });controller.close();expect(disposed).toBe(1);expect(failures).toEqual([true]);expect(controller.snapshot()).toBeUndefined();
});
