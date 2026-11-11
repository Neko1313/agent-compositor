import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../src/build.js';
import { ScriptedProvider } from '@agent-compositor/core';
import tools from '../../../plugins/git-review/tools.js';
import { UndoStore, type ToolContext } from '@agent-compositor/tools';

const roots: string[] = [];
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('routes real panel actions through the tool and displays denial without a provider request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-review-panel-')); roots.push(root);
  const cwd = join(root, 'project'), home = join(root, 'home');
  await mkdir(cwd); await mkdir(home);
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({
    agent: { projectContext: false, skills: false },
    permissions: { rules: [
      { tool: 'extension_control', decision: 'allow' },
      { tool: 'git_review', decision: 'deny' },
    ] },
  }));
  const provider = new ScriptedProvider([]);
  const app = await buildApp({ cwd, env: { HOME: home }, provider, agentHub: false, pluginDirs: [resolve('plugins/git-review')] });
  apps.push(app);
  const core = app.createCore(async () => false);
  const enabled = await core.invokeTool('extension_control', { action: 'enable', name: 'git-review', scope: 'project' });
  expect(enabled.ok, enabled.error).toBe(true);
  expect(await app.reloadPlugins(core)).not.toMatch(/failed|error/i);
  const surfaces: any[] = [];
  core.subscribe(event => { if (event.kind === 'catalog' && event.event === 'ui.surface') surfaces.push(event.input); });
  await core.submit('/git-review');
  expect(provider.requests).toHaveLength(0);
  expect(surfaces.at(-1)).toMatchObject({ title: 'Git review' });
  const surface = surfaces.at(-1);
  expect(surface.view.lines.filter((line: any) => line.action).map((line: any) => line.text))
    .toEqual(['Refresh status', 'Working diff', 'Staged diff', 'Configure output', 'Close']);
  await core.host.emit('ui.press', { site: surface.id, key: 'status' });
  expect(JSON.stringify(surfaces.at(-1))).toMatch(/denied/i);
});

function context(settings: unknown = {}, result: unknown = { exitCode: 0, stdout: '', stderr: '' }) {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const ctx: ToolContext = {
    cwd: '/selected', signal: controller.signal, undo: new UndoStore(),
    settings: async () => settings,
    request: async <T>(name: string, payload: unknown) => { calls.push({ name, payload }); return result as T; },
  };
  return { ctx, calls, controller };
}

it('validates runtime input/settings and never executes invalid requests', async () => {
  for (const input of [null, [], {}, { action: 'commit' }, { action: 'diff', staged: 'yes' }, { action: 'status', path: '.' }]) {
    const { ctx, calls } = context();
    expect((await tools[0].execute(ctx, input)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  }
  for (const maxChars of [0, 3999, 64001, 4000.5, '4000', null]) {
    const { ctx, calls } = context({ maxChars });
    expect(await tools[0].execute(ctx, { action: 'status' })).toMatchObject({ ok: false, error: expect.stringContaining('maxChars') });
    expect(calls).toHaveLength(0);
  }
});

it('bounds successful output, preserves empty diffs, and uses fixed safe service arguments', async () => {
  const { ctx, calls } = context({ maxChars: 4000 }, { exitCode: 0, stdout: 'x'.repeat(4100), stderr: '' });
  expect(await tools[0].execute(ctx, { action: 'diff', staged: true })).toEqual({ ok: true, data: { output: 'x'.repeat(4000), exitCode: 0, truncated: true } });
  expect(calls).toEqual([{ name: 'service.exec.run', payload: {
    plugin: 'git-review', cmd: 'git', timeoutMs: 8000, args: ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'color.ui=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all', '--cached'],
  } }]);
  expect(await tools[0].execute(context().ctx, { action: 'diff' })).toEqual({ ok: true, data: { output: '', exitCode: 0, truncated: false } });
});

it('keeps nonzero failures and cancellation truthful', async () => {
  expect(await tools[0].execute(context({}, { exitCode: 128, stdout: '', stderr: 'not a repository' }).ctx, { action: 'status' }))
    .toMatchObject({ ok: false, error: expect.stringContaining('not a repository') });
  const { ctx, calls, controller } = context(); controller.abort();
  expect(await tools[0].execute(ctx, { action: 'status' })).toMatchObject({ ok: false, error: expect.stringContaining('cancelled') });
  expect(calls).toHaveLength(0);
});
