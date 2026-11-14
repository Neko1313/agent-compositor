import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parse as parseJsonc} from 'jsonc-parser';
import {ScriptedProvider} from '@agent-compositor/core';
import type {UiControllerFactory} from '@agent-compositor/hooks';
import type {ControllerInput, UiSurfaceSource} from '@agent-compositor/renderer-opentui';
import {buildApp} from '../src/build.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import type {AppUiControllerData} from '../src/controller-contracts.js';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse())await close();});
function gate() {
  let release!: () => void, entered = false;const promise = new Promise<void>(resolve => {release = resolve;});cleanup.push(release);
  return {release, entered: () => entered, async wait(signal?: AbortSignal) {
    entered = true;if (!signal) {await promise;return;}
    let abort!: () => void;
    try {await Promise.race([promise, new Promise<never>((_resolve, reject) => {abort = () => reject(Error('Gate cancelled'));signal.addEventListener('abort', abort, {once: true});if (signal.aborted)abort();})]);}
    finally {signal.removeEventListener('abort', abort);}
  }};
}
const alpha = 'plugin-placement-targets-alpha', beta = 'plugin-placement-targets-beta';
async function fixture(factory: UiControllerFactory) {
  const root = await mkdtemp(join(tmpdir(), 'opentui-placement-integration-'));cleanup.push(() => rm(root, {recursive: true, force: true}));
  const cwd = join(root, 'project'), home = join(root, 'home');await mkdir(cwd);await mkdir(home);
  const config = join(cwd, 'agent-compositor.json');
  await writeFile(config, JSON.stringify({enabledPlugins: ['session-manager'], ui: {controllers: {placement: 'placement-provider'}},
    agent: {skills: false, projectContext: false, fileReferences: false, verifyCompletion: false}, compaction: {enabled: false}}));
  const provider = new ScriptedProvider([]), app = await buildApp({cwd, env: {HOME: home, AGENT_HOME: join(home, '.agent-compositor')}, provider, agentHub: false});cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});layout.resize(160, 48);cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout);cleanup.push(() => host.close());
  host.core.host.registerPlugin({name: 'placement-provider', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {placement: factory});
  host.core.host.registerPlugin({name: 'placement-targets', version: '1.0.0', trust: 'trusted'}, {});
  await host.start();
  const find = (id: string) => host.surfaces.snapshot().find(source => source.id === id);
  const publish = (id: string) => host.core.host.emit('service.ui.view', {plugin: 'placement-targets', id, title: 'Target ' + id,
    view: {lines: [{text: 'READY_' + id}]}, placement: {workspace: 1, focus: false}});
  await publish('alpha');await publish('beta');
  const open = async () => {await host.submit('/placement');await expect.poll(() => find('host-placement')?.snapshot().controller?.kind).toBe('placement');await expect.poll(() => find('host-placement')?.snapshot().busy).toBe(false);return find('host-placement')!;};
  const input = (source: UiSurfaceSource, value: ControllerInput) => {
    const frame = source.snapshot().controller!;return source.controllerInput!(frame.id, value, frame.revision);
  };
  const action = async (source: UiSurfaceSource, name: string) => {
    const ticket = input(source, {kind: 'action', action: name});expect(ticket).toBeTypeOf('number');
    await expect.poll(() => source.snapshot().controller?.inputRevision).toBe(ticket);
    await expect.poll(() => source.snapshot().busy).toBe(false);
  };
  return {app, host, layout, provider, config, rules: join(cwd, '.agent-compositor', 'agent-compositor.jsonc'), find, open, input, action, publish,
    remove: (id: string) => host.core.host.emit('service.ui.remove', {plugin: 'placement-targets', id}),
  };
}
function controller(actions: string[], handle: (action: string, data: AppUiControllerData['placement']) => unknown | Promise<unknown>): UiControllerFactory {
  return ({data}) => ({render: () => ({lines: actions.map(action => ({text: action, action}))}),
    handle: input => input.kind === 'action' ? handle(input.action, data as AppUiControllerData['placement']) : undefined,
  });
}

it('applies and saves selected placements through real Core capabilities without entering the model', async () => {
  let catalog: unknown, anchors: unknown;
  const f = await fixture(controller(['apply', 'save'], async (action, data) => {
    catalog = data.windows();anchors = data.anchors();
    await data.apply(alpha, {site: 'sidebar', workspace: action === 'save' ? 3 : 2, size: action === 'save' ? .4 : .35, relativeTo: 'session', focus: false}, action === 'save');
  }));
  const source = await f.open();await f.action(source, 'apply');
  expect(catalog).toEqual(expect.arrayContaining([expect.objectContaining({id: alpha, plugin: 'placement-targets', surface: 'alpha'}), expect.objectContaining({id: beta})]));
  expect(anchors).toEqual(expect.arrayContaining(['session', alpha, beta]));
  expect(f.layout.snapshot().locations[alpha]).toBe(2);expect(f.layout.snapshot().focused).toBe('host-placement');
  await expect(readFile(f.rules, 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  await f.action(source, 'save');expect(f.layout.snapshot().locations[alpha]).toBe(3);
  expect(parseJsonc(await readFile(f.rules, 'utf8')).ui.rules).toEqual([{site: 'sidebar', workspace: 3, size: .4, relativeTo: 'session', focus: false, match: {plugin: 'placement-targets', surface: 'alpha'}}]);
  expect(f.provider.requests).toHaveLength(0);expect(f.host.core.getMessages().some(message => message.role === 'user')).toBe(false);
});

it('rejects invalid workspaces, self-neighbors and removed targets without changing layout or persisted rules', async () => {
  const results: boolean[] = [];
  const f = await fixture(controller(['workspace', 'neighbor', 'removed'], async (action, data) => {
    try {await data.apply(action === 'removed' ? beta : alpha, action === 'workspace' ? {workspace: 10} : action === 'neighbor' ? {workspace: 2, relativeTo: alpha} : {workspace: 2}, true);results.push(true);} catch {results.push(false);}
  }));
  const source = await f.open(), before = await readFile(f.config, 'utf8');
  await f.action(source, 'workspace');await f.action(source, 'neighbor');await f.remove('beta');await f.action(source, 'removed');
  expect(results).toEqual([false, false, false]);expect(f.layout.snapshot().locations[alpha]).toBe(1);expect(f.layout.snapshot().locations[beta]).toBeUndefined();
  expect(await readFile(f.config, 'utf8')).toBe(before);expect(f.provider.requests).toHaveLength(0);
  await expect(readFile(f.rules, 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
});

it.each(['target', 'neighbor', 'neighbor-replaced'] as const)('rechecks the %s after a deferred real Save before mutating live geometry', async kind => {
  let accepted: boolean | undefined;
  const f = await fixture(controller(['save'], async (_action, data) => {
    try {await data.apply(alpha, {workspace: 3, relativeTo: beta, focus: true}, true);accepted = true;} catch {accepted = false;}
  }));
  const pending = gate(), save = f.app.savePlacement;
  f.app.savePlacement = async rule => {await pending.wait();return save(rule);};
  const source = await f.open();f.input(source, {kind: 'action', action: 'save'});await expect.poll(pending.entered).toBe(true);
  await f.remove(kind === 'target' ? 'alpha' : 'beta');
  if (kind === 'target')await f.publish('alpha');
  if (kind === 'neighbor-replaced')await f.publish('beta');
  pending.release();await expect.poll(() => accepted).toBe(false);
  expect(f.layout.snapshot().locations[alpha]).toBe(1);expect(f.layout.snapshot().focused).toBe('host-placement');
  expect(parseJsonc(await readFile(f.rules, 'utf8')).ui.rules).toEqual([expect.objectContaining({workspace: 3, relativeTo: beta})]);
});

it('admits created Main, Tools and Help neighbors without turning host views or retained unknown IDs into plugin targets', async () => {
  let relativeTo = '', accepted: boolean | undefined, anchors: string[] = [], targets: string[] = [];
  const f = await fixture(controller(['apply'], async (_action, data) => {
    anchors = data.anchors();targets = data.windows().map(window => window.id);
    try {await data.apply(alpha, {workspace: 1, site: 'inspector', size: .35, relativeTo, focus: false});accepted = true;}
    catch {accepted = false;}
  }));
  f.layout.resize(2000, 400);
  for (const kind of ['session', 'tools', 'help'] as const) expect(f.host.createWindow(kind)).toBe(true);
  f.layout.register({id: 'window-999', label: 'Retained only'});f.layout.detach('window-999');
  const original = f.find(alpha), source = await f.open();
  for (const id of ['window-1', 'window-2', 'window-3']) {
    relativeTo = id;accepted = undefined;await f.action(source, 'apply');expect(accepted).toBe(true);
    const frames = f.layout.snapshot().frames, target = frames.find(frame => frame.surface === alpha)!, neighbor = frames.find(frame => frame.surface === id)!;
    expect(target).toMatchObject({x: neighbor.x, width: neighbor.width});expect(target.y).toBe(neighbor.y + neighbor.height);
    expect(f.find(alpha)).toBe(original);expect(f.layout.snapshot().focused).toBe('host-placement');
  }
  expect(anchors).toEqual(expect.arrayContaining(['session', 'tools', 'window-1', 'window-2', 'window-3', alpha, beta]));
  expect(anchors).not.toContain('window-999');expect(targets).toEqual([alpha, beta]);
  for (const invalid of [alpha, 'window-999']) {relativeTo = invalid;await f.action(source, 'apply');expect(accepted).toBe(false);}
  expect(f.provider.requests).toHaveLength(0);
});

it('rejects a known Main-copy neighbor withdrawn during Save without applying geometry after the write', async () => {
  let accepted: boolean | undefined;
  const f = await fixture(controller(['save'], async (_action, data) => {
    try {await data.apply(alpha, {workspace: 3, relativeTo: 'window-1', focus: true}, true);accepted = true;}
    catch {accepted = false;}
  }));
  f.host.createWindow('session');
  const pending = gate(), save = f.app.savePlacement;f.app.savePlacement = async rule => {await pending.wait();return save(rule);};
  const source = await f.open();f.input(source, {kind: 'action', action: 'save'});await expect.poll(pending.entered).toBe(true);
  f.layout.forget('window-1');pending.release();await expect.poll(() => accepted).toBe(false);
  expect(f.layout.snapshot().locations[alpha]).toBe(1);expect(f.layout.snapshot().focused).toBe('host-placement');
  expect(parseJsonc(await readFile(f.rules, 'utf8')).ui.rules).toEqual([expect.objectContaining({workspace: 3, relativeTo: 'window-1'})]);
});

it('keeps a saved move passive after newer Main or workspace intent while preserving fresh Apply focus', async () => {
  const f = await fixture(controller(['save', 'apply'], async (action, data) => {
    await data.apply(alpha, {workspace: action === 'save' ? 4 : 5, relativeTo: 'session', focus: true}, action === 'save');
  }));
  const pending = gate(), save = f.app.savePlacement;f.app.savePlacement = async rule => {await pending.wait();return save(rule);};
  const source = await f.open();f.input(source, {kind: 'action', action: 'save'});await expect.poll(pending.entered).toBe(true);
  f.layout.act({type: 'open', id: 'session'});f.layout.act({type: 'workspace', id: 2});pending.release();
  await expect.poll(() => f.layout.snapshot().locations[alpha]).toBe(4);expect(f.layout.snapshot().workspace).toBe(2);expect(f.layout.snapshot().focused).not.toBe(alpha);
  expect(await f.open()).toBe(source);await f.action(source, 'apply');expect(f.layout.snapshot().workspace).toBe(5);expect(f.layout.snapshot().focused).toBe(alpha);
});

it('retains a hidden placement lease but disposes a cancelled pending apply and its escaped capability', async () => {
  let created = 0, disposed = 0, data!: AppUiControllerData['placement'], continued = false;
  const pending = gate();
  const f = await fixture((request, context) => {
    created++;data = request.data as typeof data;let text = '';
    return {render: () => ({lines: [{text: 'State ' + text}, {text: 'Apply', action: 'apply'}]}), handle: async input => {
      if (input.kind === 'text')text += input.text;
      if (input.kind === 'action') {await pending.wait(context.signal);await data.apply(alpha, {workspace: 5, focus: true});continued = true;}
    }, dispose: () => {disposed++;}};
  });
  const source = await f.open(), first = source.snapshot().controller!;
  f.input(source, {kind: 'text', text: 'retained'});await expect.poll(() => source.snapshot().controller?.inputRevision).toBe(1);
  f.layout.act({type: 'close'});expect(f.layout.snapshot().locations['host-placement']).toBeUndefined();expect(disposed).toBe(0);
  expect(f.input(source, {kind: 'text', text: 'hidden'})).toBeUndefined();expect(await f.open()).toBe(source);
  expect(source.snapshot().controller?.id).toBe(first.id);expect(source.snapshot().controller?.view.lines[0].text).toBe('State retained');expect(created).toBe(1);
  f.input(source, {kind: 'action', action: 'apply'});await expect.poll(pending.entered).toBe(true);
  source.cancelController!(source.snapshot().controller!.id);pending.release();await expect.poll(() => f.find('host-placement')).toBeUndefined();
  expect(disposed).toBe(1);expect(continued).toBe(false);expect(f.layout.snapshot().locations[alpha]).toBe(1);
  expect(() => data.apply(alpha, {workspace: 5})).toThrow();expect(source.controllerInput!(first.id, {kind: 'text', text: 'stale'}, first.revision)).toBeUndefined();
});

it('cancels a selected placement input waiting behind four actual UI operations and releases the capacity cleanly', async () => {
  let handled = 0;
  const f = await fixture(controller(['apply'], async (_action, data) => {handled++;await data.apply(alpha, {workspace: 2, focus: false});}));
  const source = await f.open(), held = gate();let entered = 0;
  f.host.core.host.registerPlugin({name: 'placement-holders', version: '1.0.0', trust: 'trusted', hookTimeouts: {'ui.press': 15000}}, {
    'ui.press': async (_event, $) => {entered++;await held.wait($.signal);},
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'placement-holders', id: 'controls', title: 'Held controls',
    view: {lines: Array.from({length: 4}, (_, index) => ({text: 'Hold ' + index, action: String(index)}))}, placement: {focus: false}});
  const controls = f.find('plugin-placement-holders-controls')!;
  for (let index = 0; index < 4; index++)controls.press(String(index), controls.snapshot().revision);
  await expect.poll(() => entered).toBe(4);f.layout.act({type: 'open', id: 'host-placement'});
  const ticket = f.input(source, {kind: 'action', action: 'apply'});expect(ticket).toBe(1);await Promise.resolve();
  expect(handled).toBe(0);expect(source.snapshot().controller?.inputRevision).toBe(0);
  source.cancelController!(source.snapshot().controller!.id);held.release();await expect.poll(() => controls.snapshot().busy).toBe(false);
  expect(handled).toBe(0);expect(f.layout.snapshot().locations[alpha]).toBe(1);
  const replacement = await f.open();await f.action(replacement, 'apply');expect(handled).toBe(1);expect(f.layout.snapshot().locations[alpha]).toBe(2);
});

it('revokes the actual selected provider and fails closed on a later placement open without native forms', async () => {
  const f = await fixture(controller(['apply'], async (_action, data) => {await data.apply(alpha, {workspace: 2});}));
  const source = await f.open(), frame = source.snapshot().controller!;f.host.core.host.unregisterPlugin('placement-provider');
  expect(f.find('host-placement')).toBeUndefined();expect(source.controllerInput!(frame.id, {kind: 'action', action: 'apply'}, frame.revision)).toBeUndefined();
  await f.host.submit('/placement');await expect.poll(() => f.host.session.snapshot().notice).toBe('Selected placement controller is unavailable');
  expect(f.find('host-placement')).toBeUndefined();expect(f.host.surfaces.snapshot().some(source => source.snapshot().form)).toBe(false);expect(f.layout.snapshot().locations[alpha]).toBe(1);
});
