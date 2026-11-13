import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {AgentCore, ScriptedProvider} from '../src/index.js';
import type {AgentCoreOptions, CompletionRequest, ModelProvider, ScriptedStep} from '../src/index.js';

const source = 'export const fee = 3;\nexport const total = subtotal + fee;\n';
const edit = {oldText: 'subtotal + fee', newText: 'subtotal - fee'};
const readSource = {name: 'read', args: {path: 'source.ts'}};
const missingTarget = {name: 'edit', args: edit};
const suggestion = 'Suggested edit target (JSON):\n';
const roots: string[] = [], cores: AgentCore[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) await core.close();
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

async function workspace(other = 'export const tax = 4;\n') {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'edit-target-recovery-')));
  roots.push(cwd);
  await writeFile(join(cwd, 'source.ts'), source);
  await writeFile(join(cwd, 'other.ts'), other);
  return cwd;
}

function session(cwd: string, provider: ModelProvider, options: Partial<AgentCoreOptions> = {}) {
  const core = new AgentCore({cwd, provider, ...options});
  cores.push(core);
  const results: Record<string, unknown>[] = [], checks: unknown[] = [];
  core.subscribe(event => {
    if (event.kind !== 'catalog') return;
    if (event.event === 'tool.result') results.push(event.input);
    if (event.event === 'tool.check' && event.input.tool === 'edit') checks.push(event.input.callId);
  });
  return {core, results, checks};
}

function lastEdit(request: CompletionRequest) {
  return request.messages.filter(message => message.role === 'tool' && message.name === 'edit').at(-1)?.content;
}

function expectNoSuggestion(error: unknown) {
  expect(error).toEqual(expect.any(String));
  expect(error).not.toContain(suggestion);
  expect(error).not.toContain('edit-v1:');
}

it.each(['allowed', 'denied', 'stale'] as const)('requires a fresh explicit retry of the suggested read reference (%s)', async outcome => {
  const cwd = await workspace(), file = join(cwd, 'source.ts');
  const steps: ScriptedStep[] = [
    {toolCalls: [readSource, {name: 'read', args: {path: 'other.ts'}}]},
    {toolCalls: [missingTarget]},
  ];
  const script = new ScriptedProvider(steps);
  let beforeRetry: string | undefined;
  const provider: ModelProvider = {
    name: 'retry-suggested-edit',
    async *complete(request) {
      if (script.requests.length === 2) {
        beforeRetry = await readFile(file, 'utf8');
        const line = lastEdit(request)?.split(suggestion)[1]?.split('\n')[0];
        if (line) {
          const fragment = JSON.parse(line);
          if (outcome === 'stale') await writeFile(file, '// external change\n' + source);
          steps.push({toolCalls: [{name: 'edit', args: {...edit, ...fragment}}]});
        }
        steps.push({text: 'Reported the tool result.'});
      }
      yield* script.complete(request);
    },
  };
  const {core, results, checks} = session(cwd, provider, {
    rules: [{tool: 'edit', path: file, decision: outcome === 'denied' ? 'deny' : 'allow'}],
  });

  await core.submit('Update the fee calculation.');
  expect(core.failure).toBeUndefined();
  const read = results.find(result => result.tool === 'read' && (result.output as {content?: string})?.content === source);
  expect(read).toMatchObject({ok: true, output: {editRef: expect.any(String)}});
  const ref = (read!.output as {editRef: string}).editRef;
  const [invalid, retry] = results.filter(result => result.tool === 'edit');
  expect(invalid).toMatchObject({ok: false});
  expect(invalid.denied).toBeFalsy();
  const error = lastEdit(script.requests[2]);
  expect(error).toBe(invalid.error);
  expect(error?.split(suggestion)[1]?.split('\n')[0]).toBe(JSON.stringify({target: ref}));
  expect(beforeRetry).toBe(source);
  expect(checks).toEqual([retry.callId]);
  if (outcome === 'allowed') {
    expect(retry).toMatchObject({ok: true, output: {path: file, replacements: 1, match: 'exact'}});
    expect(await readFile(file, 'utf8')).toBe(source.replace(edit.oldText, edit.newText));
  } else if (outcome === 'denied') {
    expect(retry).toMatchObject({ok: false, denied: true, error: expect.stringContaining('denied')});
    expect(await readFile(file, 'utf8')).toBe(source);
  } else {
    expect(retry).toMatchObject({ok: false, error: expect.stringContaining('stale')});
    expect(await readFile(file, 'utf8')).toBe('// external change\n' + source);
  }
});

it('withholds a target when the exact oldText is visible in two different files', async () => {
  const cwd = await workspace(source);
  const provider = new ScriptedProvider([
    {toolCalls: [readSource, {name: 'read', args: {path: 'other.ts'}}]},
    {toolCalls: [missingTarget]}, {text: 'Need an explicit selection.'},
  ]);
  const {core, results, checks} = session(cwd, provider);
  await core.submit('Inspect both files and edit the intended one.');
  expect(results.filter(result => result.tool === 'read').map(result => result.ok)).toEqual([true, true]);
  expect(results.at(-1)).toMatchObject({tool: 'edit', ok: false});
  expectNoSuggestion(lastEdit(provider.requests[2]));
  expect(checks).toEqual([]);
});

it('uses only source visible in the returned read page', async () => {
  const cwd = await workspace();
  const provider = new ScriptedProvider([
    {toolCalls: [{name: 'read', args: {path: 'source.ts', limit: 1}}]},
    {toolCalls: [missingTarget]}, {text: 'Need more source.'},
  ]);
  const {core, results} = session(cwd, provider);
  await core.submit('Inspect the first line and propose the edit.');
  expect(results[0]).toMatchObject({ok: true, output: {content: 'export const fee = 3;', editRef: expect.any(String)}});
  expect(results[1]).toMatchObject({ok: false});
  expectNoSuggestion(lastEdit(provider.requests[2]));
});

it.each([{path: ''}, {target: false}, {editRef: 'bad-reference'}])('preserves errors for explicitly supplied malformed selectors %j', async selector => {
  const cwd = await workspace();
  const provider = new ScriptedProvider([
    {toolCalls: [readSource]},
    {toolCalls: [{name: 'edit', args: {...edit, ...selector}}]}, {text: 'Reported invalid arguments.'},
  ]);
  const {core, results, checks} = session(cwd, provider);
  await core.submit('Inspect and edit the file.');
  expect(results[0]).toMatchObject({ok: true, output: {content: source}});
  expect(results[1]).toMatchObject({ok: false});
  expectNoSuggestion(lastEdit(provider.requests[2]));
  expect(checks).toEqual([]);
});

it('does not suggest references from an earlier model turn', async () => {
  const cwd = await workspace();
  const provider = new ScriptedProvider([
    {toolCalls: [readSource]}, {text: 'File inspected.'},
    {toolCalls: [missingTarget]}, {text: 'Need a target.'},
  ]);
  const {core, results} = session(cwd, provider);
  await core.submit('Inspect the source.');
  await core.submit('Update the fee calculation.');
  expect(results[0]).toMatchObject({ok: true, output: {content: source}});
  expect(results[1]).toMatchObject({ok: false});
  expectNoSuggestion(lastEdit(provider.requests[3]));
});

it('isolates read evidence in both directions between the model turn and user tool operations', async () => {
  const cwd = await workspace('const name = "other";\n');
  const provider = new ScriptedProvider([
    {toolCalls: [readSource]},
    {toolCalls: [{name: 'edit', args: {oldText: '"other"', newText: '"new"'}}], hold: true},
    {text: 'Need a target.'},
  ]);
  const {core, results} = session(cwd, provider);
  const running = core.submit('Inspect the source and update the name.');
  try {
    await expect.poll(() => provider.requests.length).toBe(2);
    expect(results[0]).toMatchObject({ok: true, output: {content: source}});
    const independentEdit = await core.invokeUserTool('edit', edit);
    expect(independentEdit.ok).toBe(false);
    expectNoSuggestion(independentEdit.error);
    expect(await core.invokeUserTool('read', {path: 'other.ts'})).toMatchObject({ok: true, output: {editRef: expect.any(String)}});
  } finally {
    provider.release();
    await running;
  }
  expect(results.at(-1)).toMatchObject({tool: 'edit', ok: false});
  expectNoSuggestion(lastEdit(provider.requests[2]));
});

it('ignores a read answered by a plugin even when it returns a valid reference and matching source', async () => {
  const cwd = await workspace();
  const provider = new ScriptedProvider([
    {toolCalls: [readSource]}, {toolCalls: [missingTarget]}, {text: 'Need a native read.'},
  ]);
  const {core, results} = session(cwd, provider);
  const original = await core.invokeTool('read', readSource.args);
  expect(original).toMatchObject({ok: true, output: {content: source, editRef: expect.any(String)}});
  core.host.registerPlugin({name: 'answer-read', version: '1.0.0', trust: 'trusted'}, {
    'tool.call': call => call.tool === 'read' ? {result: original.output} : undefined,
  });
  await core.submit('Inspect the source and edit it.');
  expect(results[1]).toMatchObject({tool: 'read', ok: true, output: original.output});
  expect(results[2]).toMatchObject({tool: 'edit', ok: false});
  expectNoSuggestion(lastEdit(provider.requests[2]));
});

const earlierEdit = 'Earlier successful edit (JSON):\n';
function editStep(target: string, change = edit): ScriptedStep {
  return {toolCalls: [{name: 'edit', args: {target, ...change}}]};
}

it.each(['source.ts', 'other.ts'])('identifies the prior successful file when the same change has no match in %s', async target => {
  const cwd = await workspace('export const tax = 4;\n'), path = join(cwd, 'source.ts');
  const change = {oldText: 'old' + 'a'.repeat(4096), newText: 'new' + 'b'.repeat(4096)};
  await writeFile(path, change.oldText);
  const provider = new ScriptedProvider([
    editStep('source.ts', change), editStep(target, change), {text: 'I will check the result.'},
  ]);
  const {core, results} = session(cwd, provider, {rules: [{tool: 'edit', path: join(cwd, '**'), decision: 'allow'}]});
  await core.submit('Apply the replacement.');
  expect(results[0]).toMatchObject({ok: true, output: {path, replacements: 1}});
  expect(results[1]).toMatchObject({ok: false, error: expect.stringContaining('no match for oldText')});
  expect(results[1].denied).toBeFalsy();
  const error = lastEdit(provider.requests[2]);
  expect(error).toBe(results[1].error);
  expect(error?.split(earlierEdit)[1]?.split('\n')[0]).toBe(JSON.stringify({path}));
  expect(error).not.toContain(change.oldText);
  expect(error).not.toContain(change.newText);
  expect(await readFile(path, 'utf8')).toBe(change.newText);
  expect(await readFile(join(cwd, 'other.ts'), 'utf8')).toBe('export const tax = 4;\n');
});

it('applies the same change to a second matching file through normal execution', async () => {
  const cwd = await workspace(source);
  const provider = new ScriptedProvider([
    editStep('source.ts'), editStep('other.ts'), {text: 'Updated both files.'},
  ]);
  const {core, results} = session(cwd, provider, {rules: [{tool: 'edit', path: join(cwd, '**'), decision: 'allow'}]});
  await core.submit('Update both files.');
  expect(results.map(result => result.ok)).toEqual([true, true]);
  expect(lastEdit(provider.requests[2])).not.toContain(earlierEdit);
  for (const name of ['source.ts', 'other.ts']) {
    expect(await readFile(join(cwd, name), 'utf8')).toBe(source.replace(edit.oldText, edit.newText));
  }
});

it('keeps permission denial independent of matching earlier successful work', async () => {
  const cwd = await workspace(source);
  const provider = new ScriptedProvider([
    editStep('source.ts'), editStep('other.ts'), {text: 'The second edit was denied.'},
  ]);
  const {core, results} = session(cwd, provider, {rules: [
    {tool: 'edit', path: join(cwd, 'other.ts'), decision: 'deny'}, {tool: 'edit', path: join(cwd, '**'), decision: 'allow'},
  ]});
  await core.submit('Update both files.');
  expect(results[0]).toMatchObject({ok: true});
  expect(results[1]).toMatchObject({ok: false, denied: true, error: expect.stringContaining('denied')});
  expect(lastEdit(provider.requests[2])).not.toContain(earlierEdit);
  expect(await readFile(join(cwd, 'other.ts'), 'utf8')).toBe(source);
});

it('requires both literal text arguments to match the earlier edit', async () => {
  const cwd = await workspace();
  const provider = new ScriptedProvider([
    editStep('source.ts'), editStep('other.ts', {...edit, oldText: edit.oldText + ' '}),
    editStep('other.ts', {...edit, newText: edit.newText + ' '}), {text: 'Reported unmatched replacements.'},
  ]);
  const {core, results} = session(cwd, provider, {rules: [{tool: 'edit', path: join(cwd, '**'), decision: 'allow'}]});
  await core.submit('Inspect the results of the changes.');
  expect(results[0]).toMatchObject({ok: true});
  for (const index of [1, 2]) {
    expect(results[index]).toMatchObject({ok: false, error: expect.stringContaining('no match for oldText')});
    expect(lastEdit(provider.requests[index + 1])).not.toContain(earlierEdit);
  }
});

it('omits earlier edit feedback across model turns', async () => {
  const cwd = await workspace();
  const provider = new ScriptedProvider([
    editStep('source.ts'), {text: 'Updated the file.'},
    editStep('source.ts'), {text: 'Reported the result of the second request.'},
  ]);
  const {core, results} = session(cwd, provider, {rules: [{tool: 'edit', path: join(cwd, '**'), decision: 'allow'}]});
  await core.submit('Apply the change.');
  await core.submit('Apply it again.');
  expect(results[0]).toMatchObject({ok: true});
  expect(results[1]).toMatchObject({ok: false, error: expect.stringContaining('no match for oldText')});
  expect(lastEdit(provider.requests[3])).not.toContain(earlierEdit);
});
