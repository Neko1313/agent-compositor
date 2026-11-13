import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore, ScriptedProvider, type AgentCoreOptions} from '@agent-compositor/core';
import {ApprovalSession} from '@agent-compositor/permissions';
import {expect, it, vi} from 'vitest';
import {createApprovalInbox} from './opentui-approvals.js';
import {connectConversation} from './opentui-host.js';

type Request = Parameters<NonNullable<AgentCoreOptions['onApproval']>>[0];
const read = (path: string, signal?: AbortSignal): Request => ({
  tool: 'read', descriptor: {tool: 'read', path}, reason: 'Read user attachment', signal,
});

it('declines an input that the JSON review would silently change', async () => {
  const inbox = createApprovalInbox();
  const request = read('/one.txt');
  expect(await inbox.ask({...request, input: {path: '/one.txt', count: Infinity}})).toBe(false);
  expect(inbox.snapshot()).toBeUndefined();
  inbox.close();
});

it('presents permission tokens separately from the exact shell arguments and options', async () => {
  const inbox = createApprovalInbox();
  const input = {command: "printf '%s' 'two words'", cwd: '.', background: true, env: {MODE: 'demo'}};
  const core = new AgentCore({
    cwd: process.cwd(), provider: new ScriptedProvider([]), onApproval: inbox.ask,
    rules: [{tool: 'exec', decision: 'ask', reason: 'Review the command'}],
  });
  try {
    const operation = core.invokeTool('exec', input);
    await expect.poll(() => inbox.snapshot()?.tool).toBe('exec');
    const shown = inbox.snapshot()!;
    expect(shown.reason).toBe('Review the command');
    expect(shown.details).toContainEqual({label: 'Read only', value: 'false'});
    const detail = (label: string) => shown.details.find(item => item.label === label)!.value;
    expect(JSON.parse(detail('Permission tokens'))).toEqual(['printf', '%s', 'two words']);
    expect(JSON.parse(detail('Arguments'))).toEqual(input);
    inbox.answer(shown.id, false);
    expect(await operation).toMatchObject({ok: false, error: expect.stringMatching(/denied/)});
  } finally {
    inbox.close();
    await core.close();
  }
});

it('publishes the front request in FIFO order and ignores stale answers', async () => {
  const inbox = createApprovalInbox();
  const observed: (string | undefined)[] = [];
  const unsubscribe = inbox.subscribe(() => observed.push(inbox.snapshot()?.id));
  const first = inbox.ask(read('/first.txt'));
  const firstView = inbox.snapshot()!;
  const second = inbox.ask(read('/second.txt'));
  expect(inbox.snapshot()).toEqual(firstView);
  expect(firstView.details).toEqual([{label: 'Path', value: '/first.txt'}]);
  inbox.answer('unknown', true);
  expect(inbox.snapshot()).toEqual(firstView);
  inbox.answer(firstView.id, true);
  expect(await first).toBe(true);

  const secondView = inbox.snapshot()!;
  expect(secondView.id).not.toBe(firstView.id);
  expect(secondView.details).toEqual([{label: 'Path', value: '/second.txt'}]);
  inbox.answer(firstView.id, true);
  expect(inbox.snapshot()).toEqual(secondView);
  inbox.answer(secondView.id, false);
  expect(await second).toBe(false);
  expect(observed).toEqual([firstView.id, secondView.id, undefined]);
  unsubscribe();
  const third = inbox.ask(read('/third.txt'));
  inbox.close();
  expect(await third).toBe(false);
  expect(observed).toHaveLength(3);
});

it('removes already-aborted, queued and active requests and denies every request on close', async () => {
  const inbox = createApprovalInbox();
  expect(await inbox.ask(read('/skipped', AbortSignal.abort()))).toBe(false);
  expect(inbox.snapshot()).toBeUndefined();

  const active = new AbortController();
  const queued = new AbortController();
  const first = inbox.ask(read('/active', active.signal));
  const firstId = inbox.snapshot()!.id;
  const second = inbox.ask(read('/queued', queued.signal));
  const third = inbox.ask(read('/third'));
  const fourth = inbox.ask(read('/fourth'));
  queued.abort();
  expect(await second).toBe(false);
  expect(inbox.snapshot()?.id).toBe(firstId);
  active.abort();
  expect(await first).toBe(false);
  expect(inbox.snapshot()?.details).toEqual([{label: 'Path', value: '/third'}]);
  const visibleOnClose = inbox.snapshot()!.id;
  inbox.close();
  inbox.answer(visibleOnClose, true);
  expect(await Promise.all([third, fourth])).toEqual([false, false]);
  expect(inbox.snapshot()).toBeUndefined();
  expect(await inbox.ask(read('/after-close'))).toBe(false);
});

it('one answer authorizes only the displayed rewritten write in its own core', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'opentui-approval-')));
  const main = createApprovalInbox();
  const side = createApprovalInbox();
  const grants = new ApprovalSession();
  const persist = vi.fn(async () => {});
  let mainRequest: Request | undefined;
  const mainCore = new AgentCore({
    cwd, provider: new ScriptedProvider([]), approvals: grants, persistApprovals: persist,
    onApproval(request) { mainRequest = request; return main.ask(request); },
    plugins: [{
      manifest: {name: 'rewrite', version: '1.0.0', trust: 'trusted'},
      hooks: {'tool.call': (event, $) => $.next({...event, input: {path: 'actual.txt', content: 'rewritten'}})},
    }],
  });
  const sideCore = new AgentCore({cwd, provider: new ScriptedProvider([]), onApproval: side.ask});
  const mainSession = connectConversation(mainCore, 'Main', main);
  const sideSession = connectConversation(sideCore, 'Side', side);
  try {
    const first = mainCore.invokeTool('write', {path: 'original.txt', content: 'original'});
    const other = sideCore.invokeTool('write', {path: 'side.txt', content: 'side'});
    await expect.poll(() => Boolean(mainSession.snapshot().approval && sideSession.snapshot().approval)).toBe(true);
    const mainView = mainSession.snapshot().approval!, sideView = sideSession.snapshot().approval!;
    expect(mainView.tool).toBe('write');
    expect(sideView.tool).toBe('write');
    expect(mainView.id).not.toBe(sideView.id);
    const actualPath = join(cwd, 'actual.txt');
    expect(mainView.details).toContainEqual({label: 'Path', value: actualPath});
    expect(JSON.parse(mainView.details.find(item => item.label === 'Arguments')!.value))
      .toEqual({path: actualPath, content: 'rewritten'});
    (mainRequest!.input as {content: string}).content = 'changed by approval callback';
    sideSession.answerApproval!(mainView.id, true);
    mainSession.answerApproval!(sideView.id, false);
    expect(sideSession.snapshot().approval).toEqual(sideView);
    expect(mainSession.snapshot().approval).toEqual(mainView);
    await expect(readFile(actualPath)).rejects.toMatchObject({code: 'ENOENT'});
    mainSession.answerApproval!(mainView.id, true);
    expect(await first).toMatchObject({ok: true});
    expect(await readFile(actualPath, 'utf8')).toBe('rewritten');
    expect(mainSession.snapshot().approval).toBeUndefined();
    expect(sideSession.snapshot().approval).toEqual(sideView);
    sideSession.answerApproval!(sideView.id, false);
    expect(await other).toMatchObject({ok: false, error: expect.stringMatching(/denied/)});
    await expect(readFile(join(cwd, 'side.txt'))).rejects.toMatchObject({code: 'ENOENT'});
    await expect(readFile(join(cwd, 'original.txt'))).rejects.toMatchObject({code: 'ENOENT'});

    const repeat = mainCore.invokeTool('write', {path: 'original.txt', content: 'original'});
    await expect.poll(() => mainSession.snapshot().approval?.id).toBeDefined();
    const repeatId = mainSession.snapshot().approval!.id;
    expect(repeatId).not.toBe(mainView.id);
    mainSession.answerApproval!(mainView.id, true);
    expect(mainSession.snapshot().approval?.id).toBe(repeatId);
    mainSession.answerApproval!(repeatId, false);
    expect(await repeat).toMatchObject({ok: false, error: expect.stringMatching(/denied/)});
    expect(grants.list()).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  } finally {
    mainSession.disconnect();
    sideSession.disconnect();
    await Promise.all([mainCore.close(), sideCore.close()]);
    await rm(cwd, {recursive: true, force: true});
  }
});

it('denies pending model writes when their turn is interrupted or their conversation disconnects', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'opentui-approval-teardown-'));
  const inbox = createApprovalInbox();
  const write = (path: string) => ({toolCalls: [{name: 'write', args: {path, content: 'pending'}}]});
  const provider = new ScriptedProvider([write('interrupted.txt'), write('disconnected.txt'), {text: 'Done'}]);
  const core = new AgentCore({cwd, provider, onApproval: inbox.ask});
  const session = connectConversation(core, 'Main', inbox);
  try {
    const interrupted = core.submit('First write');
    await expect.poll(() => session.snapshot().approval?.tool).toBe('write');
    const firstId = session.snapshot().approval!.id;
    core.interrupt();
    await interrupted;
    expect(session.snapshot().approval).toBeUndefined();
    session.answerApproval!(firstId, true);
    await expect(readFile(join(cwd, 'interrupted.txt'))).rejects.toMatchObject({code: 'ENOENT'});

    const disconnected = core.submit('Second write');
    await expect.poll(() => session.snapshot().approval?.tool).toBe('write');
    const secondId = session.snapshot().approval!.id;
    session.disconnect();
    session.answerApproval!(secondId, true);
    await disconnected;
    expect(inbox.snapshot()).toBeUndefined();
    await expect(readFile(join(cwd, 'disconnected.txt'))).rejects.toMatchObject({code: 'ENOENT'});
  } finally {
    session.disconnect();
    await core.close();
    await rm(cwd, {recursive: true, force: true});
  }
});
