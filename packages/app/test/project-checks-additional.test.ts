import { expect, it } from 'vitest';
import tools from '../../../plugins/project-checks/tools.js';
import hooks from '../../../plugins/project-checks/hooks.js';
const tool = tools[0];
function context(scripts: Record<string, unknown>, exec = { stdout: '', stderr: '', exitCode: 0 }) {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const ctx = {
    cwd: '/project', signal: controller.signal,
    resolvePath: async (path: string) => path,
    settings: async () => ({}),
    request: async (event: string, args: unknown) => {
      calls.push({ event, args });
      return event === 'service.fs.read' ? JSON.stringify({ scripts }) : exec;
    },
  };
  return { ctx: ctx as any, calls, controller };
}
it('caps script discovery truthfully and rejects unsupported script maps', async () => {
  const f = context(Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`check${i}`, 'echo ok'])));
  const result = await tool.execute(f.ctx, { action: 'list' });
  expect(result).toMatchObject({ ok: true, data: { truncated: true } });
  expect((result as any).data.scripts).toHaveLength(128);
  for (const scripts of [{ invalid: 4 }, { ['x'.repeat(49)]: 'echo no' }, { ['bad\nname']: 'echo no' }]) {
    expect((await tool.execute(context(scripts).ctx, { action: 'list' })).ok).toBe(false);
  }
});
it('describes mutability and rejects extra arguments without touching services', async () => {
  expect(tool.describe?.({ action: 'list' })).toMatchObject({ tool: 'project_check', readOnly: true });
  expect(tool.describe?.({ action: 'run', name: 'test' })).toMatchObject({ tool: 'project_check', readOnly: false, command: ['npm', 'run', '--', 'test'] });
  const f = context({ test: 'echo ok' });
  for (const args of [{ action: 'list', name: 'test' }, { action: 'run', name: 'test', cwd: '/elsewhere' }]) {
    expect((await tool.execute(f.ctx, args)).ok).toBe(false);
  }
  expect(f.calls).toEqual([]);
});
it('requires own script membership and bounds both successful streams', async () => {
  const f = context({ test: 'echo ok' }, { stdout: 'x'.repeat(15000), stderr: 'y'.repeat(2000), exitCode: 0 });
  expect((await tool.execute(f.ctx, { action: 'run', name: 'toString' })).ok).toBe(false);
  const result = await tool.execute(f.ctx, { action: 'run', name: 'test' });
  expect(result).toMatchObject({ ok: true, data: { truncated: true } });
  expect((result as any).data.stdout.length + (result as any).data.stderr.length).toBe(16000);
});
it('awaits execution settlement on cancellation rather than returning early', async () => {
  const f = context({ test: 'echo ok' });
  let settle!: () => void;
  const pending = new Promise<void>(resolve => { settle = resolve; });
  const request = f.ctx.request;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  f.ctx.request = async (event: string, args: unknown) => {
    if (event !== 'service.exec.run') return request(event, args);
    started(); await pending;
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  let finished = false;
  const work = tool.execute(f.ctx, { action: 'run', name: 'test' }).then(r => { finished = true; return r; });
  await ready; f.controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  expect(finished).toBe(false);
  settle(); expect(await work).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/i) });
});
it('ignores unrelated routes, suppresses duplicate runs and never reopens after close', async () => {
  const state = new Map(); const views: unknown[] = []; let calls = 0;
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  let signal: AbortSignal | undefined;
  const api: any = { state, ui: { view: async (...args: unknown[]) => { views.push(args); }, remove: async () => {} },
    agent: { tool: async (_name: string, _args: unknown, options: { signal: AbortSignal }) => { calls++; signal = options.signal; return pending; } } };
  api.signal = new AbortController().signal;
  api.background = () => api;
  expect(await hooks['prompt.submit']({ text: '/checks-other' }, api)).toBeUndefined();
  await hooks['ui.press']({ site: 'unrelated', key: 'command:/checks' }, api);
  expect(views).toHaveLength(0);
  await hooks['ui.press']({ site: 'plugin-project-checks-main', key: 'command:/checks' }, api);
  const work = hooks['ui.press']({ site: 'plugin-project-checks-main', key: 'run:test' }, api);
  await new Promise(resolve => setImmediate(resolve));
  await hooks['ui.press']({ site: 'plugin-project-checks-main', key: 'run:test' }, api);
  expect(calls).toBe(1);
  await hooks['ui.press']({ site: 'plugin-project-checks-main', key: 'close' }, api);
  expect(signal?.aborted).toBe(true);
  const count = views.length;
  finish({ ok: false, error: 'cancelled' }); await work;
  expect(views).toHaveLength(count);
  await hooks['prompt.submit']({ text: '/checks' }, api);
  expect(JSON.stringify(views.at(-1))).toContain('cancelled');
});
it('budgets exact names and previews together and rereads scripts for run', async () => {
  const f = context({ exact: 'x'.repeat(2000), next: 'ok' });
  f.ctx.settings = async () => ({ maxChars: 1000 });
  const listed = await tool.execute(f.ctx, { action: 'list' }) as any;
  expect(listed.data.truncated).toBe(true);
  expect(listed.data.scripts).toEqual([{ name: 'exact', command: 'x'.repeat(995) }]);
  const request = f.ctx.request;
  f.ctx.request = async (event: string, args: unknown) => event === 'service.fs.read'
    ? JSON.stringify({ scripts: { replacement: 'echo changed' } }) : request(event, args);
  expect((await tool.execute(f.ctx, { action: 'run', name: 'exact' })).ok).toBe(false);
});
it('retains settlement only, waits for cleanup and revokes writes on unload', async () => {
  for (const unload of [false, true]) {
    const state = new Map();
    const hook = new AbortController(), lifetime = new AbortController();
    const views: unknown[] = [];
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise(resolve => { finish = resolve; });
    const retained = { signal: lifetime.signal, state, ui: { view: async (...args: unknown[]) => { views.push(args); } } };
    const api: any = { ...retained, signal: hook.signal, background: () => retained,
      agent: { tool: async () => { started(); return pending; } } };
    const work = hooks['ui.press']({ site: 'plugin-project-checks-main', key: 'run:test' }, api);
    await ready;
    hook.abort();
    await new Promise(resolve => setImmediate(resolve));
    expect(state.has('active')).toBe(true);
    expect(JSON.stringify(views.at(-1))).toContain('running');
    const before = views.length;
    if (unload) lifetime.abort();
    finish({ ok: false, error: 'expired' });
    await work;
    if (unload) expect(views).toHaveLength(before);
    else {
      expect(state.has('active')).toBe(false);
      expect(JSON.stringify(views.at(-1))).toContain('hook expired');
    }
  }
});
