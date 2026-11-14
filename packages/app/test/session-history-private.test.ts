import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, expect, it} from 'vitest';
import {AgentCore, ScriptedProvider} from '@agent-compositor/core';
import {SessionStore} from '@agent-compositor/session';
import type {HooksApi, UiControllerFactory, UiControllerInput} from '@agent-compositor/hooks';
import {installSessionServices, sessionControls, type SessionHistoryBinding} from '../src/sessions.js';
import type {AppUiControllerData} from '../src/controller-contracts.js';
import {buildApp} from '../src/build.js';

const cleanup: (() => Promise<unknown>)[] = [], releases: (() => void)[] = [];
afterEach(async () => {for (const release of releases.splice(0))release();for (const close of cleanup.splice(0).reverse())await close();});
function gate() {let release!: () => void;const promise = new Promise<void>(done => {release = done;});releases.push(release);return {promise, release};}
async function fixture(factory: UiControllerFactory) {
  const cwd = await mkdtemp(join(tmpdir(), 'compositor-history-private-')), store = new SessionStore({sessionsRoot: join(cwd, 'sessions')});
  const provider = new ScriptedProvider([{text: 'Working', hold: true}]), manager = sessionControls();
  const core = new AgentCore({cwd, provider, sessions: store, tools: [], controlTools: [], uiControllers: {history: 'chosen'}, plugins: [manager,
    {manifest: {name: 'chosen', version: '1.0.0', trust: 'trusted'}, hooks: {}, controllers: {history: factory}},
  ]});installSessionServices(core, store, cwd);
  const origin = new AsyncLocalStorage<object>(), observed: {event: string; input: Record<string, unknown>}[] = [];
  core.host.setInvocationOriginProvider(() => origin.getStore());
  core.subscribe(event => {if (event.kind === 'catalog')observed.push({event: event.event, input: event.input});});
  let binding: SessionHistoryBinding | undefined, shown = 0, removed = 0;
  const unbind = manager.bindPresenter({show: value => {binding = value;shown++;}, update: () => {}, remove: value => {if(binding===value)binding=undefined;removed++;}});
  cleanup.push(async () => {unbind();await core.close();await rm(cwd, {recursive: true, force: true});});
  await core.start();await store.create(cwd, {id: 'saved-chat', name: 'Original saved chat'});
  const open = () => origin.run({id: 'open'}, () => core.host.emit('ui.press', {site: 'plugin-session-manager-sessions', key: 'command:/history'}));
  function input(value: UiControllerInput, id: string) {
    const current = binding!, controller = new AbortController(), intent = {id};
    const promise = origin.run(intent, () => core.host.withPrivateUiInput('session-manager', controller.signal, api => current.input(value, api)))
      .finally(() => controller.abort());
    return {promise, controller, intent};
  }
  return {cwd, core, store, provider, observed, open, input, binding: () => binding, shown: () => shown, removed: () => removed};
}

it('presents validated rich history privately, including construction invalidation and a controller-owned query ID', async () => {
  let query = '', searched: unknown[] = [];
  const f = await fixture(({data}, context) => {
    const history = data as AppUiControllerData['history'];context.invalidate();
    return {render: () => ({input: {id: 'chosen-query', value: query}, lines: [{text: 'PRIVATE_HISTORY_FRAME', cells: [{ch: '窗', fg: '#abcdef', bold: true}]}]}),
      handle: async input => {if(input.kind==='change'){query=input.value;searched=await history.control('list',{search:query});}},
    };
  });
  let publicViews = 0, publicInputs = 0;
  f.core.host.registerPlugin({name: 'observer', version: '1.0.0', trust: 'trusted'}, {
    'service.ui.view': () => {publicViews++;}, 'ui.change': () => {publicInputs++;},
  });
  await f.open();expect(f.shown()).toBe(1);
  const binding = f.binding()!, frame = binding.lease.render(45, 12);
  expect(frame.lines[0].cells).toEqual([{ch: '窗', fg: '#abcdef', bold: true}]);expect(frame.input?.id).toBe('chosen-query');
  await f.input({kind: 'change', id: 'chosen-query', value: 'PRIVATE_HISTORY_QUERY'}, 'query').promise;
  expect(query).toBe('PRIVATE_HISTORY_QUERY');expect(searched).toEqual([]);expect(publicViews).toBe(0);expect(publicInputs).toBe(0);
  expect(JSON.stringify(f.observed.filter(event => event.event.startsWith('ui.')))).not.toMatch(/PRIVATE_HISTORY_/);
  expect(JSON.stringify(await f.store.load(f.core.sessionId, f.cwd))).not.toMatch(/PRIVATE_HISTORY_/);expect(f.provider.requests).toHaveLength(0);
});

it('keeps each serialized asynchronous history input on its own fresh API and form origin', async () => {
  const hold = gate(), handled: string[] = [], scopes: unknown[] = [], results: unknown[] = [];
  const f = await fixture(({data}) => {
    const history = data as AppUiControllerData['history'];
    return {render: () => ({lines: [{text: 'Private history'}]}), handle: async input => {
      if(input.kind!=='action'||!['first','second'].includes(input.action))return;
      handled.push(input.action);if(input.action==='first')await hold.promise;
      results.push(await history.form({title: input.action, fields: [{id: 'name', label: 'Name', type: 'text'}], actions: [{id: 'save', label: 'Save'}]}));
    }};
  });
  f.core.host.setFormHandler(async (_owner, request) => {scopes.push(f.core.host.currentServiceScope);return {action: 'save', values: {name: 'PRIVATE_'+request.title}};});
  await f.open();const first = f.input({kind: 'action', action: 'first'}, 'first');
  const second = f.input({kind: 'action', action: 'second'}, 'second');expect(handled).toEqual(['first']);
  hold.release();await Promise.all([first.promise, second.promise]);
  expect(handled).toEqual(['first','second']);
  expect(scopes).toMatchObject([{origin:first.intent,plugin:'session-manager',background:false},{origin:second.intent,plugin:'session-manager',background:false}]);
  expect(results).toEqual([{action:'save',values:{name:'PRIVATE_first'}},{action:'save',values:{name:'PRIVATE_second'}}]);
  expect(JSON.stringify(f.observed)).not.toMatch(/PRIVATE_first|PRIVATE_second/);
  expect(JSON.stringify(await f.store.load(f.core.sessionId, f.cwd))).not.toMatch(/PRIVATE_first|PRIVATE_second/);
});

it('retains hidden history but revokes closed leases, escaped capabilities and stale resume results', async () => {
  const hold = gate();let history!: AppUiControllerData['history'], disposed = 0, resumed = 0;
  const f = await fixture(({data}) => {history = data as typeof history;return {
    render: () => ({lines: [{text: 'Private history'}]}), dispose: () => {disposed++;},
    handle: async input => {if(input.kind==='action'&&input.action==='late'){await hold.promise;return {type:'resume',id:'saved-chat'};}},
  };});
  f.core.runtime.setResolver('service.session.control', async args => {if(args.action==='resume')resumed++;return {value:true};});
  await f.open();const binding = f.binding()!, oldData = history;
  await f.core.host.emit('ui.visibility', {site:'plugin:session-manager/sessions',attached:false,visible:false,columns:0,rows:0});
  expect(f.binding()).toBe(binding);expect(disposed).toBe(0);
  const pending = f.input({kind:'action',action:'late'},'late');await binding.close();await pending.promise;
  expect(disposed).toBe(1);expect(f.removed()).toBe(1);await expect(oldData.control('list')).rejects.toThrow('History closed');
  await f.open();hold.release();await Promise.resolve();await Promise.resolve();expect(resumed).toBe(0);
  const current = f.binding()!;f.core.host.unregisterPlugin('chosen');expect(current.lease.signal.aborted).toBe(true);expect(f.binding()).toBeUndefined();
});

it('uses the canonical session control chain for private mutations and rejects them while Main is busy', async () => {
  const seen: string[] = [], values: unknown[] = [];
  const f = await fixture(({data}) => {
    const history=data as AppUiControllerData['history'];
    return {render:()=>({lines:[{text:'Private history'}]}),handle:async input=>{
      if(input.kind!=='action'||input.action==='open')return;
      if(input.action==='list'){values.push(await history.control('list',{action:'resume'} as any));return;}
      values.push(await history.control(input.action as 'rename',{id:'saved-chat',name:'Privately renamed'}));
    }};
  });
  f.core.host.registerPlugin({name:'control-observer',version:'1.0.0',trust:'trusted'},{'service.session.control':event=>{seen.push(event.action);}});
  await f.open();await f.input({kind:'action',action:'list'},'list').promise;expect(seen.at(-1)).toBe('list');
  for(const action of ['rename','fork','archive','unarchive'])await f.input({kind:'action',action},action).promise;
  expect(await f.store.findByPrefix('saved-chat',f.cwd)).toMatchObject({name:'Privately renamed',archived:false});
  expect(values).toHaveLength(5);expect((values[2] as {parentId:string}).parentId).toBe('saved-chat');
  const main=f.core.submit('Working');await expect.poll(()=>f.provider.requests.length).toBe(1);
  await f.input({kind:'action',action:'rename'},'busy').promise;
  expect(values).toHaveLength(5);expect(f.binding()).toBeUndefined();expect(f.core.getState()).toBe('running');
  f.provider.release();await main;
});

it('keeps a selected factory failure out of public notices and never publishes a fallback frame', async () => {
  const f=await fixture(()=>{throw Error('PRIVATE_HISTORY_FACTORY_FAILURE');});await f.open();
  expect(f.binding()).toBeUndefined();expect(f.observed.some(event=>event.event==='ui.surface')).toBe(false);
  expect(JSON.stringify(f.observed)).not.toContain('PRIVATE_HISTORY_FACTORY_FAILURE');expect(f.provider.requests).toHaveLength(0);
});

it('binds the active per-Core session contribution and annotates only canonical browse commands', async () => {
  const cwd=await mkdtemp(join(tmpdir(),'compositor-history-build-'));
  const app=await buildApp({cwd,env:{HOME:cwd},provider:new ScriptedProvider([]),agentHub:false,
    fixedConfig:{enabledPlugins:['session-manager'],ui:{controllers:{history:'chosen'}}}});
  cleanup.push(async()=>{await app.close();await rm(cwd,{recursive:true,force:true});});
  const core=app.createCore(async()=>false);let binding:SessionHistoryBinding|undefined;
  core.host.registerPlugin({name:'chosen',version:'1.0.0',trust:'trusted'},{},'user',[],{history:()=>({render:()=>({lines:[{text:'Chosen history'}]}),handle:()=>{}})});
  const unbind=app.bindHistoryPresenter(core,{show:value=>{binding=value;},update:()=>{},remove:()=>{binding=undefined;}});
  await core.host.emit('ui.press',{site:'plugin-session-manager-sessions',key:'command:/history'});
  expect(binding?.lease.owner).toBe('chosen');unbind();expect(binding).toBeUndefined();
  core.host.unregisterPlugin('session-manager');
  expect(()=>app.bindHistoryPresenter(core,{show:()=>{},update:()=>{},remove:()=>{}})).toThrow('unavailable');
  expect(app.commands().filter(command=>['/history','/sessions','/resume'].includes(command.name)).every(command=>command.plugin==='session-manager'&&command.ui?.site==='plugin-session-manager-sessions')).toBe(true);
  expect(app.commands().filter(command=>['/rename','/fork','/archive','/unarchive'].includes(command.name)).every(command=>!command.ui&&!command.execution)).toBe(true);
});

it('preserves an explicitly contributed history command owner instead of replacing it with the canonical browse route', async () => {
  const cwd=await mkdtemp(join(tmpdir(),'compositor-history-command-')), directory=join(cwd,'plugins','history-owner');
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'history-owner',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/history',description:'Contributed history command',execution:'immediate'}]}));
  await writeFile(join(directory,'hooks.js'),"export default {'command.invoke':()=>{}};");
  const app=await buildApp({cwd,env:{HOME:cwd},provider:new ScriptedProvider([]),agentHub:false,
    fixedConfig:{enabledPlugins:['session-manager','history-owner']}});
  cleanup.push(async()=>{await app.close();await rm(cwd,{recursive:true,force:true});});
  expect(app.pluginErrors).toEqual([]);expect(app.plugins.some(plugin=>plugin.manifest.name==='history-owner')).toBe(true);
  expect(app.commands().find(command=>command.name==='/history')).toMatchObject({plugin:'history-owner',execution:'immediate'});
  expect(app.commands().find(command=>command.name==='/history')?.ui).toBeUndefined();
  expect(app.commands().find(command=>command.name==='/sessions')).toMatchObject({plugin:'session-manager',ui:{site:'plugin-session-manager-sessions'}});
});
