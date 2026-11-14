import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, expect, it} from 'vitest';
import {ScriptedProvider} from '@agent-compositor/core';
import type {UiControllerFactory} from '@agent-compositor/hooks';
import type {ControllerInput, UiSurfaceSource} from '@agent-compositor/renderer-opentui';
import {buildApp} from '../src/build.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import type {AppUiControllerData} from '../src/controller-contracts.js';

const cleanup:(()=>Promise<unknown>)[]=[],releases:(()=>void)[]=[];
afterEach(async()=>{for(const release of releases.splice(0))release();for(const close of cleanup.splice(0).reverse())await close();});
function gate(){let release!:()=>void,entered!:()=>void,started=false;const wait=new Promise<void>(done=>{release=done;}),ready=new Promise<void>(done=>{entered=done;});releases.push(release);return{release,ready,entered:()=>started,wait:()=>{started=true;entered();return wait;}};}
async function fixture(factory:UiControllerFactory,provider=new ScriptedProvider([{toolCalls:[{name:'ask_user',args:{question:'Main question',options:['Local','Remote'],allowOther:false}}]},{text:'Main answered'},{text:'Resumed reply'}]),startupSource?:string){
  const cwd=await mkdtemp(join(tmpdir(),'compositor-history-host-')),directory=join(cwd,'plugins','history-owner');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'history-owner',version:'1.0.0',trust:'trusted',main:'hooks.js'}));
  await writeFile(join(directory,'hooks.js'),'export default {};');
  if(startupSource){const publisher=join(cwd,'plugins','history-window-proof');await mkdir(publisher,{recursive:true});
    await writeFile(join(publisher,'plugin.json'),JSON.stringify({name:'history-window-proof',version:'1.0.0',trust:'trusted',main:'hooks.js'}));
    await writeFile(join(publisher,'hooks.js'),startupSource);}
  const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,fixedConfig:{enabledPlugins:['session-manager','history-owner',...(startupSource?['history-window-proof']:[])],
    ui:{controllers:{history:'history-owner'}},agent:{builtinTools:[],controlTools:['ask_user'],projectContext:false,skills:false,verifyCompletion:false}}});
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(160,50);
  const host=createOpenTuiHost(app,layout);
  host.core.host.unregisterPlugin('history-owner');host.core.host.registerPlugin({name:'history-owner',version:'1.0.0',trust:'trusted'},{},'user',[],{history:factory});
  cleanup.push(async()=>{await host.close();await layout.disconnect();await app.close();await rm(cwd,{recursive:true,force:true});});
  await host.start();
  const history=()=>host.surfaces.snapshot().find(source=>source.snapshot().controller?.kind==='history');
  async function open(){await host.submit('/history');await expect.poll(()=>Boolean(history())).toBe(true);const source=history()!;await expect.poll(()=>Boolean(source.snapshot().busy)).toBe(false);return source;}
  function input(source:UiSurfaceSource,value:ControllerInput){const frame=source.snapshot().controller!;return source.controllerInput!(frame.id,value,frame.revision);}
  async function settled(source:UiSurfaceSource,ticket:number|undefined){expect(ticket).toBeTypeOf('number');await expect.poll(()=>source.snapshot().controller?.inputRevision).toBe(ticket);}
  return{cwd,app,host,layout,provider,history,open,input,settled};
}

it('opens private selected history while Main waits and gives its form a fresh independent request origin',async()=>{
  let query='',formResult:unknown,historyData!:AppUiControllerData['history'];
  const f=await fixture(({data})=>{historyData=data as typeof historyData;return{
    render:()=>({input:{id:'host-history-query',value:query},lines:[{text:'PRIVATE_HISTORY_FRAME',cells:[{ch:'窗',bold:true,fg:'#abcdef'}]},{text:'Private form',action:'form'}]}),
    handle:async input=>{if(input.kind==='change'){query=input.value;await historyData.control('list',{search:query});}
      if(input.kind==='action'&&input.action==='form')formResult=await historyData.form({title:'History private token',fields:[{id:'token',label:'Token',type:'password',required:true}],actions:[{id:'save',label:'Save'}]});},
  };});
  const observed:unknown[]=[];f.host.core.host.registerPlugin({name:'observer',version:'1.0.0',trust:'trusted'},
    {'service.ui.view':event=>{observed.push(event);},'ui.change':event=>{observed.push(event);},'ui.press':event=>{if(!event.key.startsWith('command:'))observed.push(event);}});
  const main=f.host.submit('Ask Main');await expect.poll(()=>f.host.session.snapshot().interaction?.kind).toBe('question');
  const pending=f.host.session.snapshot().interaction!,before=(await f.app.store.load(f.host.core.sessionId,f.cwd)).events;
  const source=await f.open();expect(f.provider.requests).toHaveLength(1);expect(f.host.session.snapshot().interaction?.id).toBe(pending.id);
  const after=(await f.app.store.load(f.host.core.sessionId,f.cwd)).events;
  expect(after.filter(event=>event.type==='prompt.submit'||event.type==='prompt.dropped')).toEqual(before.filter(event=>event.type==='prompt.submit'||event.type==='prompt.dropped'));
  expect(source.snapshot().view).toBeUndefined();expect(source.snapshot().controller?.view.lines[0].cells?.[0]).toMatchObject({ch:'窗',fg:'#abcdef'});
  await f.settled(source,f.input(source,{kind:'change',id:'host-history-query',value:'PRIVATE_HISTORY_QUERY'}));
  const ticket=f.input(source,{kind:'action',action:'form'});expect(ticket).toBeTypeOf('number');
  await expect.poll(()=>f.host.surfaces.snapshot().some(value=>value.snapshot().form?.request.title==='History private token')).toBe(true);
  const form=f.host.surfaces.snapshot().find(value=>value.snapshot().form?.request.title==='History private token')!;
  expect(form.id).not.toBe(source.id);expect(f.host.session.snapshot().interaction?.id).toBe(pending.id);
  f.layout.act({type:'open',id:form.id});form.answerForm!(form.snapshot().form!.id,{action:'save',values:{token:'PRIVATE_HISTORY_TOKEN'}});
  await f.settled(source,ticket);expect(formResult).toEqual({action:'save',values:{token:'PRIVATE_HISTORY_TOKEN'}});
  expect(JSON.stringify(observed)).not.toMatch(/PRIVATE_HISTORY_/);
  expect(JSON.stringify(await f.app.store.load(f.host.core.sessionId,f.cwd))).not.toMatch(/PRIVATE_HISTORY_/);
  expect(JSON.stringify(f.provider.requests)).not.toMatch(/PRIVATE_HISTORY_/);
  f.host.session.answerInteraction!(pending.id,{answers:[{id:'answer',selected:['Remote']}]});await main;
  expect(f.provider.requests).toHaveLength(2);expect(f.host.session.snapshot().messages.at(-1)?.text).toBe('Main answered');
});

it('resumes a real saved Core after closing its own history view without stealing newer workspace intent',async()=>{
  let historyData!:AppUiControllerData['history'];const handler=gate();
  const f=await fixture(({data})=>{historyData=data as typeof historyData;return{
    render:()=>({lines:[{text:'Resume saved',action:'resume'}]}),handle:async input=>{
      if(input.kind==='action'&&['enter','resume'].includes(input.action)){await handler.wait();return{type:'resume',id:'saved-history-target'};}
    },
  };},new ScriptedProvider([{text:'Resumed reply'}]));
  await f.app.store.create(f.cwd,{id:'saved-history-target',name:'Saved target'});
  await f.app.store.append('saved-history-target',[{type:'prompt.submit',text:'SAVED_HISTORY_CONTEXT'},{type:'assistant.text',turnId:'seed',text:'Saved reply'},{type:'turn.complete',turnId:'seed',text:'Saved reply'}],f.cwd);
  const source=await f.open(),oldCore=f.host.core,oldFrame=source.snapshot().controller!,resume=f.app.resume,hold=gate();
  f.app.resume=async(...args)=>{await hold.wait();return resume(...args);};
  expect(f.input(source,{kind:'key',key:'enter'})).toBeTypeOf('number');await expect.poll(handler.entered).toBe(true);
  f.layout.act({type:'workspace',id:2});const intent=f.layout.windowIntentRevision;handler.release();
  await expect.poll(hold.entered).toBe(true);hold.release();
  await expect.poll(()=>f.host.core.sessionId).toBe('saved-history-target');await expect.poll(()=>f.host.core.getState()).toBe('idle');
  await expect.poll(async()=>(await f.app.store.load('saved-history-target',f.cwd)).events.some(event=>event.type==='session.start')).toBe(true);
  expect(f.host.core).not.toBe(oldCore);expect(f.history()).toBeUndefined();expect(f.layout.snapshot().workspace).toBe(2);expect(f.layout.windowIntentRevision).toBe(intent);
  expect(source.controllerInput!(oldFrame.id,{kind:'key',key:'enter'},oldFrame.revision)).toBeUndefined();
  await expect(historyData.control('list')).rejects.toThrow();
  await f.host.submit('Continue saved conversation');
  expect(f.provider.requests[0].messages.some(message=>message.content==='SAVED_HISTORY_CONTEXT')).toBe(true);
});

it('retains a selected history view and reports a rejected resume while Main is waiting',async()=>{
  const f=await fixture(()=>({render:()=>({lines:[{text:'Resume saved',action:'resume'}]}),
    handle:input=>input.kind==='action'&&input.action==='enter'?{type:'resume',id:'saved-history-target'}:undefined}));
  const main=f.host.submit('Ask Main');await expect.poll(()=>f.host.session.snapshot().interaction?.kind).toBe('question');
  const old=f.host.core,pending=f.host.session.snapshot().interaction!,source=await f.open(),frame=source.snapshot().controller!;
  await f.settled(source,f.input(source,{kind:'key',key:'enter'}));
  expect(f.history()).toBe(source);expect(source.snapshot().controller?.id).toBe(frame.id);expect(f.host.core).toBe(old);
  expect(f.host.session.snapshot().notice).toBe('Could not resume this session');expect(f.host.session.snapshot().interaction?.id).toBe(pending.id);
  f.host.session.answerInteraction!(pending.id,{answers:[{id:'answer',selected:['Remote']}]});await main;
});

it('retains a selected history view when the requested saved session cannot be prepared',async()=>{
  const f=await fixture(()=>({render:()=>({lines:[{text:'Resume missing',action:'resume'}]}),
    handle:input=>input.kind==='action'&&input.action==='enter'?{type:'resume',id:'missing-saved-session'}:undefined}));
  const source=await f.open(),old=f.host.core,frame=source.snapshot().controller!;
  await f.settled(source,f.input(source,{kind:'key',key:'enter'}));
  expect(f.history()).toBe(source);expect(source.snapshot().controller?.id).toBe(frame.id);expect(f.host.core).toBe(old);
  expect(f.host.session.snapshot().notice).toBe('Could not resume this session');expect(f.provider.requests).toHaveLength(0);
});

it('cancels a selected resume during preparation and closes the uncommitted Core',async()=>{
  const f=await fixture(()=>({render:()=>({lines:[{text:'Resume saved',action:'resume'}]}),
    handle:input=>input.kind==='action'&&input.action==='enter'?{type:'resume',id:'saved-history-target'}:undefined}),
    new ScriptedProvider([{text:'Original Core remains usable'}]));
  await f.app.store.create(f.cwd,{id:'saved-history-target',name:'Saved target'});
  const source=await f.open(),old=f.host.core,frame=source.snapshot().controller!,resume=f.app.resume,hold=gate();
  let preparedClosed=false;
  f.app.resume=async(...args)=>{const prepared=await resume(...args),close=prepared.close.bind(prepared);
    prepared.close=async()=>{preparedClosed=true;await close();};await hold.wait();return prepared;};
  expect(f.input(source,{kind:'key',key:'enter'})).toBeTypeOf('number');await expect.poll(hold.entered).toBe(true);
  source.cancelController!(frame.id);await expect.poll(()=>f.history()).toBeUndefined();hold.release();
  await expect.poll(()=>preparedClosed).toBe(true);expect(f.host.core).toBe(old);
  expect(source.controllerInput!(frame.id,{kind:'key',key:'enter'},frame.revision)).toBeUndefined();
  await f.host.submit('Continue original conversation');expect(f.provider.requests).toHaveLength(1);
  expect(f.host.session.snapshot().messages.at(-1)?.text).toBe('Original Core remains usable');
});

it('preserves semantic window placement, closed identities and split ratios across selected history resume',async()=>{
  const f=await fixture(()=>({render:()=>({lines:[{text:'Resume saved',action:'resume'}]}),
    handle:input=>input.kind==='action'&&input.action==='enter'?{type:'resume',id:'saved-window-target'}:undefined}),new ScriptedProvider([]),
    `export default {'session.start':async(_,$)=>{for(const id of ['alpha','beta'])await $.ui.view(id,'Window '+id,{lines:[{text:'Generation '+$.session.id}]},{site:'sidebar',workspace:1,size:.3,focus:false});}};`);
  const alpha='plugin-history-window-proof-alpha',beta='plugin-history-window-proof-beta';
  const find=(id:string)=>f.host.surfaces.snapshot().find(source=>source.id===id);
  await expect.poll(()=>Boolean(find(alpha)&&find(beta))).toBe(true);const firstAlpha=find(alpha)!,firstBeta=find(beta)!;
  f.layout.act({type:'open',id:alpha});f.layout.act({type:'moveWorkspace',id:3});
  f.layout.act({type:'open',id:'session'});f.layout.act({type:'moveWorkspace',id:3});
  f.layout.act({type:'open',id:beta});f.layout.act({type:'close'});f.layout.act({type:'open',id:'session'});
  const initialRatio=f.layout.snapshot().splitTarget!.ratio;f.layout.act({type:'resize',delta:.12});
  expect(f.layout.snapshot().splitTarget?.ratio).not.toBe(initialRatio);
  await expect.poll(()=>Boolean(f.layout.snapshot().saving)).toBe(false);const before=await f.app.loadLayout() as {windows:unknown};
  expect(f.layout.snapshot().locations[alpha]).toBe(3);expect(f.layout.snapshot().locations[beta]).toBeUndefined();
  await f.app.store.create(f.cwd,{id:'saved-window-target',name:'Saved window target'});
  const source=await f.open();expect(f.input(source,{kind:'key',key:'enter'})).toBeTypeOf('number');
  await expect.poll(()=>f.host.core.sessionId).toBe('saved-window-target');
  await expect.poll(()=>find(alpha)!==firstAlpha&&find(beta)!==firstBeta&&Boolean(find(alpha)&&find(beta))).toBe(true);
  await expect.poll(()=>Boolean(f.layout.snapshot().saving)).toBe(false);
  expect(f.layout.snapshot().locations[alpha]).toBe(3);expect(f.layout.snapshot().locations[beta]).toBeUndefined();
  expect((await f.app.loadLayout() as {windows:unknown}).windows).toEqual(before.windows);
  expect(find(alpha)?.snapshot().view?.lines[0].text).toBe('Generation saved-window-target');expect(f.history()).toBeUndefined();
});

it('shows the latest selected history failure after a successful reload instead of retaining its old notice',async()=>{
  const f=await fixture(()=>({render:()=>({lines:[{text:'Selected history'}]}),handle:()=>{}}));
  await f.host.submit('/reload');await expect.poll(()=>f.host.session.snapshot().notice).toMatch(/^Reloaded /);
  const old=f.host.core;await f.host.submit('/history');
  await expect.poll(()=>f.host.session.snapshot().notice).toBe('Error: History controller failed');
  expect(f.host.core).toBe(old);expect(f.history()).toBeUndefined();
  expect(f.host.surfaces.snapshot().find(source=>source.id==='plugin-session-manager-sessions')).toBeUndefined();
  expect(f.provider.requests).toHaveLength(0);
});

it('hides and reopens the same lease but focused cancellation revokes delayed controls and resume',async()=>{
  const hold=gate();let disposed=0,allowed=true;
  const f=await fixture(({data})=>{const history=data as AppUiControllerData['history'];return{
    render:()=>({lines:[{text:'Wait',action:'wait'}]}),dispose:()=>{disposed++;},handle:async input=>{
      if(input.kind==='action'&&input.action==='wait'){await hold.wait();try{await history.control('list');}catch{allowed=false;}return{type:'resume',id:'unwanted-target'};}
    },
  };});
  const source=await f.open(),frame=source.snapshot().controller!;f.layout.act({type:'close'});
  expect(f.history()).toBe(source);expect(disposed).toBe(0);expect(f.input(source,{kind:'action',action:'wait'})).toBeUndefined();
  f.layout.act({type:'open',id:source.id});expect(source.snapshot().controller?.id).toBe(frame.id);
  expect(f.input(source,{kind:'action',action:'wait'})).toBeTypeOf('number');await hold.ready;
  source.cancelController!(frame.id);await expect.poll(()=>f.history()).toBeUndefined();expect(disposed).toBe(1);
  const old=f.host.core;hold.release();await expect.poll(()=>allowed).toBe(false);expect(f.host.core).toBe(old);expect(f.provider.requests).toHaveLength(0);
});
