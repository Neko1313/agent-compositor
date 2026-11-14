import {afterEach, expect, it} from 'vitest';
import {UiControllerRegistry, type UiControllerFactory} from '@agent-compositor/hooks';
import {createOpenTuiController} from '../src/opentui-controller.js';
import {AgentCore, ScriptedProvider} from '@agent-compositor/core';
import {getEventListeners} from 'node:events';
import {createInteractionInbox} from '../src/opentui-interactions.js';

const cleanup: (() => void)[] = [];
afterEach(() => {for (const close of cleanup.splice(0).reverse())close();});
function setup(factory: UiControllerFactory) {
  const owner = new AbortController(), registry = new UiControllerRegistry({form: 'chosen'});
  registry.register('chosen', {form: factory}, owner.signal);
  const results: unknown[] = [], failures: boolean[] = [];
  let current = true;
  const controller = createOpenTuiController({registry, id: 'private-request', kind: 'form', data: {secret: 'PRIVATE_FACTORY_REQUEST'},
    current: () => current, changed: () => {}, result: result => results.push(result), failed: cancelled => failures.push(cancelled)});
  cleanup.push(() => controller.close());
  return {controller, owner, results, failures, replace() {current = false;controller.close();}};
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {release = resolve;});
  cleanup.push(release);return {promise, release};
}

it('projects only validated cells and bounded preferred geometry without exposing factory data or leases', () => {
  let received: unknown;
  const f = setup(request => {received = request.data;return {
    preferredRows: () => 5000,
    render: ({columns, rows}) => ({lines: [{text: `${columns}x${rows}`, cells: [{ch: '窗', fg: '#abcdef', bold: true}]}]}), handle: () => {},
  };});
  expect(received).toEqual({secret: 'PRIVATE_FACTORY_REQUEST'});
  expect(f.controller.snapshot()).toMatchObject({id: 'private-request', kind: 'form', inputRevision: 0, preferredRows: 10,
    view: {lines: [{text: '80x10', cells: [{ch: '窗', fg: '#abcdef', bold: true}]}]}});
  f.controller.viewport(38, 6);expect(f.controller.snapshot()).toMatchObject({preferredRows: 6, view: {lines: [{text: '38x6'}]}});
  expect(JSON.stringify(f.controller.snapshot())).not.toMatch(/PRIVATE_FACTORY_REQUEST|signal|instance|registry/);
  expect(Object.isFrozen(f.controller.snapshot()!.view.lines[0].cells)).toBe(true);
});

it('acknowledges asynchronous changes only when their serialized handlers complete, keeping mid-handle invalidation unacknowledged', async () => {
  const first = gate(), second = gate(), handled: string[] = [];
  const f = setup((_request, context) => {
    let text = '';
    return {render: () => ({input: {id: 'query', value: text}, lines: []}), handle: async input => {
      if (input.kind !== 'change')return;
      text = input.value;handled.push(text);context.invalidate();
      await (handled.length === 1 ? first.promise : second.promise);
    }};
  });
  let admissions = 0;
  expect(f.controller.input({kind: 'change', id: 'query', value: 'first'}, f.controller.snapshot()!.revision, () => admissions++)).toBe(1);
  expect(f.controller.snapshot()).toMatchObject({inputRevision: 0, view: {input: {value: 'first'}}});
  expect(f.controller.input({kind: 'change', id: 'query', value: 'second'}, f.controller.snapshot()!.revision, () => admissions++)).toBe(2);
  expect(handled).toEqual(['first']);f.controller.viewport(60, 8);expect(f.controller.snapshot()!.inputRevision).toBe(0);
  first.release();await expect.poll(() => handled).toEqual(['first', 'second']);
  expect(f.controller.snapshot()).toMatchObject({inputRevision: 1, view: {input: {value: 'second'}}});
  second.release();await expect.poll(() => f.controller.snapshot()!.inputRevision).toBe(2);
  expect(admissions).toBe(2);expect(f.failures).toEqual([]);
});

it('admits current advertised targets once and rejects stale paints, undeclared fields and outside mouse coordinates before admission', () => {
  const handled: unknown[] = [];
  const f = setup(() => ({render: () => ({lines: [{text: 'Save', action: 'save'}], input: {id: 'field', value: ''}}), handle: input => {handled.push(input);}}));
  let admissions = 0;const revision = f.controller.snapshot()!.revision;
  for (const [input, paint] of [
    [{kind: 'action', action: 'unoffered'}, revision], [{kind: 'change', id: 'other', value: 'PRIVATE'}, revision],
    [{kind: 'mouse', row: 10, col: 0, button: 'left'}, revision], [{kind: 'key', key: 'f5'}, revision - 1],
  ] as const)expect(f.controller.input(input, paint, () => admissions++)).toBeUndefined();
  expect(admissions).toBe(0);expect(handled).toEqual([]);
  expect(f.controller.input({kind: 'action', action: 'save'}, revision, () => admissions++)).toBe(1);
  expect(handled).toEqual([{kind: 'action', action: 'save'}]);expect(admissions).toBe(1);expect(f.controller.snapshot()!.inputRevision).toBe(1);
});

it('revokes an uncooperative pending handler and its queued input on owner unload without publishing private errors or late results', async () => {
  const pending = gate(), handled: unknown[] = [];
  const f = setup(() => ({render: () => ({lines: []}), handle: async input => {handled.push(input);await pending.promise;return {secret: 'LATE_PRIVATE_RESULT'};}}));
  const revision = f.controller.snapshot()!.revision;
  f.controller.input({kind: 'key', key: 'f5'}, revision);f.controller.input({kind: 'key', key: 'f5'}, revision);
  f.owner.abort(Error('PRIVATE_EXCEPTION'));pending.release();
  await expect.poll(() => f.failures).toEqual([true]);await Promise.resolve();
  expect(handled).toHaveLength(1);expect(f.results).toEqual([]);
  expect(JSON.stringify(f.controller.snapshot())).not.toMatch(/PRIVATE_EXCEPTION|LATE_PRIVATE_RESULT/);
});

it('fails closed when a controller attempts effects while rendering without exposing its exception', () => {
  const f = setup((_request, context) => ({render: () => {context.invalidate();return {lines: []};}, handle: () => {}}));
  expect(f.failures).toEqual([false]);expect(f.controller.snapshot()).toBeUndefined();
});

it('keeps selected question choices, cardinality and cancellation bound to their captured declaration despite factory and caller mutations', async () => {
  const owner = new AbortController(), replacement = new AbortController(), inbox = createInteractionInbox();
  let answer = 'Local';
  const request = {question: 'Choose a mode', options: ['Local', 'Remote'], multi: false, allowOther: false, signal: owner.signal};
  const core = new AgentCore({cwd: process.cwd(), provider: new ScriptedProvider([]), uiControllers: {question: 'chosen'},
    plugins: [{manifest: {name: 'chosen', version: '1.0.0', trust: 'trusted'}, hooks: {}, controllers: {
      question: ({data}) => {
        const declaration = data as typeof request;
        if (declaration.options)declaration.options[0] = 'Factory changed';declaration.multi = true;declaration.allowOther = true;
        return {render: () => ({lines: [{text: 'Selected question'}]}), handle: () => ({answer})};
      },
    }}]});
  inbox.bind(core);
  try {
    const pending = inbox.askQuestion(request);void pending.catch(() => {});
    expect(request.options).toEqual(['Local', 'Remote']);expect(request.multi).toBe(false);expect(request.allowOther).toBe(false);
    const current = inbox.controllerSnapshot()!;
    request.options[0] = 'Caller changed';request.multi = true;request.signal = replacement.signal;
    inbox.controllerInput(current.id, {kind: 'key', key: 'f4'}, current.revision);
    expect(await pending).toBe('Local');
    expect(getEventListeners(owner.signal, 'abort')).toHaveLength(0);expect(getEventListeners(replacement.signal, 'abort')).toHaveLength(0);
    answer = '  Normalized answer  ';
    const free = inbox.askQuestion({question: 'Your name'}), freeFrame = inbox.controllerSnapshot()!;
    inbox.controllerInput(freeFrame.id, {kind: 'key', key: 'f4'}, freeFrame.revision);
    expect(await free).toBe('Normalized answer');
    const cancelled = inbox.askQuestion({...request, options: ['Local', 'Remote'], signal: owner.signal}).catch(error => String(error));
    owner.abort();expect(await cancelled).toContain('Question cancelled');
    expect(inbox.controllerSnapshot()).toBeUndefined();
  } finally {inbox.close();await core.close();}
});

it('denies an uncloneable private approval request before instantiating its selected factory or native fallback', async () => {
  let created = 0;const owner = new AbortController(), inbox = createInteractionInbox();
  const core = new AgentCore({cwd: process.cwd(), provider: new ScriptedProvider([]), uiControllers: {approval: 'chosen'},
    plugins: [{manifest: {name: 'chosen', version: '1.0.0', trust: 'trusted'}, hooks: {}, controllers: {
      approval: () => {created++;return {render: () => ({lines: []}), handle: () => ({allow: true})};},
    }}]});
  inbox.bind(core);
  try {
    expect(await inbox.ask({tool: 'read', descriptor: {tool: 'read'}, signal: owner.signal,
      input: {privateCallback: () => 'PRIVATE_UNCLONEABLE'}})).toBe(false);
    expect(created).toBe(0);expect(inbox.controllerSnapshot()).toBeUndefined();expect(inbox.snapshot()).toBeUndefined();
    expect(getEventListeners(owner.signal, 'abort')).toHaveLength(0);
  } finally {inbox.close();await core.close();}
});
