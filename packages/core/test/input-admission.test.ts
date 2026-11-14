import {afterEach, expect, expectTypeOf, it} from 'vitest';
import {AgentCore, ScriptedProvider, type AgentCoreOptions, type CoreInputAdmission} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';

const cores: AgentCore[] = [], releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0))release();
  for (const core of cores.splice(0))await core.close();
});
function gate() {
  let release!: () => void, enter!: () => void;
  const pending = new Promise<void>(done => {release = done;}), entered = new Promise<void>(done => {enter = done;});
  releases.push(release);
  return {entered, release, wait: () => {enter();return pending;}};
}
function fixture(options: Partial<AgentCoreOptions> = {}) {
  const provider = new ScriptedProvider([{text: 'Completed'}]), journal: SessionEvent[] = [];
  const core = new AgentCore({cwd: process.cwd(), provider, tools: [], controlTools: [],
    sessions: {create: async () => {}, append: async (_id, events) => {journal.push(...events);}}, ...options});
  cores.push(core);return {core, provider, journal};
}

it('admits before a pending prompt hook consumes the input without a model turn or committed submit event', async () => {
  const hold = gate(), events: string[] = [];
  const f = fixture({plugins: [{manifest: {name: 'local-ui', version: '1.0.0', trust: 'trusted'}, hooks: {
    'prompt.submit': async () => {await hold.wait();return {drop: 'Local form handled'};},
  }}]});
  f.core.subscribe(event => {if (event.kind === 'catalog')events.push(event.event);});
  const receipt = f.core.dispatchInput('/local-form');
  expectTypeOf(receipt.admitted).toEqualTypeOf<Promise<CoreInputAdmission>>();
  expectTypeOf<ReturnType<AgentCore['submit']>>().toEqualTypeOf<Promise<void>>();
  expectTypeOf<ReturnType<AgentCore['steer']>>().toEqualTypeOf<Promise<void>>();
  expectTypeOf<ReturnType<AgentCore['invokeCommand']>>().toEqualTypeOf<Promise<boolean>>();
  let completed = false;void receipt.completion.then(() => {completed = true;});
  expect(await receipt.admitted).toBe('submitted');await hold.entered;
  expect(completed).toBe(false);expect(events).not.toContain('prompt.submit');expect(f.provider.requests).toHaveLength(0);
  hold.release();await receipt.completion;
  expect(await receipt.admitted).toBe('submitted');expect(f.provider.requests).toHaveLength(0);
  expect(f.journal.some(event => event.type === 'prompt.dropped')).toBe(true);
});

it.each(['submit', 'steer'] as const)('admits busy %s before its notification hook finishes and preserves its original queue semantics', async intent => {
  const hold = gate(), provider = new ScriptedProvider([
    {toolCalls: [{name: 'inspect', args: {}}], hold: true}, {text: 'Main completed'}, {text: 'Queued completed'},
  ]);
  const core = fixture({provider,
    tools: [{name: 'inspect', description: 'Read-only probe', parameters: {type: 'object'},
      describe: () => ({tool: 'inspect', readOnly: true}), execute: async () => ({ok: true, data: 'Inspected'})}],
    rules: [{tool: 'inspect', decision: 'allow'}],
    plugins: [{manifest: {name: 'notifications', version: '1.0.0', trust: 'trusted'},
      hooks: {[intent === 'submit' ? 'prompt.queued' : 'prompt.steer']: () => hold.wait()}}],
  }).core;
  const main = core.dispatchInput('Main');expect(await main.admitted).toBe('submitted');
  await expect.poll(() => provider.requests.length).toBe(1);
  const next = core.dispatchInput('Follow-up', intent);let completed = false;void next.completion.then(() => {completed = true;});
  expect(await next.admitted).toBe(intent === 'submit' ? 'queued' : 'steered');await hold.entered;
  expect(completed).toBe(false);expect(provider.requests).toHaveLength(1);
  hold.release();await next.completion;provider.release();await main.completion;
  expect(provider.requests).toHaveLength(intent === 'submit' ? 3 : 2);
  expect(provider.requests[intent === 'submit' ? 2 : 1].messages.some(message => message.role === 'user' && message.content === 'Follow-up')).toBe(true);
});

it('reports idle steering as a submitted turn', async () => {
  const f = fixture(), receipt = f.core.dispatchInput('Start from idle', 'steer');
  expect(await receipt.admitted).toBe('submitted');await receipt.completion;
  expect(f.provider.requests).toHaveLength(1);
});

it.each(['preparation', 'provider'] as const)('keeps admission accepted when %s fails later', async stage => {
  const provider = new ScriptedProvider([{error: 'Provider unavailable', finish: 'error'}]);
  const core = fixture({provider, ...(stage === 'preparation' ? {preparePrompt: async () => {throw Error('Preparation unavailable');}} : {})}).core;
  const receipt = core.dispatchInput('Accepted task');expect(await receipt.admitted).toBe('submitted');
  await receipt.completion;expect(await receipt.admitted).toBe('submitted');
  expect(core.failure).toContain(stage === 'preparation' ? 'Preparation unavailable' : 'Provider unavailable');
});

it('distinguishes a newly failed journal after admission from a previously failed journal before ownership', async () => {
  const core = fixture({sessions: {create: async () => {}, append: async () => {throw Error('Storage unavailable');}}}).core;
  const first = core.dispatchInput('First');expect(await first.admitted).toBe('submitted');await first.completion;
  const next = core.dispatchInput('Never owned');expect(await next.admitted).toBe(false);await next.completion;
  expect(core.failure).toContain('Storage unavailable');
});

it('admits immediate commands before their handler finishes but rejects capacity and length before ownership', async () => {
  const hold = gate();let started = 0;
  const f = fixture({userCommands: () => [{name: '/control', plugin: 'controls'}],
    plugins: [{manifest: {name: 'controls', version: '1.0.0', trust: 'trusted'}, hooks: {
      'command.invoke': async () => {started++;await hold.wait();},
    }}]});
  const commands = Array.from({length: 4}, () => f.core.dispatchInput('/control'));
  expect(await Promise.all(commands.map(receipt => receipt.admitted))).toEqual(['command', 'command', 'command', 'command']);
  await expect.poll(() => started).toBe(4);
  const full = f.core.dispatchInput('/control');expect(await full.admitted).toBe(false);
  await expect(full.completion).rejects.toThrow('Four immediate commands');
  const oversized = f.core.dispatchInput('/control ' + 'x'.repeat(64000));expect(await oversized.admitted).toBe(false);
  await expect(oversized.completion).rejects.toThrow('64000');
  hold.release();await Promise.all(commands.map(receipt => receipt.completion));expect(f.provider.requests).toHaveLength(0);
});

it('keeps an accepted command failure separate and observes rejection when a caller only reads admission', async () => {
  const core = fixture({userCommands: () => [{name: '/fail', plugin: 'controls'}],
    plugins: [{manifest: {name: 'controls', version: '1.0.0', trust: 'trusted'}, hooks: {
      'command.invoke': () => {throw Error('Handler failed');},
    }}]}).core;
  const receipt = core.dispatchInput('/fail');expect(await receipt.admitted).toBe('command');
  await expect(receipt.completion).rejects.toThrow('Handler failed');expect(await receipt.admitted).toBe('command');
  expect(await core.dispatchInput('/fail').admitted).toBe('command');
  await new Promise<void>(done => setImmediate(done));
});

it.each(['submit', 'steer'] as const)('settles %s cancelled during a lifecycle reset without claiming ownership', async intent => {
  const hold = gate(), f = fixture({plugins: [{manifest: {name: 'lifecycle', version: '1.0.0', trust: 'trusted'},
    hooks: {'session.end': () => hold.wait()}}]});
  f.core.clear();await hold.entered;
  const receipt = f.core.dispatchInput('Cancelled while waiting', intent);let admission: CoreInputAdmission | undefined;
  void receipt.admitted.then(value => {admission = value;});await Promise.resolve();expect(admission).toBeUndefined();
  f.core.interrupt();hold.release();expect(await receipt.admitted).toBe(false);await receipt.completion;
  expect(f.provider.requests).toHaveLength(0);
});

it('admits after an uncancelled lifecycle reset finishes', async () => {
  const hold = gate(), f = fixture({plugins: [{manifest: {name: 'lifecycle', version: '1.0.0', trust: 'trusted'},
    hooks: {'session.end': () => hold.wait()}}]});
  f.core.clear();await hold.entered;const receipt = f.core.dispatchInput('After reset');
  hold.release();expect(await receipt.admitted).toBe('submitted');await receipt.completion;
  expect(f.provider.requests).toHaveLength(1);
});

it.each(['submit', 'steer'] as const)('rejects %s on a closed Core before admission and retains its completion error', async intent => {
  const f = fixture();await f.core.close();const receipt = f.core.dispatchInput('Closed', intent);
  expect(await receipt.admitted).toBe(false);await expect(receipt.completion).rejects.toThrow('Session is closed');
  expect(f.provider.requests).toHaveLength(0);
});
