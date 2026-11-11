import { afterEach, expect, it } from 'vitest';
import { AgentCore, ScriptedProvider } from '@agent-compositor/core';
import type { BuiltApp } from '../src/build.js';
import { runHeadless } from '../src/headless.js';

const cores: AgentCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.close();
});

function resumedCore(provider: ConstructorParameters<typeof AgentCore>[0]['provider']) {
  const core = AgentCore.resume({ cwd: process.cwd(), provider }, [
    { type: 'prompt.submit', text: 'Previous task' },
    { type: 'assistant.text', text: 'Historical answer' },
    { type: 'turn.complete', text: 'Historical answer' },
  ]);
  cores.push(core);
  return core;
}

async function run(core: AgentCore, format: 'text' | 'json' | 'stream-json') {
  let output = '';
  const app = { createCore: () => core } as unknown as BuiltApp;
  const code = await runHeadless(app, 'Current task', format, text => { output += text; });
  const result = format === 'text' ? undefined : JSON.parse(output.trim().split('\n').at(-1)!);
  expect(output).not.toContain('Historical answer');
  return { code, output, result };
}

it.each(['text', 'json', 'stream-json'] as const)('handles interruption before output in %s', async format => {
  const core = resumedCore({
    name: 'interrupt-before-output',
    async *complete() {
      core.interrupt();
      yield { type: 'finish' as const, reason: 'stop' as const };
    },
  });
  const { code, output, result } = await run(core, format);
  expect(code).toBe(1);
  if (result) expect(result).toMatchObject({ type: 'result', response: '', error: 'Interrupted' });
  else expect(output).toBe('\nError: Interrupted\n');
});

it.each(['text', 'json', 'stream-json'] as const)('keeps completed output successful in %s', async format => {
  const core = resumedCore(new ScriptedProvider([{ text: 'Current answer' }]));
  const { code, output, result } = await run(core, format);
  expect(code).toBe(0);
  if (result) {
    expect(result).toEqual({
      type: 'result', sessionId: core.sessionId, response: 'Current answer',
      usage: { inputTokens: expect.any(Number), outputTokens: expect.any(Number) },
    });
  } else expect(output).toBe('Current answer\n');
});

it.each(['text', 'json', 'stream-json'] as const)('keeps handled host commands successful in %s', async format => {
  const core = resumedCore(new ScriptedProvider([]));
  core.host.registerPlugin({ name: 'handled-command', version: '1.0.0', trust: 'trusted' }, {
    'prompt.submit': () => ({ drop: 'handled' }),
  });
  const { code, output, result } = await run(core, format);
  expect(code).toBe(0);
  if (result) {
    expect(result).toEqual({
      type: 'result', sessionId: core.sessionId, response: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  } else expect(output).toBe('\n');
});

it('uses completed turn text even when a custom strategy does not stream it', async () => {
  const core = resumedCore(new ScriptedProvider([]));
  core.host.registerPlugin({ name: 'final-only-strategy', version: '1.0.0', trust: 'trusted' }, {
    'service.agent.run': () => ({ value: { text: 'Final strategy answer' } }),
  });
  const { code, result } = await run(core, 'json');
  expect(code).toBe(0);
  expect(result.response).toBe('Final strategy answer');
  expect(result).not.toHaveProperty('error');
});
