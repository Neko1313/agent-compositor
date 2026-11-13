import {afterEach, expect, it} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../src/build.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import type {UiSurfaceSource} from '@agent-compositor/renderer-opentui';
import type {PlacementConfig} from '../src/placement.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});

async function fixture(options: {ui?: PlacementConfig; enabledPlugins?: string[]; plugins?: {name: string; source: string; commands: unknown[]}[]} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'opentui-real-host-'));
  cleanup.push(() => rm(root, {recursive: true, force: true}));
  const cwd = join(root, 'project'), home = join(root, 'home');
  await mkdir(cwd); await mkdir(home);
  for (const plugin of options.plugins ?? []) {
    const directory = join(cwd, 'plugins', plugin.name);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, 'plugin.json'), JSON.stringify({name: plugin.name, version: '1.0.0', trust: 'trusted', main: 'hooks.js',
      commands: plugin.commands, compositor: {standard: 1, apiVersion: 1}}));
    await writeFile(join(directory, 'hooks.js'), plugin.source);
  }
  const requests: {model: string; authorization?: string; body: any}[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({data: [{id: 'configured-model'}]})); return;
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
    agent: {tools: ['ask_user'], builtinTools: [], controlTools: ['ask_user'], skills: false, projectContext: false, fileReferences: false, verifyCompletion: false},
    compaction: {enabled: false},
    ...(options.ui ? {ui: options.ui} : {}),
  }));
  const app = await buildApp({cwd, env, agentHub: false});
  cleanup.push(() => app.close());
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});
  layout.resize(140, 40);
  cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout);
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
function profile(endpoint: string, key = 'FAKE_LOOPBACK_PRIVATE_KEY') {
  return {id: 'opentui-local', type: 'openai-compat', baseUrl: endpoint, model: 'configured-model', key, clearKey: false,
    maxOutputTokens: '1000', timeoutMs: '20000', scope: 'project', contextWindow: '', reasoningEffort: ''};
}

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

it('fails closed at construction for unsupported selected private controller owners', async () => {
  const f = await fixture();
  for (const kind of ['approval', 'editor', 'question', 'form', 'history', 'placement'] as const) {
    const app = await buildApp({cwd: f.cwd, env: f.env, agentHub: false,
      fixedConfig: {...f.app.config.config, ui: {controllers: {
        editor: '@host', approval: '@host', question: '@host', form: '@host', history: '@host', placement: '@host',
        [kind]: 'unsupported-owner',
      }}}});
    try {expect(() => createOpenTuiHost(app, f.layout)).toThrow('Selected ' + kind + ' controllers are not supported by OpenTUI');}
    finally {await app.close();}
  }
});

it('revokes deferred UI-origin forms after their admitted operation has settled', async () => {
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
  release();
  await expect.poll(() => result).toBeNull();
  expect(f.form()).toBeUndefined();
  expect(f.host.session.snapshot().interaction).toBeUndefined();
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
  expect(f.host.session.snapshot().notice).toContain('searchable window finder is not yet available');
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
