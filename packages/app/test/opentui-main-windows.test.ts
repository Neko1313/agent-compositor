import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider, type AgentCore} from '@agent-compositor/core';
import {hello} from '@agent-compositor/protocol';
import type {UiControllerFactory, UiEditorState} from '@agent-compositor/hooks';
import {buildApp} from '../src/build.js';
import {AppUI} from '../src/ui.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture(options: {ink?: boolean; editor?: boolean; provider?: ScriptedProvider} = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'opentui-main-windows-'));cleanup.push(() => rm(cwd, {recursive: true, force: true}));
  const provider = options.provider ?? new ScriptedProvider([{text: 'First reply'}, {text: 'Second reply'}]);
  const app = await buildApp({cwd, env: {HOME: cwd}, provider, agentHub: false, fixedConfig: {
    enabledPlugins: ['session-manager'], ...(options.editor ? {ui: {controllers: {editor: 'copy-editor'}}} : {}),
    agent: {tools: ['read', 'ask_user'], builtinTools: ['read'], controlTools: ['ask_user'],
      skills: false, projectContext: false, fileReferences: false, verifyCompletion: false},
    permissions: {rules: [{tool: 'read', decision: 'allow'}]}, compaction: {enabled: false},
  }});cleanup.push(() => app.close());
  const createCore = vi.spyOn(app, 'createCore');
  let inkSaved: any;
  if (options.ink) {
    const ink = new AppUI(app.createCore, undefined, [], app.commands, {}, {saveLayout: app.saveLayout});
    ink.connect(() => {});ink.receive(hello('renderer', {surfaces: ['terminal'], sites: [], elements: ['Text', 'Layout'], encodings: ['jsonl']}));
    ink.resize(160, 48);
    const key = (key: string, modifiers: string[] = ['meta']) => ink.receive({type: 'input', surface: 'input', data: {kind: 'key', key, modifiers}});
    ink.core.host.registerPlugin({name: 'ink-tools', version: '1.0.0', trust: 'trusted'}, {});
    await ink.core.host.emit('service.ui.configure', {plugin: 'ink-tools', appearance: {presentation: {showTools: true}}});
    key('s');key('2', ['meta', 'shift']);key('1');key('t');key('?');key('s');key('q');
    await ink.settled();inkSaved = await app.loadLayout();
    ink.close();await ink.settled();await ink.core.close();
  }
  const layout = await connectWindowLayout(app, {panes: [{id: 'session', label: 'Main'}], initial: ['session']});
  layout.resize(160, 48);cleanup.push(() => layout.disconnect());
  const host = createOpenTuiHost(app, layout);cleanup.push(() => host.close());
  await host.start();
  const source = (id: string) => host.surfaces.snapshot().find(source => source.id === id)!;
  const focus = (id: string) => layout.act({type: 'open', id});
  return {cwd, app, provider, host, layout, source, focus, createCore, inkSaved};
}

it('materializes real Ink-produced saved session, tools and help windows including closed identities without another Core', async () => {
  const f = await fixture({ink: true}), created = f.createCore.mock.calls.length;
  expect(f.inkSaved.views).toEqual([
    {id: 'window-1', title: 'Conversation', kind: 'session'}, {id: 'window-2', title: 'Tools', kind: 'tools'},
    {id: 'window-3', title: 'Window controls', kind: 'help'}, {id: 'window-4', title: 'Conversation', kind: 'session'},
  ]);
  expect(f.host.conversationWindows.snapshot().map(window => [window.id, window.label, window.session.label])).toEqual([
    ['session', 'Main', 'Main'], ['window-1', 'Conversation', 'Main'], ['window-4', 'Conversation', 'Main'],
  ]);
  expect(f.layout.snapshot().locations).toMatchObject({session: 1, tools: 1, 'window-1': 2, 'window-2': 1, 'window-3': 1});
  expect(f.layout.snapshot().locations['window-4']).toBeUndefined();
  expect(f.source('tools').snapshot().view?.lines).toEqual([{text: 'No tools called yet.'}]);
  expect(f.source('window-2').snapshot().view).toEqual(f.source('tools').snapshot().view);
  expect(f.source('window-3').snapshot().view?.lines.some(line => line.text.includes('Ctrl+arrows retile'))).toBe(true);
  f.host.navigation.openFinder();
  expect(f.host.navigation.snapshot().entries.find(entry => entry.id === 'window-4')).toMatchObject({state: 'closed'});
  f.host.navigation.choose('window-4', f.host.navigation.snapshot().revision);
  expect(f.layout.snapshot().focused).toBe('window-4');
  for (const kind of ['session', 'tools', 'help'] as const) expect(f.host.createWindow(kind)).toBe(true);
  expect(f.layout.hostViews().slice(-3)).toEqual([
    {id: 'window-5', title: 'Main 5', kind: 'session'}, {id: 'window-6', title: 'Tools 6', kind: 'tools'},
    {id: 'window-7', title: 'Window controls 7', kind: 'help'},
  ]);
  expect(f.host.mainSession('window-5')?.label).toBe('Main');expect(f.host.isMainPane('window-6')).toBe(false);
  expect(f.createCore.mock.calls).toHaveLength(created);expect(f.provider.requests).toEqual([]);
  await expect.poll(() => f.layout.snapshot().saving).toBe(false);
  expect((await f.app.loadLayout() as any).views).toEqual([...f.inkSaved.views, ...f.layout.hostViews().slice(-3)]);
  await f.host.submit('/chat');expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'session'});
  f.layout.act({type: 'close'});await f.host.submit('/chat');
  expect(f.layout.snapshot()).toMatchObject({workspace: 2, focused: 'window-1'});
  const inventory = f.layout.hostViews(), before = f.layout.snapshot().locations;
  await f.host.submit('/chat new');expect(f.host.session.snapshot().notice).toBe('Usage: /chat');
  expect(f.layout.hostViews()).toEqual(inventory);expect(f.layout.snapshot().locations).toEqual(before);
  expect(f.provider.requests).toEqual([]);
});

it('shares one Main request FIFO across copies while only the exact focused visible port can answer', async () => {
  const f = await fixture({provider: new ScriptedProvider([
    {toolCalls: [{name: 'ask_user', args: {question: 'Choose mode', options: ['Local', 'Remote'], allowOther: false}}]},
    {text: 'Answered once'},
  ])});
  f.host.createWindow('session');f.host.createWindow('session');
  const original = f.host.session, first = f.host.mainSession('window-1')!, second = f.host.mainSession('window-2')!;
  const main = f.host.submit('One Main task');
  await expect.poll(() => first.snapshot().interaction?.kind).toBe('question');
  const question = first.snapshot().interaction!;expect(second.snapshot()).toBe(first.snapshot());
  let formResult: unknown = 'pending';
  f.host.core.host.registerPlugin({name: 'copy-form', version: '1.0.0', trust: 'trusted'}, {
    'ui.press': async (_event, $) => {formResult = await $.ui.form({title: 'Queued private form', fields: [{id: 'value', label: 'Value', type: 'text'}], actions: [{id: 'save', label: 'Save'}]});},
  });
  const form = f.host.core.host.emit('ui.press', {site: 'unscoped', key: 'open'});
  const answer = {answers: [{id: 'answer', selected: ['Remote']}]};
  original.answerInteraction!(question.id, answer);first.answerInteraction!(question.id, answer);
  expect(second.snapshot().interaction?.id).toBe(question.id);expect(f.provider.requests).toHaveLength(1);
  f.host.navigation.handle({kind: 'key', key: 'w', modifiers: ['alt']});second.answerInteraction!(question.id, answer);
  expect(second.snapshot().interaction?.id).toBe(question.id);
  f.host.navigation.handle({kind: 'key', key: 'escape'});
  f.layout.act({type: 'close'});second.answerInteraction!(question.id, answer);
  expect(second.snapshot().interaction?.id).toBe(question.id);
  f.focus('window-1');first.answerInteraction!(question.id, answer);await main;
  const queued = first.snapshot().interaction!;expect(queued).toMatchObject({kind: 'form', request: {title: 'Queued private form'}});
  second.cancelInteraction!(queued.id);expect(formResult).toBe('pending');
  first.cancelInteraction!(question.id);expect(formResult).toBe('pending');
  first.answerInteraction!(queued.id, {action: 'save', values: {value: 'PRIVATE_COPY_FORM'}});await form;
  expect(formResult).toEqual({action: 'save', values: {value: 'PRIVATE_COPY_FORM'}});
  expect(f.provider.requests).toHaveLength(2);expect(f.host.core.getMessages().filter(message => message.role === 'user')).toHaveLength(1);
  expect(JSON.stringify({requests: f.provider.requests, messages: f.host.core.getMessages()})).not.toContain('PRIVATE_COPY_FORM');
});

it('keeps one editor lease across copies, admits only its singleton anchor viewport and revokes same-journal old ports on resume', async () => {
  const f = await fixture({editor: true}), states: UiEditorState[] = [], viewports: number[] = [];
  const factory: UiControllerFactory = request => {
    let {text, cursor} = request.state as UiEditorState;states.push({text, cursor});
    return {snapshot: () => ({text, cursor}), preferredRows: () => 3,
      render: viewport => {viewports.push(viewport.rows);return {lines: [{text: 'MASKED ' + text.length}]};},
      handle: input => {if (input.kind === 'text') {text = text.slice(0, cursor) + input.text + text.slice(cursor);cursor += input.text.length;}},
      dispose() {text = '';cursor = 0;}};
  };
  const register = (core: AgentCore) => core.host.registerPlugin({name: 'copy-editor', version: '1.0.0', trust: 'trusted'}, {}, 'user', [], {editor: factory});
  register(f.host.core);
  f.host.createWindow('session');f.host.createWindow('session');expect(states).toHaveLength(1);
  const old = f.host.mainSession('window-2')!, canonical = f.host.session, initial = old.snapshot().editor!;
  expect(canonical.editorInput!(initial.id, {kind: 'text', text: 'STALE'}, initial.revision)).toBeUndefined();
  const ticket = old.editorInput!(initial.id, {kind: 'text', text: 'PRIVATE😀窗'}, initial.revision)!;
  await expect.poll(() => old.snapshot().editor?.inputRevision).toBe(ticket);
  canonical.editorViewport!(initial.id, 80, 9, 18);expect(viewports.at(-1)).not.toBe(9);
  old.editorViewport!(initial.id, 80, 3, 18);expect(viewports.at(-1)).toBe(3);
  f.layout.resize(320, 48);
  f.host.core.host.registerPlugin({name: 'copy-plugin', version: '1.0.0', trust: 'trusted'}, {});
  await f.host.core.host.emit('service.ui.view', {plugin: 'copy-plugin', id: 'panel', title: 'Other window', view: {lines: []}, placement: {focus: true}});
  expect(f.layout.snapshot().frames.some(frame => frame.surface === 'window-2')).toBe(true);
  old.editorViewport!(initial.id, 80, 4, 18);expect(viewports.at(-1)).toBe(4);
  expect(old.submit('HIDDEN_SUBMIT')).toBe(false);expect(f.provider.requests).toEqual([]);
  const resume = f.app.resume;f.app.resume = async (...args) => {const core = await resume(...args);register(core);return core;};
  await f.host.submit('Persisted public task');
  const journal = f.host.core.sessionId, oldState = old.snapshot(), oldCore = f.host.core;
  await f.host.core.host.emit('service.session.control', {action: 'resume', id: journal});
  const next = f.host.mainSession('window-2')!;
  expect(f.host.core).not.toBe(oldCore);expect(next.id).toBe(old.id);expect(next.generation).not.toBe(old.generation);
  expect(old.isCurrent!()).toBe(false);expect(old.submit('STALE_AFTER_RESUME')).toBe(false);
  expect(old.snapshot()).toBe(oldState);expect(next.label).toBe('Main');
  expect(states).toEqual([{text: '', cursor: 0}, {text: 'PRIVATE😀窗', cursor: 'PRIVATE😀窗'.length}]);
  f.focus('window-2');const nextEditor = next.snapshot().editor!;
  expect(old.editorInput!(nextEditor.id, {kind: 'text', text: 'STALE'}, nextEditor.revision)).toBeUndefined();
  await f.host.submit('Post-resume public task');
  expect(next.snapshot().messages).toContainEqual({role: 'user', text: 'Post-resume public task'});
  expect(old.snapshot().messages).not.toContainEqual({role: 'user', text: 'Post-resume public task'});
  expect(JSON.stringify({requests: f.provider.requests, messages: f.host.core.getMessages(), view: next.snapshot().editor})).not.toMatch(/PRIVATE😀窗|STALE_AFTER_RESUME|HIDDEN_SUBMIT/);
  expect(states).toHaveLength(2);
});

it('shares literal real tool activity across read-only Tools windows without reopening a closed view or accepting a forged host source', async () => {
  const f = await fixture();await writeFile(join(f.cwd, 'tool-note.txt'), 'PRIVATE_FILE_BODY');
  f.host.createWindow('tools');const tools = f.source('window-1');
  f.layout.act({type: 'close'});const locations = f.layout.snapshot().locations;
  const result = await f.host.core.invokeTool('read', {path: 'tool-note.txt'});expect(result.ok).toBe(true);
  expect(tools.snapshot().view).toEqual(f.source('tools').snapshot().view);
  const text = tools.snapshot().view!.lines.map(line => line.text).join('\n');
  expect(text).toContain('read {"path":"tool-note.txt"}');expect(text).toContain('read: done');expect(text).not.toContain('PRIVATE_FILE_BODY');
  expect(tools.snapshot().view!.lines.every(line => !line.action)).toBe(true);
  const messages = f.host.core.getMessages();tools.press('send', tools.snapshot().revision);tools.change('reply', 'INVENTED', tools.snapshot().revision);
  expect(f.host.core.getMessages()).toEqual(messages);expect(f.layout.snapshot().locations).toEqual(locations);
  f.host.createWindow('session');const main = f.host.mainSession('window-2')!;
  f.host.core.host.registerPlugin({name: 'impostor', version: '1.0.0', trust: 'trusted'}, {});
  await f.host.core.host.emit('service.ui.view', {id: 'window-2', plugin: 'impostor', title: 'Injected', view: {lines: [{text: 'INJECTED'}]}});
  expect(f.host.mainSession('window-2')).toBe(main);expect(f.host.surfaces.snapshot().find(source => source.id === 'window-2')).toBeUndefined();
  expect(f.source('plugin-impostor-window-2').snapshot().title).toBe('Injected');
  expect(f.host.createWindow('plugin' as 'session')).toBe(false);expect(f.host.session.snapshot().notice).toBe('The window could not be created');
  expect(f.provider.requests).toEqual([]);
});

it('rejects native submission during a held replacement startup while retaining the current copy port and accepting after start', async () => {
  const f = await fixture();f.host.createWindow('session');
  await f.host.submit('Saved task');
  let release!: () => void, entered = false;const gate = new Promise<void>(resolve => {release = resolve;});
  cleanup.push(async () => release());
  const resume = f.app.resume;
  f.app.resume = async (...args) => {
    const next = await resume(...args), start = next.start.bind(next);
    next.start = async () => {entered = true;await gate;await start();};return next;
  };
  const oldCore = f.host.core, switching = oldCore.host.emit('service.session.control', {action: 'resume', id: oldCore.sessionId});
  await expect.poll(() => entered).toBe(true);
  const port = f.host.mainSession('window-1')!;expect(port.isCurrent!()).toBe(true);
  expect(port.submit('UNSENT_DURING_STARTUP')).toBe(false);
  expect(f.provider.requests).toHaveLength(1);expect(f.host.core.getMessages().some(message => message.content.includes('UNSENT_DURING_STARTUP'))).toBe(false);
  release();await switching;f.focus('window-1');
  expect(port.submit('Admitted after startup')).toBe(true);
  await expect.poll(() => port.snapshot().messages.at(-1)).toEqual({role: 'assistant', text: 'Second reply'});
  expect(f.provider.requests).toHaveLength(2);
  expect(JSON.stringify(f.provider.requests)).not.toContain('UNSENT_DURING_STARTUP');
});

it('rejects native text after replacement startup failure but keeps explicit reload available through the same guarded facade', async () => {
  const f = await fixture();await f.host.submit('Saved task');
  const resume = f.app.resume;f.app.resume = async (...args) => {
    const next = await resume(...args);next.start = async () => {throw Error('Controlled startup failure');};return next;
  };
  await f.host.core.host.emit('service.session.control', {action: 'resume', id: f.host.core.sessionId});
  const port = f.host.session;expect(port.isCurrent!()).toBe(true);
  expect(port.submit('UNSENT_AFTER_STARTUP_FAILURE')).toBe(false);
  expect(port.snapshot().notice).toContain('Retry /reload');expect(f.provider.requests).toHaveLength(1);
  expect(port.submit('/reload')).toBe(true);
  await expect.poll(() => port.snapshot().notice).toMatch(/^Reloaded /);
  expect(port.submit('After explicit recovery')).toBe(true);
  await expect.poll(() => port.snapshot().messages.at(-1)).toEqual({role: 'assistant', text: 'Second reply'});
  expect(JSON.stringify(f.provider.requests)).not.toContain('UNSENT_AFTER_STARTUP_FAILURE');
});

it('emits one canonical Main focus hook per creation, changed selection and idempotent chat recovery', async () => {
  const f = await fixture(), focused: string[] = [];
  f.host.core.host.registerPlugin({name: 'copy-focus-counter', version: '1.0.0', trust: 'trusted'}, {
    'ui.focus': event => {focused.push(event.site);},
  });
  expect(f.host.createWindow('session')).toBe(true);await expect.poll(() => focused.length >= 1).toBe(true);
  expect(f.host.createWindow('session')).toBe(true);await expect.poll(() => focused.length >= 2).toBe(true);
  f.focus('window-1');await expect.poll(() => focused.length >= 3).toBe(true);
  await f.host.submit('/chat');await expect.poll(() => focused.length >= 4).toBe(true);
  expect(f.layout.snapshot().focused).toBe('session');
  await f.host.submit('/chat');await expect.poll(() => focused.length >= 5).toBe(true);
  f.layout.actAutomatic({type: 'open', id: 'window-2'});await expect.poll(() => focused.length >= 6).toBe(true);
  f.layout.resize(180, 48);await f.host.close();
  expect(focused).toEqual(Array(6).fill('session'));expect(f.provider.requests).toEqual([]);
});

it('offers restored Main, Tools and Help neighbors in the native placement form and applies relative to the saved copy', async () => {
  const f = await fixture({ink: true});
  f.host.core.host.registerPlugin({name: 'copy-target', version: '1.0.0', trust: 'trusted'}, {});
  await f.host.core.host.emit('service.ui.view', {plugin: 'copy-target', id: 'panel', title: 'Plugin target', view: {lines: [{text: 'Ready'}]}, placement: {focus: false}});
  const target = f.source('plugin-copy-target-panel');await f.host.submit('/placement');
  await expect.poll(() => f.host.surfaces.snapshot().some(source => source.snapshot().form?.request.title === 'Arrange plugin windows')).toBe(true);
  const form = f.host.surfaces.snapshot().find(source => source.snapshot().form)!;
  const request = form.snapshot().form!, fields = request.request.fields;
  expect(fields.find(field => field.id === 'window')?.options?.map(option => option.value)).toEqual([target.id]);
  expect(fields.find(field => field.id === 'relativeTo')?.options?.map(option => option.value)).toEqual(expect.arrayContaining(['', 'session', 'tools', 'window-1', 'window-2', 'window-3', 'window-4']));
  expect(fields.find(field => field.id === 'relativeTo')?.options?.map(option => option.value)).not.toContain(target.id);
  form.answerForm!(request.id, {action: 'apply', values: {window: target.id, site: 'inspector', workspace: '2', size: '.35', relativeTo: 'window-1', focus: false}});
  await expect.poll(() => form.snapshot().form?.request.description).toContain('Applied for this run');
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: form.id, locations: {[target.id]: 2, 'window-1': 2}});
  expect(f.source(target.id)).toBe(target);expect(f.layout.snapshot().locations['window-4']).toBeUndefined();expect(f.provider.requests).toEqual([]);
});
