import {getEventListeners} from 'node:events';
import {expect, it} from 'vitest';
import {AgentCore, ScriptedProvider} from '@agent-compositor/core';
import {type UiForm} from '@agent-compositor/events';
import {createInteractionInbox} from './opentui-interactions.js';
import {connectConversation} from './opentui-host.js';

const form: UiForm = {title: 'Private connection', fields: [
  {id: 'token', label: 'Token', type: 'password', required: true},
  {id: 'endpoint', label: 'Endpoint', type: 'url', required: true},
], actions: [{id: 'save', label: 'Save'}]};
const answer = {action: 'save', values: {token: 'isolated-private-value', endpoint: 'https://example.test'}};
const question = {question: 'Choose a mode', options: ['Local', 'Remote'], allowOther: false};
const choice = (selected = ['Local']) => ({answers: [{id: 'answer', selected}]});

it('arbitrates approvals, questions and private forms in one FIFO and ignores foreign or stale decisions', async () => {
  const inbox = createInteractionInbox();
  const approval = inbox.ask({tool: 'read', descriptor: {path: '/first', tool: 'read'}});
  const first = inbox.snapshot()!;
  const questionResult = inbox.askQuestion(question);
  const formResult = inbox.form('settings', form, new AbortController().signal);
  expect(inbox.interactionSnapshot()).toBeUndefined();
  inbox.answerInteraction(first.id, choice());
  inbox.answer('foreign', true);
  expect(inbox.snapshot()).toBe(first);
  inbox.answer(first.id, false);
  expect(await approval).toBe(false);
  const next = inbox.interactionSnapshot()!;
  expect(next.kind).toBe('question');
  expect(inbox.snapshot()).toBeUndefined();
  inbox.answer(first.id, true);
  inbox.answerInteraction('foreign', choice());
  expect(inbox.interactionSnapshot()).toBe(next);
  inbox.answerInteraction(next.id, choice());
  expect(await questionResult).toBe('Local');
  const last = inbox.interactionSnapshot()!;
  expect(last.kind).toBe('form');
  inbox.cancelInteraction(next.id);
  expect(inbox.interactionSnapshot()).toBe(last);
  inbox.answerInteraction(last.id, answer);
  expect(await formResult).toEqual(answer);
  expect(inbox.interactionSnapshot()).toBeUndefined();
  inbox.close();
});

it('keeps invalid answers pending, rejects disallowed custom choices and detaches immutable descriptions', async () => {
  const inbox = createInteractionInbox();
  const request = {...question, options: [...question.options], optionDetails: [{label: 'Local', description: 'No server', recommended: true}]};
  const result = inbox.askQuestion(request);
  const shown = inbox.interactionSnapshot()!;
  request.options[0] = 'Changed';
  request.optionDetails[0].description = 'Changed';
  expect(shown.kind === 'question' && shown.request.questions[0].options?.[0])
    .toEqual({label: 'Local', description: 'No server', recommended: true});
  expect(Object.isFrozen(shown)).toBe(true);
  for (const invalid of [choice(['Remote', 'Local']), choice(['Changed']),
    {answers: [{id: 'answer', selected: [], text: 'Custom'}]}, {answers: []},
  ]) {
    inbox.answerInteraction(shown.id, invalid);
    expect(inbox.interactionSnapshot()).toMatchObject({id: shown.id, error: expect.any(String)});
  }
  inbox.answerInteraction(shown.id, choice(['Remote']));
  expect(await result).toBe('Remote');
  inbox.close();
});

it('validates complete questionnaires and preserves their declared answer order', async () => {
  const inbox = createInteractionInbox();
  const result = inbox.askQuestion({question: 'Setup', questions: [
    {id: 'features', question: 'Choose features', options: ['Search', 'Files'], multi: true, allowOther: false},
    {id: 'name', question: 'Your name'},
  ]});
  const id = inbox.interactionSnapshot()!.id;
  inbox.answerInteraction(id, {answers: [{id: 'features', selected: ['Search', 'Search']}, {id: 'name', selected: [], text: 'Neko'}]});
  expect(inbox.interactionSnapshot()).toMatchObject({id, error: expect.any(String)});
  inbox.answerInteraction(id, {answers: [{id: 'name', selected: [], text: 'Neko'}, {id: 'features', selected: ['Search', 'Files']}]});
  expect(await result).toEqual({answers: [{id: 'features', selected: ['Search', 'Files']}, {id: 'name', selected: [], text: 'Neko'}]});
  inbox.close();
});

it('retains the admitted question cardinality and signal when its caller mutates the borrowed request', async () => {
  const inbox = createInteractionInbox();
  const owner = new AbortController(), replacement = new AbortController();
  const request = {...question, multi: false, signal: owner.signal};
  const result = inbox.askQuestion(request);
  const id = inbox.interactionSnapshot()!.id;
  request.multi = true;
  request.signal = replacement.signal;
  inbox.answerInteraction(id, choice());
  expect(await result).toBe('Local');
  expect(getEventListeners(owner.signal, 'abort')).toHaveLength(0);
  expect(getEventListeners(replacement.signal, 'abort')).toHaveLength(0);
  const cancelled = inbox.askQuestion({...question, signal: owner.signal}).catch(error => String(error));
  owner.abort();
  expect(await cancelled).toContain('cancelled');
  inbox.close();
});

it('settles queued and active cancellation once and removes every abort listener on close', async () => {
  const inbox = createInteractionInbox();
  const firstSignal = new AbortController(), secondSignal = new AbortController(), formSignal = new AbortController();
  const first = inbox.askQuestion({...question, signal: firstSignal.signal}).catch(error => String(error));
  const second = inbox.askQuestion({...question, signal: secondSignal.signal}).catch(error => String(error));
  const third = inbox.form('settings', form, formSignal.signal);
  const firstId = inbox.interactionSnapshot()!.id;
  secondSignal.abort();
  expect(await second).toContain('cancelled');
  expect(inbox.interactionSnapshot()?.id).toBe(firstId);
  expect(getEventListeners(secondSignal.signal, 'abort')).toHaveLength(0);
  inbox.close();
  expect(await first).toContain('cancelled');
  expect(await third).toBeNull();
  expect(getEventListeners(firstSignal.signal, 'abort')).toHaveLength(0);
  expect(getEventListeners(formSignal.signal, 'abort')).toHaveLength(0);
  expect(inbox.interactionSnapshot()).toBeUndefined();
  await expect(inbox.askQuestion(question)).rejects.toThrow('cancelled');
  expect(await inbox.form('settings', form, new AbortController().signal)).toBeNull();
  expect(await inbox.ask({tool: 'read', descriptor: {tool: 'read'}})).toBe(false);
});

it('removes abort listeners when a subscriber answers or closes a newly published request synchronously', async () => {
  const inbox = createInteractionInbox();
  const first = new AbortController(), second = new AbortController();
  const off = inbox.subscribe(() => {
    const active = inbox.interactionSnapshot();
    if (active?.kind === 'question') inbox.answerInteraction(active.id, choice());
  });
  expect(await inbox.askQuestion({...question, signal: first.signal})).toBe('Local');
  expect(getEventListeners(first.signal, 'abort')).toHaveLength(0);
  off();
  inbox.subscribe(() => { if (inbox.interactionSnapshot()) inbox.close(); });
  expect(await inbox.form('settings', form, second.signal)).toBeNull();
  expect(getEventListeners(second.signal, 'abort')).toHaveLength(0);
});

it('routes questions independently through their real core and closes only its own input channel', async () => {
  const inboxes = [createInteractionInbox(), createInteractionInbox()];
  const cores = inboxes.map(inbox => new AgentCore({cwd: process.cwd(), provider: new ScriptedProvider([]), onAsk: inbox.askQuestion}));
  const sessions = cores.map((core, index) => { inboxes[index].bind(core); return connectConversation(core, ['Main', 'Side'][index], inboxes[index]); });
  try {
    const operations = cores.map(core => core.host.emit('service.ui.ask', {plugin: 'core', ...question})
      .catch(error => ({error: String(error)})));
    await expect.poll(() => sessions.every(session => session.snapshot().interaction?.kind === 'question')).toBe(true);
    const first = sessions[0].snapshot().interaction!, second = sessions[1].snapshot().interaction!;
    sessions[0].answerInteraction!(second.id, choice());
    expect(sessions[0].snapshot().interaction?.id).toBe(first.id);
    sessions[0].disconnect();
    sessions[1].answerInteraction!(second.id, choice(['Remote']));
    const [main, side] = await Promise.all(operations);
    expect(main).toMatchObject({error: expect.stringContaining('cancelled')});
    expect(side).toMatchObject({value: {value: {answer: 'Remote'}}});
  } finally {
    for (const session of sessions) session.disconnect();
    await Promise.all(cores.map(core => core.close()));
  }
});

it('keeps an explicit private form alive across foreground interruption and never journals its values', async () => {
  const inbox = createInteractionInbox();
  let received: unknown;
  const provider = new ScriptedProvider([{text: 'Held foreground', hold: true}]);
  const core = new AgentCore({cwd: process.cwd(), provider, onAsk: inbox.askQuestion, userCommands: () => [{name: '/private', plugin: 'settings'}],
    plugins: [{manifest: {name: 'settings', version: '1.0.0', trust: 'trusted'}, hooks: {
      'command.invoke': async (_event, $) => { received = await $.ui.form(form); await $.ui.notify('Private form finished'); },
    }}]});
  inbox.bind(core);
  const events: unknown[] = [];
  const off = core.subscribe(event => events.push(event));
  const session = connectConversation(core, 'Main', inbox);
  try {
    await core.start();
    const foreground = core.submit('Hold');
    await expect.poll(() => provider.requests.length).toBe(1);
    const privateCommand = core.submit('/private');
    await expect.poll(() => session.snapshot().interaction?.kind).toBe('form');
    const shown = session.snapshot().interaction!;
    core.interrupt();
    await foreground;
    expect(session.snapshot().interaction?.id).toBe(shown.id);
    inbox.answerInteraction(shown.id, {...answer, values: {...answer.values, endpoint: 'file:///' + answer.values.token}});
    expect(JSON.stringify(session.snapshot())).not.toContain(answer.values.token);
    inbox.answerInteraction(shown.id, answer);
    await privateCommand;
    expect(received).toEqual(answer);
    expect(JSON.stringify({events, messages: core.getMessages(), session: session.snapshot()})).not.toContain(answer.values.token);
  } finally { session.disconnect(); off(); await core.close(); }
});

it('cancels a new model question after a completed private form and clears the session immediately', async () => {
  const inbox = createInteractionInbox();
  const provider = new ScriptedProvider([
    {toolCalls: [{name: 'ask_user', args: {...question, allowOther: true}}]},
    {text: 'Question cancelled'},
  ]);
  const core = new AgentCore({cwd: process.cwd(), provider, onAsk: inbox.askQuestion,
    controlTools: ['ask_user'], userCommands: () => [{name: '/private', plugin: 'settings'}],
    plugins: [{manifest: {name: 'settings', version: '1.0.0', trust: 'trusted'}, hooks: {
      'command.invoke': async (_event, $) => { await $.ui.form(form); await $.ui.notify('Private form finished'); },
    }}]});
  inbox.bind(core);
  const session = connectConversation(core, 'Main', inbox);
  try {
    await core.start();
    const privateCommand = core.submit('/private');
    await expect.poll(() => session.snapshot().interaction?.kind).toBe('form');
    const formId = session.snapshot().interaction!.id;
    session.answerInteraction!(formId, answer);
    await privateCommand;
    expect(session.snapshot().interaction).toBeUndefined();
    const turn = core.submit('Ask a new question');
    await expect.poll(() => session.snapshot().interaction?.kind).toBe('question');
    const questionId = session.snapshot().interaction!.id;
    expect(questionId).not.toBe(formId);
    session.cancelInteraction!(questionId);
    expect(session.snapshot().interaction).toBeUndefined();
    await turn;
    const tool = core.getMessages().findLast(message => message.role === 'tool');
    expect(tool?.content).toContain('Question cancelled');
    expect(tool?.content).not.toContain('"answer"');
    expect(session.snapshot().messages.at(-1)?.text).toBe('Question cancelled');
  } finally { session.disconnect(); await core.close(); }
});

it('fails closed for unavailable selected factories and never clears a newer form-handler owner', async () => {
  const inbox = createInteractionInbox();
  let created = 0;
  const core = new AgentCore({cwd: process.cwd(), provider: new ScriptedProvider([]), uiControllers: {question: 'custom', form: 'custom'},
    plugins: [{manifest: {name: 'custom', version: '1.0.0', trust: 'trusted'}, hooks: {}, controllers: {
      form: () => { created++; throw Error('PRIVATE_FORM_FACTORY_EXCEPTION'); },
      question: () => { created++; throw Error('PRIVATE_QUESTION_FACTORY_EXCEPTION'); },
    }}]});
  inbox.bind(core);
  try {
    await expect(inbox.askQuestion(question)).rejects.toThrow(/^Selected question controller is unavailable$/);
    expect(await inbox.form('settings', form, new AbortController().signal)).toBeNull();
    expect(created).toBe(2);
    expect(inbox.controllerSnapshot()).toBeUndefined();
    expect(inbox.interactionSnapshot()).toBeUndefined();
    const replacement = core.host.setFormHandler(async () => answer);
    inbox.close();
    let received: unknown;
    core.host.registerPlugin({name: 'settings', version: '1.0.0', trust: 'trusted'}, {
      'ui.press': async (_event, $) => { received = await $.ui.form(form); },
    });
    expect((await core.host.emit('ui.press', {site: 'settings', key: 'open'})).faults).toHaveLength(0);
    expect(received).toEqual(answer);
    replacement();
    const result = await core.host.emit('ui.press', {site: 'settings', key: 'again'});
    expect(result.faults).toHaveLength(1);
    expect(JSON.stringify(result.faults)).toContain('Forms require an interactive UI');
  } finally { inbox.close(); await core.close(); }
});
