import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandbox } from '../../../plugins/monty/adapter.js';
import { AgentCore, ScriptedProvider } from '@agent-compositor/core';
import { buildApp } from '../src/build.js';
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temp() { const root = await mkdtemp(join(tmpdir(), 'monty-check-')); roots.push(root); return root; }

describe('Monty sandbox', () => {
  it('parent cancellation stops an active workflow task without journaling an unfinished step', async () => {
    const root = await temp();
    const provider = new ScriptedProvider([{ toolCalls: [{ name: 'workflow', args: { code: 'await task("wait for cancellation")' } }] }, { hold: true }]);
    const app = await buildApp({ cwd: root, env: { HOME: root }, provider, pluginDirs: [join(process.cwd(), 'plugins')] });
    const core = app.createCore(async () => true);
    const running = core.submit('run workflow');
    await vi.waitFor(() => expect(provider.requests).toHaveLength(2));
    core.interrupt(); await running;
    expect(core.getState()).toBe('interrupted');
    const { readdir } = await import('node:fs/promises');
    const [run] = await readdir(join(app.storage.paths.state, 'workflows'));
    expect(await readdir(join(app.storage.paths.state, 'workflows', run))).toEqual(['code.py']);
  });

  it('returns Python values, bounded print output and explicitly supplied async callbacks', async () => {
    const result = await runSandbox({ language: 'python', code: 'value = await double(number)\nprint("computed")\n{"value": value}', inputs: { number: 21 }, functions: { double: async (args: unknown[]) => Number(args[0]) * 2 } });
    expect(result).toEqual({ output: { value: 42 }, stdout: 'computed\n' });
  });

  it('does not expose host files, shell, network or unspecified functions', async () => {
    const root = await temp(); const path = join(root, 'secret'); await writeFile(path, 'private-content');
    await expect(runSandbox({ language: 'python', code: 'from pathlib import Path\nPath(target).read_text()', inputs: { target: path } })).rejects.toThrow();
    for (const code of ['import subprocess\nsubprocess.run(["id"])', 'import socket\nsocket.socket()', 'await arbitrary_host_function()']) await expect(runSandbox({ language: 'python', code })).rejects.toThrow();
    vi.stubEnv('MONTY_TEST_PRIVATE_VALUE', 'host-only-test-value');
    const value = await runSandbox({ language: 'python', code: 'import os\nos.getenv("MONTY_TEST_PRIVATE_VALUE")' }).then(result => result.output, () => 'access denied');
    expect(value).not.toBe('host-only-test-value');
  });

  it('enforces memory and output limits and rejects JavaScript', async () => {
    await expect(runSandbox({ language: 'javascript', code: 'process.exit()' })).rejects.toThrow(/python/);
    await expect(runSandbox({ language: 'python', code: '[0] * 2000000', memoryBytes: 1000000 })).rejects.toThrow(/memory|Memory/i);
    await expect(runSandbox({ language: 'python', code: 'print("x" * 100000)' })).rejects.toThrow(/cap|limit|Memory/i);
  });

  it('kills a nonterminating worker on deadline and cancels host callbacks', async () => {
    await expect(runSandbox({ language: 'python', code: 'while True:\n    pass', timeoutMs: 300 })).rejects.toThrow(/timed out|Timeout/i);
    const controller = new AbortController();
    let entered!: () => void, cancelled = false;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const running = runSandbox({ language: 'python', code: 'await wait()', functions: { wait: async (_args: unknown[], signal: AbortSignal) => {
      entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
    } } }, controller.signal);
    await ready; controller.abort();
    await expect(running).rejects.toThrow(/cancelled/); expect(cancelled).toBe(true);
    expect((await runSandbox({ language: 'python', code: '2 + 3' })).output).toBe(5);
  });

  it('fails closed without a provider and supports replacing Monty', async () => {
    const root = await temp();
    const core = new AgentCore({ cwd: root, provider: new ScriptedProvider([]) });
    await expect(core.host.emit('service.sandbox.run', { language: 'python', code: '1' })).rejects.toThrow(/No sandbox provider/);
    const app = await buildApp({ cwd: root, env: { HOME: root }, provider: new ScriptedProvider([]), pluginDirs: [join(process.cwd(), 'plugins')] });
    const installed = app.createCore(async () => false);
    expect((await installed.host.emit('service.sandbox.run', { language: 'python', code: '6 * 7' })).value).toEqual({ value: { output: 42, stdout: '' } });
    const replacement = new AgentCore({ cwd: root, provider: new ScriptedProvider([]), serviceProviders: { 'service.sandbox.run': 'other' }, plugins: [
      ...app.plugins.map(p => ({ manifest: p.manifest, hooks: p.hooks, tier: p.tier })),
      { manifest: { name: 'other', version: '1.0.0', trust: 'trusted', provides: ['service.sandbox.run'] }, hooks: { 'service.sandbox.run': () => ({ value: { output: 'replacement', stdout: '' } }) } },
    ] });
    expect((await replacement.host.emit('service.sandbox.run', { language: 'python', code: 'not even Python' })).value).toEqual({ value: { output: 'replacement', stdout: '' } });
  });
});
