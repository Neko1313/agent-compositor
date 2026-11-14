import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider} from '@agent-compositor/core';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture(diskTheme = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'opentui-appearance-'));cleanup.push(() => rm(cwd, {recursive: true, force: true}));
  if (diskTheme) {
    const directory = join(cwd, 'plugins', 'appearance-probe');await mkdir(directory, {recursive: true});
    await writeFile(join(directory, 'plugin.json'), JSON.stringify({name: 'appearance-probe', version: '1.0.0', trust: 'trusted', main: 'hooks.js'}));
    await writeFile(join(directory, 'hooks.js'), `export default {
      'session.start':async(_,$)=>$.ui.configure({colors:{accent:'#123456'},chrome:{borderStyle:'round'}}),
      'session.reload':async(_,$)=>$.ui.configure({colors:{muted:'#345678'},presentation:{agentLabel:'Reloaded'}})
    };`);
  }
  const provider = new ScriptedProvider([]), app = await buildApp({cwd, env: {HOME: cwd}, provider, agentHub: false,
    fixedConfig: {enabledPlugins: diskTheme ? ['appearance-probe'] : [], agent: {tools: [], builtinTools: [], controlTools: [],
      skills: false, projectContext: false, fileReferences: false, verifyCompletion: false}, compaction: {enabled: false}}});
  cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});layout.resize(160, 48);cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout);cleanup.push(() => host.close());await host.start();
  const publish = (owner: string, appearance: unknown) => host.core.host.emit('service.ui.configure', {plugin: owner, appearance});
  return {cwd, app, provider, host, layout, publish};
}

it('publishes a stable immutable partial appearance source with all fields, replacement order and trusted scope-less compatibility', async () => {
  const f = await fixture(), source = f.host.appearance;expect(source.snapshot().appearance).toEqual({});
  const snapshots: unknown[] = [], off = source.subscribe(() => snapshots.push(source.snapshot()));
  const patch = {colors: {text: '#010101', muted: 'gray', accent: 'cyanBright', success: 'green', warning: 'yellow', danger: 'red',
    border: '#020202', titleBackground: '#030303', selectionBackground: '#040404', selectionText: 'whiteBright'},
    chrome: {borderStyle: 'double', controls: 'always'},
    presentation: {userLabel: 'Operator', agentLabel: 'Worker', welcome: 'Welcome', hints: false, toolDetails: true}};
  await f.publish('host-palette', patch);expect(source.snapshot().appearance).toEqual(patch);
  expect(Object.isFrozen(source.snapshot())).toBe(true);expect(Object.isFrozen(source.snapshot().appearance.colors)).toBe(true);
  const accepted = source.snapshot();expect(source.snapshot()).toBe(accepted);
  await expect(f.publish('host-palette', {colors: {accent: '\x1b[31m'}})).rejects.toThrow();
  expect(source.snapshot()).toBe(accepted);expect(snapshots).toHaveLength(1);
  await f.publish('second', {colors: {accent: '#223344'}});
  await f.publish('host-palette', {presentation: {agentLabel: 'Latest'}});
  expect(source.snapshot().appearance).toEqual({colors: {accent: '#223344'}, presentation: {agentLabel: 'Latest'}});
  await f.publish('second', null);expect(source.snapshot().appearance).toEqual({presentation: {agentLabel: 'Latest'}});
  off();expect(f.provider.requests).toEqual([]);
});

it('acts on explicit Tools publications once, preserving workspace, focus, zoom, copies and manual placement', async () => {
  const f = await fixture();f.host.createWindow('tools');
  f.host.core.host.registerPlugin({name: 'theme-a', version: '1.0.0', trust: 'trusted'}, {});
  f.host.core.host.registerPlugin({name: 'theme-b', version: '1.0.0', trust: 'trusted'}, {});
  f.layout.act({type: 'open', id: 'tools'});f.layout.act({type: 'moveWorkspace', id: 4});
  f.layout.act({type: 'open', id: 'session'});f.layout.act({type: 'zoom'});
  const before = f.layout.snapshot(), intent = f.layout.windowIntentRevision;
  await f.publish('theme-a', {presentation: {showTools: true}});
  expect(f.layout.snapshot()).toBe(before);
  await f.publish('theme-b', {presentation: {showTools: false}});
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', fullscreen: true, locations: {'window-1': 1}});
  expect(f.layout.snapshot().locations.tools).toBeUndefined();expect(f.layout.windowIntentRevision).toBe(intent);
  await f.publish('theme-a', {presentation: {showTools: true}});
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', fullscreen: true, locations: {tools: 1, 'window-1': 1}});
  f.host.core.host.unregisterPlugin('theme-a');
  expect(f.host.appearance.snapshot().appearance.presentation?.showTools).toBe(false);
  expect(f.layout.snapshot().locations.tools).toBe(1);
  await f.publish('theme-b', null);expect(f.layout.snapshot().locations.tools).toBe(1);
  f.layout.act({type: 'open', id: 'tools'});f.layout.act({type: 'close'});
  await f.publish('unrelated', {colors: {accent: '#112233'}});expect(f.layout.snapshot().locations.tools).toBeUndefined();
  await f.publish('unrelated', {presentation: {showTools: true}});expect(f.layout.snapshot().locations.tools).toBe(1);
  f.layout.act({type: 'open', id: 'tools'});f.layout.act({type: 'close'});
  await f.publish('unrelated', {presentation: {showTools: true}});expect(f.layout.snapshot().locations.tools).toBe(1);
  expect(f.layout.snapshot().locations['window-1']).toBe(1);expect(f.provider.requests).toEqual([]);
});

it('removes only unloaded owner contributions during reload and resets all contributions on actual Core replacement', async () => {
  const f = await fixture(true), source = f.host.appearance;
  expect(source.snapshot().appearance).toEqual({colors: {accent: '#123456'}, chrome: {borderStyle: 'round'}});
  await f.publish('trusted-host', {colors: {warning: 'yellow'}});
  const observed: unknown[] = [];source.subscribe(() => observed.push(source.snapshot().appearance));
  await f.host.submit('/reload');
  expect(observed).toContainEqual({colors: {warning: 'yellow'}});
  expect(source.snapshot().appearance).toEqual({colors: {warning: 'yellow', muted: '#345678'}, presentation: {agentLabel: 'Reloaded'}});
  const old = f.host.core;await f.app.store.create(f.cwd, {id: 'appearance-next'});
  const epoch = source.snapshot().revision;
  await old.host.emit('service.session.control', {action: 'resume', id: 'appearance-next'});
  expect(f.host.core).not.toBe(old);expect(source.snapshot().revision).toBeGreaterThan(epoch);
  expect(observed).toContainEqual({});expect(source.snapshot().appearance).toEqual({colors: {accent: '#123456'}, chrome: {borderStyle: 'round'}});
  const current = source.snapshot();await old.host.emit('service.ui.configure', {plugin: 'old', appearance: {colors: {accent: '#ffffff'}}});
  expect(source.snapshot()).toBe(current);expect(f.provider.requests).toEqual([]);
});

it('rejects a publication whose captured plugin lifetime expired while an actual service interceptor was waiting', async () => {
  const f = await fixture();let entered = false, release!: () => void;const gate = new Promise<void>(done => {release = done;});cleanup.push(release);
  f.host.core.host.registerPlugin({name: 'late-theme', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (_event, $) => {await $.ui.configure({colors: {accent: '#111111'}, presentation: {showTools: true}});},
  });
  f.host.core.host.registerPlugin({name: 'appearance-interceptor', version: '1.0.0', trust: 'trusted'}, {
    'service.ui.configure': async event => {if (event.appearance?.colors?.accent === '#111111') {entered = true;await gate;}},
  });
  const pending = f.host.core.host.emit('ui.press', {site: 'theme', key: 'publish'});await expect.poll(() => entered).toBe(true);
  f.host.core.host.unregisterPlugin('late-theme');f.host.core.host.registerPlugin({name: 'late-theme', version: '2.0.0', trust: 'trusted'}, {});
  await f.publish('late-theme', {colors: {accent: '#334455'}});const current = f.host.appearance.snapshot();
  release();await pending;expect(f.host.appearance.snapshot()).toBe(current);expect(f.layout.snapshot().locations.tools).toBeUndefined();
});
