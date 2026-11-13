import {afterEach, describe, expect, it} from 'vitest';
import {AgentCore, ScriptedProvider, type AgentCoreOptions, type ScriptedStep} from '@agent-compositor/core';
import type {UiControllerInput} from '@agent-compositor/hooks';
import {hello, type WireMessage} from '@agent-compositor/protocol';
import {AppUI, type AppCommand} from '../src/ui.js';

const fixtures: {ui: AppUI}[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.ui.close();
    await f.ui.settled();
    await f.ui.core.close();
  }
});

function setup(steps: ScriptedStep[] = [], options: Partial<AgentCoreOptions> = {}, commands: () => AppCommand[] = () => []) {
  const provider = new ScriptedProvider(steps);
  const ui = new AppUI((onApproval, onAsk) => new AgentCore({cwd: process.cwd(), provider, ...options, onApproval, onAsk}), undefined, [], commands);
  const messages: WireMessage[] = [], screens = new Map<string, string>();
  ui.connect(message => {
    messages.push(message);
    if (message.type === 'render') screens.set(message.surface, message.grid?.map(row => row.map(cell => cell.ch).join('')).join('\n') ?? '');
  });
  ui.receive(hello('renderer', {surfaces: ['terminal'], sites: [], elements: ['Text', 'Layout', 'Pointer'], encodings: ['jsonl']}));
  ui.resize(120, 40);
  const input = (data: Extract<WireMessage, {type: 'input'}>['data']) => ui.receive({type: 'input', surface: 'input', data});
  const key = (key: string, modifiers?: string[]) => input({kind: 'key', key, modifiers});
  const text = (text: string) => input({kind: 'text', text});
  const send = (value: string) => {key('i', ['meta']); text(value); key('enter');};
  const picker = (query: string) => {key('f2'); text(query);};
  const f = {ui, provider, messages, screens, input, key, text, send, picker};
  fixtures.push(f);
  return f;
}

describe('local window controls', () => {
  it('keeps the model, prompt queue and draft cursor intact when window mode consumes typing and Ctrl+C', async () => {
    const f = setup([{text: 'MODEL_RUNNING', hold: true}, {text: 'QUEUED_DONE'}]);
    f.send('Original task');
    await expect.poll(() => f.provider.requests.length).toBe(1);
    f.text('leftRIGHT');
    for (let n = 0; n < 5; n++) f.key('left');
    const before = structuredClone(f.ui.core.getMessages());
    f.key('w', ['meta']);
    expect(f.screens.get('input')).toContain('WINDOW MODE');
    f.key('y'); f.key('n'); f.text('this is a pasted command, not a window action');
    const arranged = f.ui.windows.snapshot();
    f.input({kind: 'text', text: 'q', paste: true});
    expect(f.ui.windows.snapshot()).toEqual(arranged);
    f.key('c', ['ctrl']);
    expect(f.screens.get('input')).not.toContain('WINDOW MODE');
    expect(f.provider.requests[0].signal.aborted).toBe(false);
    expect(f.ui.core.getState()).toBe('running');
    expect(f.ui.core.getMessages()).toEqual(before);
    expect(f.messages.some(message => message.type === 'bye')).toBe(false);
    f.key('i', ['meta']); f.text('_'); f.key('enter');
    expect(f.provider.requests).toHaveLength(1);
    f.provider.release(); await f.ui.settled();
    expect(f.provider.requests).toHaveLength(2);
    expect(f.provider.requests[1].messages.at(-1)?.content).toBe('left_RIGHT');
  });

  it.each(['approval', 'question'] as const)('does not answer a pending %s from either window mode or the picker', async kind => {
    let executed = false;
    const call = kind === 'question'
      ? {name: 'ask_user', args: {question: 'Choose the deployment target', options: ['Stage', 'Production'], allowOther: false}}
      : {name: 'approval_probe', args: {}};
    const f = setup([{toolCalls: [call]}, {text: 'EXPLICIT_DECISION_RECEIVED'}], {
      rules: [{tool: 'approval_probe', decision: 'ask'}],
      tools: [{name: 'approval_probe', description: 'Approval-only fixture', parameters: {type: 'object'}, describe: () => ({tool: 'approval_probe'}), execute: async () => {executed = true; return {ok: true, data: 'Ran'};}}],
    });
    f.send('Original task');
    const evidence = kind === 'approval' ? 'approval_probe' : 'Choose the deployment target';
    await expect.poll(() => f.screens.get('input') ?? '').toContain(evidence);
    const before = structuredClone(f.ui.core.getMessages());
    f.key('w', ['meta']); f.key('y'); f.key('n'); f.key('enter');
    expect(f.provider.requests).toHaveLength(1);
    expect(f.ui.core.getMessages()).toEqual(before);
    f.picker('no matching window'); f.key('y'); f.key('n'); f.key('enter');
    expect(f.screens.get('window-switcher')).toContain('No matching windows');
    f.key('c', ['ctrl']);
    f.key('w', ['meta']); f.key('c', ['ctrl']);
    expect(f.ui.core.getState()).toBe('running');
    expect(f.provider.requests[0].signal.aborted).toBe(false);
    expect(executed).toBe(false);
    expect(f.ui.core.getMessages()).toEqual(before);
    f.key('i', ['meta']);
    f.key(kind === 'approval' ? 'n' : 'enter');
    await f.ui.settled();
    expect(f.provider.requests).toHaveLength(2);
    expect(f.ui.core.getMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(['Original task']);
    if (kind === 'question') expect(JSON.stringify(f.provider.requests[1].messages)).toContain('Stage');
    else expect(executed).toBe(false);
  });

  it('cancels the picker without changing focus or layout, then finds another workspace and restores the same closed chat', async () => {
    const f = setup();
    f.ui.windows.place('tools', {workspace: 2, site: 'split', focus: false});
    f.key('i', ['meta']); f.text('unsent draft');
    const before = f.ui.windows.snapshot();
    f.picker('Tools'); f.key('down'); f.key('escape');
    expect(f.ui.windows.snapshot()).toEqual(before);
    expect(f.ui.windows.focused).toBe('input');
    expect(f.screens.get('input')).toContain('unsent draft');
    f.picker('Tools');
    expect(f.screens.get('window-switcher')).toContain('WS 2');
    f.key('enter');
    expect(f.ui.windows.workspace).toBe(2);
    expect(f.ui.windows.focused).toBe('tools');
    f.picker('Conversation'); f.key('enter');
    expect(f.ui.windows.workspace).toBe(1);
    expect(f.ui.windows.focused).toBe('session');
    f.key('w', ['meta']); f.key('q');
    expect(f.ui.windows.has('session')).toBe(false);
    f.key('w'); f.text('Conversation');
    expect(f.screens.get('window-switcher')).toContain('Closed');
    f.key('enter');
    expect(f.ui.windows.focused).toBe('session');
    expect(f.ui.windows.ids()).toEqual(['session']);
    expect(f.ui.windows.workspaceOf('tools')).toBe(2);
    expect(f.provider.requests).toHaveLength(0);
    f.key('i', ['meta']);
    expect(f.screens.get('input')).toContain('unsent draft');
  });

  it('opens /windows locally during a held turn and uses the rendered status button hitboxes', async () => {
    const f = setup([{text: 'MODEL_RUNNING', hold: true}]);
    f.send('Original task');
    await expect.poll(() => f.provider.requests.length).toBe(1);
    const before = structuredClone(f.ui.core.getMessages());
    f.send('/windows');
    expect(f.messages.filter(message => message.type === 'focus').at(-1)).toMatchObject({surface: 'window-switcher'});
    f.key('escape');
    const click = (label: string) => {
      const col = (f.screens.get('status') ?? '').split('\n')[0].indexOf(label);
      expect(col).toBeGreaterThanOrEqual(0);
      f.input({kind: 'mouse', button: 'left', action: 'press', col: col + 1, row: 38});
    };
    click('[Arrange]'); expect(f.screens.get('input')).toContain('WINDOW MODE');
    click('[Windows]'); expect(f.screens.get('window-switcher')).toContain('Conversation');
    f.key('escape'); f.key('i');
    expect(f.ui.core.getMessages()).toEqual(before);
    expect(f.provider.requests).toHaveLength(1);
    expect(f.provider.requests[0].signal.aborted).toBe(false);
    f.provider.release(); await f.ui.settled();
    expect(f.provider.requests).toHaveLength(1);
  });

  it('restores the original workspace and fullscreen on finder cancellation after a plugin requests focus',async()=>{
    const f=setup();
    f.ui.windows.focused='session';f.ui.windows.fullscreen=true;
    const before=f.ui.windows.snapshot() as {workspace:number;focused:string;fullscreen:boolean};
    f.picker('Tools');
    await f.ui.core.host.emit('service.ui.view',{plugin:'focus-probe',id:'main',title:'Background publication',
      view:{lines:[{text:'New plugin result'}]},placement:{workspace:3,focus:true}});
    expect(f.ui.windows.workspace).toBe(3);
    f.key('escape');
    expect(f.ui.windows.snapshot()).toMatchObject({workspace:before.workspace,focused:before.focused,fullscreen:before.fullscreen});
    expect(f.ui.windows.workspaceOf('plugin-focus-probe-main')).toBe(3);
    expect(f.provider.requests).toHaveLength(0);
  });

  it('preserves a selected custom editor cursor and its F2 submit while reserving mode input for the host', async () => {
    let state = {text: '', cursor: 0};
    const handled: string[] = [];
    const f = setup([{text: 'CUSTOM_SUBMITTED'}], {
      uiControllers: {editor: 'custom-editor'},
      plugins: [{manifest: {name: 'custom-editor', version: '1.0.0', trust: 'trusted'}, hooks: {}, controllers: {editor: () => ({
        snapshot: () => ({...state}),
        render: () => ({lines: [{text: 'CUSTOM ' + state.text}]}),
        handle: input => {
          handled.push(input.kind === 'key' ? input.key : input.kind);
          if (input.kind === 'text') {state.text = state.text.slice(0, state.cursor) + input.text + state.text.slice(state.cursor); state.cursor += input.text.length;}
          if (input.kind === 'key' && input.key === 'left') state.cursor = Math.max(0, state.cursor - 1);
          if (input.kind === 'key' && input.key === 'f2') {const text = state.text; state = {text: '', cursor: 0}; return {type: 'submit', text};}
        },
      })}}],
    });
    f.text('AB'); f.key('left');
    const received = [...handled];
    f.key('w', ['meta']); f.key('y'); f.key('n'); f.key('f2');
    expect(f.screens.get('window-switcher')).toContain('Conversation');
    f.key('escape'); f.key('i');
    expect(handled).toEqual(received);
    expect(state).toEqual({text: 'AB', cursor: 1});
    f.text('x'); f.key('f2'); await f.ui.settled();
    expect(f.provider.requests).toHaveLength(1);
    expect(f.provider.requests[0].messages.at(-1)?.content).toBe('AxB');
    expect(handled.filter(key => key === 'f2')).toHaveLength(1);
  });

  it.each(['approval', 'question'] as const)('keeps F2 owned by the selected %s controller when the editor is native', async kind => {
    let received = 0, executed = false;
    const f = setup([{toolCalls: [kind === 'question'
      ? {name: 'ask_user', args: {question: 'Deployment?', options: ['Stage'], allowOther: false}}
      : {name: 'approval_probe', args: {}}]}, {text: 'CUSTOM_DECISION_RECEIVED'}], {
      uiControllers: {[kind]: 'decision-controller'},
      plugins: [{manifest: {name: 'decision-controller', version: '1.0.0', trust: 'trusted'}, hooks: {}, controllers: {
        [kind]: () => ({
          render: () => ({lines: [{text: 'CUSTOM ' + kind.toUpperCase() + ' · F2 decides'}]}),
          handle: (input: UiControllerInput) => {
            if (input.kind === 'key' && input.key === 'f2') {
              received++;
              return kind === 'question' ? {answer: 'Stage'} : {allow: false, scope: 'once'};
            }
          },
        }),
      }}],
      rules: [{tool: 'approval_probe', decision: 'ask'}],
      tools: [{name: 'approval_probe', description: 'Approval-only fixture', parameters: {type: 'object'}, describe: () => ({tool: 'approval_probe'}), execute: async () => {executed = true; return {ok: true, data: 'Ran'};}}],
    });
    f.send('Original task');
    await expect.poll(() => f.screens.get('input') ?? '').toContain('CUSTOM ' + kind.toUpperCase());
    f.key('f2'); await f.ui.settled();
    expect(received).toBe(1);
    expect(executed).toBe(false);
    expect(f.messages.some(message => message.type === 'render' && message.surface === 'window-switcher')).toBe(false);
    expect(f.provider.requests).toHaveLength(2);
    expect(f.ui.core.getMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(['Original task']);
    if (kind === 'question') expect(JSON.stringify(f.provider.requests[1].messages)).toContain('Stage');
  });

  it('keeps F2 owned by the selected private form controller with a native draft and no model request', async () => {
    let received: unknown, handled = 0;
    const f = setup([], {
      uiControllers: {form: 'form-controller'},
      plugins: [{manifest: {name: 'form-controller', version: '1.0.0', trust: 'trusted'},
        hooks: {'ui.press': async (_event, $) => {received = await $.ui.form({title: 'Private form', fields: [{id: 'token', label: 'Token', type: 'password', required: true}], actions: [{id: 'save', label: 'Save'}]});}},
        controllers: {form: () => ({
          render: () => ({lines: [{text: 'CUSTOM FORM · F2 saves'}]}),
          handle: input => {
            if (input.kind === 'key' && input.key === 'f2') {handled++; return {action: 'save', values: {token: 'PRIVATE_F2_FORM_VALUE'}};}
          },
        })},
      }],
    });
    f.text('unsent native draft');
    const pending = f.ui.core.host.emit('ui.press', {site: 'form-controller', key: 'open'});
    await expect.poll(() => f.screens.get('settings-form') ?? '').toContain('CUSTOM FORM');
    f.key('f2');
    expect((await pending).faults).toEqual([]);
    expect(handled).toBe(1);
    expect(received).toEqual({action: 'save', values: {token: 'PRIVATE_F2_FORM_VALUE'}});
    expect(f.messages.some(message => message.type === 'render' && message.surface === 'window-switcher')).toBe(false);
    expect(f.screens.get('input')).toContain('unsent native draft');
    expect(f.provider.requests).toHaveLength(0);
    expect(f.ui.core.getMessages()).toEqual([]);
    expect(JSON.stringify(f.messages)).not.toContain('PRIVATE_F2_FORM_VALUE');
  });

  it('cancels and commits title drags in window mode while a human question remains pending', async () => {
    const f = setup([{toolCalls: [{name: 'ask_user', args: {question: 'Keep waiting for my decision?', options: ['Yes'], allowOther: false}}]}, {text: 'ANSWER_RECEIVED'}]);
    f.key('t', ['meta']);
    const tools = f.ui.windows.focused;
    f.send('Original task');
    await expect.poll(() => f.screens.get('input') ?? '').toContain('Keep waiting for my decision?');
    f.key('w', ['meta']);
    const frames = () => f.messages.filter(message => message.type === 'layout').at(-1)!.frames;
    const session = frames().find(frame => frame.surface === 'session')!;
    const target = frames().find(frame => frame.surface === tools)!;
    const mouse = (action: 'press' | 'move' | 'release', col: number, row: number) => f.input({kind: 'mouse', button: 'left', action, col, row});
    const before = structuredClone(f.ui.core.getMessages());
    const drag = () => {
      mouse('press', session.x + 4, session.y + 1);
      mouse('move', target.x + Math.floor(target.width / 2), target.y + target.height - 2);
      expect(frames().find(frame => frame.surface === tools)?.drop).toBe('bottom');
    };
    drag(); f.key('escape');
    expect(frames().some(frame => frame.drop)).toBe(false);
    expect(f.screens.get('input')).toContain('WINDOW MODE');
    expect(frames().find(frame => frame.surface === 'session')).toMatchObject({x: session.x, y: session.y, width: session.width, height: session.height});
    drag(); mouse('release', target.x + Math.floor(target.width / 2), target.y + target.height - 2);
    expect(frames().find(frame => frame.surface === 'session')!.y).toBeGreaterThan(frames().find(frame => frame.surface === tools)!.y);
    expect(f.screens.get('input')).toContain('Answer remains pending');
    expect(f.provider.requests).toHaveLength(1);
    expect(f.provider.requests[0].signal.aborted).toBe(false);
    expect(f.ui.core.getMessages()).toEqual(before);
    f.key('i'); f.key('enter'); await f.ui.settled();
    expect(f.provider.requests).toHaveLength(2);
    expect(JSON.stringify(f.provider.requests[1].messages)).toContain('Yes');
  });

  it.each(['remove', 'close'] as const)('reopens a plugin after %s through its declared command instead of restoring stale view data', async action => {
    const commands: AppCommand[] = [{name: '/inspect', description: 'Inspector', plugin: 'inspector', ui: {site: 'plugin-inspector-main'}}];
    const f = setup([], {}, () => commands);
    let opens = 0;
    f.ui.core.host.registerPlugin({name: 'inspector', version: '1.0.0', trust: 'trusted'}, {
      'ui.press': async (event, $) => {
        if (event.site === 'plugin-inspector-main' && event.key === 'command:/inspect') {
          opens++;
          await $.ui.view('main', 'Inspector', {lines: [{text: 'Fresh publication ' + opens}]}, {focus: true});
        }
      },
    });
    f.send('/inspect'); await f.ui.settled();
    expect(f.screens.get('plugin-inspector-main')).toContain('Fresh publication 1');
    if (action === 'remove') await f.ui.core.host.emit('service.ui.remove', {plugin: 'inspector', id: 'main'});
    else {
      f.key('w', ['meta']); f.key('q');
      await f.ui.core.host.emit('service.ui.view', {plugin: 'inspector', id: 'main', title: 'Inspector', view: {lines: [{text: 'STALE_LATE_PUBLICATION'}]}});
    }
    expect(f.ui.windows.has('plugin-inspector-main')).toBe(false);
    f.picker('/inspect');
    expect(f.screens.get('window-switcher')).toContain('Closed');
    f.key('enter'); await f.ui.settled();
    expect(opens).toBe(2);
    expect(f.screens.get('plugin-inspector-main')).toContain('Fresh publication 2');
    expect(f.ui.windows.focused).toBe('plugin-inspector-main');
    expect(f.provider.requests).toHaveLength(0);
  });

  it('refreshes filtered inventory during publication and unload without resurrecting removed plugin windows', async () => {
    let commands: AppCommand[] = [{name: '/inspect', description: 'Inspector', plugin: 'inspector', ui: {site: 'plugin-inspector-main'}}];
    const f = setup([], {}, () => commands);
    f.ui.core.host.registerPlugin({name: 'inspector', version: '1.0.0', trust: 'trusted'}, {});
    const publish = (title: string) => f.ui.core.host.emit('service.ui.view', {plugin: 'inspector', id: 'main', title, view: {lines: [{text: 'Actual plugin view'}]}, placement: {focus: false}});
    await publish('Old inspector');
    f.picker('Old inspector');
    expect(f.screens.get('window-switcher')).toContain('Old inspector');
    await publish('Renamed inspector');
    expect(f.screens.get('window-switcher')).toContain('No matching windows');
    for (const _ of 'Old inspector') f.key('backspace');
    f.text('Renamed');
    expect(f.screens.get('window-switcher')).toContain('Renamed inspector');
    commands = [];
    f.ui.core.host.unregisterPlugin('inspector');
    await expect.poll(() => f.screens.get('window-switcher') ?? '').toContain('No matching windows');
    f.key('enter'); f.key('escape');
    expect(f.ui.windows.has('plugin-inspector-main')).toBe(false);
    expect(f.provider.requests).toHaveLength(0);
  });
});
