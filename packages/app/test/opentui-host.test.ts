import {afterEach, expect, it} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../src/build.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import type {UiSurfaceSource} from '@agent-compositor/renderer-opentui';
import type {PlacementConfig} from '../src/placement.js';
import {handleActionMouseDown} from '../../renderer-opentui/src/mouse-action.js';
import type {UiControllers, UiControllerFactory, UiEditorState} from '@agent-compositor/hooks';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});

async function fixture(options: {ui?: PlacementConfig; controllers?: Partial<Record<'editor'|'approval'|'question'|'form', string>>; onExit?(): void; exec?: 'allow' | 'deny' | 'ask'; questionnaires?: boolean; models?: string[]; enabledPlugins?: string[]; plugins?: {name: string; source: string; commands: unknown[]; hookTimeouts?: Record<string, number>}[]} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'opentui-real-host-'));
  cleanup.push(() => rm(root, {recursive: true, force: true}));
  const cwd = join(root, 'project'), home = join(root, 'home');
  await mkdir(cwd); await mkdir(home);
  for (const plugin of options.plugins ?? []) {
    const directory = join(cwd, 'plugins', plugin.name);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, 'plugin.json'), JSON.stringify({name: plugin.name, version: '1.0.0', trust: 'trusted', main: 'hooks.js',
      commands: plugin.commands, hookTimeouts: plugin.hookTimeouts, compositor: {standard: 1, apiVersion: 1}}));
    await writeFile(join(directory, 'hooks.js'), plugin.source);
  }
  const requests: {model: string; authorization?: string; body: any}[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({data: (options.models ?? ['configured-model']).map(id => ({id}))})); return;
    }
    if (req.url !== '/v1/chat/completions') {res.writeHead(404).end(); return;}
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({model: body.model, authorization: req.headers.authorization, body});
    res.writeHead(200, {'content-type': 'text/event-stream'});
    const task = body.messages.filter((message: any) => message.role === 'user').at(-1)?.content;
    const answer = body.messages.some((message: any) => message.role === 'tool' && message.tool_call_id === 'question');
    const question = task === 'Ask before continuing' && !answer;
    const delta = question ? {tool_calls: [{index: 0, id: 'question', type: 'function', function: {name: 'ask_user', arguments: JSON.stringify({question: 'Choose execution mode', options: ['Local', 'Remote'], allowOther: false})}}]} : {content: 'REAL_ROUTER_COMPLETED'};
    res.end('data: ' + JSON.stringify({choices: [{delta, finish_reason: question ? 'tool_calls' : 'stop'}]}) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanup.push(async () => {server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));});
  const endpoint = `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`;
  const env = {HOME: home, AGENT_HOME: join(home, '.agent-compositor'), AGENT_BASE_URL: endpoint, AGENT_MODEL: 'initial-model', AGENT_API_KEY: ''};
  await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({
    enabledPlugins: ['model-selector', 'provider-auth', 'session-manager', ...(options.enabledPlugins ?? []), ...(options.plugins ?? []).map(plugin => plugin.name)],
    agent: {tools: ['ask_user', ...(options.questionnaires ? ['ask_questions'] : []), ...(options.exec ? ['exec'] : [])], builtinTools: options.exec ? ['exec'] : [], controlTools: ['ask_user', ...(options.questionnaires ? ['ask_questions'] : [])], skills: false, projectContext: false, fileReferences: false, verifyCompletion: false},
    ...(options.exec ? {permissions: {rules: [{tool: 'exec', decision: options.exec}]}} : {}),
    compaction: {enabled: false},
    ...(options.ui || options.controllers ? {ui: {...options.ui, ...(options.controllers ? {controllers: options.controllers} : {})}} : {}),
  }));
  const app = await buildApp({cwd, env, agentHub: false});
  cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});
  layout.resize(140, 40);
  cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout, {onExit: options.onExit});
  cleanup.push(() => host.close());
  const events: unknown[] = [];
  host.core.subscribe(event => events.push(event));
  await host.start();
  const find = (id: string) => host.surfaces.snapshot().find(source => source.id === id);
  const form = () => host.surfaces.snapshot().find(source => source.snapshot().form);
  const waitForm = async (title: string) => {
    await expect.poll(() => form()?.snapshot().form?.request.title).toBe(title);
    return form()!;
  };
  const answer = (source: UiSurfaceSource, action: string, values: Record<string, string | boolean>) =>
    source.answerForm!(source.snapshot().form!.id, {action, values});
  return {root, cwd, home, endpoint, env, app, layout, host, requests, events, find, form, waitForm, answer};
}

async function connection(f: Awaited<ReturnType<typeof fixture>>) {
  await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')?.snapshot().view?.lines.some(line => line.action === 'add')).toBe(true);
  const models = f.find('plugin-model-selector-models')!;
  await expect.poll(() => models.snapshot().busy).toBe(false);
  models.press('add', models.snapshot().revision);
  const preset = await f.waitForm('Add provider');
  f.answer(preset, 'next', {preset: 'compatible'});
  const form = await f.waitForm('New provider connection');
  return {models, form};
}

function focusGate() {
  let release!: () => void, entered = false;
  const ready = new Promise<void>(resolve => {release = resolve;});
  cleanup.push(async () => release());
  return {release, entered: () => entered, async wait(signal: AbortSignal) {
    entered = true;let abort!: () => void;
    try {await Promise.race([ready, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);signal.addEventListener('abort', abort, {once: true});if (signal.aborted)abort();
    })]);signal.throwIfAborted();} finally {signal.removeEventListener('abort', abort);}
  }};
}
async function focusFixture(handler: (event: any, $: any) => unknown, ui?: PlacementConfig) {
  const f = await fixture({ui, plugins: [{name: 'focus-probe', source: 'export default {};', commands: [
    {name: '/focus-slow', description: 'Open a controlled view', ui: {site: 'slow'}},
    {name: '/focus-launch', description: 'Launch a retained view', ui: {site: 'launcher'}},
  ]}]});
  f.host.core.host.unregisterPlugin('focus-probe');
  f.host.core.host.registerPlugin({name: 'focus-probe', version: '1.0.0', trust: 'trusted', hookTimeouts: {'ui.press': 15000}}, {'ui.press': handler});
  return f;
}

async function controllerFixture(factories: UiControllers, options: Parameters<typeof fixture>[0] = {}) {
  const f = await fixture({...options, controllers: Object.fromEntries(Object.keys(factories).map(kind => [kind, 'selected-input'])),
    plugins: [...(options.plugins ?? []), {name: 'selected-input', source: 'export default {};', commands: []}]});
  f.host.core.host.unregisterPlugin('selected-input');
  f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], factories);
  return f;
}
function editorFactory(states: UiEditorState[] = [], data: unknown[] = []): UiControllerFactory {
  return request => {
    let {text, cursor} = request.state as UiEditorState;states.push({text, cursor});data.push(request.data);
    return {snapshot: () => ({text, cursor}), render: () => ({lines: [{text: 'MASKED EDITOR ' + text.length}]}),
      handle: input => {
        if (input.kind === 'text') {text = text.slice(0, cursor) + input.text + text.slice(cursor);cursor += input.text.length;}
        if (input.kind === 'key' && (input.key === 'f2' || input.key === 'f3')) {const value = text;text = '';cursor = 0;return {type: input.key === 'f2' ? 'submit' : 'steer', text: value};}
      }, dispose() {text = '';cursor = 0;},
    };
  };
}
async function editorInput(f: Awaited<ReturnType<typeof fixture>>, input: Parameters<NonNullable<typeof f.host.session.editorInput>>[1]) {
  const frame = f.host.session.snapshot().editor!;
  const ticket = f.host.session.editorInput!(frame.id, input, frame.revision);
  expect(ticket).toBeTypeOf('number');
  await expect.poll(() => f.host.session.snapshot().editor?.inputRevision).toBe(ticket);
  return ticket;
}

it('sends a selected editor draft through actual Core admission without leaking the unsubmitted private checkpoint', async () => {
  const data: unknown[] = [], admission = focusGate();
  const f = await controllerFixture({editor: editorFactory([], data)});
  f.host.core.host.registerPlugin({name: 'editor-admission-gap', version: '1.0.0', trust: 'trusted'}, {
    'prompt.submit': async (_event, $) => {await admission.wait($.signal);},
  });
  expect(f.host.session.snapshot().editor).toMatchObject({available: true, kind: 'editor'});
  expect(data[0]).toMatchObject({sessionId: f.host.core.sessionId, commands: expect.any(Function), files: expect.any(Function)});
  await editorInput(f, {kind: 'text', text: 'PRIVATE_DRAFT 窗🙂'});
  expect(JSON.stringify(f.host.session.snapshot())).not.toMatch(/PRIVATE_DRAFT|cursor|commands|sessionId/);
  expect(f.requests).toHaveLength(0);expect(JSON.stringify(await f.app.store.load(f.host.core.sessionId, f.cwd))).not.toContain('PRIVATE_DRAFT');
  await editorInput(f, {kind: 'key', key: 'f2'});
  expect(f.host.session.snapshot().editor?.admission).toMatchObject({type: 'submit', status: 'accepted'});
  await expect.poll(admission.entered).toBe(true);
  // Admission precedes turn.start: the existing conversation still paints idle.
  expect(f.host.core.getState()).toBe('running');expect(f.host.session.snapshot().running).toBe(false);
  expect(f.host.core.getMessages().some(message => message.role === 'user' && message.content === 'PRIVATE_DRAFT 窗🙂')).toBe(false);
  expect(f.requests).toHaveLength(0);
  admission.release();
  await expect.poll(() => f.requests.filter(request => request.body.messages.filter((message: any) => message.role === 'user').at(-1)?.content === 'PRIVATE_DRAFT 窗🙂')).toHaveLength(1);
  await expect.poll(() => f.host.session.snapshot().messages.at(-1)).toEqual({role: 'assistant', text: 'REAL_ROUTER_COMPLETED'});
  await expect.poll(() => f.host.session.snapshot().running).toBe(false);
  expect(f.host.core.getMessages().some(message => message.role === 'user' && message.content === 'PRIVATE_DRAFT 窗🙂')).toBe(true);
  expect(f.requests).toHaveLength(1);expect(f.host.session.snapshot().editor?.view.lines[0].text).toBe('MASKED EDITOR 0');
});

it('queues selected Draft submit and steer while Main waits for a question and admits neither as an answer', async () => {
  const f = await controllerFixture({editor: editorFactory()});
  const pending = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const request = f.host.session.snapshot().interaction!;
  await editorInput(f, {kind: 'text', text: 'Queued selected draft'});await editorInput(f, {kind: 'key', key: 'f2'});
  expect(f.host.session.snapshot().editor?.admission).toMatchObject({type: 'submit', status: 'queued'});
  await editorInput(f, {kind: 'text', text: 'Steering selected draft'});await editorInput(f, {kind: 'key', key: 'f3'});
  expect(f.host.session.snapshot().editor?.admission).toMatchObject({type: 'steer', status: 'queued'});
  expect(f.host.session.snapshot().interaction?.id).toBe(request.id);expect(f.requests).toHaveLength(1);
  f.host.session.answerInteraction!(request.id, {answers: [{id: 'answer', selected: ['Local']}]});
  await pending;
  expect(f.host.session.snapshot().interaction).toBeUndefined();expect(f.host.session.snapshot().editor?.view.lines[0].text).toBe('MASKED EDITOR 0');
  expect(f.host.core.getMessages().some(message => message.role === 'user' && message.content === 'Queued selected draft')).toBe(true);
});

it('keeps an accepted selected draft consumed after the actual model stream fails', async () => {
  const states: UiEditorState[] = [], f = await controllerFixture({editor: editorFactory(states)});
  f.host.core.runtime.setResolver('service.model.stream', () => {throw Error('Model transport failed after admission');});
  await editorInput(f, {kind: 'text', text: 'Accepted before transport failure'});await editorInput(f, {kind: 'key', key: 'f2'});
  await expect.poll(() => f.host.session.snapshot().error).toContain('Model transport failed');
  expect(f.host.session.snapshot().editor?.admission?.status).toBe('accepted');expect(f.host.session.snapshot().editor?.view.lines[0].text).toBe('MASKED EDITOR 0');
  expect(states).toHaveLength(1);expect(f.host.core.getMessages().some(message => message.role === 'user' && message.content === 'Accepted before transport failure')).toBe(true);
});

it('keeps a late editor UI destination passive after newer navigation and gives a fresh command its own focus', async () => {
  const gate = focusGate(), base = editorFactory();
  const f = await controllerFixture({editor: (request, context) => {
    const instance = base(request, context);
    return {...instance, handle: async input => {const result = instance.handle(input);if (input.kind === 'key' && input.key === 'f2')await gate.wait(context.signal);return result;}};
  }}, {plugins: [{name: 'editor-route', commands: [{name: '/editor-route', description: 'Open fixture', execution: 'immediate'}],
    source: "export default {'command.invoke':async(_,$)=>{await $.ui.view('result','Editor route',{lines:[{text:'EDITOR_ROUTE_READY'}]},{workspace:6,focus:true});}};"}]});
  await editorInput(f, {kind: 'text', text: '/editor-route'});
  const frame = f.host.session.snapshot().editor!;f.host.session.editorInput!(frame.id, {kind: 'key', key: 'f2'}, frame.revision);
  await expect.poll(gate.entered).toBe(true);f.layout.act({type: 'workspace', id: 2});gate.release();
  await expect.poll(() => f.find('plugin-editor-route-result')?.snapshot().view?.lines[0].text).toBe('EDITOR_ROUTE_READY');
  expect(f.layout.snapshot().workspace).toBe(2);expect(f.layout.snapshot().locations['plugin-editor-route-result']).toBe(6);
  f.layout.act({type: 'open', id: 'session'});await editorInput(f, {kind: 'text', text: '/editor-route'});await editorInput(f, {kind: 'key', key: 'f2'});
  await expect.poll(() => f.layout.snapshot().focused).toBe('plugin-editor-route-result');expect(f.layout.snapshot().workspace).toBe(6);
  expect(f.requests).toHaveLength(0);
});

it('keeps a newer editor command focused when an older command publishes after it', async () => {
  const gate = focusGate(), commands = ['/editor-first', '/editor-second'].map(name => ({name, description: name, execution: 'immediate'}));
  const f = await controllerFixture({editor: editorFactory()}, {plugins: [{name: 'editor-sequence', commands, source: "export default {'command.invoke':()=>{}};" }]});
  f.host.core.host.unregisterPlugin('editor-sequence');
  f.host.core.host.registerPlugin({name: 'editor-sequence', version: '1.0.0', trust: 'trusted'}, {
    'command.invoke': async (event, $) => {
      const first = event.name === '/editor-first';if (first)await gate.wait($.signal);
      await $.ui.view(first ? 'first' : 'second', first ? 'First route' : 'Second route', {lines: [{text: 'Ready'}]}, {workspace: first ? 5 : 6, focus: true});
    },
  });
  expect(f.app.commands().filter(command => command.name.startsWith('/editor-'))).toHaveLength(2);
  expect(f.host.core.hasImmediateCommand('/editor-first')).toBe(true);
  await editorInput(f, {kind: 'text', text: '/editor-first'});await editorInput(f, {kind: 'key', key: 'f2'});
  await expect.poll(gate.entered).toBe(true);
  await editorInput(f, {kind: 'text', text: '/editor-second'});await editorInput(f, {kind: 'key', key: 'f2'});
  await expect.poll(() => f.layout.snapshot().focused).toBe('plugin-editor-sequence-second');gate.release();
  await expect.poll(() => f.find('plugin-editor-sequence-first')?.snapshot().view?.lines[0].text).toBe('Ready');
  expect(f.layout.snapshot().focused).toBe('plugin-editor-sequence-second');expect(f.layout.snapshot().workspace).toBe(6);
});

it('restores a rejected selected editor UI command when all four real interface slots are held', async () => {
  const states: UiEditorState[] = [];
  const f = await controllerFixture({editor: editorFactory(states)}, {plugins: [{name: 'editor-hold', commands: [{name: '/editor-hold', description: 'Hold', execution: 'immediate'}],
    source: "export default {'command.invoke':async(event,$)=>{await $.ui.form({title:'Hold '+event.args,fields:[{id:'value',label:'Value',type:'text'}],actions:[{id:'cancel',label:'Cancel'}]});}};"}]});
  for (let index = 0; index < 4; index++) {await f.host.submit('/editor-hold ' + index);await expect.poll(() => f.host.surfaces.snapshot().filter(source => source.snapshot().form).length).toBe(index + 1);}
  f.layout.act({type: 'open', id: 'session'});await editorInput(f, {kind: 'text', text: '/settings'});await editorInput(f, {kind: 'key', key: 'f2'});
  expect(f.host.session.snapshot().editor?.admission).toMatchObject({status: 'rejected'});
  expect(states.at(-1)).toEqual({text: '/settings', cursor: 9});expect(f.host.session.snapshot().editor?.view.lines[0].text).toBe('MASKED EDITOR 9');
  expect(f.find('plugin-model-selector-models')).toBeUndefined();expect(f.requests).toHaveLength(0);
  for (const source of f.host.surfaces.snapshot())if (source.snapshot().form)source.cancelForm!(source.snapshot().form!.id);
});

it('preserves a selected editor checkpoint before unload and resume while revoking old capabilities and stale paints', async () => {
  const states: UiEditorState[] = [], data: any[] = [], factory = editorFactory(states, data);
  const f = await controllerFixture({editor: factory});await editorInput(f, {kind: 'text', text: 'Saved 窗🙂 draft'});
  const old = f.host.session.snapshot().editor!, oldCore = f.host.core, oldData = data.at(-1);
  expect(await oldData.files('')).toBeInstanceOf(Array);
  const pendingFiles = oldData.files('').then(() => 'allowed', () => 'expired');
  f.host.core.host.unregisterPlugin('selected-input');expect(f.host.session.snapshot().editor?.available).toBe(false);
  expect(await pendingFiles).toBe('expired');
  expect(() => oldData.commands()).toThrow();await expect(oldData.files('')).rejects.toThrow();
  f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  expect(states.at(-1)).toEqual({text: 'Saved 窗🙂 draft', cursor: 15});
  expect(f.host.session.editorInput!(old.id, {kind: 'key', key: 'f2'}, old.revision)).toBeUndefined();
  await f.host.submit('/reload');expect(f.host.session.snapshot().editor?.available).toBe(false);
  f.host.core.host.unregisterPlugin('selected-input');f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  expect(states.at(-1)).toEqual({text: 'Saved 窗🙂 draft', cursor: 15});
  const target = await f.app.store.create(f.cwd, {name: 'Editor resume target'});
  const resumed = await f.host.core.host.emit('service.session.control', {action: 'resume', id: target.id});expect(resumed.value).toEqual({value: true});
  expect(f.host.core).not.toBe(oldCore);expect(f.host.session.snapshot().editor?.available).toBe(false);
  f.host.core.host.unregisterPlugin('selected-input');f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  expect(states.at(-1)).toEqual({text: 'Saved 窗🙂 draft', cursor: 15});expect(f.requests).toHaveLength(0);
});

it('does not transfer a consumed selected draft when its accepted prompt synchronously unloads the editor provider', async () => {
  const states: UiEditorState[] = [], factory = editorFactory(states), f = await controllerFixture({editor: factory});
  f.host.core.host.registerPlugin({name: 'accepted-unload', version: '1.0.0', trust: 'trusted'}, {
    'prompt.submit': () => {f.host.core.host.unregisterPlugin('selected-input');return {drop: 'Accepted control'};},
  });
  await editorInput(f, {kind: 'text', text: 'Already accepted draft'});
  const frame = f.host.session.snapshot().editor!;f.host.session.editorInput!(frame.id, {kind: 'key', key: 'f2'}, frame.revision);
  await expect.poll(() => f.host.session.snapshot().editor?.available).toBe(false);
  await expect.poll(() => f.host.core.getState()).toBe('idle');expect(f.requests).toHaveLength(0);
  f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  expect(states.at(-1)).toEqual({text: '', cursor: 0});
});

it('keeps an accepted editor reload command consumed across the real plugin replacement', async () => {
  const states: UiEditorState[] = [], factory = editorFactory(states), f = await controllerFixture({editor: factory});
  await editorInput(f, {kind: 'text', text: '/reload'});
  const frame = f.host.session.snapshot().editor!;f.host.session.editorInput!(frame.id, {kind: 'key', key: 'f2'}, frame.revision);
  await expect.poll(() => f.host.session.snapshot().editor?.available).toBe(false);
  await expect.poll(() => f.host.session.snapshot().notice).toMatch(/^Reloaded /);
  f.host.core.host.unregisterPlugin('selected-input');f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  expect(states.at(-1)).toEqual({text: '', cursor: 0});expect(f.requests).toHaveLength(0);
});

it('rejects stale selected editor paints and unfocused or Finder input and counts only admitted edits as fresh intent', async () => {
  const f = await controllerFixture({editor: editorFactory()}), initial = f.host.session.snapshot().editor!, intent = f.layout.windowIntentRevision;
  f.host.session.editorViewport!(initial.id, 38, 3);expect(f.layout.windowIntentRevision).toBe(intent);
  expect(f.host.session.editorInput!(initial.id, {kind: 'text', text: 'stale'}, initial.revision)).toBeUndefined();
  const frame = f.host.session.snapshot().editor!;f.layout.act({type: 'workspace', id: 2});
  expect(f.host.session.editorInput!(frame.id, {kind: 'text', text: 'hidden'}, frame.revision)).toBeUndefined();
  f.layout.act({type: 'open', id: 'session'});f.host.navigation.openFinder();
  expect(f.host.session.editorInput!(frame.id, {kind: 'text', text: 'finder'}, frame.revision)).toBeUndefined();
  f.host.navigation.handle({kind: 'key', key: 'escape'});const currentIntent = f.layout.windowIntentRevision;
  await editorInput(f, {kind: 'text', text: 'admitted'});expect(f.layout.windowIntentRevision).toBe(currentIntent + 1);expect(f.requests).toHaveLength(0);
});

it('revokes an uncooperative old-generation editor submit during resume and transfers its unaccepted draft', async () => {
  const states: UiEditorState[] = [], gate = focusGate(), factory = editorFactory(states);
  const f = await controllerFixture({editor: (request, context) => {
    const instance = factory(request, context);
    return {...instance, handle: async input => {
      const result = instance.handle(input);
      if (input.kind === 'key' && input.key === 'f2')await gate.wait(new AbortController().signal);
      return result;
    }};
  }});
  await editorInput(f, {kind: 'text', text: 'Unaccepted before resume'});
  const old = f.host.session.snapshot().editor!;
  f.host.session.editorInput!(old.id, {kind: 'key', key: 'f2'}, old.revision);await expect.poll(gate.entered).toBe(true);
  const target = await f.app.store.create(f.cwd, {name: 'Deferred editor target'});
  await f.host.core.host.emit('service.session.control', {action: 'resume', id: target.id});
  f.host.core.host.unregisterPlugin('selected-input');f.host.core.host.registerPlugin({name: 'selected-input', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  expect(states.at(-1)).toEqual({text: 'Unaccepted before resume', cursor: 24});
  gate.release();await Promise.resolve();await Promise.resolve();
  expect(f.requests).toHaveLength(0);expect(f.host.core.getMessages().some(message => message.role === 'user')).toBe(false);
  expect(f.host.session.editorInput!(old.id, {kind: 'key', key: 'f2'}, old.revision)).toBeUndefined();
});

it('applies selected editor interrupt to the running Core and requests exit only while idle', async () => {
  let exits = 0;const base = editorFactory();
  const f = await controllerFixture({editor: (request, context) => {
    const instance = base(request, context);return {...instance, handle: input => input.kind === 'key' && input.key === 'f4'
      ? {type: 'interrupt'} : instance.handle(input)};
  }}, {onExit: () => {exits++;}});
  const pending = f.host.submit('Ask before continuing');await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  await editorInput(f, {kind: 'key', key: 'f4'});await pending;
  expect(f.host.core.getState()).toBe('interrupted');expect(f.host.session.snapshot().interaction).toBeUndefined();expect(exits).toBe(0);
  await editorInput(f, {kind: 'key', key: 'f4'});expect(exits).toBe(1);
});
async function controllerLauncher(f: Awaited<ReturnType<typeof fixture>>, handler: (event: any, $: any) => unknown) {
  f.host.core.host.registerPlugin({name: 'controller-requester', version: '1.0.0', trust: 'trusted', hookTimeouts: {'ui.press': 15000}}, {'ui.press': handler});
  await f.host.core.host.emit('service.ui.view', {plugin: 'controller-requester', id: 'launcher', title: 'Controller launcher',
    view: {lines: [{text: 'Start', action: 'start'}]}, placement: {focus: false}});
  const source = f.find('plugin-controller-requester-launcher')!;source.press('start', source.snapshot().revision);return source;
}

function scopedWorker() {
  return {name: 'scoped-worker', commands: [{name: '/controller-exec', description: 'Run a reviewed fixture', execution: 'immediate'}],
    source: `export default {'command.invoke':async(event,$)=>{
      const result=await $.agent.tool('exec',{command:'/bin/sh ./controller-effect.sh'});
      await $.storage.set(event.args.trim(),result,'project');
    }};`};
}

it.each(['once', 'session', 'project'] as const)('preserves selected approval %s scope through the real Core policy and process boundary', async scope => {
  let factories = 0;
  const f = await controllerFixture({approval: () => {factories++;return {
    render: () => ({lines: [{text: 'PRIVATE APPROVAL 窗', cells: [{ch: 'A', fg: '#abcdef', bold: true}]}]}),
    handle: input => input.kind === 'key' ? input.key === 'f5' ? {allow: true, scope} : {allow: false, scope: 'once'} : undefined,
  };}}, {exec: 'ask', plugins: [scopedWorker()]});
  await writeFile(join(f.cwd, 'controller-effect.sh'), 'printf "approved\\n" >> controller-effect.txt\n');
  const result = (name: string) => f.app.storage.read('scoped-worker', name, 'project', f.host.core.sessionId);
  const approval = () => f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'approval');
  await f.host.submit('/controller-exec first');await expect.poll(() => approval()?.snapshot().controller?.kind).toBe('approval');
  const source = approval()!, frame = source.snapshot().controller!;
  expect(source.snapshot().approval).toBeUndefined();expect(source.snapshot().interaction).toBeUndefined();
  expect(JSON.stringify(source.snapshot())).not.toMatch(/descriptor|controller-effect\.sh|Permission tokens|Arguments/);
  await expect(readFile(join(f.cwd, 'controller-effect.txt'))).rejects.toMatchObject({code: 'ENOENT'});
  source.controllerInput!(frame.id, {kind: 'key', key: 'f5'}, frame.revision);
  await expect.poll(() => result('first')).toMatchObject({ok: true});
  await f.host.submit('/controller-exec second');
  if (scope === 'once') {
    await expect.poll(() => approval()?.snapshot().controller?.kind).toBe('approval');
    const next = approval()!, current = next.snapshot().controller!;
    next.controllerInput!(current.id, {kind: 'key', key: 'f3'}, current.revision);
  }
  await expect.poll(() => result('second')).toMatchObject({ok: scope !== 'once'});
  expect(factories).toBe(scope === 'once' ? 2 : 1);
  expect((await readFile(join(f.cwd, 'controller-effect.txt'), 'utf8')).trim().split('\n')).toHaveLength(scope === 'once' ? 1 : 2);
  const files = await readdir(join(f.app.storage.paths.home, 'approvals')).catch(() => []);
  expect(files).toHaveLength(scope === 'project' ? 1 : 0);
  if (scope === 'project')expect(JSON.parse(await readFile(join(f.app.storage.paths.home, 'approvals', files[0]), 'utf8'))).toContainEqual(expect.objectContaining({note: 'project'}));
  expect(f.requests).toHaveLength(0);
});

it('denies falsey or malformed selected approval results without a process effect', async () => {
  let value: unknown;
  const f = await controllerFixture({approval: () => ({render: () => ({lines: [{text: 'Approval'}]}), handle: () => value})},
    {exec: 'ask', plugins: [scopedWorker()]});
  await writeFile(join(f.cwd, 'controller-effect.sh'), 'printf forbidden > controller-effect.txt\n');
  for (const [index, invalid] of [null, false, 0, {allow: 'PRIVATE_INVALID'}, {allow: true, scope: 'forever'}].entries()) {
    value = invalid;await f.host.submit('/controller-exec invalid' + index);
    await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller?.kind === 'approval')).toBe(true);
    const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'approval')!, current = source.snapshot().controller!;
    source.controllerInput!(current.id, {kind: 'key', key: 'f5'}, current.revision);
    await expect.poll(() => f.app.storage.read('scoped-worker', 'invalid' + index, 'project', f.host.core.sessionId)).toMatchObject({ok: false});
  }
  await expect(readFile(join(f.cwd, 'controller-effect.txt'))).rejects.toMatchObject({code: 'ENOENT'});
  expect(JSON.stringify(f.events)).not.toContain('PRIVATE_INVALID');
});

it('projects a selected Main question privately and accepts only the current focused controller receipt', async () => {
  let request: unknown, handled = 0;
  const f = await controllerFixture({question: ({data}) => {request = data;return {
    render: ({columns}) => ({lines: [{text: `CUSTOM QUESTION ${columns}`}]}),
    handle: input => {handled++;return input.kind === 'key' && input.key === 'f4' ? {answer: 'Remote'} : undefined;},
  };}});
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().controller?.kind).toBe('question');
  const initial = f.host.session.snapshot().controller!;
  expect(request).toMatchObject({question: 'Choose execution mode', options: ['Local', 'Remote']});
  expect(f.host.session.snapshot().interaction).toBeUndefined();expect(f.host.session.snapshot().approval).toBeUndefined();
  expect(JSON.stringify(f.host.session.snapshot())).not.toContain('Choose execution mode');
  f.host.session.controllerViewport!(initial.id, 38, 6);const current = f.host.session.snapshot().controller!;
  expect(current.view.lines[0].text).toBe('CUSTOM QUESTION 38');
  expect(f.host.session.controllerInput!(initial.id, {kind: 'key', key: 'f4'}, initial.revision)).toBeUndefined();
  f.layout.act({type: 'workspace', id: 2});
  expect(f.host.session.controllerInput!(current.id, {kind: 'key', key: 'f4'}, current.revision)).toBeUndefined();expect(handled).toBe(0);
  f.layout.act({type: 'open', id: 'session'});
  expect(f.host.session.controllerInput!(current.id, {kind: 'key', key: 'f4'}, current.revision)).toBe(1);
  await main;expect(handled).toBe(1);expect(f.host.session.snapshot().controller).toBeUndefined();expect(f.requests).toHaveLength(2);
});

it('keeps an unscoped selected form in idle Main while an ordinary prompt receives a real provider response', async () => {
  let received: unknown = 'pending', request: unknown, value = '';
  const f = await controllerFixture({form: ({data}) => {request = data;return {
    render: () => ({lines: [{text: 'PARKED FORM ' + '*'.repeat(value.length)}]}),
    handle: input => {
      if (input.kind === 'text')value += input.text;
      if (input.kind === 'key' && input.key === 'f5')return {action: 'save', values: {value}};
    },
  };}});
  f.host.core.host.registerPlugin({name: 'unscoped-controller', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (_event, $) => {received = await $.ui.form({title: 'PRIVATE_IDLE_FORM',
      fields: [{id: 'value', label: 'Value', type: 'text', value: 'PRIVATE_DEFAULT'}], actions: [{id: 'save', label: 'Save'}]});},
  });
  const pending = f.host.core.host.emit('ui.press', {site: 'unscoped', key: 'open'});
  await expect.poll(() => f.host.session.snapshot().controller?.kind).toBe('form');
  const frame = f.host.session.snapshot().controller!;
  expect(f.host.core.getState()).toBe('idle');expect(f.host.session.snapshot().running).toBe(false);
  expect(request).toMatchObject({title: 'PRIVATE_IDLE_FORM', fields: [{value: 'PRIVATE_DEFAULT'}]});
  expect(f.host.session.snapshot().interaction).toBeUndefined();expect(f.host.surfaces.snapshot().some(source => source.snapshot().controller)).toBe(false);
  f.host.session.controllerInput!(frame.id, {kind: 'text', text: 'PRIVATE_ENTERED_VALUE'}, frame.revision);
  await f.host.submit('Continue while the local form waits');
  expect(f.requests).toHaveLength(1);expect(f.host.session.snapshot().messages.at(-1)?.text).toBe('REAL_ROUTER_COMPLETED');
  expect(f.host.session.snapshot().controller).toMatchObject({id: frame.id, kind: 'form', inputRevision: 1});
  expect(f.host.session.snapshot().running).toBe(false);expect(received).toBe('pending');
  expect(JSON.stringify({snapshot: f.host.session.snapshot(), requests: f.requests, messages: f.host.core.getMessages()})).not.toMatch(/PRIVATE_(?:IDLE_FORM|DEFAULT|ENTERED_VALUE)/);
  expect(JSON.stringify(await f.app.store.load(f.host.core.sessionId, f.cwd))).not.toContain('PRIVATE_');
  const current = f.host.session.snapshot().controller!;
  f.host.session.controllerInput!(current.id, {kind: 'key', key: 'f5'}, current.revision);await pending;
  expect(received).toEqual({action: 'save', values: {value: 'PRIVATE_ENTERED_VALUE'}});
  expect(f.host.session.snapshot().controller).toBeUndefined();expect(f.requests).toHaveLength(1);
});

it('keeps selected form factory defaults and entered values out of renderer DTOs while rejecting invalid output in place', async () => {
  let data: unknown, value = '', received: unknown;
  const f = await controllerFixture({form: request => {data = request.data;return {
    render: () => ({lines: [{text: 'MASKED FORM ' + '*'.repeat(value.length)}]}),
    handle: input => {
      if (input.kind === 'text')value += input.text;
      if (input.kind === 'key' && input.key === 'f4')return {action: 'unoffered', values: {token: value}};
      if (input.kind === 'key' && input.key === 'f5')return {action: 'save', values: {token: value, undeclared: 'drop'}};
      if (input.kind === 'key' && input.key === 'f3')return null;
    },
  };}});
  const launcher = await controllerLauncher(f, async (_event, $) => {received = await $.ui.form({title: 'PRIVATE_FACTORY_TITLE',
    fields: [{id: 'token', label: 'Private token', type: 'text', value: 'PRIVATE_DEFAULT'}], actions: [{id: 'save', label: 'Save'}]});});
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller?.kind === 'form')).toBe(true);
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'form')!, first = source.snapshot().controller!;
  expect(data).toMatchObject({title: 'PRIVATE_FACTORY_TITLE', fields: [{value: 'PRIVATE_DEFAULT'}]});
  expect(source.snapshot().form).toBeUndefined();expect(source.snapshot().interaction).toBeUndefined();
  source.controllerInput!(first.id, {kind: 'text', text: 'PRIVATE_SUBMITTED'}, first.revision);
  for (const key of ['f3', 'f4']) {
    const frame = source.snapshot().controller!;source.controllerInput!(frame.id, {kind: 'key', key}, frame.revision);
    expect(source.snapshot().controller?.id).toBe(first.id);
    expect(source.snapshot().controller?.view.lines.some(line => line.text === 'Complete the form with valid fields and an offered action')).toBe(true);
    expect(received).toBeUndefined();
  }
  expect(JSON.stringify(source.snapshot())).not.toMatch(/PRIVATE_(?:FACTORY_TITLE|DEFAULT|SUBMITTED)|"(?:fields|values|lease)":/);
  const frame = source.snapshot().controller!;source.controllerInput!(frame.id, {kind: 'key', key: 'f5'}, frame.revision);
  await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(received).toEqual({action: 'save', values: {token: 'PRIVATE_SUBMITTED'}});
  expect(JSON.stringify(f.events)).not.toContain('PRIVATE_SUBMITTED');expect(JSON.stringify(await f.app.store.load(f.host.core.sessionId, f.cwd))).not.toContain('PRIVATE_SUBMITTED');
});

it('keeps the admitted form validator authoritative when the selected factory mutates its private declaration', async () => {
  let received: unknown = 'pending';
  const f = await controllerFixture({form: ({data}) => {
    const declaration = data as {fields: {id: string; required?: boolean; type: string; label: string}[]; actions: {id: string; label: string}[]};
    declaration.fields[0].required = false;
    declaration.fields.push({id: 'injected', label: 'Foreign field', type: 'text'});
    declaration.actions.push({id: 'injected', label: 'Foreign action'});
    return {render: () => ({lines: [{text: 'Selected form'}]}), handle: input => {
      if (input.kind !== 'key')return;
      if (input.key === 'f4')return {action: 'injected', values: {token: '', injected: 'foreign'}};
      if (input.key === 'f3')return {action: 'save', values: {token: '', injected: 'foreign'}};
      return {action: 'save', values: {token: 'valid original field', injected: 'must be dropped'}};
    }};
  }});
  const launcher = await controllerLauncher(f, async (_event, $) => {received = await $.ui.form({title: 'Original declaration',
    fields: [{id: 'token', label: 'Token', type: 'text', required: true}], actions: [{id: 'save', label: 'Save'}]});});
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller?.kind === 'form')).toBe(true);
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'form')!, id = source.snapshot().controller!.id;
  for (const key of ['f4', 'f3']) {
    const current = source.snapshot().controller!;source.controllerInput!(id, {kind: 'key', key}, current.revision);
    expect(source.snapshot().controller?.id).toBe(id);expect(received).toBe('pending');
    expect(source.snapshot().controller?.view.lines.at(-1)?.text).toBe('Complete the form with valid fields and an offered action');
  }
  source.controllerInput!(id, {kind: 'key', key: 'f5'}, source.snapshot().controller!.revision);
  await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(received).toEqual({action: 'save', values: {token: 'valid original field'}});
});

it.each(['Main', 'workspace'] as const)('settles an admitted async selected form after newer %s intent without recapturing focus', async navigation => {
  let gate!: ReturnType<typeof focusGate>, result: unknown;
  const f = await controllerFixture({form: () => ({render: () => ({lines: [{text: 'Async form'}]}), handle: async () => {
    await gate.wait(new AbortController().signal);return {action: 'save', values: {value: 'PRIVATE_ASYNC'}};
  }})});
  gate = focusGate();const launcher = await controllerLauncher(f, async (_event, $) => {
    result = await $.ui.form({title: 'Async', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});
    await $.ui.view('returned', 'Async result', {lines: [{text: 'Completed'}]}, {workspace: 6, focus: true});
  });
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller?.kind === 'form')).toBe(true);
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'form')!, frame = source.snapshot().controller!;
  expect(source.controllerInput!(frame.id, {kind: 'key', key: 'f5'}, frame.revision)).toBe(1);await expect.poll(gate.entered).toBe(true);
  f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});if (navigation === 'workspace')f.layout.act({type: 'workspace', id: 2});
  const before = f.layout.snapshot(), epoch = f.layout.windowIntentRevision;
  gate.release();await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(result).toEqual({action: 'save', values: {value: 'PRIVATE_ASYNC'}});
  expect(f.find('plugin-controller-requester-returned')?.snapshot().view?.lines[0].text).toBe('Completed');
  expect(f.layout.snapshot()).toMatchObject({workspace: before.workspace, focused: before.focused});expect(f.layout.windowIntentRevision).toBe(epoch);
  expect(JSON.stringify(f.events)).not.toContain('PRIVATE_ASYNC');
});

it('does not let the previous selected request identity settle its successor in the same private operation', async () => {
  let handled = 0;const results: unknown[] = [];
  const f = await controllerFixture({form: () => ({render: () => ({lines: [{text: 'Selected form'}]}),
    handle: () => {handled++;return {action: 'save', values: {value: 'exact'}};}})});
  const launcher = await controllerLauncher(f, async (_event, $) => {
    for (const title of ['First private request', 'Second private request'])results.push(await $.ui.form({title,
      fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]}));
  });
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller)).toBe(true);
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller)!, first = source.snapshot().controller!;
  source.controllerInput!(first.id, {kind: 'key', key: 'f5'}, first.revision);
  await expect.poll(() => source.snapshot().controller?.id !== first.id && !!source.snapshot().controller).toBe(true);
  const second = source.snapshot().controller!;
  expect(source.controllerInput!(first.id, {kind: 'key', key: 'f5'}, second.revision)).toBeUndefined();source.cancelController!(first.id);
  expect(source.snapshot().controller?.id).toBe(second.id);expect(handled).toBe(1);expect(results).toHaveLength(1);
  source.controllerInput!(second.id, {kind: 'key', key: 'f5'}, second.revision);
  await expect.poll(() => launcher.snapshot().busy).toBe(false);expect(handled).toBe(2);expect(results).toHaveLength(2);
});

it('rejects malformed selected question outputs and sanitizes private handler exceptions without native fallback', async () => {
  let value: unknown;const failures: string[] = [];
  const f = await controllerFixture({question: () => ({render: () => ({lines: [{text: 'Selected question'}]}), handle: () => {
    if (value instanceof Error)throw value;return value;
  }})});
  const launcher = await controllerLauncher(f, async (_event, $) => {
    try {await $.ui.ask({question: 'PRIVATE_QUESTION_DECLARATION', options: ['Allowed'], allowOther: false});}
    catch (error) {failures.push((error as Error).message);}
  });
  for (const [index, invalid] of [null, false, 0, {answer: 'Not allowed'}, {answer: {PRIVATE_BAD_RESULT: true}}, Error('PRIVATE_CONTROLLER_EXCEPTION')].entries()) {
    value = invalid;if (index)launcher.press('start', launcher.snapshot().revision);
    await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller?.kind === 'question')).toBe(true);
    const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'question')!, frame = source.snapshot().controller!;
    expect(source.snapshot().interaction).toBeUndefined();expect(JSON.stringify(source.snapshot())).not.toContain('PRIVATE_QUESTION_DECLARATION');
    source.controllerInput!(frame.id, {kind: 'key', key: 'f4'}, frame.revision);
    await expect.poll(() => launcher.snapshot().busy).toBe(false);
  }
  expect(failures).toHaveLength(6);expect(failures.every(error => /^(Invalid question controller result|Selected question controller is unavailable)$/.test(error))).toBe(true);
  expect(JSON.stringify(f.events)).not.toMatch(/PRIVATE_(?:CONTROLLER_EXCEPTION|BAD_RESULT)/);expect(f.requests).toHaveLength(0);
});

it('revokes an active selected form on controller-owner unload and ignores its uncooperative late answer', async () => {
  let gate!: ReturnType<typeof focusGate>, result: unknown = 'pending', disposed = 0;
  const f = await controllerFixture({form: () => ({render: () => ({lines: [{text: 'Revocable'}]}), dispose: () => {disposed++;}, handle: async () => {
    await gate.wait(new AbortController().signal);return {action: 'save', values: {value: 'PRIVATE_LATE'}};
  }})});
  gate = focusGate();const launcher = await controllerLauncher(f, async (_event, $) => {result = await $.ui.form({title: 'Revocable',
    fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});});
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().controller?.kind === 'form')).toBe(true);
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().controller?.kind === 'form')!, frame = source.snapshot().controller!;
  source.controllerInput!(frame.id, {kind: 'key', key: 'f5'}, frame.revision);await expect.poll(gate.entered).toBe(true);
  f.host.core.host.unregisterPlugin('selected-input');await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(result).toBeNull();expect(disposed).toBe(1);gate.release();await Promise.resolve();
  expect(source.controllerInput!(frame.id, {kind: 'key', key: 'f5'}, frame.revision)).toBeUndefined();
  expect(result).toBeNull();expect(JSON.stringify(f.events)).not.toContain('PRIVATE_LATE');
});

it('admits a passive first view without taking a held form, Main question or another workspace', async () => {
  const f = await fixture();f.host.core.host.registerPlugin({name: 'passive', version: '1.0.0', trust: 'trusted'}, {});
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  const {form} = await connection(f), request = form.snapshot().form!;
  f.layout.act({type: 'moveWorkspace', id: 2});const intent = f.layout.windowIntentRevision;
  await f.host.core.host.emit('service.ui.view', {plugin: 'passive', id: 'new', title: 'Passive view', view: {lines: [{text: 'Published while working'}]}});
  expect(f.layout.snapshot()).toMatchObject({workspace: 2, focused: form.id, locations: {'plugin-passive-new': 2}});
  expect(f.layout.windowIntentRevision).toBe(intent);expect(form.snapshot().form?.id).toBe(request.id);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);expect(f.requests).toHaveLength(1);
  form.cancelForm!(request.id);f.host.session.cancelInteraction!(question.id);await main;
});

it('honors explicit first-publication focus preferences while ordinary updates keep a closed or moved view', async () => {
  const f = await fixture({ui: {rules: [
    {match: {plugin: 'passive', surface: 'on'}, focus: true, workspace: 5},
    {match: {plugin: 'passive', surface: 'off'}, focus: false, workspace: 4},
  ]}});
  f.host.core.host.registerPlugin({name: 'passive', version: '1.0.0', trust: 'trusted'}, {});
  const publish = (id: string, placement: any) => f.host.core.host.emit('service.ui.view', {plugin: 'passive', id, title: id, view: {lines: [{text: id}]}, placement});
  await publish('plain', {focus: true, workspace: 3});expect(f.layout.snapshot()).toMatchObject({workspace: 3, focused: 'plugin-passive-plain'});
  await publish('off', {focus: true});expect(f.layout.snapshot()).toMatchObject({workspace: 3, focused: 'plugin-passive-plain', locations: {'plugin-passive-off': 4}});
  await publish('on', {focus: false});expect(f.layout.snapshot()).toMatchObject({workspace: 5, focused: 'plugin-passive-on'});
  f.layout.act({type: 'moveWorkspace', id: 6});f.layout.act({type: 'open', id: 'session'});
  const intent = f.layout.windowIntentRevision;await publish('on', {focus: true, workspace: 9});
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', locations: {'plugin-passive-on': 6}});
  expect(f.layout.windowIntentRevision).toBe(intent);
  f.layout.act({type: 'open', id: 'plugin-passive-on'});f.layout.act({type: 'close'});f.layout.act({type: 'open', id: 'session'});
  await publish('on', {focus: true});expect(f.layout.snapshot().locations['plugin-passive-on']).toBeUndefined();
  expect(f.layout.snapshot().focused).toBe('session');
});

it.each(['Main', 'workspace', 'Arrange', 'Finder', 'pane'] as const)('preserves newer %s intent when a delayed requested view and its focus rule arrive', async intent => {
  const gate = focusGate();
  const f = await focusFixture(async (_event, $) => {await gate.wait($.signal);await $.ui.view('slow', 'Delayed view', {lines: [{text: 'Completed controlled open'}]}, {focus: true});},
    {rules: [{match: {plugin: 'focus-probe', surface: 'slow'}, workspace: 3, focus: true}]});
  await f.host.submit('/focus-slow');await expect.poll(gate.entered).toBe(true);
  if (intent === 'Main')f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});
  if (intent === 'workspace')f.layout.act({type: 'workspace', id: 2});
  if (intent === 'Arrange')f.host.navigation.toggleArrange();
  if (intent === 'Finder') {f.host.navigation.openFinder();f.host.navigation.changeQuery('Main', f.host.navigation.snapshot().revision);}
  if (intent === 'pane') {
    await f.host.core.host.emit('service.ui.view', {plugin: 'focus-probe', id: 'other', title: 'Other view', view: {lines: []}});
    f.layout.act({type: 'open', id: 'plugin-focus-probe-other'});
  }
  const before = f.layout.snapshot(), epoch = f.layout.windowIntentRevision, navigation = f.host.navigation.snapshot();
  gate.release();await expect.poll(() => f.find('plugin-focus-probe-slow')?.snapshot().busy).toBe(false);
  expect(f.layout.snapshot()).toMatchObject({workspace: before.workspace, focused: before.focused, locations: {'plugin-focus-probe-slow': 3}});
  expect(f.layout.windowIntentRevision).toBe(epoch);
  expect(f.host.navigation.snapshot()).toMatchObject({mode: navigation.mode, query: navigation.query});
  expect(f.requests).toHaveLength(0);expect(f.host.core.getMessages()).toEqual([]);
});

it('selects an unfocused semantic action before capturing its request focus, without counting its own bubbling click', async () => {
  let done: unknown;
  const f = await focusFixture(async (_event, $) => {done = await $.ui.form({title: 'One-click form', fields: [{id: 'name', label: 'Name', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});});
  await f.host.core.host.emit('service.ui.view', {plugin: 'focus-probe', id: 'launcher', title: 'Launcher', view: {lines: [{text: 'Open form', action: 'start'}]}, placement: {focus: false}});
  const source = f.find('plugin-focus-probe-launcher')!;expect(f.layout.snapshot().focused).toBe('session');
  source.press('start', source.snapshot().revision);const epoch = f.layout.windowIntentRevision;
  expect(f.layout.snapshot().focused).toBe(source.id);
  const frame = f.layout.snapshot().frames.find(frame => frame.surface === source.id)!;
  f.layout.act({type: 'pointer', phase: 'down', kind: 'pane', x: frame.x + 2, y: frame.y + 2});
  expect(f.layout.windowIntentRevision).toBe(epoch);
  const form = await f.waitForm('One-click form');expect(f.layout.snapshot().focused).toBe(form.id);
  expect(f.layout.windowIntentRevision).toBe(epoch);f.answer(form, 'save', {name: 'Kept'});
  await expect.poll(() => done).toMatchObject({action: 'save', values: {name: 'Kept'}});
});

it('keeps a delayed normal private request passive after a newer idempotent Main selection', async () => {
  const gate = focusGate();let result: unknown;
  const f = await focusFixture(async (_event, $) => {await gate.wait($.signal);result = await $.ui.ask({question: 'Delayed private question', options: ['Continue'], allowOther: false});});
  await f.host.submit('/focus-slow');await expect.poll(gate.entered).toBe(true);
  f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});const epoch = f.layout.windowIntentRevision;
  gate.release();await expect.poll(() => f.host.surfaces.snapshot().find(source => source.snapshot().interaction)?.snapshot().interaction?.kind).toBe('question');
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().interaction)!;
  expect(f.layout.snapshot().focused).toBe('session');expect(f.layout.windowIntentRevision).toBe(epoch);
  source.answerInteraction!(source.snapshot().interaction!.id, {answers: [{id: 'answer', selected: ['Continue']}]});
  await expect.poll(() => result).toBe('Continue');
});

it.each([1, 6])('consumes a semantic control click before its focused destination opens on workspace %s', async workspace => {
  const f = await focusFixture(async (_event, $) => {
    await $.ui.view('slow', 'Explicit focus', {lines: [{text: 'Explicit destination'}]}, {workspace, focus: true});
  });
  f.layout.resize(240, 40);
  const publish = (id: string, title: string, placement: {workspace: number; focus: boolean}, lines: any[] = []) =>
    f.host.core.host.emit('service.ui.view', {plugin: 'focus-probe', id, title, placement, view: {lines}});
  await publish('passive', 'Passive neighbor', {workspace, focus: false});
  await publish('launcher', 'Controls', {workspace: 1, focus: false}, [{text: 'Publish focus true', action: 'open'}]);
  const source = f.find('plugin-focus-probe-launcher')!;
  f.layout.act({type: 'open', id: source.id});f.layout.act({type: 'swap'});
  const original = f.layout.snapshot().frames.find(frame => frame.surface === source.id)!;
  const point = {x: original.x + 2, y: original.y + 2};
  const event = {button: 0, defaultPrevented: false, propagationStopped: false,
    preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.propagationStopped = true;}};
  expect(handleActionMouseDown(event, true, () => source.press('open', source.snapshot().revision))).toBe(true);
  const epoch = f.layout.windowIntentRevision;
  await expect.poll(() => f.find('plugin-focus-probe-slow')?.snapshot().busy).toBe(false);
  const hit = f.layout.snapshot().frames.find(frame => point.x >= frame.x && point.x < frame.x + frame.width
    && point.y >= frame.y && point.y < frame.y + frame.height);
  expect(hit?.surface).toBe(workspace === 1 ? source.id : 'plugin-focus-probe-passive');
  // Native child callbacks precede the viewport listener. Its live hit test is
  // dangerous even when the old source still occupies these same coordinates.
  if (!event.propagationStopped)f.layout.act({type: 'pointer', phase: 'down', kind: 'pane', ...point, revision: f.layout.snapshot().revision});
  expect(f.layout.snapshot()).toMatchObject({workspace, focused: 'plugin-focus-probe-slow'});
  expect(f.layout.windowIntentRevision).toBe(epoch);expect(event.defaultPrevented).toBe(true);
  const passive = f.layout.snapshot().frames.find(frame => frame.surface === 'plugin-focus-probe-passive')!;
  f.layout.act({type: 'pointer', phase: 'down', kind: 'pane', x: passive.x + 2, y: passive.y + 2, revision: f.layout.snapshot().revision});
  expect(f.layout.snapshot().focused).toBe('plugin-focus-probe-passive');
  expect(f.layout.windowIntentRevision).toBe(epoch + 1);expect(f.requests).toHaveLength(0);
});

it.each([false, true])('keeps retained view publication passive with launcher settled=%s', async settled => {
  const gate = focusGate();let normalSignal: AbortSignal | undefined, publication: Promise<unknown> | undefined;
  const f = await focusFixture(async (_event, $) => {
    normalSignal = $.signal;const retained = $.background();
    publication = gate.wait(retained.signal).then(() => retained.ui.view('background', 'Retained view', {lines: [{text: 'Independent publication'}]}));
    if (!settled)await publication;
  });
  await f.host.submit('/focus-launch');await expect.poll(() => !!normalSignal).toBe(true);
  if (settled)await expect.poll(() => normalSignal!.aborted).toBe(true);else expect(normalSignal!.aborted).toBe(false);
  const epoch = f.layout.windowIntentRevision;gate.release();await publication;
  const source = f.find('plugin-focus-probe-background')!;
  expect(source.snapshot().busy).toBe(false);expect(f.layout.snapshot().focused).toBe('session');
  expect(f.layout.windowIntentRevision).toBe(epoch);await expect.poll(() => normalSignal!.aborted).toBe(true);
});

it('does not reopen a retained closed identity through a stale requested publication and matching focus rule', async () => {
  const gate = focusGate();
  const f = await focusFixture(async (_event, $) => {await gate.wait($.signal);await $.ui.view('slow', 'Closed result', {lines: [{text: 'Available without reopening'}]}, {focus: true});},
    {rules: [{match: {plugin: 'focus-probe', surface: 'slow'}, workspace: 3, focus: true}]});
  const id = 'plugin-focus-probe-slow';
  f.layout.register({id, label: 'Retained closed owner'}, {workspace: 3, focus: true});f.layout.act({type: 'close'});f.layout.act({type: 'open', id: 'session'});
  await f.host.submit('/focus-slow');await expect.poll(gate.entered).toBe(true);
  f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});gate.release();
  await expect.poll(() => f.find(id)?.snapshot().busy).toBe(false);
  expect(f.layout.snapshot().locations[id]).toBeUndefined();expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session'});
  f.host.navigation.openFinder();f.host.navigation.changeQuery('Closed result', f.host.navigation.snapshot().revision);
  expect(f.host.navigation.snapshot().entries[0]).toMatchObject({id, state: 'closed'});
  f.host.navigation.choose(id, f.host.navigation.snapshot().revision);
  expect(f.layout.snapshot().focused).toBe(id);
});

it('keeps a foreign interceptor publication bound to its live caller focus eligibility rather than treating it as unscoped', async () => {
  const gate = focusGate();
  const f = await focusFixture(async (_event, $) => {await gate.wait($.signal);await $.ui.view('slow', 'Original result', {lines: []}, {focus: true});});
  f.host.core.host.registerPlugin({name: 'focus-interceptor', version: '1.0.0', trust: 'trusted'}, {
    'service.ui.view': async (event, $) => {
      if (event.plugin === 'focus-probe' && event.id === 'slow')await $.ui.view('foreign', 'Foreign result', {lines: []}, {focus: true, workspace: 4});
      return $.next();
    },
  });
  await f.host.submit('/focus-slow');await expect.poll(gate.entered).toBe(true);
  f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});gate.release();
  await expect.poll(() => f.find('plugin-focus-probe-slow')?.snapshot().busy).toBe(false);
  expect(f.find('plugin-focus-interceptor-foreign')).toBeDefined();
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', locations: {'plugin-focus-interceptor-foreign': 4}});
});

it('does not promote a stale captured ordinary origin into passive explicit-focus authority', async () => {
  const gate = focusGate();let later: Promise<unknown> | undefined;
  const f = await focusFixture(async (_event, $) => {await $.ui.view('slow', 'Ordinary result', {lines: []});});
  f.host.core.host.registerPlugin({name: 'capture-origin', version: '1.0.0', trust: 'trusted'}, {
    'service.ui.view': (event, $) => {
      if (event.plugin === 'focus-probe' && event.id === 'slow') {
        const lifetime = f.host.core.host.currentServiceScope!.lifetime;
        later = gate.wait(lifetime).then(() => f.host.core.host.emit('service.ui.view', {plugin: 'focus-probe', id: 'late', title: 'Stale origin result',
          view: {lines: []}, placement: {focus: true, workspace: 4}}, new AbortController().signal));
      }
      return $.next();
    },
  });
  await f.host.submit('/focus-slow');await expect.poll(() => f.find('plugin-focus-probe-slow')?.snapshot().busy).toBe(false);
  f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});gate.release();await later;
  expect(f.find('plugin-focus-probe-late')).toBeDefined();
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', locations: {'plugin-focus-probe-late': 4}});
});

function commandWorker() {
  return {name: 'command-worker', commands: [{name: '/command-worker', description: 'Run a local test worker', execution: 'immediate'}], source: `export default {
    'command.invoke': async (event, $) => {
      const name = event.args.trim();
      if (!['a', 'b', 'denied'].includes(name)) throw Error('Unknown worker');
      await $.ui.view(name, 'Command ' + name.toUpperCase(), {lines: [{text: 'COMMAND_' + name.toUpperCase()}]}, {site: 'split', focus: true});
      const result = await $.agent.tool('exec', {command: '/bin/sh ./worker.sh ' + name, timeoutMs: 20000});
      await $.ui.view(name, 'Command ' + name.toUpperCase(), {lines: [{text: result.ok ? 'WORKER_COMPLETED' : 'WORKER_DENIED'}]});
    },
  };`};
}
function processAlive(pid: number) {
  try {process.kill(pid, 0); return true;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error;}
}

it('owns a real builtin exec approval separately from Main and executes only after its exact Allow', async () => {
  const f = await fixture({exec: 'ask', plugins: [{name: 'manual-worker',
    commands: [{name: '/manual-worker', description: 'Run an explicitly reviewed worker', execution: 'immediate'}],
    hookTimeouts: {'command.invoke': 15000}, source: `export default {'command.invoke': async (event, $) => {
      const name = event.args.trim(); if (!['allow', 'deny'].includes(name)) throw Error('Unknown test worker');
      const result = await $.agent.tool('exec', {command: '/bin/sh ./manual.sh ' + name});
      await $.storage.set('result-' + name, result, 'project');
    }};`}]});
  await writeFile(join(f.cwd, 'manual.sh'), 'printf "once" >> "effect-$1"\n');
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!, transcript = structuredClone(f.host.core.getMessages());
  const approval = () => f.host.surfaces.snapshot().find(source => source.snapshot().approval);
  const result = (name: string) => f.app.storage.read('manual-worker', 'result-' + name, 'project', f.host.core.sessionId);
  await f.host.submit('/manual-worker allow');
  await expect.poll(() => approval()?.snapshot().title).toBe('Approval · manual-worker');
  const source = approval()!, request = source.snapshot().approval!;
  expect(request.tool).toBe('exec');
  expect(request.details.some(detail => detail.value.includes('/bin/sh ./manual.sh allow'))).toBe(true);
  await expect(readFile(join(f.cwd, 'effect-allow'))).rejects.toMatchObject({code: 'ENOENT'});
  f.host.session.answerApproval!(request.id, true);
  source.answerApproval!(question.id, true);
  source.answerInteraction!(request.id, {answers: [{id: 'answer', selected: ['Local']}]});
  expect(source.snapshot().approval?.id).toBe(request.id);
  f.layout.act({type: 'open', id: source.id}); f.layout.act({type: 'close'});
  expect(source.snapshot().approval?.id).toBe(request.id);
  f.host.navigation.openFinder();
  f.host.navigation.changeQuery('Approval · manual-worker', f.host.navigation.snapshot().revision);
  f.host.navigation.choose(source.id, f.host.navigation.snapshot().revision);
  expect(f.layout.snapshot().focused).toBe(source.id);
  const approvalIntent = f.layout.windowIntentRevision;
  source.answerApproval!(request.id, true); source.answerApproval!(request.id, true);
  expect(f.layout.windowIntentRevision).toBe(approvalIntent + 1);
  await expect.poll(() => result('allow')).toMatchObject({ok: true});
  expect(await readFile(join(f.cwd, 'effect-allow'), 'utf8')).toBe('once');
  await expect.poll(() => approval()).toBeUndefined();
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(f.host.core.getMessages()).toEqual(transcript); expect(f.requests).toHaveLength(1);
  await f.host.submit('/manual-worker deny');
  await expect.poll(() => approval()?.snapshot().approval?.tool).toBe('exec');
  const denied = approval()!; denied.answerApproval!(denied.snapshot().approval!.id, false);
  await expect.poll(() => result('deny')).toMatchObject({ok: false});
  await expect(readFile(join(f.cwd, 'effect-deny'))).rejects.toMatchObject({code: 'ENOENT'});
  await expect.poll(() => f.host.core.getOperations()).toEqual([]);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  f.host.session.answerInteraction!(question.id, {answers: [{id: 'answer', selected: ['Local']}]}); await main;
  expect(f.requests).toHaveLength(2); expect(JSON.stringify(f.requests[1].body)).not.toContain('manual.sh');
});

it('keeps concurrent same-owner questions and a questionnaire private while Main waits', async () => {
  const f = await fixture({questionnaires: true, plugins: [{name: 'manual-questions',
    commands: [{name: '/manual-question', description: 'Ask in the caller window', execution: 'immediate'}],
    hookTimeouts: {'command.invoke': 15000}, source: `export default {'command.invoke': async (event, $) => {
      const name = event.args.trim();
      try {
        const result = name === 'many' ? await $.agent.tool('ask_questions', {title:'PRIVATE_MULTI',questions:[
          {id:'checks',question:'Private checks',multi:true,options:['Unit','Visual'],allowOther:false},
          {id:'owner',question:'Private owner'},
        ]}) : await $.ui.ask({question:'PRIVATE_' + name,options:['Left','Right'],allowOther:false});
        await $.storage.set('result-' + name,result,'project');
      } catch {await $.storage.set('result-' + name,{cancelled:true},'project');}
    }};`}]});
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const mainQuestion = f.host.session.snapshot().interaction!, transcript = structuredClone(f.host.core.getMessages());
  const question = (text: string) => f.host.surfaces.snapshot().find(source => {
    const request = source.snapshot().interaction;
    return request?.kind === 'question' && request.request.questions[0]?.question === text;
  });
  const result = (name: string) => f.app.storage.read('manual-questions', 'result-' + name, 'project', f.host.core.sessionId);
  await f.host.submit('/manual-question a'); await f.host.submit('/manual-question b');
  await expect.poll(() => !!question('PRIVATE_a') && !!question('PRIVATE_b')).toBe(true);
  const a = question('PRIVATE_a')!, b = question('PRIVATE_b')!;
  const aid = a.snapshot().interaction!.id, bid = b.snapshot().interaction!.id;
  expect(a.id).not.toBe(b.id); expect(a.snapshot().title).toBe('Questions · manual-questions');
  a.answerInteraction!(bid, {answers: [{id: 'answer', selected: ['Right']}]});
  a.cancelInteraction!(bid); f.host.session.answerInteraction!(aid, {answers: [{id: 'answer', selected: ['Right']}]});
  expect(a.snapshot().interaction?.id).toBe(aid); expect(b.snapshot().interaction?.id).toBe(bid);
  f.layout.act({type: 'open', id: b.id}); f.layout.act({type: 'close'});
  a.answerInteraction!(aid, {answers: [{id: 'answer', selected: ['Right']}]});
  await expect.poll(() => result('a')).toBe('Right');
  b.answerInteraction!(bid, {answers: [{id: 'answer', selected: ['Forbidden']}]});
  expect(b.snapshot().interaction).toMatchObject({id: bid, error: 'Complete each question with an allowed answer'});
  expect(f.layout.snapshot().locations[b.id]).toBeUndefined();
  await f.host.submit('/manual-question many');
  await expect.poll(() => question('Private checks')?.snapshot().interaction?.kind).toBe('question');
  const many = question('Private checks')!, manyId = many.snapshot().interaction!.id;
  many.answerInteraction!(manyId, {answers: [{id: 'checks', selected: ['Unit', 'Visual']}, {id: 'owner', selected: [], text: 'PRIVATE_OWNER'}]});
  await expect.poll(() => result('many')).toMatchObject({ok: true});
  a.answerInteraction!(bid, {answers: [{id: 'answer', selected: ['Left']}]});
  expect(b.snapshot().interaction?.id).toBe(bid);
  b.cancelInteraction!(bid); await expect.poll(() => result('b')).toEqual({cancelled: true});
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().interaction)).toBe(false);
  expect(f.host.session.snapshot().interaction?.id).toBe(mainQuestion.id);
  expect(f.host.core.getMessages()).toEqual(transcript); expect(f.requests).toHaveLength(1);
  f.host.session.answerInteraction!(mainQuestion.id, {answers: [{id: 'answer', selected: ['Remote']}]}); await main;
  expect(f.requests).toHaveLength(2);
  expect(JSON.stringify(f.requests[1].body)).not.toMatch(/PRIVATE_(?:a|b|MULTI|OWNER)/);
});

it('keeps a passive background request alive through launcher cancellation and Main interruption', async () => {
  const f = await fixture();
  let background: Promise<unknown> | undefined;
  f.host.core.host.registerPlugin({name: 'background-request', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (_event, $) => {
      background = $.background().ui.ask({question: 'Independent request', options: ['Continue'], allowOther: false});
      await new Promise<void>(done => {if ($.signal.aborted) done(); else $.signal.addEventListener('abort', () => done(), {once: true});});
    },
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'background-request', id: 'work', title: 'Launcher',
    view: {lines: [{text: 'Start', action: 'start'}]}, placement: {focus: false}});
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const mainId = f.host.session.snapshot().interaction!.id;
  f.layout.act({type: 'open', id: 'session'});
  const launcher = f.find('plugin-background-request-work')!;
  launcher.press('start', launcher.snapshot().revision);
  f.layout.act({type: 'open', id: 'session'});
  const request = () => f.host.surfaces.snapshot().find(source => source.snapshot().interaction?.kind === 'question');
  await expect.poll(() => request()?.snapshot().title).toBe('Questions · background-request');
  const source = request()!, id = source.snapshot().interaction!.id;
  expect(f.layout.snapshot().focused).toBe('session');
  expect(f.host.cancelOperation(launcher.id)).toBe(true);
  await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(source.snapshot().interaction?.id).toBe(id);
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId);
  f.host.session.interrupt!(); await main;
  expect(source.snapshot().interaction?.id).toBe(id);
  expect(f.requests).toHaveLength(1);
  f.layout.act({type: 'open', id: source.id});const backgroundIntent = f.layout.windowIntentRevision;
  source.answerInteraction!(id, {answers: [{id: 'answer', selected: ['Continue']}]});
  expect(f.layout.windowIntentRevision).toBe(backgroundIntent);
  expect(await background).toBe('Continue');
  await expect.poll(() => request()).toBeUndefined();
  expect(f.host.core.getOperations()).toEqual([]);
});

it.each(['ordinary', 'background'] as const)('attributes an interceptor form to its actual plugin in %s work', async mode => {
  const f = await fixture();
  let work: Promise<unknown> | undefined, callerAlive = false;
  f.host.core.host.registerPlugin({name: 'scope-a', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (_event, $) => {
      const capability = mode === 'background' ? $.background() : $;
      work = (async () => {
        const result = await capability.fs.read('scope-trigger');
        callerAlive = !capability.signal.aborted;
        await capability.ui.view('main', 'Caller A', {lines: [{text: 'CALLER_A_CONTINUED'}]}, {focus: false});
        return result;
      })();
      if (mode === 'ordinary') await work;
    },
  });
  f.host.core.host.registerPlugin({name: 'scope-b', version: '1.0.0', trust: 'trusted'}, {
    'service.fs.read': async (event, $) => {
      if (event.path !== 'scope-trigger') return $.next();
      const result = await $.ui.form({title: 'Interceptor B form', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});
      return {value: result ? 'answered' : 'cancelled'};
    },
  });
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const mainId = f.host.session.snapshot().interaction!.id;
  await f.host.core.host.emit('service.ui.view', {plugin: 'scope-a', id: 'main', title: 'Caller A',
    view: {lines: [{text: 'Start', action: 'start'}]}});
  const caller = f.find('plugin-scope-a-main')!;
  caller.press('start', caller.snapshot().revision);
  const form = await f.waitForm('Interceptor B form'), requestId = form.snapshot().form!.id;
  expect(form.snapshot().form?.plugin).toBe('scope-b');
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId);
  f.host.core.host.unregisterPlugin('scope-b');
  expect(await work).toBe('cancelled'); expect(callerAlive).toBe(true);
  await expect.poll(() => caller.snapshot().busy).toBe(false);
  expect(caller.snapshot().view?.lines[0].text).toBe('CALLER_A_CONTINUED');
  await expect.poll(() => f.host.surfaces.snapshot().includes(form)).toBe(false);
  form.answerForm!(requestId, {action: 'save', values: {value: 'stale'}});
  expect(f.host.core.host.hasPlugin('scope-a')).toBe(true);
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId); expect(f.requests).toHaveLength(1);
  f.host.session.interrupt!(); await main;
});

it.each(['unload', 'close'] as const)('cleans a background request on owner %s and ignores its old source callbacks', async stop => {
  const f = await fixture();
  let background: Promise<unknown> | undefined;
  f.host.core.host.registerPlugin({name: 'request-lifetime', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': (_event, $) => {background = $.background().ui.ask({question: 'Lifetime request', options: ['Continue']})
      .then(value => ({ok: true, value}), () => ({ok: false}));},
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'request-lifetime', id: 'work', title: 'Lifetime',
    view: {lines: [{text: 'Start', action: 'start'}]}});
  const launcher = f.find('plugin-request-lifetime-work')!;
  launcher.press('start', launcher.snapshot().revision);
  const request = () => f.host.surfaces.snapshot().find(source => source.snapshot().interaction);
  await expect.poll(() => request()?.snapshot().interaction?.kind).toBe('question');
  const source = request()!, id = source.snapshot().interaction!.id;
  await expect.poll(() => launcher.snapshot().busy).toBe(false);
  if (stop === 'unload') f.host.core.host.unregisterPlugin('request-lifetime'); else await f.host.close();
  expect(await background).toEqual({ok: false});
  await expect.poll(() => f.host.surfaces.snapshot().includes(source)).toBe(false);
  source.answerInteraction!(id, {answers: [{id: 'answer', selected: ['Continue']}]});
  expect(f.host.session.snapshot().interaction).toBeUndefined(); expect(f.requests).toHaveLength(0);
});

it('counts independent requests in the four-operation limit without falling back to Main', async () => {
  const f = await fixture();
  let retained: any;
  f.host.core.host.registerPlugin({name: 'request-capacity', version: '1.0.0', trust: 'trusted', hookTimeouts: {'ui.press': 15000}}, {
    'ui.press': async (event, $) => {
      if (event.key === 'capture') {retained = $.background(); return;}
      await $.ui.ask({question: 'Capacity ' + event.site, options: ['Continue']});
    },
  });
  await f.host.core.host.emit('ui.press', {site: 'capture', key: 'capture'});
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const mainId = f.host.session.snapshot().interaction!.id;
  const launchers: UiSurfaceSource[] = [];
  for (let index = 0; index < 4; index++) {
    await f.host.core.host.emit('service.ui.view', {plugin: 'request-capacity', id: 'pane' + index, title: 'Capacity ' + index,
      view: {lines: [{text: 'Ask', action: 'ask'}]}});
    const source = f.find('plugin-request-capacity-pane' + index)!; launchers.push(source);
    source.press('ask', source.snapshot().revision);
  }
  const requests = () => f.host.surfaces.snapshot().filter(source => source.snapshot().interaction);
  await expect.poll(() => requests().length).toBe(4);
  await expect(retained.ui.ask({question: 'Fifth request', options: ['Continue']})).rejects.toThrow('A request window is unavailable');
  expect(requests()).toHaveLength(4); expect(f.host.session.snapshot().notice).toContain('Four interface operations');
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId); expect(f.requests).toHaveLength(1);
  const released = requests()[0]; released.cancelInteraction!(released.snapshot().interaction!.id);
  await expect.poll(() => requests().length).toBe(3);
  const fifth = retained.ui.ask({question: 'Fifth request', options: ['Continue']});
  await expect.poll(() => requests().length).toBe(4);
  const source = requests().find(source => {
    const interaction = source.snapshot().interaction;
    return interaction?.kind === 'question' && interaction.request.questions[0].question === 'Fifth request';
  })!;
  source.answerInteraction!(source.snapshot().interaction!.id, {answers: [{id: 'answer', selected: ['Continue']}]});
  expect(await fifth).toBe('Continue');
  for (const source of requests()) source.cancelInteraction!(source.snapshot().interaction!.id);
  await expect.poll(() => launchers.every(source => !source.snapshot().busy)).toBe(true);
  f.host.session.interrupt!(); await main;
});

it.each(['fresh', 'workspace', 'pane'] as const)('finishes a deferred successful resume while preserving %s window intent', async intent => {
  const f = await fixture(), gate = focusGate(), previous = f.host.core, resume = f.app.resume;
  f.layout.act({type: 'workspace', id: 2});
  f.app.resume = async (...args) => {
    const replacement = await resume(...args), start = replacement.start.bind(replacement);
    replacement.start = async () => {await gate.wait(new AbortController().signal);await start();};
    return replacement;
  };
  const resumed = previous.host.emit('service.session.control', {action: 'resume', id: previous.sessionId});
  await expect.poll(gate.entered).toBe(true);expect(f.host.core).not.toBe(previous);
  if (intent === 'workspace')f.layout.act({type: 'workspace', id: 3});
  if (intent === 'pane') {
    await f.host.core.host.emit('service.ui.view', {plugin: 'model-selector', id: 'resume-other', title: 'Chosen during resume',
      view: {lines: [{text: 'Live replacement source'}]}, placement: {workspace: 4, focus: false}});
    f.layout.act({type: 'open', id: 'plugin-model-selector-resume-other'});
  }
  const before = f.layout.snapshot(), epoch = f.layout.windowIntentRevision;
  gate.release();expect((await resumed).value).toEqual({value: true});
  expect(f.host.core.controlsReady).toBe(true);expect(f.layout.windowIntentRevision).toBe(epoch);
  expect(f.layout.snapshot()).toMatchObject(intent === 'fresh' ? {workspace: 1, focused: 'session'}
    : {workspace: before.workspace, focused: before.focused});
  await f.host.submit('Continue after deferred resume');
  expect(f.requests).toHaveLength(1);expect(f.host.session.snapshot().messages).toContainEqual({role: 'assistant', text: 'REAL_ROUTER_COMPLETED'});
});

it('keeps a committed resumed session recoverable when its startup fails', async () => {
  const f = await fixture(), previous = f.host.core;
  const resume = f.app.resume;
  f.app.resume = async (...args) => {
    const replacement = await resume(...args);
    replacement.start = async () => {throw Error('Controlled startup failure');};
    return replacement;
  };
  const result = await previous.host.emit('service.session.control', {action: 'resume', id: previous.sessionId});
  expect(result.value).toMatchObject({deny: expect.stringContaining('startup failed')});
  expect(f.host.core).not.toBe(previous);
  await expect(f.host.submit('Blocked until explicit recovery')).rejects.toThrow('Session startup did not finish');
  expect(f.requests).toHaveLength(0);
  f.app.resume = resume;
  await f.host.submit('/reload');
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  f.host.session.answerInteraction!(question.id, {answers: [{id: 'answer', selected: ['Local']}]}); await main;
  expect(f.requests).toHaveLength(2); expect(f.host.session.snapshot().interaction).toBeUndefined();
});

it('cancels one command window and its real builtin exec while preserving its neighbor and Main', async () => {
  const f = await fixture({exec: 'allow', plugins: [commandWorker()]});
  await writeFile(join(f.cwd, 'worker.sh'), 'printf "%s" "$$" > "$1.pid"\nwhile [ ! -f "release-$1" ]; do /bin/sleep 0.1; done\n');
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  await f.host.submit('/command-worker a');
  await f.host.submit('/command-worker b');
  const pid = async (name: string) => {
    let value = 0;
    await expect.poll(async () => {value = Number(await readFile(join(f.cwd, name + '.pid'), 'utf8').catch(() => '0')); return value > 0;}).toBe(true);
    return value;
  };
  const [a, b] = await Promise.all([pid('a'), pid('b')]);
  const first = f.find('plugin-command-worker-a')!, second = f.find('plugin-command-worker-b')!;
  expect(first.snapshot().busy).toBe(true);
  expect(second.snapshot().busy).toBe(true);
  expect(f.host.cancelOperation(first.id)).toBe(true);
  await expect.poll(() => first.snapshot().busy).toBe(false);
  expect(processAlive(a)).toBe(false);
  expect(processAlive(b)).toBe(true);
  expect(second.snapshot().busy).toBe(true);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(f.host.core.getState()).toBe('running');
  expect(f.requests).toHaveLength(1);
  expect(f.host.core.getOperations()).toHaveLength(2);
  f.host.session.interrupt!(); await main;
  expect(processAlive(b)).toBe(true);
  expect(second.snapshot().busy).toBe(true);
  await writeFile(join(f.cwd, 'release-b'), 'release');
  await expect.poll(() => second.snapshot().busy).toBe(false);
  expect(processAlive(b)).toBe(false);
  expect(second.snapshot().view?.lines[0].text).toBe('WORKER_COMPLETED');
  expect(first.snapshot().view?.lines[0].text).toBe('COMMAND_A');
  expect(f.host.core.getOperations()).toEqual([]);
  expect(f.requests).toHaveLength(1);
});

it('preserves normal permissions for a command window that invokes builtin exec', async () => {
  const f = await fixture({exec: 'deny', plugins: [commandWorker()]});
  await writeFile(join(f.cwd, 'worker.sh'), 'printf "%s" "$$" > "$1.pid"\n');
  await f.host.submit('/command-worker denied');
  await expect.poll(() => f.find('plugin-command-worker-denied')?.snapshot().view?.lines[0].text).toBe('WORKER_DENIED');
  await expect.poll(() => f.find('plugin-command-worker-denied')?.snapshot().busy).toBe(false);
  await expect(readFile(join(f.cwd, 'denied.pid'))).rejects.toMatchObject({code: 'ENOENT'});
  expect(f.host.core.getOperations()).toEqual([]);
  expect(f.requests).toHaveLength(0);
});
function profile(endpoint: string, key = 'FAKE_LOOPBACK_PRIVATE_KEY') {
  return {id: 'opentui-local', type: 'openai-compat', baseUrl: endpoint, model: 'configured-model', key, clearKey: false,
    maxOutputTokens: '1000', timeoutMs: '20000', scope: 'project', contextWindow: '', reasoningEffort: ''};
}

it('returns to the existing Models pane after adding, zooming, discovering and saving an actual provider while Main waits', async () => {
  const f = await fixture({models: ['app-alpha', 'app-beta']});
  await f.host.submit('/settings');const models = f.find('plugin-model-selector-models')!;
  await expect.poll(() => models.snapshot().busy).toBe(false);
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!.id;
  models.press('add', models.snapshot().revision);
  const preset = await f.waitForm('Add provider');
  f.layout.act({type: 'zoom'});expect(f.layout.snapshot()).toMatchObject({fullscreen: true, focused: preset.id});
  f.answer(preset, 'next', {preset: 'compatible'});
  const form = await f.waitForm('New provider connection');
  const values = {...profile(f.endpoint), id: 'ui-profile', model: 'app-alpha'};
  f.answer(form, 'discover', values);
  const picker = await f.waitForm('Available models');f.answer(picker, 'use', {model: 'app-beta'});
  await expect.poll(() => form.snapshot().form?.request.description).toContain('Connection tested');
  const request = form.snapshot().form!.id, epoch = f.layout.windowIntentRevision;
  f.answer(form, 'save', {...values, model: 'app-beta', key: ''});
  await expect.poll(() => models.snapshot().busy).toBe(false);
  expect(models.snapshot().view?.lines[0].text).toBe('Active: ui-profile · app-beta');
  expect(f.layout.snapshot().focused).toBe(models.id);
  expect(f.layout.windowIntentRevision).toBe(epoch + 1);
  const saved = await readFile(join(f.app.storage.paths.state, 'providers.json'), 'utf8');
  expect(JSON.parse(saved).profiles['ui-profile'].model).toBe('app-beta');
  expect(JSON.parse(await readFile(join(f.app.storage.paths.state, 'model.json'), 'utf8'))).toBe('ui-profile');
  const completedIntent = f.layout.windowIntentRevision;
  form.answerForm!(request, {action: 'save', values});
  expect(f.layout.windowIntentRevision).toBe(completedIntent);
  expect(await readFile(join(f.app.storage.paths.state, 'providers.json'), 'utf8')).toBe(saved);
  expect(f.host.session.snapshot().interaction?.id).toBe(question);expect(f.requests).toHaveLength(1);
  expect(JSON.stringify(f.events)).not.toContain(values.key);
  f.host.session.interrupt!();await main;
});

it.each(['Main', 'workspace', 'unfocused'] as const)('preserves %s intent after an ordinary private form answer while its continuation is deferred', async intent => {
  let gate!: ReturnType<typeof focusGate>, answers = 0;
  const f = await focusFixture(async (_event, $) => {
    const result = await $.ui.form({title: 'Controlled continuation', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});
    if (!result)return;answers++;await gate.wait($.signal);
    await $.ui.view('launcher', 'Continuation result', {lines: [{text: result.values.value}]}, {focus: true});
  });
  gate = focusGate();
  await f.host.core.host.emit('service.ui.view', {plugin: 'focus-probe', id: 'launcher', title: 'Launcher',
    view: {lines: [{text: 'Open', action: 'open'}]}, placement: {focus: false}});
  const launcher = f.find('plugin-focus-probe-launcher')!;launcher.press('open', launcher.snapshot().revision);
  const form = await f.waitForm('Controlled continuation'), request = form.snapshot().form!.id;
  f.layout.act({type: 'zoom'});
  if (intent === 'unfocused')f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});
  const answerIntent = f.layout.windowIntentRevision;
  form.answerInteraction!(request, {action: 'save', values: {value: 'Exact answer'}});
  expect(f.layout.windowIntentRevision).toBe(answerIntent + Number(intent !== 'unfocused'));
  await expect.poll(gate.entered).toBe(true);
  if (intent !== 'unfocused')f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});
  if (intent === 'workspace')f.layout.act({type: 'workspace', id: 2});
  const before = f.layout.snapshot(), epoch = f.layout.windowIntentRevision;
  form.answerForm!(request, {action: 'save', values: {value: 'Stale answer'}});
  expect(f.layout.windowIntentRevision).toBe(epoch);expect(answers).toBe(1);
  gate.release();await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(launcher.snapshot().view?.lines[0].text).toBe('Exact answer');
  expect(f.layout.snapshot()).toMatchObject({workspace: before.workspace, focused: before.focused});
  expect(f.layout.windowIntentRevision).toBe(epoch);expect(f.requests).toHaveLength(0);
});

it.each(['Finder', 'Arrange'] as const)('does not grant a hidden request callback new focus authority while %s owns input', async mode => {
  let gate!: ReturnType<typeof focusGate>;
  const f = await focusFixture(async (_event, $) => {
    await $.ui.form({title: 'Parked request', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});
    await gate.wait($.signal);await $.ui.view('slow', 'Passive result', {lines: []}, {workspace: 4, focus: true});
  });
  gate = focusGate();await f.host.submit('/focus-slow');
  const form = await f.waitForm('Parked request');
  expect(f.layout.snapshot().focused).toBe(form.id);
  if (mode === 'Finder')f.host.navigation.openFinder();else f.host.navigation.toggleArrange();
  const epoch = f.layout.windowIntentRevision;
  f.answer(form, 'save', {value: 'Programmatic answer'});
  await expect.poll(gate.entered).toBe(true);expect(f.layout.windowIntentRevision).toBe(epoch);
  gate.release();await expect.poll(() => f.find('plugin-focus-probe-slow')?.snapshot().busy).toBe(false);
  expect(f.host.navigation.snapshot().mode).toBe(mode === 'Finder' ? 'finder' : 'arrange');
  expect(f.layout.snapshot().workspace).toBe(1);expect(f.layout.snapshot().focused).not.toBe('plugin-focus-probe-slow');
  expect(f.layout.windowIntentRevision).toBe(epoch);
});

it.each(['form', 'question'] as const)('renews only a current focused ordinary %s cancellation before its continuation', async kind => {
  const f = await focusFixture(async (_event, $) => {
    try {
      if (kind === 'form')await $.ui.form({title: 'Cancel continuation', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});
      else await $.ui.ask({question: 'Cancel continuation', options: ['Continue'], allowOther: false});
    } catch {}
    await $.ui.view('launcher', 'Returned after cancel', {lines: [{text: 'Cancelled once'}]}, {focus: true});
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'focus-probe', id: 'launcher', title: 'Launcher',
    view: {lines: [{text: 'Open', action: 'open'}]}, placement: {focus: false}});
  const launcher = f.find('plugin-focus-probe-launcher')!;launcher.press('open', launcher.snapshot().revision);
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().interaction?.kind === kind)).toBe(true);
  const source = f.host.surfaces.snapshot().find(source => source.snapshot().interaction?.kind === kind)!, request = source.snapshot().interaction!.id;
  f.layout.act({type: 'zoom'});const epoch = f.layout.windowIntentRevision;
  if (kind === 'form')source.cancelForm!(request);else source.cancelInteraction!(request);
  source.cancelInteraction!(request);
  await expect.poll(() => launcher.snapshot().busy).toBe(false);
  expect(f.layout.snapshot().focused).toBe(launcher.id);expect(launcher.snapshot().view?.lines[0].text).toBe('Cancelled once');
  expect(f.layout.windowIntentRevision).toBe(epoch + 1);
});

it('configures the actual provider in a separate private form while the main model question remains pending, then restores it', async () => {
  const f = await fixture();
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  const {form} = await connection(f);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(f.requests).toHaveLength(1);
  expect(f.layout.snapshot().locations[form.id]).toBeDefined();
  f.answer(form, 'save', profile(f.endpoint));
  await expect.poll(() => f.host.surfaces.snapshot().includes(form)).toBe(false);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  const saved = JSON.parse(await readFile(join(f.app.storage.paths.state, 'providers.json'), 'utf8'));
  expect(saved.profiles['opentui-local'].model).toBe('configured-model');
  expect(JSON.stringify(saved)).not.toContain('FAKE_LOOPBACK_PRIVATE_KEY');
  const credentials = join(f.app.storage.paths.home, 'credentials.json');
  expect((await stat(credentials)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(credentials, 'utf8'))['opentui-local'].accessToken).toBe('FAKE_LOOPBACK_PRIVATE_KEY');
  expect(JSON.stringify(f.events)).not.toContain('FAKE_LOOPBACK_PRIVATE_KEY');
  expect(JSON.stringify(f.host.session.snapshot())).not.toContain('FAKE_LOOPBACK_PRIVATE_KEY');
  const stored = await f.app.store.load(f.host.core.sessionId, f.cwd);
  expect(JSON.stringify(stored)).not.toContain('FAKE_LOOPBACK_PRIVATE_KEY');
  f.host.session.answerInteraction!(question.id, {answers: [{id: 'answer', selected: ['Local']}]});
  await main;
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]).toMatchObject({model: 'configured-model', authorization: 'Bearer FAKE_LOOPBACK_PRIVATE_KEY'});
  const previous = f.host.core.sessionId;
  await f.host.close();
  const next = await buildApp({cwd: f.cwd, env: {...f.env, AGENT_MODEL: undefined}, resumeSessionId: previous, agentHub: false});
  cleanup.push(() => next.close());
  const layout = await connectWindowLayout(next, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});
  cleanup.push(() => layout.disconnect());
  const restored = createOpenTuiHost(next, layout); cleanup.push(() => restored.close());
  await restored.start();
  expect(restored.session.snapshot().messages.some(message => message.text === 'Ask before continuing')).toBe(true);
  await restored.submit('Verify persisted profile');
  expect(f.requests.at(-1)).toMatchObject({model: 'configured-model', authorization: 'Bearer FAKE_LOOPBACK_PRIVATE_KEY'});
});

it('retains a hidden UI form through foreground interruption and only explicit Cancel settles it', async () => {
  const f = await fixture();
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const {form} = await connection(f);
  const request = form.snapshot().form!;
  f.layout.act({type: 'open', id: form.id}); f.layout.act({type: 'close'});
  expect(f.layout.snapshot().locations[form.id]).toBeUndefined();
  f.host.session.interrupt!(); await main;
  expect(f.host.session.snapshot().interaction).toBeUndefined();
  expect(form.snapshot().form?.id).toBe(request.id);
  form.answerForm!(request.id, {action: 'save', values: {key: 'MUST_NOT_APPEAR_IN_ERROR'}});
  expect(form.snapshot().form).toMatchObject({id: request.id, error: expect.any(String)});
  expect(f.layout.snapshot().locations[form.id]).toBeUndefined();
  expect(JSON.stringify(form.snapshot())).not.toContain('MUST_NOT_APPEAR_IN_ERROR');
  f.layout.act({type: 'open', id: form.id});
  form.cancelForm!('foreign'); expect(form.snapshot().form?.id).toBe(request.id);
  form.cancelForm!(request.id);
  await expect.poll(() => f.host.surfaces.snapshot().includes(form)).toBe(false);
  expect(await readFile(join(f.app.storage.paths.home, 'credentials.json'), 'utf8').catch(() => 'absent')).toBe('absent');
  expect(JSON.stringify(f.events)).not.toContain('MUST_NOT_APPEAR_IN_ERROR');
  expect(f.requests).toHaveLength(1);
});

it('rejects stale, foreign and unadvertised UI actions, and replaces current semantics on publication/removal', async () => {
  const f = await fixture();
  const received: unknown[] = [];
  f.host.core.host.registerPlugin({name: 'proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': event => {if (event.site === 'plugin-proof-panel') received.push(event);},
    'ui.change': event => {if (event.site === 'plugin-proof-panel') received.push(event);},
  });
  const publish = (action = 'first') => f.host.core.host.emit('service.ui.view', {plugin: 'proof', id: 'panel', title: 'Proof',
    view: {lines: [{text: 'Action', action}], input: {id: 'search', value: ''}}});
  await publish();
  const source = f.find('plugin-proof-panel')!, revision = source.snapshot().revision;
  expect(f.host.surfaces.snapshot()).toBe(f.host.surfaces.snapshot());
  await publish('second');
  source.press('first', revision);
  source.press('first', source.snapshot().revision);
  source.press('unknown', source.snapshot().revision);
  source.change('foreign', 'value', source.snapshot().revision);
  expect(received).toEqual([]);
  source.press('second', source.snapshot().revision);
  await expect.poll(() => received.length).toBe(1);
  await expect.poll(() => source.snapshot().busy).toBe(false);
  source.change('search', 'current query', source.snapshot().revision);
  await expect.poll(() => received.length).toBe(2);
  expect(received[1]).toMatchObject({id: 'search', value: 'current query'});
  f.host.core.host.unregisterPlugin('proof');
  await expect.poll(() => f.find('plugin-proof-panel')).toBeUndefined();
  source.press('second', source.snapshot().revision);
  expect(received).toHaveLength(2);
});

it('keeps non-UI-context forms in the main FIFO and cancels only the selected independent UI operation', async () => {
  const f = await fixture();
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  let result: unknown = 'pending';
  f.host.core.host.registerPlugin({name: 'fifo-proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (event, $) => {if (event.site === 'unscoped') result = await $.ui.form({title: 'Unscoped form', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});},
  });
  const unscoped = f.host.core.host.emit('ui.press', {site: 'unscoped', key: 'open'});
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  const {form} = await connection(f);
  expect(f.host.cancelOperation('foreign')).toBe(false);
  expect(f.host.cancelOperation(form.id)).toBe(true);
  await expect.poll(() => f.host.surfaces.snapshot().includes(form)).toBe(false);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(result).toBe('pending');
  f.host.session.answerInteraction!(question.id, {answers: [{id: 'answer', selected: ['Remote']}]});
  await main;
  expect(f.host.session.snapshot().interaction).toMatchObject({kind: 'form', request: {title: 'Unscoped form'}});
  const queued = f.host.session.snapshot().interaction!;
  f.host.session.cancelInteraction!(question.id); expect(result).toBe('pending');
  f.host.session.cancelInteraction!(queued.id); await unscoped;
  expect(result).toBeNull();
});

it('serializes semantic input changes and forwards only the latest queued value', async () => {
  const f = await fixture();
  const seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  f.host.core.host.registerPlugin({name: 'search-proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.change': async (event, $) => {
      if (event.site !== 'plugin-search-proof-main') return;
      seen.push(event.value);
      if (seen.length === 1) await gate;
      await $.ui.view('main', 'Search', {input: {id: 'query', value: event.value}, lines: [{text: 'Search results'}]});
    },
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'search-proof', id: 'main', title: 'Search',
    view: {input: {id: 'query', value: ''}, lines: [{text: 'Search results'}]}});
  const source = f.find('plugin-search-proof-main')!;
  const transitions: {busy?: boolean; value?: string}[] = [];
  source.subscribe(() => transitions.push({busy: source.snapshot().busy, value: source.snapshot().view?.input?.value}));
  expect(f.host.session.snapshot()).toBe(f.host.session.snapshot());
  source.change('query', 'first', source.snapshot().revision);
  await expect.poll(() => seen).toEqual(['first']);
  source.change('query', 'intermediate', source.snapshot().revision);
  source.change('query', 'latest', source.snapshot().revision);
  expect(seen).toEqual(['first']);
  release();
  await expect.poll(() => seen).toEqual(['first', 'latest']);
  await expect.poll(() => source.snapshot().busy).toBe(false);
  expect(source.snapshot().view?.input?.value).toBe('latest');
  expect(transitions.every(state => state.busy || state.value === 'latest')).toBe(true);
  expect(f.requests).toHaveLength(0);
});

it('bounds simultaneous UI operations and shuts down each private form through its owning signal', async () => {
  const f = await fixture();
  let calls = 0;
  const results: unknown[] = [];
  f.host.core.host.registerPlugin({name: 'bounded-proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.change': async (event, $) => {
      if (event.site === 'plugin-bounded-proof-search')
        await $.ui.view('search', 'Queued search', {input: {id: 'query', value: event.value}, lines: []});
    },
    'ui.press': async (event, $) => {
      if (event.site !== 'plugin-bounded-proof-main') return;
      calls++;
      results.push(await $.ui.form({title: 'Controlled form', fields: [{id: 'token', label: 'Token', type: 'password'}], actions: [{id: 'save', label: 'Save'}]}));
    },
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'bounded-proof', id: 'main', title: 'Bounded', view: {lines: [{text: 'Open form', action: 'open'}]}});
  const source = f.find('plugin-bounded-proof-main')!;
  for (let n = 0; n < 5; n++) source.press('open', source.snapshot().revision);
  await expect.poll(() => f.host.surfaces.snapshot().filter(source => source.snapshot().form).length).toBe(4);
  expect(calls).toBe(4);
  expect(f.host.session.snapshot().notice).toContain('Four interface operations');
  await f.host.core.host.emit('service.ui.view', {plugin: 'bounded-proof', id: 'search', title: 'Queued search', view: {input: {id: 'query', value: ''}, lines: []}});
  const search = f.find('plugin-bounded-proof-search')!;
  search.change('query', 'queued search input', search.snapshot().revision);
  expect(search.snapshot().busy).toBe(true);
  expect(f.host.session.snapshot().notice).toContain('input queued');
  const forms = f.host.surfaces.snapshot().filter(source => source.snapshot().form);
  f.host.cancelOperation(forms[0].id);
  await expect.poll(() => f.host.surfaces.snapshot().filter(source => source.snapshot().form).length).toBe(3);
  await expect.poll(() => search.snapshot().view?.input?.value).toBe('queued search input');
  await expect.poll(() => search.snapshot().busy).toBe(false);
  expect(forms.slice(1).every(source => source.snapshot().form)).toBe(true);
  await f.host.close();
  expect(results).toEqual([null, null, null, null]);
  expect(f.requests).toHaveLength(0);
});

it('resumes actual saved history through the same stable session wrapper and removes the prior sources', async () => {
  const f = await fixture();
  await f.app.store.create(f.cwd, {id: 'saved-chat', name: 'Saved chat'});
  await f.app.store.append('saved-chat', [
    {type: 'prompt.submit', text: 'Saved user task'},
    {type: 'assistant.text', turnId: 'saved-turn', text: 'Saved answer'},
    {type: 'turn.complete', turnId: 'saved-turn', text: 'Saved answer'},
  ], f.cwd);
  const session = f.host.session, previous = f.host.core;
  await f.host.submit('/history');
  await expect.poll(() => f.find('plugin-session-manager-sessions')?.snapshot().view?.lines.some(line => line.action === 'resume')).toBe(true);
  const history = f.find('plugin-session-manager-sessions')!;
  history.press('select:saved-chat', history.snapshot().revision);
  await expect.poll(() => history.snapshot().busy).toBe(false);
  history.press('resume', history.snapshot().revision);
  await expect.poll(() => f.host.core.sessionId).toBe('saved-chat');
  expect(f.host.core).not.toBe(previous);
  expect(f.host.session).toBe(session);
  expect(session.snapshot().messages).toContainEqual({role: 'assistant', text: 'Saved answer'});
  expect(f.find('plugin-session-manager-sessions')).toBeUndefined();
  await f.host.submit('Continue restored chat');
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].body.messages.some((message: any) => message.content === 'Saved answer')).toBe(true);
});

it('relays actual composer attachment pixels and visibility without opening a standalone mascot pane', async () => {
  const f = await fixture();
  const observed: unknown[] = [];
  f.host.core.host.registerPlugin({name: 'media-proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.visibility': event => {observed.push(event);},
  });
  const frames: unknown[] = [];
  const off = f.host.composerMedia.subscribe(false, frame => frames.push(frame));
  const pixel = Buffer.from([1, 2, 3, 255]).toString('base64');
  await f.host.core.host.emit('service.ui.view', {plugin: 'media-proof', id: 'companion', title: 'Chosen mascot',
    view: {attachment: {site: 'composer', width: 18, rows: 6, label: 'Actual choice'}, raster: {width: 1, height: 1, rgba: pixel}, lines: []}});
  expect(f.find('plugin-media-proof-companion')).toBeUndefined();
  expect(f.layout.snapshot().locations['plugin-media-proof-companion']).toBeUndefined();
  expect(frames.at(-1)).toEqual({width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255])});
  expect(f.host.composerMedia.dimensions?.()).toEqual({width: 18, height: 6});
  await expect.poll(() => observed.some((event: any) => event.site === 'plugin:media-proof/companion' && event.visible && event.columns === 18 && event.rows === 6)).toBe(true);
  off();
  await expect.poll(() => observed.some((event: any) => event.site === 'plugin:media-proof/companion' && !event.visible)).toBe(true);
  const stopped: unknown[] = [];
  const offSecond = f.host.composerMedia.subscribe(false, frame => stopped.push(frame));
  f.host.core.host.unregisterPlugin('media-proof');
  await expect.poll(() => stopped.at(-1)).toBeUndefined();
  offSecond();
});

it('reopens an explicitly requested closed pane and preserves permanent placement through host shutdown and restart', async () => {
  const f = await fixture();
  await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')).toBeDefined();
  const id = 'plugin-model-selector-models';
  f.layout.act({type: 'open', id}); f.layout.act({type: 'moveWorkspace', id: 3});
  f.layout.act({type: 'workspace', id: 3}); f.layout.act({type: 'open', id}); f.layout.act({type: 'close'});
  expect(f.layout.snapshot().locations[id]).toBeUndefined();
  await f.host.submit('/settings');
  await expect.poll(() => f.layout.snapshot().locations[id]).toBe(3);
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  const file = join(f.app.storage.paths.state, 'layout.json');
  const before = JSON.parse(await readFile(file, 'utf8'));
  await f.host.close(); await f.layout.disconnect();
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(before);
  const app = await buildApp({cwd: f.cwd, env: f.env, agentHub: false}); cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']}); cleanup.push(() => layout.disconnect());
  layout.resize(140, 40);
  const host = createOpenTuiHost(app, layout); cleanup.push(() => host.close());
  await host.start(); await host.submit('/settings');
  await expect.poll(() => host.surfaces.snapshot().some(source => source.id === id)).toBe(true);
  expect(layout.snapshot().locations[id]).toBe(3);
  expect(layout.snapshot().focused).toBe(id);
});

it('fails closed when an unavailable selected history or placement controller is opened and keeps navigation usable', async () => {
  const f = await fixture();
  for (const kind of ['history', 'placement'] as const) {
    const app = await buildApp({cwd: f.cwd, env: f.env, agentHub: false,
      fixedConfig: {...f.app.config.config, ui: {controllers: {
        editor: '@host', approval: '@host', question: '@host', form: '@host', history: '@host', placement: '@host',
        [kind]: 'unsupported-owner',
      }}}});
    const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(140,40);
    const host=createOpenTuiHost(app,layout);
    try {
      await host.start();await host.submit(kind==='history'?'/history':'/placement');
      await expect.poll(()=>host.session.snapshot().notice).toMatch(/controller.*(?:failed|unavailable)/i);
      expect(host.surfaces.snapshot().some(source=>source.snapshot().controller?.kind===kind)).toBe(false);
      expect(f.requests).toHaveLength(0);
      host.navigation.openFinder();expect(host.navigation.snapshot().mode).toBe('finder');
      expect(host.navigation.snapshot().entries.some(entry=>entry.id==='session')).toBe(true);
    } finally {await host.close();await layout.disconnect();await app.close();}
  }
});

it('gives an explicitly retained form a passive independent request owner after its launcher settles', async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let result: unknown = 'pending';
  f.host.core.host.registerPlugin({name: 'deferred-proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': (_event, $) => {
      const detached = $.background();
      void gate.then(async () => {
        try {result = await detached.ui.form({title: 'Late form', fields: [{id: 'token', label: 'Token', type: 'password'}], actions: [{id: 'save', label: 'Save'}]});}
        catch {result = 'revoked';}
      });
    },
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'deferred-proof', id: 'main', title: 'Deferred', view: {lines: [{text: 'Schedule', action: 'schedule'}]}});
  const source = f.find('plugin-deferred-proof-main')!;
  source.press('schedule', source.snapshot().revision);
  await expect.poll(() => source.snapshot().busy).toBe(false);
  f.layout.act({type: 'open', id: 'session'});
  release();
  const form = await f.waitForm('Late form');
  expect(f.layout.snapshot().focused).toBe('session');
  expect(f.host.session.snapshot().interaction).toBeUndefined();
  form.answerForm!(form.snapshot().form!.id, {action: 'save', values: {token: 'PRIVATE_RETAINED_TOKEN'}});
  await expect.poll(() => result).toEqual({action: 'save', values: {token: 'PRIVATE_RETAINED_TOKEN'}});
  await expect.poll(() => f.form()).toBeUndefined();
  expect(f.host.session.snapshot().interaction).toBeUndefined();
  expect(f.requests).toHaveLength(0);
  expect(JSON.stringify(f.events)).not.toContain('PRIVATE_RETAINED_TOKEN');
});

it('rejects ordinary stale UI capabilities instead of delivering their form into Main', async () => {
  const f = await fixture();
  let release = () => {}, result: unknown = 'pending';
  const gate = new Promise<void>(done => {release = done;});
  f.host.core.host.registerPlugin({name: 'ordinary-stale', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': (_event, $) => {void gate.then(async () => {
      try {result = await $.ui.form({title: 'Expired ordinary form', fields: [{id: 'value', type: 'text', label: 'Value'}], actions: [{id: 'save', label: 'Save'}]});}
      catch {result = 'revoked';}
    });},
  });
  await f.host.core.host.emit('service.ui.view', {plugin: 'ordinary-stale', id: 'main', title: 'Ordinary stale', view: {lines: [{text: 'Schedule', action: 'schedule'}]}});
  const source = f.find('plugin-ordinary-stale-main')!;
  source.press('schedule', source.snapshot().revision);
  await expect.poll(() => source.snapshot().busy).toBe(false);
  release(); await expect.poll(() => result).toBe('revoked');
  expect(f.form()).toBeUndefined(); expect(f.host.session.snapshot().interaction).toBeUndefined();
  expect(f.requests).toHaveLength(0);
});

it('routes an actual loaded UI-only command during a pending question and promotes legacy text as bounded literal lines', async () => {
  const f = await fixture({plugins: [{name: 'ui-only-real-owner', commands: [
    {name: '/ui-only-proof', description: 'Open a legacy text surface', ui: {site: 'panel'}},
  ], source: `export default {'ui.press':async(event,$)=>{
    if(event.site==='plugin-ui-only-real-owner-panel'&&event.key==='command:/ui-only-proof')
      await $.ui.surface('panel','Legacy proof','Literal [x] task\\nNo inferred action',{site:'sidebar',focus:false});
  }};`}]});
  expect(f.app.pluginErrors).toEqual([]);
  const command = f.app.commands().find(command => command.name === '/ui-only-proof');
  expect(command).toMatchObject({plugin: 'ui-only-real-owner', ui: {site: 'plugin-ui-only-real-owner-panel'}});
  expect(command?.execution).toBeUndefined();
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  expect(f.host.session.isImmediateCommand!('/ui-only-proof')).toBe(true);
  await f.host.submit('/ui-only-proof');
  await expect.poll(() => f.find('plugin-ui-only-real-owner-panel')).toBeDefined();
  const source = f.find('plugin-ui-only-real-owner-panel')!;
  await expect.poll(() => source.snapshot().busy).toBe(false);
  expect(source.snapshot().view?.lines).toEqual([{text: 'Literal [x] task'}, {text: 'No inferred action'}]);
  source.press('invented action', source.snapshot().revision);
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(f.requests).toHaveLength(1);
  expect(f.host.core.getMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(['Ask before continuing']);
  const text = 'x' + '😀'.repeat(6000) + '\nTAIL';
  await f.host.core.host.emit('service.ui.surface', {plugin: 'ui-only-real-owner', id: 'panel', title: 'Long legacy text', text});
  const lines = source.snapshot().view!.lines;
  expect(lines.every(line => line.text.length <= 10000 && !line.action)).toBe(true);
  expect(lines.slice(0, -1).map(line => line.text).join('')).toBe('x' + '😀'.repeat(6000));
  expect(lines.at(-1)?.text).toBe('TAIL');
  await f.host.core.host.emit('service.ui.surface', {plugin: 'ui-only-real-owner', id: 'panel', title: 'Many lines', text: 'line\n'.repeat(3000)});
  expect(source.snapshot().view?.lines).toHaveLength(2000);
  expect(source.snapshot().view?.lines.at(-1)?.text).toContain('truncated');
  f.host.session.cancelInteraction!(question.id); await main;
});

it('resolves user placement rules once over plugin hints and restored positions, retaining later manual moves', async () => {
  const f = await fixture({ui: {
    sites: {inspector: {size: .25, focus: false}}, rules: [
      {match: {plugin: 'placement-proof'}, site: 'inspector', workspace: 3, relativeTo: 'session'},
      {match: {plugin: 'placement-proof', surface: 'main'}, size: .3},
    ],
  }});
  f.layout.act({type: 'open', id: 'session'}); f.layout.act({type: 'moveWorkspace', id: 3});
  const id = 'plugin-placement-proof-main';
  const register = (host: typeof f.host) => host.core.host.registerPlugin({name: 'placement-proof', version: '1.0.0', trust: 'trusted'}, {});
  const publish = (host: typeof f.host) => host.core.host.emit('service.ui.view', {plugin: 'placement-proof', id: 'main', title: 'Placement',
    view: {lines: [{text: 'Actual placement source'}]}, placement: {site: 'sidebar', workspace: 1, size: .7, relativeTo: 'missing', focus: true}});
  register(f.host); await publish(f.host);
  expect(f.layout.snapshot()).toMatchObject({workspace: 3, focused: 'session', locations: {[id]: 3}});
  expect(f.layout.snapshot().frames.find(frame => frame.surface === id)).toMatchObject({x: 0, y: 28, width: 140, height: 12});
  f.layout.act({type: 'open', id}); f.layout.act({type: 'moveWorkspace', id: 4});
  f.layout.act({type: 'workspace', id: 3});
  await publish(f.host);
  expect(f.layout.snapshot()).toMatchObject({workspace: 3, focused: 'session', locations: {[id]: 4}});
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  await f.host.close(); await f.layout.disconnect();
  const app = await buildApp({cwd: f.cwd, env: f.env, agentHub: false}); cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']}); cleanup.push(() => layout.disconnect());
  layout.resize(140, 40);
  const host = createOpenTuiHost(app, layout); cleanup.push(() => host.close());
  await host.start(); register(host); await publish(host);
  expect(layout.snapshot().locations[id]).toBe(3);
  expect(layout.snapshot().frames.find(frame => frame.surface === id)).toMatchObject({x: 0, y: 28, width: 140, height: 12});
  layout.act({type: 'open', id}); layout.act({type: 'moveWorkspace', id: 5}); layout.act({type: 'workspace', id: 3});
  await publish(host);
  expect(layout.snapshot().locations[id]).toBe(5);
});

it('does not let an earlier self-removed source operation overwrite its replacement source generation', async () => {
  const f = await fixture({plugins: [{name: 'capture-proof', commands: [
    {name: '/capture-view', description: 'Publish and detach a controlled view', ui: {site: 'panel'}},
  ], source: 'export default {};'}]});
  f.host.core.host.unregisterPlugin('capture-proof');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let removed = false, finished = false;
  f.host.core.host.registerPlugin({name: 'capture-proof', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (event, $) => {
      if (event.site !== 'plugin-capture-proof-panel') return;
      if (event.key === 'command:/capture-view') {
        await $.ui.view('panel', 'Earlier source', {lines: []});
        await $.ui.remove('panel'); removed = true;
        await gate; finished = true;
      } else if (event.key === 'hold') await $.ui.form({title: 'Replacement operation', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});
    },
  });
  await f.host.submit('/capture-view');
  await expect.poll(() => removed).toBe(true);
  expect(f.find('plugin-capture-proof-panel')).toBeUndefined();
  await f.host.core.host.emit('service.ui.view', {plugin: 'capture-proof', id: 'panel', title: 'Replacement source', view: {lines: [{text: 'Hold replacement', action: 'hold'}]}});
  const source = f.find('plugin-capture-proof-panel')!;
  source.press('hold', source.snapshot().revision);
  await f.waitForm('Replacement operation');
  const before = source.snapshot();
  expect(before.busy).toBe(true);
  release();
  await expect.poll(() => finished).toBe(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(source.snapshot()).toBe(before);
  const form = f.form()!; form.cancelForm!(form.snapshot().form!.id);
  await expect.poll(() => source.snapshot().busy).toBe(false);
  f.host.core.host.unregisterPlugin('capture-proof');
  await expect.poll(() => f.find('plugin-capture-proof-panel')).toBeUndefined();
});

it('uses actual manager navigation, local inactive installation, cross-manager forms and deferred enable/reload during a pending question', async () => {
  const f = await fixture({enabledPlugins: ['extension-manager', 'marketplace-manager', 'local-flow-probe']});
  const catalog = join(f.root, 'catalog'), plugin = join(catalog, 'plugins/local-flow-probe');
  await mkdir(join(catalog, '.claude-plugin'), {recursive: true}); await mkdir(plugin, {recursive: true});
  await writeFile(join(catalog, '.claude-plugin/marketplace.json'), JSON.stringify({name: 'local-flow', owner: {name: 'Local fixture'},
    plugins: [{name: 'local-flow-probe', version: '1.0.0', source: './plugins/local-flow-probe'}]}));
  await writeFile(join(plugin, 'plugin.json'), JSON.stringify({name: 'local-flow-probe', version: '1.0.0', trust: 'trusted'}));
  await writeFile(join(plugin, 'hooks.ts'), `export default {'session.reload':async(_,$)=>$.ui.surface('main','Installed local flow','Loaded only after explicit enable and reload',{focus:false})};`);
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!;
  const extensionId = 'plugin-extension-manager-extensions', marketId = 'plugin-marketplace-manager-marketplaces';
  const waitAction = async (id: string, action: string) => {
    await expect.poll(() => f.find(id)?.snapshot().view?.lines.some(line => line.action === action)).toBe(true);
    const source = f.find(id)!; await expect.poll(() => source.snapshot().busy).toBe(false); return source;
  };
  const press = async (id: string, action: string) => {const source = await waitAction(id, action); source.press(action, source.snapshot().revision);};
  await f.host.submit('/plugins'); await press(extensionId, 'navigate:marketplace');
  await press(marketId, 'add');
  const add = await f.waitForm('Add marketplace'); f.answer(add, 'add', {source: catalog, ref: '', scope: 'project'});
  await expect.poll(() => f.form()).toBeUndefined();
  await press(marketId, 'navigate:marketplace');
  await press(marketId, 'catalog:local-flow');
  await press(marketId, 'navigate:extensions');
  await press(extensionId, 'navigate:marketplace'); await press(marketId, 'catalog:local-flow');
  await press(marketId, 'install:local-flow-probe@local-flow');
  const install = await f.waitForm('Install local-flow-probe@local-flow'); f.answer(install, 'install', {scope: 'project'});
  await expect.poll(() => f.form()).toBeUndefined();
  const market = await waitAction(marketId, 'manage:local-flow-probe');
  expect(market.snapshot().view?.lines.some(line => line.text.includes('Inactive until you explicitly enable'))).toBe(true);
  const stateFile = join(f.app.storage.paths.state, 'extensions-state.json');
  const inactive = JSON.parse(await readFile(stateFile, 'utf8'));
  expect(inactive.disabled).toContain('local-flow-probe'); expect(inactive.enabled).not.toContain('local-flow-probe');
  expect(f.app.plugins.some(plugin => plugin.manifest.name === 'local-flow-probe')).toBe(false);
  await press(marketId, 'updates');
  await expect.poll(() => f.find(extensionId)?.snapshot().view?.lines.some(line => line.text === 'Plugin updates')).toBe(true);
  await press(marketId, 'manage:local-flow-probe');
  const manage = await f.waitForm('Manage local-flow-probe');
  expect(manage.snapshot().form?.plugin).toBe('extension-manager');
  f.answer(manage, 'apply', {action: 'enable', scope: 'project'});
  await expect.poll(() => f.form()).toBeUndefined();
  await expect.poll(() => f.find(extensionId)?.snapshot().view?.lines[0]?.text).toContain('Enabled local-flow-probe');
  const enabled = JSON.parse(await readFile(stateFile, 'utf8')); expect(enabled.enabled).toContain('local-flow-probe');
  await press(extensionId, 'navigate:placement');
  const placement = await f.waitForm('Arrange plugin windows');
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  placement.cancelForm!(placement.snapshot().form!.id);
  await expect.poll(() => f.form()).toBeUndefined();
  await press(extensionId, 'navigate:reload');
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(f.app.plugins.some(plugin => plugin.manifest.name === 'local-flow-probe')).toBe(false);
  expect(f.requests).toHaveLength(1);
  expect(f.host.core.getMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(['Ask before continuing']);
  f.host.session.answerInteraction!(question.id, {answers: [{id: 'answer', selected: ['Local']}]}); await main;
  await expect.poll(() => f.app.plugins.some(plugin => plugin.manifest.name === 'local-flow-probe')).toBe(true);
  await expect.poll(() => f.find('plugin-local-flow-probe-main')?.snapshot().view?.lines[0].text).toBe('Loaded only after explicit enable and reload');
  expect(f.requests).toHaveLength(2);
});

it('keeps /windows and the actual native placement editor out of model prompts, applies and saves canonical rules', async () => {
  const f = await fixture({ui: {rules: [{match: {plugin: 'unrelated'}, workspace: 8}]}});
  const originalFile = join(f.cwd, 'agent-compositor.json'), original = await readFile(originalFile, 'utf8');
  const file = join(f.cwd, '.agent-compositor', 'agent-compositor.jsonc');
  await mkdir(join(f.cwd, '.agent-compositor'), {recursive: true});
  await writeFile(file, '// Keep this user comment\n{"agent":{"maxSteps":11}}\n');
  await f.host.submit('/windows');
  expect(f.host.navigation.snapshot().mode).toBe('finder');
  f.host.navigation.handle({kind: 'key', key: 'escape'});
  expect(f.host.session.isImmediateCommand!('/windows')).toBe(true);
  await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')?.snapshot().busy).toBe(false);
  const id = 'plugin-model-selector-models';
  expect(f.host.session.isImmediateCommand!('/placement')).toBe(true);
  await f.host.submit('/placement');
  const form = await f.waitForm('Arrange plugin windows');
  const values = {window: id, site: 'inspector', workspace: '3', size: '0.25', relativeTo: 'session', focus: false};
  f.answer(form, 'apply', values);
  await expect.poll(() => form.snapshot().form?.request.description).toContain('Applied for this run');
  expect(f.layout.snapshot().locations[id]).toBe(3);
  f.answer(form, 'save', {...values, workspace: '4'});
  await expect.poll(() => form.snapshot().form?.request.description).toContain('Rule saved');
  expect(f.layout.snapshot().locations[id]).toBe(4);
  const saved = await readFile(file, 'utf8');
  expect(saved).toContain('// Keep this user comment'); expect(saved).toContain('unrelated'); expect(saved).toContain('model-selector');
  expect(await readFile(originalFile, 'utf8')).toBe(original);
  form.cancelForm!(form.snapshot().form!.id);
  await expect.poll(() => f.form()).toBeUndefined();
  await f.host.core.host.emit('service.ui.remove', {plugin: 'model-selector', id: 'models'});
  await f.host.submit('/settings');
  await expect.poll(() => f.layout.snapshot().locations[id]).toBe(4);
  expect(f.requests).toHaveLength(0);
  await f.host.close(); await f.layout.disconnect();
  const app = await buildApp({cwd: f.cwd, env: f.env, agentHub: false}); cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']}); cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout); cleanup.push(() => host.close());
  await host.start(); await host.submit('/settings');
  await expect.poll(() => layout.snapshot().locations[id]).toBe(4);
  expect(app.config.config.ui?.rules?.some(rule => rule.match.plugin === 'unrelated')).toBe(true);
});

it.each(['Main', 'workspace'] as const)('applies and saves placement geometry without stealing newer %s intent after a delayed save', async intent => {
  const f = await fixture(), gate = focusGate();
  await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')?.snapshot().busy).toBe(false);
  const id = 'plugin-model-selector-models', save = f.app.savePlacement;
  let saves = 0;
  f.app.savePlacement = async rule => {saves++;await gate.wait(new AbortController().signal);return save(rule);};
  await f.host.submit('/placement');
  const form = await f.waitForm('Arrange plugin windows'), request = form.snapshot().form!;
  const values = {window: id, site: 'inspector', workspace: '3', size: '0.25', relativeTo: 'session', focus: true};
  const beforeAnswer = f.layout.windowIntentRevision;
  f.answer(form, 'save', values);
  expect(f.layout.windowIntentRevision).toBe(beforeAnswer + 1);
  await expect.poll(gate.entered).toBe(true);
  f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});
  if (intent === 'workspace')f.layout.act({type: 'workspace', id: 2});
  const before = f.layout.snapshot(), epoch = f.layout.windowIntentRevision;
  form.answerForm!(request.id, {action: 'save', values});
  expect(f.layout.windowIntentRevision).toBe(epoch);expect(saves).toBe(1);
  gate.release();
  await expect.poll(() => form.snapshot().form?.request.description).toContain('Rule saved');
  expect(f.layout.snapshot()).toMatchObject({workspace: before.workspace, focused: before.focused, locations: {[id]: 3}});
  expect(f.layout.windowIntentRevision).toBe(epoch);
  expect(form.snapshot().form?.id).not.toBe(request.id);
  const saved = await readFile(join(f.cwd, '.agent-compositor', 'agent-compositor.jsonc'), 'utf8');
  expect(saved).toContain('"focus": true');expect(saved).toContain('"workspace": 3');
  form.cancelForm!(form.snapshot().form!.id);
});

it('honors a fresh Focus=true placement Apply after reopening an old pending form through Finder', async () => {
  const f = await fixture();await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')?.snapshot().busy).toBe(false);
  const id = 'plugin-model-selector-models';
  await f.host.submit('/placement');const form = await f.waitForm('Arrange plugin windows');
  const request = form.snapshot().form!.id;
  f.layout.act({type: 'close'});f.host.navigation.handle({kind: 'key', key: '0', modifiers: ['alt']});
  f.host.navigation.openFinder();f.host.navigation.changeQuery('Arrange plugin windows', f.host.navigation.snapshot().revision);
  f.host.navigation.choose(form.id, f.host.navigation.snapshot().revision);
  expect(f.layout.snapshot().focused).toBe(form.id);expect(form.snapshot().form?.id).toBe(request);
  const beforeAnswer = f.layout.windowIntentRevision;
  form.answerInteraction!(request, {action: 'apply', values: {window: id, site: 'inspector', workspace: '3', size: '0.25', relativeTo: 'session', focus: true}});
  await expect.poll(() => form.snapshot().form?.request.description).toContain('Applied for this run');
  expect(f.layout.snapshot()).toMatchObject({workspace: 3, focused: id, locations: {[id]: 3}});
  expect(f.layout.windowIntentRevision).toBe(beforeAnswer + 1);
  form.cancelForm!(form.snapshot().form!.id);expect(f.requests).toHaveLength(0);
});

it('admits the full placement selector boundary and explains overflow without silently dropping retained windows', async () => {
  const f = await fixture();
  f.host.core.host.registerPlugin({name: 'many-windows', version: '1.0.0', trust: 'trusted'}, {});
  const add = async (index: number) => {
    await f.host.core.host.emit('service.ui.view', {plugin: 'many-windows', id: 'pane' + index, title: 'Window ' + index,
      view: {lines: []}, placement: {focus: true}});
    f.layout.act({type: 'close'});
  };
  for (let index = 0; index < 198; index++) await add(index);
  await f.host.submit('/placement');
  const form = await f.waitForm('Arrange plugin windows');
  expect(form.snapshot().form?.request.fields.find(field => field.id === 'window')?.options).toHaveLength(198);
  expect(form.snapshot().form?.request.fields.find(field => field.id === 'relativeTo')?.options).toHaveLength(200);
  form.cancelForm!(form.snapshot().form!.id); await expect.poll(() => f.form()).toBeUndefined();
  await add(198); await f.host.submit('/placement');
  await expect.poll(() => f.host.session.snapshot().notice).toContain('up to 198 plugin windows');
  expect(f.form()).toBeUndefined();
  expect(f.host.surfaces.snapshot()).toHaveLength(199);
  expect(f.requests).toHaveLength(0);
});

it('serializes new submissions behind an actual reload and rejects stale UI actions during its commit', async () => {
  const f = await fixture();
  await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')?.snapshot().busy).toBe(false);
  const source = f.find('plugin-model-selector-models')!;
  const native = f.app.reloadPlugins.bind(f.app);
  let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => {release = resolve;});
  f.app.reloadPlugins = async core => {entered = true; await gate; return native(core);};
  const reload = f.host.submit('/reload');
  await expect.poll(() => entered).toBe(true);
  const request = f.host.submit('Run after the reload commit');
  source.press('add', source.snapshot().revision);
  expect(f.form()).toBeUndefined();
  expect(f.host.session.snapshot().notice).toContain('Plugin reload is applying');
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(f.requests).toHaveLength(0);
  release(); await reload; await request;
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].body.messages.at(-1)?.content).toBe('Run after the reload commit');
  expect(f.host.core.getMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(['Run after the reload commit']);
});

it('drains an in-flight actual reload before closing its core and prevents queued submissions after shutdown', async () => {
  const f = await fixture();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const nativeReload = f.app.reloadPlugins.bind(f.app), nativeClose = f.host.core.close.bind(f.host.core);
  f.app.reloadPlugins = async core => {events.push('reload started'); await gate; const result = await nativeReload(core); events.push('reload finished'); return result;};
  f.host.core.close = async () => {events.push('core closed'); await nativeClose();};
  const reload = f.host.submit('/reload');
  await expect.poll(() => events).toEqual(['reload started']);
  const queued = f.host.submit('Do not run after shutdown');
  let closed = false;
  const closing = f.host.close().then(() => {closed = true;});
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(closed).toBe(false);
  expect(events).toEqual(['reload started']);
  release(); await Promise.all([reload, queued, closing]);
  expect(events).toEqual(['reload started', 'reload finished', 'core closed']);
  expect(f.requests).toHaveLength(0);
});

it('keeps a failed reload requested and blocks submissions waiting on that failure until an explicit retry succeeds', async () => {
  const f = await fixture();
  await f.host.submit('/settings');
  await expect.poll(() => f.find('plugin-model-selector-models')?.snapshot().busy).toBe(false);
  const source = f.find('plugin-model-selector-models')!;
  const native = f.app.reloadPlugins.bind(f.app);
  let release!: () => void, attempts = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  f.app.reloadPlugins = async core => {attempts++; if (attempts === 1) {await gate; throw Error('Controlled reload failure');} return native(core);};
  const reload = f.host.submit('/reload');
  const request = f.host.submit('Wait for a successful reload');
  const denied = expect(request).rejects.toThrow('Plugin reload did not finish');
  release(); await reload; await denied;
  expect(f.requests).toHaveLength(0);
  expect(f.host.session.snapshot().notice).toContain('Could not reload plugins');
  await expect(f.host.submit('A fresh request after failure')).rejects.toThrow('Plugin reload did not finish');
  source.press('add', source.snapshot().revision);
  expect(f.form()).toBeUndefined();
  expect(f.host.session.snapshot().notice).toContain('Retry /reload');
  await f.host.submit('/reload');
  expect(attempts).toBe(2);
  await f.host.submit('Run after retry');
  expect(f.requests).toHaveLength(1);
});

it('preserves manually moved and closed identities across same-owner reload, then forgets truly disabled owners', async () => {
  const name = 'reload-proof', id = 'plugin-reload-proof-panel';
  const f = await fixture({enabledPlugins: ['extension-manager'], ui: {rules: [
    {match: {plugin: name, surface: 'panel'}, site: 'sidebar', workspace: 3, focus: false},
  ]}, plugins: [{name, commands: [], source: `const show=async(_,$)=>$.ui.view('panel','Reload proof',{lines:[{text:'Current generation'}]},{site:'sidebar',focus:false});export default {'session.start':show,'session.reload':show};`}]});
  await expect.poll(() => f.find(id)).toBeDefined();
  expect(f.layout.snapshot().locations[id]).toBe(3);
  f.layout.act({type: 'open', id}); f.layout.act({type: 'moveWorkspace', id: 4}); f.layout.act({type: 'workspace', id: 1});
  const first = f.find(id)!;
  await f.host.submit('/reload');
  expect(f.find(id)).toBeDefined(); expect(f.find(id)).not.toBe(first);
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', locations: {[id]: 4}});
  f.layout.act({type: 'open', id}); f.layout.act({type: 'close'}); f.layout.act({type: 'workspace', id: 1});
  await f.host.submit('/reload');
  expect(f.find(id)).toBeDefined();
  expect(f.layout.snapshot().locations[id]).toBeUndefined();
  expect(f.layout.snapshot().workspace).toBe(1);
  const selection = async (action: 'disable' | 'enable') => {
    await f.host.submit(`/extensions ${action} ${name} --project`);
    await expect.poll(() => f.find('plugin-extension-manager-extensions')?.snapshot().busy).toBe(false);
    await expect.poll(() => f.find('plugin-extension-manager-extensions')?.snapshot().view?.lines[0]?.text)
      .toContain(action === 'disable' ? 'Disabled reload-proof' : 'Enabled reload-proof');
    await f.host.submit('/reload');
  };
  await selection('disable');
  expect(f.host.core.host.hasPlugin(name)).toBe(false);
  expect(f.find(id)).toBeUndefined();
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  const saved = JSON.parse(await readFile(join(f.app.storage.paths.state, 'layout.json'), 'utf8'));
  expect(saved.registered).not.toContain(id);
  await selection('enable');
  expect(f.host.core.host.hasPlugin(name)).toBe(true);
  expect(f.layout.snapshot().locations[id]).toBe(3);
  expect(f.requests).toHaveLength(0);
});

it('forgets a retained but unpublished owner when a later reload actually disables it', async () => {
  const name = 'quiet-proof', id = 'plugin-quiet-proof-panel';
  const f = await fixture({enabledPlugins: ['extension-manager'], plugins: [{name, commands: [],
    source: `export default {'session.start':async(_,$)=>$.ui.view('panel','Quiet proof',{lines:[]},{workspace:3,site:'sidebar',focus:false})};`}]});
  await expect.poll(() => f.find(id)).toBeDefined();
  await f.host.submit('/reload');
  expect(f.host.core.host.hasPlugin(name)).toBe(true);
  expect(f.find(id)).toBeUndefined();
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  const file = join(f.app.storage.paths.state, 'layout.json');
  const retained = JSON.parse(await readFile(file, 'utf8'));
  expect(retained.registered).toContain(id);
  expect(JSON.stringify(retained.windows)).toContain(id);
  await f.host.submit('/extensions disable quiet-proof --project');
  await expect.poll(() => f.find('plugin-extension-manager-extensions')?.snapshot().busy).toBe(false);
  await f.host.submit('/reload');
  expect(f.host.core.host.hasPlugin(name)).toBe(false);
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  const forgotten = JSON.parse(await readFile(file, 'utf8'));
  expect(forgotten.registered).not.toContain(id);
  expect(JSON.stringify(forgotten.windows)).not.toContain(id);
  expect(f.requests).toHaveLength(0);
});

it('navigates real pending questions and private forms without changing their decisions or the main conversation identity', async () => {
  const f = await fixture();
  const main = f.host.submit('Ask before continuing');
  await expect.poll(() => f.host.session.snapshot().interaction?.kind).toBe('question');
  const question = f.host.session.snapshot().interaction!, sessionId = f.host.core.sessionId;
  const {form} = await connection(f);
  const request = form.snapshot().form!;
  const nav = f.host.navigation;
  nav.toggleArrange();
  for (const key of ['y', 'n']) expect(nav.handle({kind: 'key', key})).toBe(true);
  expect(nav.handle({kind: 'paste', text: 'q'})).toBe(true);
  nav.handle({kind: 'key', key: 'c', modifiers: ['ctrl']});
  expect(nav.snapshot().mode).toBe('normal');
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(form.snapshot().form?.id).toBe(request.id);
  nav.openFinder(); nav.changeQuery('New provider connection', nav.snapshot().revision);
  expect(nav.snapshot().entries).toHaveLength(1);
  nav.choose(form.id, nav.snapshot().revision);
  expect(f.layout.snapshot().focused).toBe(form.id);
  nav.toggleArrange(); nav.handle({kind: 'key', key: 'q'}); nav.handle({kind: 'key', key: 'escape'});
  expect(f.layout.snapshot().locations[form.id]).toBeUndefined();
  expect(form.snapshot().form?.id).toBe(request.id);
  nav.openFinder(); nav.changeQuery('New provider connection', nav.snapshot().revision);
  expect(nav.snapshot().entries[0]).toMatchObject({id: form.id, state: 'closed'});
  nav.choose(form.id, nav.snapshot().revision);
  expect(f.layout.snapshot().focused).toBe(form.id);
  nav.handle({kind: 'key', key: '0', modifiers: ['alt']});
  nav.toggleArrange(); nav.handle({kind: 'key', key: 'q'}); nav.handle({kind: 'key', key: 'escape'});
  expect(f.layout.snapshot().locations.session).toBeUndefined();
  await f.host.submit('/windows'); nav.changeQuery('Main', nav.snapshot().revision);
  nav.choose('session', nav.snapshot().revision);
  expect(f.host.core.sessionId).toBe(sessionId);
  expect(f.layout.snapshot().focused).toBe('session');
  expect(f.host.session.snapshot().interaction?.id).toBe(question.id);
  expect(f.requests).toHaveLength(1);
  expect(f.host.core.getMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(['Ask before continuing']);
  nav.openFinder(); nav.changeQuery('PRIVATE_FINDER_QUERY_SENTINEL', nav.snapshot().revision);
  expect(JSON.stringify(f.events)).not.toContain('PRIVATE_FINDER_QUERY_SENTINEL');
  expect(JSON.stringify(await f.app.store.load(sessionId, f.cwd))).not.toContain('PRIVATE_FINDER_QUERY_SENTINEL');
  nav.handle({kind: 'key', key: 'escape'});
  form.cancelForm!(request.id);
  f.host.session.cancelInteraction!(question.id); await main;
});

it.each(['up', 'down', 'tab'])('keeps a current single-result retained picker route live after boundary %s selection', async key => {
  let gate!: ReturnType<typeof focusGate>, signal: AbortSignal | undefined, calls = 0, continued = false;
  const f = await focusFixture(async (_event, $) => {
    calls++;signal = $.signal;const retained = $.background();
    await gate.wait(retained.signal);
    await retained.ui.view('slow', 'Retained boundary destination', {lines: [{text: 'Current route completed'}]}, {workspace: 6, focus: true});
    continued = !signal!.aborted;
  });
  gate = focusGate();const nav = f.host.navigation, id = 'plugin-focus-probe-slow';
  nav.openFinder();nav.changeQuery('/focus-slow', nav.snapshot().revision);
  expect(nav.snapshot().entries.map(entry => entry.id)).toEqual([id]);
  nav.handle({kind: 'key', key: 'enter'});await expect.poll(gate.entered).toBe(true);
  const epoch = f.layout.windowIntentRevision, selection = nav.snapshot().selectionRevision!;
  nav.handle({kind: 'key', key});nav.handle({kind: 'key', key: 'enter'});
  expect(nav.snapshot()).toMatchObject({mode: 'finder', opening: id, selected: id});
  expect(nav.snapshot().selectionRevision).toBeGreaterThan(selection);
  expect(f.layout.windowIntentRevision).toBe(epoch);expect(signal!.aborted).toBe(false);expect(calls).toBe(1);
  gate.release();await expect.poll(() => nav.snapshot().mode).toBe('normal');
  await expect.poll(() => f.find(id)?.snapshot().busy).toBe(false);
  expect(continued).toBe(true);expect(calls).toBe(1);
  expect(f.layout.snapshot()).toMatchObject({workspace: 6, focused: id});
  expect(f.find(id)?.snapshot().view?.lines[0].text).toBe('Current route completed');expect(f.requests).toHaveLength(0);
});

it('awaits an actual unopened route destination and cancels late publication without blocking existing background producers', async () => {
  const f = await fixture({plugins: [{name: 'navigation-probe', commands: [
    {name: '/nav-slow', description: 'Delayed UI route', ui: {site: 'slow'}},
  ], source: `export default {'ui.press':async(event,$)=>{
    if(event.site!=='plugin-navigation-probe-slow'||event.key!=='command:/nav-slow')return;
    const detached=$.background();
    await new Promise(resolve=>setTimeout(resolve,80));
    await detached.ui.view('slow','Slow destination',{lines:[{text:'Fresh route destination'}]},{focus:true});
    await detached.ui.view('existing','Existing background',{lines:[{text:'Authorized background update'}]},{focus:$.signal.aborted});
    await detached.storage.set('late','finished','project');
  }};`}]});
  await f.host.core.host.emit('service.ui.view', {plugin: 'navigation-probe', id: 'existing', title: 'Existing background',
    view: {lines: [{text: 'Before update'}]}, placement: {focus: false}});
  const nav = f.host.navigation;
  nav.openFinder(); nav.changeQuery('/nav-slow', nav.snapshot().revision);
  expect(nav.snapshot().entries).toContainEqual(expect.objectContaining({id: 'plugin-navigation-probe-slow', state: 'available'}));
  nav.handle({kind: 'key', key: 'enter'});
  expect(nav.snapshot()).toMatchObject({mode: 'finder', opening: 'plugin-navigation-probe-slow'});
  // This packet belongs to the finder input, never to the previous Main draft.
  expect(nav.handle({kind: 'key', key: 'x', text: 'x'})).toBe(false);
  nav.changeQuery('/nav-slowx', nav.snapshot().revision);
  nav.handle({kind: 'key', key: 'escape'});
  await expect.poll(() => f.app.storage.read('navigation-probe', 'late', 'project', f.host.core.sessionId)).toBe('finished');
  expect(f.find('plugin-navigation-probe-slow')).toBeUndefined();
  expect(f.layout.snapshot().locations['plugin-navigation-probe-slow']).toBeUndefined();
  expect(f.find('plugin-navigation-probe-existing')?.snapshot().view?.lines[0].text).toBe('Authorized background update');
  expect(f.layout.snapshot().focused).toBe('session');
  expect(f.host.core.getMessages()).toEqual([]);
  nav.openFinder(); nav.changeQuery('/nav-slow', nav.snapshot().revision); nav.handle({kind: 'key', key: 'enter'});
  expect(nav.snapshot().mode).toBe('finder');
  await expect.poll(() => nav.snapshot().mode).toBe('normal');
  expect(f.layout.snapshot().focused).toBe('plugin-navigation-probe-slow');
  expect(f.find('plugin-navigation-probe-slow')?.snapshot().view?.lines[0].text).toBe('Fresh route destination');
  expect(f.requests).toHaveLength(0);
});

it('withdraws unloaded route choices and fails closed for retained views without a declared refresh route', async () => {
  const f = await fixture({plugins: [{name: 'navigation-owned', commands: [
    {name: '/nav-owned', description: 'Owned UI route', ui: {site: 'main'}},
  ], source: 'export default {};'}]});
  const nav = f.host.navigation;
  nav.openFinder(); nav.changeQuery('/nav-owned', nav.snapshot().revision);
  const stale = nav.snapshot().revision;
  expect(nav.snapshot().entries).toHaveLength(1);
  f.host.core.host.unregisterPlugin('navigation-owned');
  expect(nav.snapshot().entries).toHaveLength(0);
  nav.choose('plugin-navigation-owned-main', stale);
  expect(nav.snapshot().mode).toBe('finder');
  nav.handle({kind: 'key', key: 'escape'});
  f.host.core.host.registerPlugin({name: 'unrouted-view', version: '1.0.0', trust: 'trusted'}, {});
  await f.host.core.host.emit('service.ui.view', {plugin: 'unrouted-view', id: 'panel', title: 'No refresh route', view: {lines: []}});
  await f.host.core.host.emit('service.ui.remove', {plugin: 'unrouted-view', id: 'panel'});
  nav.openFinder(); nav.changeQuery('No refresh route', nav.snapshot().revision);
  expect(nav.snapshot().entries[0]).toMatchObject({state: 'unavailable'});
  nav.handle({kind: 'key', key: 'enter'});
  expect(nav.snapshot().mode).toBe('finder');
  expect(f.find('plugin-unrouted-view-panel')).toBeUndefined();
  expect(f.requests).toHaveLength(0);
});

it('keeps window inventory snapshots stable through background view content updates', async () => {
  const f = await fixture();
  f.host.core.host.registerPlugin({name: 'frame-proof', version: '1.0.0', trust: 'trusted'}, {});
  const publish = (text: string) => f.host.core.host.emit('service.ui.view', {plugin: 'frame-proof', id: 'main', title: 'Stable window', view: {lines: [{text}]}, placement: {focus: false}});
  await publish('Frame one');
  const nav = f.host.navigation;
  nav.openFinder(); nav.changeQuery('Stable window', nav.snapshot().revision);
  const before = nav.snapshot();
  await publish('Frame two');
  expect(f.find('plugin-frame-proof-main')?.snapshot().view?.lines[0].text).toBe('Frame two');
  expect(nav.snapshot()).toBe(before);
  nav.select('plugin-frame-proof-main', nav.snapshot().revision);
  expect(nav.snapshot().selectionRevision).toBeGreaterThan(before.selectionRevision!);
});
