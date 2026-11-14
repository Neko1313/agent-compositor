import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore, ScriptedProvider, type AgentTurnContext, type ModelProvider} from '@agent-compositor/core';
import {connectConversation} from '../src/opentui-conversation.js';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function directory() {const cwd = await mkdtemp(join(tmpdir(), 'opentui-tool-rows-'));cleanup.push(() => rm(cwd, {recursive: true, force: true}));return cwd;}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

it('projects canonical Main call chronology and live status with bounded arguments, without any result body', async () => {
  const cwd = await directory();let release!: () => void, entered = false;const gate = new Promise<void>(done => {release = done;});
  const args = {detail: 'PUBLIC_ARGS_' + '😀'.repeat(5000)};
  const core = new AgentCore({cwd, provider: new ScriptedProvider([{text: 'Planning', toolCalls: [{name: 'slow', args}]}, {text: 'Done'}]),
    tools: [{name: 'slow', description: 'Held ordinary tool', parameters: {type: 'object'}, describe: () => ({tool: 'slow'}),
      execute: async () => {entered = true;await gate;return {ok: true, data: 'PRIVATE_RESULT_BODY'};}},
      {name: 'ui-probe', description: 'Independent UI tool', parameters: {type: 'object'}, describe: () => ({tool: 'ui-probe'}),
        execute: async () => ({ok: true, data: 'PRIVATE_UI_RESULT'})}],
    rules: [{tool: 'slow', decision: 'allow'}, {tool: 'ui-probe', decision: 'allow'}]});cleanup.push(() => core.close());
  core.host.registerPlugin({name: 'ui-owner', version: '1.0.0', trust: 'trusted'}, {});
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());
  cleanup.push(release);
  const pending = core.submit('One task');await expect.poll(() => entered).toBe(true);
  const during = session.snapshot().messages;
  expect(during.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
  expect(during.at(-1)).toMatchObject({role: 'tool', tool: {callId: core.getMessages().find(message => message.toolCalls)?.toolCalls?.[0].id, name: 'slow', state: 'running'}});
  const serialized = during.at(-1)!;expect(serialized.role).toBe('tool');
  if (serialized.role === 'tool') {expect(serialized.tool.args!.length).toBeLessThanOrEqual(8000);expect(serialized.tool.args).toContain('arguments truncated');expect(serialized.tool.args).not.toMatch(/[\uD800-\uDBFF]…/);}
  expect(await core.invokeUserTool('ui-probe', {detail: 'PRIVATE_BUSY_UI_ARGUMENT'}, {owner: 'ui-owner'})).toMatchObject({ok: true});
  expect(session.snapshot().messages).toEqual(during);
  release();await pending;
  expect(session.snapshot().messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  expect(session.snapshot().messages[2]).toMatchObject({tool: {state: 'done'}});
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_RESULT_BODY');
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_BUSY_UI_ARGUMENT');
});

it('shows a live failed Main tool status without copying its private error/result text', async () => {
  const core = new AgentCore({cwd: await directory(), provider: new ScriptedProvider([{toolCalls: [{name: 'probe', args: {mode: 'public'}}]}, {text: 'Failure handled'}]),
    tools: [{name: 'probe', description: 'Controlled failure', parameters: {type: 'object'}, describe: () => ({tool: 'probe'}),
      execute: async () => ({ok: false, error: 'PRIVATE_TOOL_ERROR'})}], rules: [{tool: 'probe', decision: 'allow'}]});cleanup.push(() => core.close());
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Run probe');
  expect(session.snapshot().messages.find(message => message.role === 'tool')).toMatchObject({text: '', tool: {state: 'error'}});
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_TOOL_ERROR');
});

it('omits historical Main and idle UI calls whose provenance is unknown to this binding', async () => {
  const core = AgentCore.resume({cwd: await directory(), provider: new ScriptedProvider([])}, [
    {type: 'prompt.submit', text: 'Saved task'},
    {type: 'tool.call', callId: 'read-1', tool: 'read', input: {path: 'public.txt'}},
    {type: 'tool.result', callId: 'read-1', tool: 'read', ok: false, error: 'PRIVATE_READ_RESULT'},
    {type: 'tool.call', callId: 'custom-1', tool: 'custom', input: {mode: 'PRIVATE_HISTORICAL_IDLE_UI_ARGUMENT'}},
    {type: 'tool.result', callId: 'custom-1', tool: 'custom', ok: false, error: 'PRIVATE_CUSTOM_RESULT'},
    {type: 'tool.call', callId: 'question-1', tool: 'ask_user', input: {question: 'PRIVATE_QUESTION_REQUEST', options: ['PRIVATE_CHOICE']}},
    {type: 'tool.result', callId: 'question-1', tool: 'ask_user', ok: true, output: {answer: 'PRIVATE_ANSWER'}},
    {type: 'tool.call', callId: 'questions-1', tool: 'ask_questions', input: {questions: [{question: 'PRIVATE_QUESTIONNAIRE'}]}},
    {type: 'tool.result', callId: 'questions-1', tool: 'ask_questions', ok: true, output: {answers: ['PRIVATE_STRUCTURED_ANSWER']}},
    {type: 'tool.call', operationId: 'private-operation', callId: 'private-1', tool: 'exec', input: {command: 'PRIVATE_UI_OPERATION'}},
    {type: 'tool.result', operationId: 'private-operation', callId: 'private-1', tool: 'exec', ok: true, output: 'PRIVATE_UI_OUTPUT'},
    {type: 'assistant.text', turnId: 'saved', text: 'Saved reply'}, {type: 'turn.complete', turnId: 'saved', text: 'Saved reply'},
  ]);cleanup.push(() => core.close());
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());
  expect(session.snapshot().messages).toEqual([{role: 'user', text: 'Saved task'}, {role: 'assistant', text: 'Saved reply'}]);
  expect(JSON.stringify(session.snapshot())).not.toMatch(/PRIVATE_(READ|CUSTOM|QUESTION|CHOICE|ANSWER|STRUCTURED|UI)/);
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_HISTORICAL_IDLE_UI_ARGUMENT');
  await core.submit('Refresh history');
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toEqual([]);
});

it('keeps a real foreground UI tool invocation out of the Main transcript', async () => {
  let executed = false;
  const core = new AgentCore({cwd: await directory(), provider: new ScriptedProvider([]),
    tools: [{name: 'probe', description: 'Interface tool', parameters: {type: 'object'}, describe: () => ({tool: 'probe'}),
      execute: async () => {executed = true;return {ok: true, data: 'PRIVATE_UI_OUTPUT'};}}], rules: [{tool: 'probe', decision: 'allow'}]});cleanup.push(() => core.close());
  core.host.registerPlugin({name: 'ui-owner', version: '1.0.0', trust: 'trusted'}, {});
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());
  const result = await core.invokeUserTool('probe', {value: 'PRIVATE_UI_ARGUMENT'}, {owner: 'ui-owner'});
  expect(result.ok).toBe(true);expect(executed).toBe(true);expect(session.snapshot().messages).toEqual([]);
  expect(core.getMessages().some(message => message.toolCalls?.some(call => call.name === 'probe'))).toBe(true);
  await core.invokeTool('probe', {value: 'PRIVATE_DIRECT_ARGUMENT'});
  expect(session.snapshot().messages).toEqual([]);
});

it('admits only the live Main occurrence when a provider reuses a historical private tool ID', async () => {
  let reusedId = '';
  const scripted = new ScriptedProvider([{toolCalls: [{name: 'probe', args: {value: 'PUBLIC_LIVE_ARGUMENT'}}]}, {text: 'Done'}, {text: 'Refreshed'}]);
  const provider: ModelProvider = {name: 'reused-id', async *complete(request) {
    for await (const event of scripted.complete(request)) yield event.type === 'tool_call' ? {...event, id: reusedId} : event;
  }};
  const core = new AgentCore({cwd: await directory(), provider,
    tools: [{name: 'probe', description: 'Probe', parameters: {type: 'object'}, describe: () => ({tool: 'probe'}),
      execute: async () => ({ok: true, data: 'PRIVATE_RESULT'})}], rules: [{tool: 'probe', decision: 'allow'}]});cleanup.push(() => core.close());
  core.host.registerPlugin({name: 'ui-owner', version: '1.0.0', trust: 'trusted'}, {});
  expect((await core.invokeUserTool('probe', {value: 'PRIVATE_HISTORICAL_UI_ARGUMENT'}, {owner: 'ui-owner'})).ok).toBe(true);
  reusedId = core.getMessages().find(message => message.toolCalls)?.toolCalls?.[0].id ?? '';
  expect(reusedId).not.toBe('');
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());
  expect(session.snapshot().messages).toEqual([]);
  await core.submit('Run Main probe');
  expect(core.getMessages().flatMap(message => message.toolCalls ?? []).filter(call => call.id === reusedId)).toHaveLength(2);
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toEqual([
    {role: 'tool', text: '', tool: {callId: reusedId, name: 'probe', args: '{"value":"PUBLIC_LIVE_ARGUMENT"}', state: 'done'}},
  ]);
  await core.submit('Refresh');
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toHaveLength(1);
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_');
  session.disconnect();
  const replacement = connectConversation(core, 'Main');cleanup.push(() => replacement.disconnect());
  expect(replacement.snapshot().messages.filter(message => message.role === 'tool')).toEqual([]);
});

it('does not promote a result-only call or historical call with the same ID', async () => {
  const core = AgentCore.resume({cwd: await directory(), provider: new ScriptedProvider([
    {toolCalls: [{name: 'probe', args: {value: 'UNEXECUTED_MAIN_ARGUMENT'}}]}, {text: 'Handled'},
  ]), tools: [{name: 'probe', description: 'Never scheduled', parameters: {type: 'object'}, describe: () => ({tool: 'probe'}),
    execute: async () => {throw Error('Must not execute');}}], plugins: [{
      manifest: {name: 'no-schedule', version: '1.0.0', trust: 'trusted'},
      hooks: {'service.agent.batch': () => ({value: true})},
    }]}, [
    {type: 'tool.call', callId: 'call_1_0', tool: 'probe', input: {value: 'PRIVATE_HISTORICAL_ARGUMENT'}},
    {type: 'tool.result', callId: 'call_1_0', tool: 'probe', ok: true, output: 'PRIVATE_RESULT'},
  ]);cleanup.push(() => core.close());
  const events: string[] = [];core.subscribe(event => {if (event.kind === 'catalog' && event.event.startsWith('tool.')) events.push(event.event);});
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Do not schedule');
  expect(events).toContain('tool.result');expect(events).not.toContain('tool.call');
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toEqual([]);
});

it('clears occurrence provenance on context replacement and admits only later live calls', async () => {
  let turn = 0;
  const core = new AgentCore({cwd: await directory(), provider: new ScriptedProvider([]),
    tools: [{name: 'probe', description: 'Probe', parameters: {type: 'object'}, describe: () => ({tool: 'probe'}),
      execute: async () => ({ok: true, data: 'PRIVATE_RESULT'})}], rules: [{tool: 'probe', decision: 'allow'}], plugins: [{
      manifest: {name: 'strategy', version: '1.0.0', trust: 'trusted'}, hooks: {'service.agent.run': async input => {
        const context = input.context as AgentTurnContext;
        if (++turn === 2) await context.replace([...context.messages()]);
        await context.execute([{id: 'reused', name: 'probe', args: {turn}}]);return {value: {text: `Done ${turn}`}};
      }},
    }]});cleanup.push(() => core.close());
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('First');
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toMatchObject([{tool: {args: '{"turn":1}', state: 'done'}}]);
  await core.submit('Replace context');
  expect(core.getMessages().flatMap(message => message.toolCalls ?? [])).toHaveLength(2);
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toMatchObject([{tool: {args: '{"turn":2}', state: 'done'}}]);
});

it('redacts human-input arguments even for positively admitted live Main calls', async () => {
  const names = ['ask_user', 'ask_questions'];
  const core = new AgentCore({cwd: await directory(), provider: new ScriptedProvider([
    {toolCalls: names.map(name => ({name, args: {question: 'PRIVATE_REQUEST', options: ['PRIVATE_CHOICE'], default: 'PRIVATE_DEFAULT'}}))},
    {text: 'Answered'},
  ]), tools: names.map(name => ({name, description: 'Human input', parameters: {type: 'object'}, describe: () => ({tool: name}),
    execute: async () => ({ok: true, data: 'PRIVATE_ANSWER'})})), controlTools: [],
    rules: names.map(tool => ({tool, decision: 'allow' as const}))});cleanup.push(() => core.close());
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Ask');
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toMatchObject(names.map(name => ({tool: {name, state: 'done'}})));
  expect(session.snapshot().messages.filter(message => message.role === 'tool').every(message => message.tool.args === undefined)).toBe(true);
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_');
});

it.each([0, 1, -1])('projects real Main exec exit %i independently from a successful tool invocation', async exitCode => {
  const cwd = await directory(), path = join(cwd, 'command.cjs');
  await writeFile(path, `process.stdout.write('PRIVATE_STDOUT');process.stderr.write('PRIVATE_STDERR');${exitCode === -1 ? "process.kill(process.pid,'SIGTERM')" : `process.exit(${exitCode})`}`);
  const core = new AgentCore({cwd, provider: new ScriptedProvider([{toolCalls: [{name: 'exec', args: {command: `exec ${quote(process.execPath)} ${quote(path)}`}}]}, {text: 'Handled'}]),
    rules: [{tool: 'exec', decision: 'allow'}]});cleanup.push(() => core.close());
  let receipt: Record<string, unknown> | undefined;
  core.subscribe(event => {if (event.kind === 'catalog' && event.event === 'tool.result') receipt = event.input;});
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Run command');
  expect(receipt).toMatchObject({ok: true, output: {exitCode}});
  expect(session.snapshot().messages.find(message => message.role === 'tool')).toMatchObject({text: `exit ${exitCode}`, tool: {name: 'exec', state: exitCode === 0 ? 'done' : 'error'}});
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_');
});

it.each([0, 1])('projects real background launch and output observations until process exit %i', async exitCode => {
  const cwd = await directory(), path = join(cwd, 'background.cjs');
  await writeFile(path, `const fs=require('node:fs');const watcher=fs.watch('.',(_event,file)=>{if(file==='release'&&fs.existsSync('release')){watcher.close();process.stdout.write('PRIVATE_BACKGROUND_OUTPUT');process.exit(${exitCode});}});fs.writeFileSync('ready','ready');`);
  let shellId = '', closed!: () => void;
  const completion = new Promise<void>(resolve => {closed = resolve;});
  let session: ReturnType<typeof connectConversation>;
  const core = new AgentCore({cwd, provider: new ScriptedProvider([]), rules: ['exec', 'exec_output'].map(tool => ({tool, decision: 'allow' as const})), plugins: [{
    manifest: {name: 'background-strategy', version: '1.0.0', trust: 'trusted'}, hooks: {'service.agent.run': async input => {
      const context = input.context as AgentTurnContext;
      await context.execute([{id: 'launch', name: 'exec', args: {command: `exec ${quote(process.execPath)} ${quote(path)}`, background: true, timeoutMs: 5000}}]);
      expect(shellId).not.toBe('');
      await context.execute([{id: 'running', name: 'exec_output', args: {id: shellId}}]);
      expect(session.snapshot().messages.filter(message => message.role === 'tool')).toMatchObject([
        {text: 'started', tool: {name: 'exec', state: 'complete'}},
        {text: 'process running', tool: {name: 'exec_output', state: 'complete'}},
      ]);
      await expect.poll(() => stat(join(cwd, 'ready')).then(() => true, () => false)).toBe(true);
      await writeFile(join(cwd, 'release'), 'release');await completion;
      await context.execute([{id: 'finished', name: 'exec_output', args: {id: shellId}}]);
      return {value: {text: 'Handled'}};
    }},
  }]});cleanup.push(() => core.close());
  core.subscribe(event => {
    if (event.kind !== 'catalog') return;
    if (event.event === 'tool.result' && event.input.tool === 'exec') shellId = (event.input.output as {shellId: string}).shellId;
    if (event.event === 'shell.completed' && event.input.id === shellId) closed();
  });
  session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Run background command');
  expect(core.failure).toBeUndefined();
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toMatchObject([
    {text: 'started', tool: {name: 'exec', state: 'complete'}},
    {text: 'process running', tool: {name: 'exec_output', state: 'complete'}},
    {text: `exit ${exitCode}`, tool: {name: 'exec_output', state: exitCode === 0 ? 'done' : 'error'}},
  ]);
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_');
});

it.each([
  ['exec', undefined], ['exec', 'PRIVATE_BODY {"exitCode":1}'], ['exec', [{exitCode: 1}]],
  ['exec', {exitCode: '0', stdout: 'PRIVATE_BODY'}], ['exec', {exitCode: 0.5}], ['exec', {exitCode: Number.MAX_SAFE_INTEGER + 1}],
  ['exec', {started: true, shellId: ''}], ['exec', {started: true, shellId: '  '}],
  ['exec_output', null], ['exec_output', {done: true, exitCode: '0'}], ['exec_output', {done: false, exitCode: 0}],
] as const)('keeps unknown %s outcomes neutral without parsing result text (%j)', async (name, output) => {
  const core = new AgentCore({cwd: await directory(), provider: new ScriptedProvider([{toolCalls: [{name, args: name === 'exec' ? {command: 'unused'} : {id: 'unused'}}]}, {text: 'Handled'}]),
    rules: [{tool: name, decision: 'allow'}],
    services: {[name === 'exec' ? 'service.shell.exec' : 'service.shell.execOutput']: () => ({value: output})}});cleanup.push(() => core.close());
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Observe outcome');
  expect(session.snapshot().messages.find(message => message.role === 'tool')).toMatchObject({text: '', tool: {name, state: 'complete'}});
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_BODY');
});

it('keeps failed shell invocations and custom lookalike data on their own invocation semantics', async () => {
  const core = new AgentCore({cwd: await directory(), provider: new ScriptedProvider([
    {toolCalls: [{name: 'exec', args: {command: 'unused'}}, {name: 'custom', args: {}}]}, {text: 'Handled'},
  ]), extraTools: [{name: 'custom', description: 'Custom structured data', parameters: {type: 'object'}, describe: () => ({tool: 'custom'}),
    execute: async () => ({ok: true, data: {ok: false, exitCode: 1, stdout: 'PRIVATE_CUSTOM_OUTPUT'}})}],
    rules: ['exec', 'custom'].map(tool => ({tool, decision: 'allow' as const})),
    services: {'service.shell.exec': () => ({deny: 'PRIVATE_SHELL_ERROR'})}});cleanup.push(() => core.close());
  const session = connectConversation(core, 'Main');cleanup.push(() => session.disconnect());await core.submit('Observe both');
  expect(session.snapshot().messages.filter(message => message.role === 'tool')).toMatchObject([
    {text: '', tool: {name: 'exec', state: 'error'}}, {text: '', tool: {name: 'custom', state: 'done'}},
  ]);
  expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE_');
});
