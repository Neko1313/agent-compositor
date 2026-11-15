import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider, type AgentCore} from '@agent-compositor/core';
import type {UiControllers, UiEditorState} from '@agent-compositor/hooks';
import type {PublicRenderSlotSource} from '@agent-compositor/renderer-opentui';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();vi.restoreAllMocks();});
const manifest = (name: string) => ({name, version: '1.0.0', trust: 'trusted' as const});
const measure = (source: PublicRenderSlotSource, columns = 61, rows = 9) => source.measure({columns, rows, visible: true, scrollOffset: 0});
async function fixture(options: {provider?: ScriptedProvider; controllers?: Partial<Record<keyof UiControllers, string>>; disk?: boolean} = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'opentui-public-host-'));cleanup.push(() => rm(cwd, {recursive: true, force: true}));
  let plugin: string | undefined;
  if (options.disk) {
    plugin = join(cwd, 'plugins', 'persistent-render');await mkdir(plugin, {recursive: true});
    await writeFile(join(plugin, 'plugin.json'), JSON.stringify({...manifest('persistent-render'), main: 'hooks.js'}));
    await writeFile(join(plugin, 'hooks.js'), 'export default {};');
  }
  const provider = options.provider ?? new ScriptedProvider([]), app = await buildApp({cwd, env: {HOME: cwd}, provider, agentHub: false,
    fixedConfig: {enabledPlugins: ['session-manager', ...(options.disk ? ['persistent-render'] : [])],
      ...(options.controllers ? {ui: {controllers: options.controllers}} : {}),
      agent: {tools: ['read', 'ask_user'], builtinTools: ['read'], controlTools: ['ask_user'], skills: false,
        projectContext: false, fileReferences: false, verifyCompletion: false},
      permissions: {rules: [{tool: 'read', decision: 'allow'}]}, compaction: {enabled: false}}});cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});layout.resize(240, 80);cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout);cleanup.push(() => host.close());await host.start();
  const calls: {core: AgentCore; input: any; signal?: AbortSignal; completion: ReturnType<AgentCore['host']['emit']>}[] = [];
  const observe = (core: AgentCore) => {
    const emit = core.host.emit.bind(core.host);
    vi.spyOn(core.host, 'emit').mockImplementation((name, input, signal, dispatchSignal) => {
      // HooksHost recursively enters emit without its explicit signal. Record
      // only the outer cache emission, keeping its actual cancellation receipt.
      const completion = emit(name, input, signal, dispatchSignal);
      if (name === 'ui.render' && signal) calls.push({core, input: structuredClone(input), signal, completion});
      return completion;
    });
  };observe(host.core);
  const focus = (id: string) => {layout.act({type: 'open', id});if (!layout.snapshot().fullscreen) layout.act({type: 'zoom'});};
  const slot = (id: string) => {const source = host.publicRender.slot(id);expect(source, 'Known public slot ' + id).toBeDefined();return source!;};
  const source = (id: string) => host.surfaces.snapshot().find(item => item.id === id)!;
  return {cwd, app, provider, plugin, host, layout, calls, observe, focus, slot, source};
}

it('bounds physically pending painter calls while superseding SDK authority and coalescing invalidations', async () => {
  const f = await fixture();
  const held: {rows: number; signal: AbortSignal; release(): void; next(): unknown; notify(): Promise<void>}[] = [];
  let retiring = false;
  f.host.core.host.registerPlugin({...manifest('held-painter'), hookTimeouts: {'ui.render': 60000}}, {'ui.render': async (event, $) => {
    if (retiring || event.props.pane !== 'session') return;
    let release!: () => void;const gate = new Promise<void>(resolve => {release = resolve;});
    const number = held.length + 1;
    held.push({rows: event.viewport!.rows, signal: $.signal, release, next: () => $.next(), notify: () => $.ui.notify('EXPIRED_RENDER_EFFECT')});
    await gate;return {tree: {lines: [{text: 'PAINTER_' + number, action: 'paint-' + number}]}};
  }});
  const source = f.slot('session');f.focus('session');
  // Real layout persistence publishes an invalidation when it settles. Drain
  // that setup work before measuring only the explicit fake-clock churn.
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  try {
    // Drive the actual Runtime's 100ms retirement window, below the painter's
    // declared budget. No hook has physically returned during this churn.
    let rows = 39;
    for (let index = 0; index < 8; index++) {
      if (index === 3 || index === 6) await f.host.core.host.emit('ui.invalidate', {site: 'conversation'});
      else {measure(source, 176, rows);rows = rows === 39 ? 40 : 39;}
      await vi.advanceTimersByTimeAsync(101);
    }
    expect(held).toHaveLength(2);
    expect(held.map(call => call.rows)).toEqual([39, 40]);
    expect(held.every(call => call.signal.aborted)).toBe(true);
    expect(source.snapshot().override).toBeUndefined();
    expect(source.snapshot().defaultView?.lines.some(line => line.text.includes('No messages'))).toBe(true);
    expect(() => held[0].next()).toThrow('Public render superseded');
    await expect(held[0].notify()).rejects.toThrow('Public render superseded');
    held[0].release();await vi.advanceTimersByTimeAsync(0);
    expect(held).toHaveLength(3);expect(held[2].rows).toBe(40);
    expect(source.snapshot().override).toBeUndefined();
    held[1].release();await vi.advanceTimersByTimeAsync(0);
    expect(source.snapshot().override).toBeUndefined();
    const painterCalls = f.calls.filter(call => call.input.props.pane === 'session');
    expect(painterCalls.map(call => call.input.viewport.rows)).toEqual([39, 40, 40]);
    const current = painterCalls[2];
    expect(painterCalls[1].signal?.aborted).toBe(true);expect(current.signal?.aborted).toBe(false);
    // Both obsolete and current emissions measured 40 rows. Await the actual
    // third dispatch, rather than assuming a timer tick completes its chain.
    held[2].release();const currentResult = await current.completion;
    expect(currentResult).toMatchObject({value: {tree: {lines: [{text: 'PAINTER_3', action: 'paint-3'}]}}, faults: []});
    expect(source.snapshot().override?.lines[0].text).toBe('PAINTER_3');
    expect(f.provider.requests).toEqual([]);
  } finally {
    retiring = true;for (const call of held) call.release();vi.useRealTimers();
  }
});

it.each(['unload', 'close'] as const)('cancels retained public dispatch on owner %s without admitting old-owner work', async stop => {
  const f = await fixture();let release!: () => void, captured!: {signal: AbortSignal; next(): unknown};let paints = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});cleanup.push(release);
  f.host.core.host.registerPlugin({...manifest('retained-painter'), hookTimeouts: {'ui.render': 60000}}, {'ui.render': async (event, $) => {
    if (event.props.pane !== 'session') return;paints++;captured = {signal: $.signal, next: () => $.next()};
    await gate;return {tree: {lines: [{text: 'RETIRED_PAINT', action: 'retired-action'}]}};
  }});
  f.focus('session');const source = f.slot('session');measure(source);
  await expect.poll(() => paints).toBe(1);
  if (stop === 'unload') f.host.core.host.unregisterPlugin('retained-painter');else await f.host.close();
  expect(captured.signal.aborted).toBe(true);expect(() => captured.next()).toThrow();
  measure(source, 70, 11);source.press('retired-action', source.snapshot().revision);
  release();await expect.poll(() => source.snapshot().override).toBeUndefined();
  expect(paints).toBe(1);expect(f.provider.requests).toEqual([]);
});

it.each(['undefined', 'invalid', 'thrown'] as const)('does not start a downstream painter after retired %s outcome', async outcome => {
  const f = await fixture(), held: {rows: number; signal: AbortSignal; release(): void}[] = [], downstream: number[] = [], publications: string[] = [];
  let effects = 0;
  f.host.core.host.registerPlugin({...manifest('returning-painter'), hookTimeouts: {'ui.render': 60000}}, {'ui.render': async (event, $) => {
    if (event.props.pane !== 'session') return;
    let release!: () => void;const gate = new Promise<void>(resolve => {release = resolve;});
    const rows = event.viewport!.rows;held.push({rows, signal: $.signal, release});await gate;
    if (rows === 10) return {tree: {lines: [{text: 'CURRENT_PAINTER'}]}};
    if (outcome === 'thrown') throw Error('Retired painter failed');
    if (outcome === 'invalid') return {unexpected: 'Not a render response'};
  }});
  f.host.core.host.registerPlugin(manifest('downstream-painter'), {'ui.render': async (event, $) => {
    if (event.props.pane !== 'session') return;downstream.push(event.viewport!.rows);
    try {await $.ui.notify('STALE_PAINTER_EFFECT');effects++;} catch {/* Rendering never gains effect authority. */}
    return {tree: {lines: [{text: 'STALE_DOWNSTREAM_PAINT'}]}};
  }}, 'append');
  f.focus('session');const source = f.slot('session');source.subscribe(() => {const text = source.snapshot().override?.lines[0].text;if (text) publications.push(text);});
  try {
    measure(source, 61, 9);await expect.poll(() => held.length).toBe(1);
    const obsolete = f.calls.find(call => call.input.props.pane === 'session' && call.input.viewport.rows === 9)!;
    measure(source, 61, 10);expect(held[0].signal.aborted).toBe(true);await expect.poll(() => held.length).toBe(2);
    held[0].release();await obsolete.completion;
    expect(downstream).toEqual([]);expect(effects).toBe(0);expect(publications).toEqual([]);
    expect(source.snapshot().override).toBeUndefined();expect(source.snapshot().defaultView?.lines.some(line => line.text.includes('No messages'))).toBe(true);
    held[1].release();const currentResult = await f.calls.find(call => call.input.props.pane === 'session' && call.input.viewport.rows === 10)!.completion;
    expect(currentResult).toMatchObject({value: {tree: {lines: [{text: 'CURRENT_PAINTER'}]}}, faults: []});
    await expect.poll(() => source.snapshot().override?.lines[0].text).toBe('CURRENT_PAINTER');
    expect(publications).toEqual(['CURRENT_PAINTER']);expect(downstream).toEqual([]);expect(f.provider.requests).toEqual([]);
  } finally {for (const call of held) call.release();}
});

it('uses all five real public sites and separate copy identities with exact measured viewport metadata and working defaults', async () => {
  const f = await fixture();let release!: () => void, held = true;
  const gate = new Promise<void>(resolve => {release = resolve;});cleanup.push(release);
  f.host.core.host.registerPlugin(manifest('public-render'), {'ui.render': async event => {
    if (held) await gate;
    return {tree: {lines: [{text: `OVERRIDE ${event.site} ${event.props.pane}`} ], input: {id: 'override-input', value: 'IGNORED_OVERRIDE_INPUT'}}};
  }});
  f.host.createWindow('session');f.host.createWindow('tools');f.host.createWindow('help');
  f.host.core.host.registerPlugin(manifest('producer'), {});
  await f.host.core.host.emit('service.ui.view', {plugin: 'producer', id: 'panel', title: 'Public producer',
    view: {input: {id: 'search', value: 'PUBLIC_FILTER', label: 'Filter'}, lines: [{text: 'PUBLIC_DEFAULT', action: 'default'}],
      tabs: [{id: 'tab', label: 'Tab', action: 'tab'}], table: {columns: [{label: 'Column'}], rows: [{id: 'row', cells: ['CELL'], action: 'row'}]}},
    placement: {focus: false}});
  f.focus('session');const source = f.slot('session'), topology = f.layout.snapshot().locations;measure(source, 43, 7);
  expect(source.snapshot().override).toBeUndefined();expect(source.snapshot().defaultView?.lines.some(line => line.text.includes('No messages'))).toBe(true);
  expect(f.calls.at(-1)?.input).toMatchObject({site: 'conversation', surface: 'terminal', viewport: {columns: 43, rows: 7}, props: {pane: 'session', title: 'Main', fieldRows: []}});
  held = false;release();await expect.poll(() => source.snapshot().override?.lines[0].text).toBe('OVERRIDE conversation session');
  const cases = [['window-1', 'conversation', 'Main 1'], ['window-2', 'tools', 'Tools 2'], ['window-3', 'help', 'Window controls 3'],
    ['plugin-producer-panel', 'plugin:producer/panel', 'Public producer']] as const;
  for (const [id, site, title] of cases) {
    f.focus(id);const port = f.slot(id), before = f.layout.snapshot().locations;measure(port, 47, 8);
    await expect.poll(() => port.snapshot().override?.lines[0].text).toBe(`OVERRIDE ${site} ${id}`);
    expect(f.calls.filter(call => call.input.props.pane === id).at(-1)?.input).toMatchObject({site, viewport: {columns: 47, rows: 8}, props: {pane: id, title}});
    expect(f.layout.snapshot().locations).toEqual(before);
  }
  const plugin = f.calls.filter(call => call.input.props.pane === 'plugin-producer-panel').at(-1)!.input;
  expect(plugin.props).toMatchObject({plugin: 'producer', surface: 'panel', lines: [{text: 'PUBLIC_DEFAULT', action: 'default'}],
    fieldRows: [{text: 'Filter: PUBLIC_FILTER', tone: 'accent'}], table: {rows: [{id: 'row'}]}, tabs: [{id: 'tab'}]});
  expect(f.source('plugin-producer-panel').snapshot().view?.input).toEqual({id: 'search', value: 'PUBLIC_FILTER', label: 'Filter'});
  expect(JSON.stringify(f.calls.map(call => call.input))).not.toContain('IGNORED_OVERRIDE_INPUT');
  const status = f.slot('status');measure(status, 80, 2);await expect.poll(() => status.snapshot().override?.lines[0].text).toBe('OVERRIDE status status');
  expect(f.calls.at(-1)?.input).toMatchObject({site: 'status', viewport: {columns: 80, rows: 2}, props: {pane: 'status', workspace: 1}});
  expect(new Set(f.calls.map(call => call.input.site))).toEqual(new Set(['conversation', 'tools', 'help', 'plugin:producer/panel', 'status']));
  expect(f.layout.snapshot().locations).toEqual(topology);expect(f.provider.requests).toEqual([]);
});

it('routes a render-only added action through the original real producer and its ordinary independent tool operation', async () => {
  const provider = new ScriptedProvider([{text: 'MAIN_WORKING', hold: true}, {text: 'Main done'}]), f = await fixture({provider});
  await writeFile(join(f.cwd, 'action.txt'), 'ACTION_RESULT');let release!: () => void, observed: any, result: unknown;
  const gate = new Promise<void>(resolve => {release = resolve;});cleanup.push(() => {release();provider.release();});
  const operations: any[] = [];f.host.core.subscribe(event => {if (event.kind === 'catalog' && event.event === 'tool.operation') operations.push(event.input);});
  f.host.core.host.registerPlugin(manifest('producer'), {'ui.press': async (event, $) => {
    if (event.site !== 'plugin-producer-panel' || event.key !== 'override-only') return;
    observed = {site: event.site, key: event.key};
    result = await $.agent.tool('read', {path: 'action.txt'});await gate;
  }});
  await f.host.core.host.emit('service.ui.view', {plugin: 'producer', id: 'panel', title: 'Actions', view: {lines: [{text: 'DEFAULT_WITHOUT_ACTION'}]}, placement: {focus: true}});
  f.host.core.host.registerPlugin(manifest('render-provider'), {'ui.render': event => event.site === 'plugin:producer/panel'
    ? {tree: {lines: [{text: 'Added action', action: 'override-only'}]}} : undefined});
  const pending = f.host.submit('Main task');await expect.poll(() => provider.requests.length).toBe(1);
  f.focus('plugin-producer-panel');const port = f.slot('plugin-producer-panel');measure(port);
  await expect.poll(() => port.snapshot().override?.lines[0].action).toBe('override-only');
  const revision = port.snapshot().revision;port.press('forged', revision);expect(observed).toBeUndefined();port.press('override-only', revision);
  await expect.poll(() => result).toMatchObject({ok: true, output: {content: 'ACTION_RESULT'}});
  expect(observed).toEqual({site: 'plugin-producer-panel', key: 'override-only'});
  expect(operations).toEqual(expect.arrayContaining([expect.objectContaining({owner: 'producer', tool: 'read', phase: 'started', operationId: expect.any(String)})]));
  expect(f.source('plugin-producer-panel').snapshot().busy).toBe(true);expect(f.host.core.getState()).toBe('running');expect(provider.requests).toHaveLength(1);
  release();await expect.poll(() => f.source('plugin-producer-panel').snapshot().busy).toBe(false);provider.release();await pending;
  expect(f.host.core.getMessages().filter(message => message.role === 'user')).toHaveLength(1);
});

it('revokes old rendered keys through appearance/invalidation/unload/reload/resume while retaining actual topology and copy IDs', async () => {
  const f = await fixture({disk: true});f.host.createWindow('session');f.host.createWindow('tools');
  f.focus('window-1');f.layout.act({type: 'moveWorkspace', id: 3});f.focus('window-2');f.layout.act({type: 'close'});f.focus('session');
  let version = 'FIRST', held = true, release!: () => void;const gate = new Promise<void>(resolve => {release = resolve;});cleanup.push(release);
  f.host.core.host.registerPlugin(manifest('transient-render'), {'ui.render': async event => {
    const text = version;if (held) await gate;return {tree: {lines: [{text: text + ' ' + event.site}]}};
  }});
  const source = f.slot('session');measure(source);await expect.poll(() => f.calls.length).toBeGreaterThan(0);const first = f.calls.at(-1)!;
  const windows = structuredClone(f.layout.snapshot().locations), views = f.layout.hostViews();
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);const topology = structuredClone((await f.app.loadLayout() as any).windows);
  held = false;version = 'APPEARANCE';await f.host.core.host.emit('service.ui.configure', {plugin: 'palette', appearance: {presentation: {welcome: 'PUBLIC_WELCOME'}}});
  await expect.poll(() => source.snapshot().override?.lines[0].text).toBe('APPEARANCE conversation');expect(first.signal?.aborted).toBe(true);
  release();await Promise.resolve();expect(source.snapshot().override?.lines[0].text).toBe('APPEARANCE conversation');
  version = 'INVALIDATED';await f.host.core.host.emit('ui.invalidate', {site: 'conversation'});await expect.poll(() => source.snapshot().override?.lines[0].text).toBe('INVALIDATED conversation');
  f.host.core.host.unregisterPlugin('transient-render');await expect.poll(() => source.snapshot().override).toBeUndefined();
  expect(source.snapshot().defaultView?.lines.some(line => line.text.includes('PUBLIC_WELCOME'))).toBe(true);
  await writeFile(join(f.plugin!, 'hooks.js'), "export default {'ui.render':e=>({tree:{lines:[{text:'RELOADED '+e.site}]}})};");
  await f.host.submit('/reload');await expect.poll(() => source.snapshot().override?.lines[0].text).toBe('RELOADED conversation');
  expect(f.layout.snapshot().locations).toEqual(windows);expect(f.layout.hostViews()).toEqual(views);
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);expect((await f.app.loadLayout() as any).windows).toEqual(topology);
  const old = f.host.core;await f.app.store.create(f.cwd, {id: 'public-render-resume'});await old.host.emit('service.session.control', {action: 'resume', id: 'public-render-resume'});
  expect(f.host.core).not.toBe(old);f.observe(f.host.core);const next = f.slot('session');expect(next).not.toBe(source);
  f.focus('session');measure(next);await expect.poll(() => next.snapshot().override?.lines[0].text).toBe('RELOADED conversation');
  const revision = next.snapshot().revision;source.measure({columns: 999, rows: 9, visible: true, scrollOffset: 0});source.press('old', source.snapshot().revision);
  await old.host.emit('ui.invalidate', {site: 'conversation'}).catch(() => {});expect(next.snapshot().revision).toBe(revision);
  expect(f.layout.snapshot().locations).toEqual(windows);expect(f.layout.hostViews()).toEqual(views);expect(f.provider.requests).toEqual([]);
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);expect((await f.app.loadLayout() as any).windows).toEqual(topology);
});

it('keeps raw idle/busy UI tool diagnostics out of public Tools and Main but admits real live Main tool details', async () => {
  const provider = new ScriptedProvider([{text: 'MAIN_WORKING', hold: true, toolCalls: [{name: 'read', args: {path: 'public-main.txt'}}]}, {text: 'Read complete'}]);
  const f = await fixture({provider});cleanup.push(() => provider.release());
  await writeFile(join(f.cwd, 'PRIVATE_UI_ARGUMENT.txt'), 'PRIVATE_UI_OUTPUT');await writeFile(join(f.cwd, 'public-main.txt'), 'PRIVATE_MAIN_RESULT');
  f.host.core.host.registerPlugin(manifest('producer'), {});
  f.host.core.host.registerPlugin(manifest('public-observer'), {'ui.render': () => undefined});
  f.layout.act({type: 'open', id: 'tools'});const tools = f.slot('tools');measure(tools);f.focus('session');const main = f.slot('session');measure(main);
  expect(await f.host.core.invokeUserTool('read', {path: 'PRIVATE_UI_ARGUMENT.txt'}, {owner: 'producer'})).toMatchObject({ok: true});
  expect(f.source('tools').snapshot().view?.lines.map(line => line.text).join('\n')).toContain('PRIVATE_UI_ARGUMENT.txt');
  f.layout.act({type: 'open', id: 'tools'});measure(tools);f.focus('session');measure(main);
  expect(JSON.stringify(f.calls.map(call => call.input))).not.toContain('PRIVATE_UI_');expect(main.snapshot().defaultView?.lines.map(line => line.text).join('\n')).not.toContain('PRIVATE_UI_');
  const operations: any[] = [];f.host.core.subscribe(event => {if (event.kind === 'catalog' && event.event === 'tool.operation') operations.push(event.input);});
  const pending = f.host.submit('Read Main file');await expect.poll(() => provider.requests.length).toBe(1);
  expect(await f.host.core.invokeUserTool('read', {path: 'PRIVATE_UI_ARGUMENT.txt'}, {owner: 'producer'})).toMatchObject({ok: true});
  expect(operations).toEqual(expect.arrayContaining([expect.objectContaining({owner: 'producer', phase: 'completed'})]));
  provider.release();await pending;f.layout.act({type: 'open', id: 'tools'});measure(tools);await f.host.core.host.emit('ui.invalidate', {site: 'tools'});
  await expect.poll(() => f.calls.some(call => call.input.site === 'tools' && JSON.stringify(call.input).includes('public-main.txt'))).toBe(true);
  expect(JSON.stringify(f.calls.map(call => call.input))).not.toMatch(/PRIVATE_UI_|PRIVATE_MAIN_RESULT/);
  expect(f.host.core.getMessages().some(message => message.content.includes('PRIVATE_UI_OUTPUT'))).toBe(true);
});

it.each([false, true])('never registers native/selected private surfaces, editor checkpoints or composer attachment as public slots (selected form %s)', async selectedForm => {
  const f = await fixture({controllers: {editor: 'selected-private', question: 'selected-private', ...(selectedForm ? {form: 'selected-private'} : {})},
    provider: new ScriptedProvider([{toolCalls: [{name: 'ask_user', args: {question: 'PRIVATE_QUESTION', options: ['PRIVATE_OPTION'], allowOther: false}}]}, {text: 'Handled'}])});
  let draft: UiEditorState = {text: '', cursor: 0}, formData: unknown;
  const factories: UiControllers = {
    editor: request => {draft = request.state as UiEditorState;return {snapshot: () => draft, preferredRows: () => 3, render: () => ({lines: [{text: 'MASKED_EDITOR'}]}),
      handle: input => {if (input.kind === 'text') draft = {text: draft.text + input.text, cursor: draft.cursor + input.text.length};}};},
    question: () => ({render: () => ({lines: [{text: 'MASKED_QUESTION'}]}), handle: () => undefined}),
    form: request => {formData = request.data;return {render: () => ({lines: [{text: 'MASKED_FORM'}]}), handle: () => undefined};},
  };
  f.host.core.host.registerPlugin(manifest('selected-private'), {}, 'user', [], factories);
  f.host.core.host.registerPlugin(manifest('producer'), {'ui.press': async (event, $) => {
    if (event.key === 'form') await $.ui.form({title: 'PRIVATE_FORM', fields: [{id: 'token', label: 'Private token', type: 'text', value: 'PRIVATE_FORM_DEFAULT'}], actions: [{id: 'save', label: 'Save'}]});
  }});
  await f.host.core.host.emit('service.ui.view', {plugin: 'producer', id: 'controls', title: 'Public controls', view: {lines: [{text: 'Open form', action: 'form'}]}, placement: {focus: false}});
  await f.host.core.host.emit('service.ui.view', {plugin: 'producer', id: 'mascot', title: 'PRIVATE_COMPOSER', view: {lines: [],
    attachment: {site: 'composer', width: 8, label: 'PRIVATE_COMPOSER'}, raster: {width: 1, height: 1, rgba: Buffer.from([1, 2, 3, 255]).toString('base64')}}});
  const editor = f.host.session.snapshot().editor!;f.host.session.editorInput!(editor.id, {kind: 'text', text: 'PRIVATE_EDITOR_DRAFT'}, editor.revision);
  await expect.poll(() => draft.text).toBe('PRIVATE_EDITOR_DRAFT');const pending = f.host.submit('Ask');
  await expect.poll(() => f.host.session.snapshot().controller?.kind).toBe('question');
  f.focus('plugin-producer-controls');const controls = f.source('plugin-producer-controls');controls.press('form', controls.snapshot().revision);
  await expect.poll(() => f.host.surfaces.snapshot().some(source => selectedForm ? source.snapshot().controller?.kind === 'form' : source.snapshot().form !== undefined)).toBe(true);
  const privateSource = f.host.surfaces.snapshot().find(source => selectedForm ? source.snapshot().controller?.kind === 'form' : source.snapshot().form !== undefined)!;
  expect(f.host.publicRender.slot(privateSource.id)).toBeUndefined();expect(f.host.publicRender.slot('plugin-producer-mascot')).toBeUndefined();
  expect(f.host.publicRender.slot('input')).toBeUndefined();expect(f.host.publicRender.slot(editor.id)).toBeUndefined();
  if (selectedForm) expect(JSON.stringify(formData)).toContain('PRIVATE_FORM_DEFAULT');
  f.focus('session');measure(f.slot('session'), 100, 30);measure(f.slot('status'), 100, 2);
  f.layout.act({type: 'open', id: 'tools'});measure(f.slot('tools'), 100, 30);await f.host.core.host.emit('ui.invalidate', {site: 'conversation'});
  expect(f.calls.length).toBeGreaterThan(0);expect(JSON.stringify(f.calls.map(call => call.input))).not.toMatch(/PRIVATE_|MASKED_|commands|capabilities|rgba/);
  f.focus(privateSource.id);if (selectedForm) privateSource.cancelController!(privateSource.snapshot().controller!.id);
  else privateSource.cancelInteraction!(privateSource.snapshot().interaction!.id);
  f.focus('session');f.host.session.cancelController!(f.host.session.snapshot().controller!.id);await pending;
});
