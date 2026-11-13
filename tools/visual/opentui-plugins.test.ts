import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {getEventListeners} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScriptedProvider} from '@agent-compositor/core';
import {expect, it} from 'vitest';
import {buildApp} from '../../packages/app/src/build.js';
import {seedOpenTuiPlugin} from './opentui-plugin-fixture.js';
import {connectPluginManager} from './opentui-plugins.js';

it('rejects stale and policy-denied actions, applies after queued turns, and cancels unapplied removal on disconnect', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'opentui-plugins-'));
  const home = join(cwd, 'home');
  const fixture = await seedOpenTuiPlugin(cwd, home);
  const provider = new ScriptedProvider([
    {text: 'First hold', hold: true}, {text: 'Second hold', hold: true}, {text: 'Last hold', hold: true},
    {text: 'Replacement hold', hold: true},
  ]);
  const app = await buildApp({cwd, env: {HOME: home}, agentHub: false, provider,
    fixedConfig: {enabledPlugins: ['preview-notes'], agent: {tools: [], controlTools: [], projectContext: false}}});
  const main = app.createCore(async () => false);
  const id = 'preview-notes@preview-market';
  await main.host.emit('service.marketplace.control', {action: 'add', source: fixture.catalogRoot, scope: 'project'});
  const manager = await connectPluginManager(app, main);
  const row = () => manager.snapshot().rows.find(item => item.id === id)!;
  const act = (action: 'install' | 'enable' | 'remove') => manager.act(id, action, manager.snapshot().revision);
  const settle = () => expect.poll(() => manager.snapshot().working).toBe(false);
  try {
    const firstRevision = manager.snapshot().revision;
    manager.refresh();
    await settle();
    manager.act(id, 'install', firstRevision);
    expect(manager.snapshot().working).toBe(false);
    await expect(readFile(fixture.manifest)).rejects.toMatchObject({code: 'ENOENT'});

    main.host.registerPlugin({name: 'test-management-policy', version: '1.0.0', trust: 'trusted'}, {
      'service.extension.control': event => event.action === 'install' ? {deny: 'Install denied by this policy'} : undefined,
    });
    act('install');
    await expect.poll(() => manager.snapshot().error).toContain('Install denied by this policy');
    await expect(readFile(fixture.manifest)).rejects.toMatchObject({code: 'ENOENT'});
    main.host.unregisterPlugin('test-management-policy');
    act('install');
    await settle();
    expect(row()).toMatchObject({installedVersion: '1.0.0', enabled: false});
    expect(row().loadedVersion).toBeUndefined();

    const first = manager.submit('Hold');
    await expect.poll(() => provider.requests.length).toBe(1);
    await manager.submit('Queued work');
    act('enable');
    await settle();
    expect(row()).toMatchObject({enabled: true, pending: 'reload pending'});
    expect(row().loadedVersion).toBeUndefined();
    provider.release();
    await expect.poll(() => provider.requests.length).toBe(2);
    expect(main.host.hasPlugin('preview-notes')).toBe(false);
    provider.release();
    await first;
    await expect.poll(() => row().loadedVersion).toBe('1.0.0');
    expect(row().pending).toBeUndefined();
    await manager.submit('/preview-note');
    expect(JSON.parse(await readFile(fixture.receipt, 'utf8'))).toEqual({version: '1.0.0'});

    const last = manager.submit('Another hold');
    await expect.poll(() => provider.requests.length).toBe(3);
    act('remove');
    await settle();
    expect(row()).toMatchObject({enabled: true, loadedVersion: '1.0.0', installedVersion: '1.0.0', pending: 'remove queued'});
    await manager.disconnect();
    manager.act(id, 'remove', manager.snapshot().revision);
    provider.release();
    await last;
    await app.reloadPlugins(main);
    expect(JSON.parse(await readFile(fixture.manifest, 'utf8')).version).toBe('1.0.0');
    expect(main.host.hasPlugin('preview-notes')).toBe(true);
    expect(provider.requests.flatMap(request => request.tools)).toEqual([]);

    // Replacing a queued request hands ownership to its new caller. A late
    // cancellation from the first screen must not erase the second decision.
    const firstOwner = new AbortController(), secondOwner = new AbortController();
    const queuedRemove = (signal: AbortSignal) => main.host.emit('service.extension.control',
      {action: 'remove', name: 'preview-notes', scope: 'project', signal}, signal);
    const hold = main.submit('Hold removal');
    await expect.poll(() => provider.requests.length).toBe(4);
    expect((await queuedRemove(firstOwner.signal)).value).toMatchObject({value: {queued: true}});
    expect((await queuedRemove(secondOwner.signal)).value).toMatchObject({value: {queued: true}});
    expect(getEventListeners(firstOwner.signal, 'abort')).toHaveLength(0);
    firstOwner.abort();
    provider.release();
    await hold;
    await app.reloadPlugins(main);
    expect(getEventListeners(secondOwner.signal, 'abort')).toHaveLength(0);
    await expect(readFile(fixture.manifest)).rejects.toMatchObject({code: 'ENOENT'});
  } finally {
    await manager.disconnect();
    await app.close();
    await rm(cwd, {recursive: true, force: true});
  }
});
