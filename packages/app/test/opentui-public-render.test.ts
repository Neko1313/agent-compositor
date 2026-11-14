import {afterEach, expect, it} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '@agent-compositor/runtime';
import {attach} from '@agent-compositor/hooks';
import type {UiTextView} from '@agent-compositor/events';
import type {PublicRenderMeasurement} from '@agent-compositor/renderer-opentui';
import {createOpenTuiPublicRender, type OpenTuiPublicRenderOptions} from '../src/opentui-public-render.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
const view = (text: string): UiTextView => ({lines: [{text}]});
const metrics = (extra: Partial<PublicRenderMeasurement> = {}): PublicRenderMeasurement => ({columns: 80, rows: 8, visible: true, scrollOffset: 0, ...extra});
const flush = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
function fixture(describe?: OpenTuiPublicRenderOptions['describe']) {
  let text = 'DEFAULT', reads = 0;
  const calls: {input: Parameters<OpenTuiPublicRenderOptions['render']>[0]; signal: AbortSignal; resolve(value: {value: unknown}): void}[] = [];
  const pressed: string[] = [];
  const cache = createOpenTuiPublicRender({describe: (id, measure) => {reads++;return describe ? describe(id, measure) : {
    site: 'plugin:' + id, props: {lines: [{text}], offset: measure.scrollOffset}, defaultView: view(text),
  };}, render: (input, signal) => new Promise(resolve => {calls.push({input, signal, resolve});}), press: (id, action) => {pressed.push(id + ':' + action);}});
  cleanup.push(() => cache.close());
  return {cache, calls, pressed, setText(value: string) {text = value;}, reads: () => reads,
    async resolve(index: number, tree: unknown) {calls[index].resolve({value: {tree}});await flush();}};
}

it('keeps registration/lookup stable, paints a parsed immutable default first, and detaches both producer and override data', async () => {
  const raw = {site: 'conversation', props: {lines: [{text: 'ORIGINAL'}], input: {id: 'public-filter', value: 'producer'}}, defaultView: view('ORIGINAL')};
  const f = fixture(() => raw), identity = {}, source = f.cache.register('session', identity), reads = f.reads();
  expect(f.cache.slots.slot('session')).toBe(source);expect(f.cache.slots.slot('unknown')).toBeUndefined();expect(f.cache.register('session', identity)).toBe(source);
  expect(f.reads()).toBe(reads);expect(f.calls).toHaveLength(0);
  expect(source.snapshot()).toMatchObject({defaultView: view('ORIGINAL')});expect(source.snapshot().override).toBeUndefined();
  expect(Object.isFrozen(source.snapshot().defaultView?.lines[0])).toBe(true);
  source.measure(metrics());expect(f.calls).toHaveLength(1);expect(f.calls[0].input).toEqual({site: 'conversation', surface: 'terminal', props: raw.props, viewport: {columns: 80, rows: 8}});
  raw.props.lines[0].text = 'BORROWED_MUTATION';raw.defaultView.lines[0].text = 'BORROWED_MUTATION';
  expect(f.calls[0].input.props.lines).toEqual([{text: 'ORIGINAL'}]);
  f.cache.refresh('session');expect(f.calls[0].signal.aborted).toBe(true);expect(f.calls).toHaveLength(2);
  const tree = view('OVERRIDE');await f.resolve(1, tree);tree.lines[0].text = 'MUTATED_RESULT';
  expect(source.snapshot().override).toEqual(view('OVERRIDE'));expect(Object.isFrozen(source.snapshot().override?.lines)).toBe(true);
  f.setText('ignored');source.measure(metrics());expect(f.calls).toHaveLength(2);
});

it('coalesces changing input to the latest key with at most two actual render emissions per ID', async () => {
  const f = fixture(), source = f.cache.register('panel', {});source.measure(metrics());
  for (const columns of [81, 82, 83, 84]) source.measure(metrics({columns}));
  expect(f.calls).toHaveLength(2);expect(f.calls.map(call => call.input.viewport.columns)).toEqual([80, 81]);
  expect(f.calls.every(call => call.signal.aborted)).toBe(true);expect(source.snapshot().defaultView).toEqual(view('DEFAULT'));
  await f.resolve(0, view('OLD80'));expect(f.calls).toHaveLength(3);expect(f.calls[2].input.viewport.columns).toBe(84);
  await f.resolve(1, view('OLD81'));expect(source.snapshot().override).toBeUndefined();
  await f.resolve(2, view('LATEST84'));expect(source.snapshot().override).toEqual(view('LATEST84'));
  f.cache.refresh();source.snapshot();expect(f.calls).toHaveLength(3);
});

it('keeps per-ID capacity across identity replacement/reset and fences every retained source after lifecycle changes', async () => {
  const f = fixture(), old = f.cache.register('panel', {});old.measure(metrics());old.measure(metrics({columns: 81}));
  const next = f.cache.register('panel', {});next.measure(metrics());expect(f.calls).toHaveLength(2);
  old.measure(metrics({columns: 90}));old.press('old', old.snapshot().revision);expect(f.calls).toHaveLength(2);expect(f.pressed).toEqual([]);
  await f.resolve(0, {lines: [{text: 'OLD', action: 'old'}]});expect(f.calls).toHaveLength(3);
  f.cache.reset();expect(f.cache.slots.slot('panel')).toBeUndefined();expect(next.snapshot().override).toBeUndefined();
  const latest = f.cache.register('panel', {});latest.measure(metrics({columns: 92}));expect(f.calls).toHaveLength(3);
  await f.resolve(1, view('OLDER'));expect(f.calls).toHaveLength(4);expect(f.calls[3].input.viewport.columns).toBe(92);
  await f.resolve(2, view('EXPIRED'));expect(latest.snapshot().override).toBeUndefined();
  expect(f.cache.close()).toBeUndefined();expect(f.calls.every(call => call.signal.aborted)).toBe(true);
  await f.resolve(3, view('LATE'));expect(latest.snapshot().override).toBeUndefined();expect(f.cache.slots.slot('panel')).toBeUndefined();
  const closed = f.cache.register('late', {});closed.measure(metrics());expect(f.calls).toHaveLength(4);
});

it('bounds actual ignored render promises globally and drains queued visible defaults when capacity returns', async () => {
  const f = fixture();
  for (let id = 0; id < 512; id++) f.cache.register('panel-' + id, {}).measure(metrics());
  const queued = f.cache.register('queued', {});queued.measure(metrics());queued.measure(metrics({columns: 90}));queued.measure(metrics({columns: 91}));
  expect(f.calls).toHaveLength(512);expect(queued.snapshot().defaultView).toEqual(view('DEFAULT'));
  f.cache.remove('panel-0');expect(f.calls[0].signal.aborted).toBe(true);expect(f.calls).toHaveLength(512);
  await f.resolve(0, view('REMOVED'));expect(f.calls).toHaveLength(513);expect(f.calls[512].input.viewport.columns).toBe(91);
  await f.resolve(512, view('QUEUED'));expect(queued.snapshot().override).toEqual(view('QUEUED'));
  expect(f.cache.close()).toBeUndefined();expect(f.calls.slice(1, 512).every(call => call.signal.aborted)).toBe(true);
});

it('aborts hidden work, rejects invalid measurements and does not retry invalid trees until input/invalidation changes', async () => {
  const f = fixture(), source = f.cache.register('panel', {});
  for (const invalid of [{columns: NaN}, {rows: -1}, {scrollOffset: Infinity}, {columns: Number.MAX_SAFE_INTEGER + 1}]) source.measure(metrics(invalid));
  expect(f.calls).toHaveLength(0);source.measure(metrics({columns: 80.9, rows: 8.2, scrollOffset: 2.7}));
  expect(f.calls[0].input.viewport).toEqual({columns: 80, rows: 8});expect(f.calls[0].input.props.offset).toBe(2);
  source.measure(metrics({visible: false}));expect(f.calls[0].signal.aborted).toBe(true);await f.resolve(0, view('HIDDEN'));expect(source.snapshot().override).toBeUndefined();
  source.measure(metrics());await f.resolve(1, {lines: 'INVALID'});
  for (let i = 0; i < 5; i++) {source.snapshot();source.measure(metrics());f.cache.refresh();}
  expect(f.calls).toHaveLength(2);expect(source.snapshot().defaultView).toEqual(view('DEFAULT'));
  f.cache.invalidate();expect(f.calls).toHaveLength(3);await f.resolve(2, view('VALID'));expect(source.snapshot().override).toEqual(view('VALID'));
  source.measure(metrics({columns: 0}));expect(source.snapshot().override).toBeUndefined();expect(f.calls).toHaveLength(3);
});

it('admits only current displayed override actions and revalidates producer data before forwarding a press', async () => {
  const f = fixture(), source = f.cache.register('panel', {});source.measure(metrics());
  const override: UiTextView = {lines: [{text: 'Override', action: 'override'}], tabs: [{id: 'off', label: 'Disabled', action: 'disabled', disabled: true}],
    table: {columns: [{label: 'Column'}], rows: [{id: 'hidden', cells: ['Closed'], details: [{text: 'Hidden detail', action: 'hidden-detail'}]},
      {id: 'open', cells: ['Open'], action: 'row', expanded: true, details: [{text: 'Shown detail', action: 'shown-detail'}]}]}};
  await f.resolve(0, override);const revision = source.snapshot().revision;
  for (const action of ['default', 'disabled', 'hidden-detail', 'forged']) source.press(action, revision);
  source.press('override', revision - 1);expect(f.pressed).toEqual([]);
  for (const action of ['override', 'row', 'shown-detail']) source.press(action, revision);
  expect(f.pressed).toEqual(['panel:override', 'panel:row', 'panel:shown-detail']);
  f.setText('CHANGED_WITHOUT_REFRESH');source.press('override', revision);expect(f.pressed).toHaveLength(3);
  expect(source.snapshot().override).toBeUndefined();expect(f.calls).toHaveLength(2);
  await f.resolve(1, override);source.measure(metrics({visible: false}));source.press('override', source.snapshot().revision);expect(f.pressed).toHaveLength(3);
});

it('keeps logical producer scroll stable across override layout clamps but accepts explicit input scroll and fresh defaults', async () => {
  const f = fixture(), source = f.cache.register('panel', {});source.measure(metrics({scrollOffset: 40, scrollOrigin: 'input'}));await f.resolve(0, view('SHORT'));
  source.measure(metrics({scrollOffset: 0, scrollOrigin: 'layout'}));expect(f.calls).toHaveLength(1);
  source.measure(metrics({columns: 70, scrollOffset: 0, scrollOrigin: 'layout'}));expect(f.calls[1].input.props.offset).toBe(40);
  expect(source.snapshot().defaultView).toEqual(view('DEFAULT'));expect(f.calls[1].input.props.lines).toEqual([{text: 'DEFAULT'}]);
  await f.resolve(1, view('SHORTER'));source.measure(metrics({columns: 70, scrollOffset: 10, scrollOrigin: 'input'}));expect(f.calls[2].input.props.offset).toBe(10);
  await f.resolve(2, {lines: 'INVALID'});source.measure(metrics({columns: 70, scrollOffset: 2, scrollOrigin: 'layout'}));expect(f.calls[3].input.props.offset).toBe(2);
});

it('fails closed for invalid/capability-bearing defaults and hides borrowed action callbacks immediately', async () => {
  let description: ReturnType<OpenTuiPublicRenderOptions['describe']> = {site: 'plugin:panel', props: {}, defaultView: view('SAFE')};
  const f = fixture(() => description), source = f.cache.register('panel', {});source.measure(metrics());await f.resolve(0, {lines: [{text: 'Action', action: 'old'}]});
  description = {site: 'plugin:panel', props: {capability: () => {}}, defaultView: view('SAFE')};f.cache.refresh('panel');
  expect(source.snapshot().override).toBeUndefined();expect(source.snapshot().defaultView).toBeUndefined();expect(f.calls).toHaveLength(1);
  description = undefined;f.cache.refresh();source.press('old', source.snapshot().revision);expect(f.pressed).toEqual([]);
  description = {site: 'plugin:panel', props: {}, defaultView: {lines: 'INVALID'} as unknown as UiTextView};f.cache.refresh();expect(f.calls).toHaveLength(1);
});

it.each([undefined, null, {}, {tree: null}, {tree: {lines: [{text: 'Invalid', unknown: true}]}}])('keeps a missing/invalid final tree on the working default without retry (%j)', async value => {
  const f = fixture(), source = f.cache.register('panel', {});source.measure(metrics());f.calls[0].resolve({value});await flush();
  expect(source.snapshot().defaultView).toEqual(view('DEFAULT'));expect(source.snapshot().override).toBeUndefined();
  f.cache.refresh('panel');source.measure(metrics());source.snapshot();expect(f.calls).toHaveLength(1);
});

it('contains rejected render errors and keeps only the latest reentrant default publication', async () => {
  let text = 'FIRST', reject = false, emissions = 0;
  const cache = createOpenTuiPublicRender({describe: () => ({site: 'status', props: {lines: [{text}]}, defaultView: view(text)}),
    render: async input => {emissions++;if (reject) throw Error('PRIVATE_RENDER_FAILURE');return {value: {tree: view(String((input.props.lines as {text: string}[])[0].text))}};}, press: () => {}});cleanup.push(() => cache.close());
  const source = cache.register('status', {});let changed = false;
  source.subscribe(() => {if (!changed) {changed = true;text = 'LATEST';cache.refresh('status');}});
  source.measure(metrics());await flush();expect(emissions).toBe(1);expect(source.snapshot().override).toEqual(view('LATEST'));
  reject = true;cache.invalidate();await flush();expect(source.snapshot().defaultView).toEqual(view('LATEST'));expect(source.snapshot().override).toBeUndefined();
  cache.refresh();source.snapshot();expect(emissions).toBe(2);expect(JSON.stringify(source.snapshot())).not.toContain('PRIVATE_');
});

it('uses the real HooksHost chain once and accepts its valid recovered tree while async render effects remain read-only', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'public-render-hooks-'));cleanup.push(() => rm(cwd, {recursive: true, force: true}));
  const host = attach(new Runtime(), {session: {id: 'public-render', cwd}}), order: string[] = [];
  const manifest = (name: string) => ({name, version: '1.0.0', trust: 'trusted' as const});
  let release!: () => void;const gate = new Promise<void>(resolve => {release = resolve;});cleanup.push(release);
  host.registerPlugin(manifest('rewrite'), {'ui.render': (event, $) => {order.push('rewrite');return $.next({...event, props: {...event.props, marker: 'REAL_CHAIN'}});}});
  host.registerPlugin(manifest('state-writer'), {'ui.render': async (_event, $) => {order.push('state');await gate;$.state.set('forbidden', true);}});
  host.registerPlugin(manifest('file-writer'), {'ui.render': async (_event, $) => {order.push('file');await gate;await $.fs.write('forbidden.txt', 'PRIVATE_EFFECT');}});
  host.registerPlugin(manifest('valid-render'), {'ui.render': event => {order.push('valid');return {tree: view(String(event.props.marker))};}});
  let emissions = 0, faults: unknown[] = [], written: unknown;
  host.registerPlugin(manifest('observer'), {'session.start': (_event, $) => {written = $.state.get('forbidden');}});
  const cache = createOpenTuiPublicRender({describe: () => ({site: 'conversation', props: {lines: [{text: 'DEFAULT'}]}, defaultView: view('DEFAULT')}),
    render: async (input, signal) => {emissions++;const result = await host.emit('ui.render', input, signal);faults = result.faults;return {value: result.value};}, press: () => {}});cleanup.push(() => cache.close());
  const source = cache.register('session', {});source.measure(metrics());await expect.poll(() => order.includes('state')).toBe(true);
  expect(source.snapshot().defaultView).toEqual(view('DEFAULT'));release();await expect.poll(() => source.snapshot().override?.lines[0].text).toBe('REAL_CHAIN');
  expect(emissions).toBe(1);expect(order).toEqual(['rewrite', 'state', 'file', 'valid']);expect(faults).toHaveLength(2);
  await host.emit('session.start', {sessionId: 'public-render', cwd, plugins: []});expect(written).toBeUndefined();
  await expect(readFile(join(cwd, 'forbidden.txt'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
});
