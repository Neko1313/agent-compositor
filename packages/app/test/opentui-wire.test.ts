import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScriptedProvider} from '@agent-compositor/core';
import type {UiControllers,UiControllerFactory,UiControllerInput,UiEditorState} from '@agent-compositor/hooks';
import {decodeLine,encodeMessage,hello,nativeProtocolElements,type NativeInputMessage,type NativeOperation,type NativeStateMessage,type WireMessage} from '@agent-compositor/protocol';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {createOpenTuiWireHost} from '../src/opentui-wire.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(provider=new ScriptedProvider([]),controllers?:Partial<Record<keyof UiControllers,string>>,decorate?:(host:ReturnType<typeof createOpenTuiHost>)=>ReturnType<typeof createOpenTuiHost>){
  const cwd=await mkdtemp(join(tmpdir(),'opentui-wire-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,fixedConfig:{enabledPlugins:['session-manager'],
    ...(controllers?{ui:{controllers}}:{}),
    agent:{tools:['read','ask_user'],builtinTools:['read'],controlTools:['ask_user'],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
    permissions:{rules:[{tool:'read',decision:'allow'}]},compaction:{enabled:false}}});cleanup.push(()=>app.close());
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(160,50);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();
  const messages:WireMessage[]=[];
  const broker=createOpenTuiWireHost({host:decorate?.(host)??host,layout,onCtrlC:()=>host.core.getState()==='running'?'handled':'exit'},message=>messages.push(decodeLine(encodeMessage(message))));cleanup.push(()=>broker.close());
  const receive=(message:WireMessage)=>broker.receive(decodeLine(encodeMessage(message)));
  const negotiate=(native=true)=>receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:native?[...nativeProtocolElements]:['Text'],encodings:['jsonl']}));
  const state=()=>messages.slice().reverse().find((message):message is NativeStateMessage=>message.type==='native-state')!;
  let id=0;
  const input=(target:string,operation:NativeOperation,extra:Partial<NativeInputMessage>={})=>{
    const message:NativeInputMessage={type:'native-input',epoch:broker.epoch,id:++id,target,operation,...extra};receive(message);
    return {message,receipt:messages.slice().reverse().find(value=>value.type==='native-receipt'&&value.id===message.id)};
  };
  return {cwd,app,host,layout,provider,messages,broker,receive,negotiate,state,input};
}

it.each(['form','editor'] as const)('keeps relative %s input on its live lease while fencing painted targets, fields, focus and retired identities',async kind=>{
  const f=await fixture(new ScriptedProvider([]),{[kind]:'wire-selected'}),handled:UiControllerInput[]=[];
  let field:string|undefined='field',value='',invalidate=()=>{};
  const manifest={name:'wire-selected',version:'1.0.0',trust:'trusted' as const};
  const factory:UiControllerFactory=(request,context)=>{
    value=kind==='editor'?(request.state as UiEditorState).text:'FORMvalue';invalidate=context.invalidate;
    return{snapshot:()=>({text:value,cursor:value.length}),preferredRows:()=>5,
      render:()=>({...(field?{input:{id:field,value}}:{}),lines:[{text:'Selected '+kind},{text:value},{text:'Allowed',action:'allowed'}]}),
      async handle(input:UiControllerInput){handled.push(structuredClone(input));if(input.kind==='text')value+=input.text;else if(input.kind==='change')value=input.value;},
    };
  };
  const factories:UiControllers={[kind]:factory};
  const register=()=>f.host.core.host.registerPlugin(manifest,{},'user',[],factories);register();
  f.host.core.host.registerPlugin({name:'wire-form-caller',version:'1.0.0',trust:'trusted'},{'ui.press':async(event,$)=>{
    if(event.site==='plugin-wire-form-caller-controls'&&event.key==='open')await $.ui.form({title:'Wire private form',fields:[{id:'name',label:'Name',type:'text',value:'FORMvalue'}],actions:[{id:'save',label:'Save'}]});
  }});
  await f.host.core.host.emit('service.ui.view',{plugin:'wire-form-caller',id:'controls',title:'Form controls',view:{lines:[{text:'Open',action:'open'}]},placement:{focus:false}});
  f.negotiate();
  const dto=()=>kind==='editor'?f.state().state.sessions.find(session=>session.paneId==='session')!:
    f.state().state.surfaces.find(surface=>surface.snapshot.controller?.kind==='form')!;
  const frame=()=>{const target=dto();return kind==='editor'?'editor'in target.snapshot?target.snapshot.editor!:undefined:target.snapshot.controller!;};
  const focus=()=>{const target=dto();f.layout.act({type:'open',id:kind==='editor'?'session':target.id});};
  async function openForm(){
    const controls=f.state().state.surfaces.find(surface=>surface.id==='plugin-wire-form-caller-controls')!;
    f.layout.act({type:'open',id:controls.id});
    expect(f.input(controls.port,{kind:'surface-press',action:'open',revision:controls.snapshot.revision}).receipt).toMatchObject({status:'accepted'});
    await expect.poll(()=>f.state().state.surfaces.some(surface=>surface.snapshot.controller?.kind==='form')).toBe(true);focus();
  }
  if(kind==='form')await openForm();else await expect.poll(()=>{const current=frame();return current?.kind==='editor'&&current.available;}).toBe(true);
  focus();const initial=frame()!;
  const send=(input:UiControllerInput,revision=initial.revision,id=frame()!.id,target=dto().port)=>f.input(target,{kind:kind==='editor'?'editor-input':'controller-input',id,input,revision}).receipt;
  invalidate();expect(frame()!.revision).toBeGreaterThan(initial.revision);
  for(const input of [{kind:'key',key:'left'},{kind:'text',text:'_P',paste:true},{kind:'change',id:'field',value:'SEMANTIC'}] as const){
    const receipt=send(input);expect(receipt).toMatchObject({status:'accepted'});
    await expect.poll(()=>handled.at(-1)).toEqual(input);await expect.poll(()=>frame()!.inputRevision).toBe(handled.length);
  }
  const admitted=handled.length;
  for(const input of [{kind:'key',key:'end'},{kind:'text',text:'FUTURE'},{kind:'change',id:'field',value:'FUTURE'}] as const)
    expect(send(input,frame()!.revision+1)).toMatchObject({status:'rejected'});
  for(const input of [{kind:'mouse',row:0,col:0,button:'left',action:'press'},{kind:'action',action:'allowed'}] as const)
    expect(send(input)).toMatchObject({status:'rejected'});
  expect(send({kind:'action',action:'forged'},frame()!.revision)).toMatchObject({status:'rejected'});
  expect(handled).toHaveLength(admitted);
  expect(send({kind:'action',action:'allowed'},frame()!.revision)).toMatchObject({status:'accepted'});
  await expect.poll(()=>handled.at(-1)).toEqual({kind:'action',action:'allowed'});await expect.poll(()=>frame()!.inputRevision).toBe(handled.length);
  field='new-field';invalidate();const beforeFields=handled.length;
  expect(send({kind:'change',id:'field',value:'OLD_FIELD'})).toMatchObject({status:'rejected'});
  expect(send({kind:'change',id:'field',value:'OLD_FIELD'},frame()!.revision)).toMatchObject({status:'rejected'});
  expect(send({kind:'change',id:'new-field',value:'CURRENT_FIELD'})).toMatchObject({status:'accepted'});
  await expect.poll(()=>handled.at(-1)).toEqual({kind:'change',id:'new-field',value:'CURRENT_FIELD'});await expect.poll(()=>frame()!.inputRevision).toBe(handled.length);
  expect(handled).toHaveLength(beforeFields+1);field=undefined;invalidate();
  expect(send({kind:'change',id:'new-field',value:'MISSING_FIELD'})).toMatchObject({status:'rejected'});
  const beforeHidden=handled.length;f.layout.act({type:'workspace',id:9});
  expect(send({kind:'text',text:'HIDDEN'})).toMatchObject({status:'rejected'});expect(send({kind:'key',key:'left'})).toMatchObject({status:'rejected'});
  expect(handled).toHaveLength(beforeHidden);f.layout.act({type:'workspace',id:1});focus();
  expect(send({kind:'text',text:'FOREIGN_LEASE'},initial.revision,'foreign-request')).toMatchObject({status:'rejected'});
  const retired={port:dto().port,id:frame()!.id,revision:frame()!.revision};
  if(kind==='editor'){
    f.host.createWindow('session');expect(dto().port).not.toBe(retired.port);focus();
    expect(send({kind:'text',text:'RETIRED_PORT'},retired.revision,frame()!.id,retired.port)).toMatchObject({status:'rejected'});
    f.host.core.host.unregisterPlugin(manifest.name);register();await expect.poll(()=>frame()?.id).not.toBe(retired.id);
  }else{
    const source=f.host.surfaces.snapshot().find(source=>source.id===dto().id)!;source.cancelController!(retired.id);
    await expect.poll(()=>f.state().state.surfaces.some(surface=>surface.port===retired.port)).toBe(false);
    await openForm();expect(dto().port).not.toBe(retired.port);
    expect(send({kind:'text',text:'RETIRED_PORT'},retired.revision,frame()!.id,retired.port)).toMatchObject({status:'rejected'});
  }
  expect(frame()!.id).not.toBe(retired.id);const beforeRetired=handled.length;
  expect(send({kind:'text',text:'RETIRED_LEASE'},retired.revision,retired.id)).toMatchObject({status:'rejected'});
  expect(handled).toHaveLength(beforeRetired);expect(f.provider.requests).toEqual([]);
});

it('negotiates native presentation separately and serializes the actual host without capabilities',async()=>{
  const f=await fixture();f.broker.hello();f.negotiate(false);
  expect(f.messages.at(-1)).toMatchObject({type:'hello-ack',ok:false});expect(f.state()).toBeUndefined();
  f.negotiate();const state=f.state();
  expect(state).toMatchObject({epoch:f.broker.epoch,state:{windows:[{id:'session'}],layout:{focused:'session',width:160,height:50}}});
  const main=state.state.sessions.find(session=>session.paneId==='session')!;
  expect(main).toMatchObject({id:f.host.session.id,conversationId:'main',current:true,snapshot:{messages:[],running:false}});
  expect(main.port).not.toBe(main.id);expect(state.state.windows[0].session).toBe(main.port);
  expect(state.state.immediateCommands).toEqual(expect.arrayContaining(['/chat','/windows','/history']));
  expect(decodeLine(encodeMessage(state))).toEqual(state);
  f.input('@layout',{kind:'layout-action',action:{type:'workspace',id:9}});
  expect(f.state().state.layout).toMatchObject({workspace:9,focused:'input',frames:[]});
  expect(f.state().state.layout).toEqual(f.layout.snapshot());
  expect(f.provider.requests).toEqual([]);
});

it('rejects retained same-ID ports after a copy rebuild and revokes wrong epochs without model calls',async()=>{
  const f=await fixture();f.negotiate();const old=f.state().state.sessions[0];
  f.host.createWindow('session');const state=f.state().state;
  expect(state.windows.map(window=>window.id)).toEqual(['session','window-1']);
  expect(new Set(state.sessions.map(session=>session.port)).size).toBe(2);
  expect(state.sessions.every(session=>session.id===old.id&&session.conversationId==='main')).toBe(true);
  expect(f.input(old.port,{kind:'submit',text:'STALE_PORT'}).receipt).toMatchObject({status:'rejected'});
  const current=state.sessions.find(session=>session.paneId==='window-1')!;
  expect(f.input(current.port,{kind:'submit',text:'WRONG_EPOCH'},{epoch:'retired'}).receipt).toMatchObject({status:'rejected',epoch:'retired'});
  expect(f.provider.requests).toEqual([]);
});

it('accepts a zero-based first protocol input and rejects a changed duplicate',async()=>{
  const f=await fixture();f.negotiate();
  const first=f.input('@layout',{kind:'layout-action',action:{type:'workspace',id:2}},{id:0});
  expect(first.receipt).toMatchObject({id:0,status:'accepted'});expect(f.layout.snapshot().workspace).toBe(2);
  f.receive({...first.message,operation:{kind:'layout-action',action:{type:'workspace',id:9}}});
  expect(f.messages.at(-1)).toMatchObject({id:0,status:'rejected'});expect(f.layout.snapshot().workspace).toBe(2);
});

it('acknowledges submission before model completion and keeps navigation independent of the held turn',async()=>{
  const provider=new ScriptedProvider([{text:'HELD_MAIN',hold:true},{text:'Done'}]),f=await fixture(provider);cleanup.push(()=>provider.release());
  f.negotiate();const main=f.state().state.sessions[0];
  const submitted=f.input(main.port,{kind:'submit',text:'Main work'});
  await expect.poll(()=>f.messages.find(value=>value.type==='native-receipt'&&value.id===submitted.message.id)).toMatchObject({status:'accepted'});
  await expect.poll(()=>provider.requests.length).toBe(1);expect(f.host.core.getState()).toBe('running');
  expect(f.input('@navigation',{kind:'navigation-handle',input:{kind:'key',key:'f2'}}).receipt).toMatchObject({status:'accepted',consumed:true});
  expect(f.state().state.navigation?.mode).toBe('finder');
  expect(f.input(main.port,{kind:'submit',text:'DO_NOT_REPLACE_MAIN'}).receipt).toMatchObject({status:'rejected'});
  expect(f.input('@navigation',{kind:'navigation-handle',input:{kind:'key',key:'0',modifiers:['alt']}}).receipt).toMatchObject({status:'accepted',consumed:true});
  expect(f.state().state.navigation?.mode).toBe('normal');expect(f.host.core.getState()).toBe('running');expect(provider.requests).toHaveLength(1);
});

it('routes a displayed plugin action once while Main runs and rejects forged, hidden and conflicting duplicate inputs',async()=>{
  const provider=new ScriptedProvider([{text:'HELD_MAIN',hold:true},{text:'Done'}]),f=await fixture(provider);cleanup.push(()=>provider.release());
  await writeFile(join(f.cwd,'report.txt'),'PRIVATE_UI_TOOL_RESULT');let calls=0,result:unknown;
  f.host.core.host.registerPlugin({name:'wire-proof',version:'1.0.0',trust:'trusted'},{'ui.press':async(event,$)=>{
    if(event.site==='plugin-wire-proof-panel'&&event.key==='read'){calls++;result=await $.agent.tool('read',{path:'report.txt'});}
  }});
  await f.host.core.host.emit('service.ui.view',{plugin:'wire-proof',id:'panel',title:'Wire actions',view:{lines:[{text:'Read report',action:'read'}]},placement:{focus:false}});
  f.negotiate();const main=f.state().state.sessions.find(session=>session.paneId==='session')!;
  f.input(main.port,{kind:'submit',text:'Main work'});await expect.poll(()=>provider.requests.length).toBe(1);
  const surface=f.state().state.surfaces.find(surface=>surface.id==='plugin-wire-proof-panel')!;
  expect(f.input(surface.port,{kind:'surface-press',action:'forged',revision:surface.snapshot.revision}).receipt).toMatchObject({status:'rejected'});
  const accepted=f.input(surface.port,{kind:'surface-press',action:'read',revision:surface.snapshot.revision});
  expect(accepted.receipt).toMatchObject({status:'accepted'});f.receive(accepted.message);
  await expect.poll(()=>result).toMatchObject({ok:true,output:{content:'PRIVATE_UI_TOOL_RESULT'}});expect(calls).toBe(1);
  f.receive({...accepted.message,operation:{kind:'surface-press',action:'forged',revision:surface.snapshot.revision}});
  expect(f.messages.at(-1)).toMatchObject({type:'native-receipt',status:'rejected',id:accepted.message.id});expect(calls).toBe(1);
  f.layout.act({type:'close'});
  expect(f.input(surface.port,{kind:'surface-press',action:'read',revision:surface.snapshot.revision}).receipt).toMatchObject({status:'rejected'});
  expect(f.host.core.getMessages().filter(message=>message.role==='user')).toHaveLength(1);expect(provider.requests).toHaveLength(1);
});

it('binds native question answers to the visible current request and preserves once-only completion',async()=>{
  const provider=new ScriptedProvider([{toolCalls:[{name:'ask_user',args:{question:'WIRE_QUESTION',options:['Local','Remote'],allowOther:false}}]},{text:'Handled'}]);
  const f=await fixture(provider);f.negotiate();const main=f.state().state.sessions[0];
  f.input(main.port,{kind:'submit',text:'Ask first'});
  await expect.poll(()=>f.state().state.sessions[0].snapshot.interaction?.kind).toBe('question');
  const interaction=f.state().state.sessions[0].snapshot.interaction!;
  if(interaction.kind!=='question')throw Error('Expected a native question');
  expect(f.input(main.port,{kind:'interaction',id:'FOREIGN_REQUEST',value:{answers:[]}}).receipt).toMatchObject({status:'rejected'});
  const answer={answers:interaction.request.questions.map(question=>({id:question.id,selected:['Local']}))};
  expect(f.input(main.port,{kind:'interaction',id:interaction.id,value:answer}).receipt).toMatchObject({status:'accepted'});
  await expect.poll(()=>f.host.core.getState()).toBe('idle');
  expect(f.input(main.port,{kind:'interaction',id:interaction.id,value:answer}).receipt).toMatchObject({status:'rejected'});
  expect(provider.requests).toHaveLength(2);
});

it('revokes the broker after a negative or incompatible late acknowledgment',async()=>{
  for(const ack of [{type:'hello-ack',ok:false,reason:'Peer stopped'},{type:'hello-ack',ok:true,version:'1.7.0'}] as const){
    const f=await fixture();f.negotiate();f.receive(ack);const count=f.messages.length;
    f.input('@layout',{kind:'layout-action',action:{type:'workspace',id:9}});
    expect(f.layout.snapshot().workspace).toBe(1);expect(f.messages).toHaveLength(count);
  }
});

it('closes a broken outbound transport before another host publication or input can run',async()=>{
  const f=await fixture();const errors:unknown[]=[];let sends=0;
  const broker=createOpenTuiWireHost({host:f.host,layout:f.layout,onCtrlC:()=> 'exit',onFailure:error=>errors.push(error)},message=>{
    sends++;if(message.type==='native-state')throw Error('Disconnected wire');
  });cleanup.push(()=>broker.close());
  broker.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements],encodings:['jsonl']}));
  expect(errors).toHaveLength(1);const count=sends;
  f.layout.act({type:'workspace',id:2});
  broker.receive({type:'native-input',epoch:broker.epoch,id:1,target:'@layout',operation:{kind:'layout-action',action:{type:'workspace',id:9}}});
  expect(f.layout.snapshot().workspace).toBe(2);expect(sends).toBe(count);
});

it('rejects an action when all real UI operation slots are occupied',async()=>{
  const f=await fixture();let release!:()=>void,calls=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});cleanup.push(release);
  f.host.core.host.registerPlugin({name:'wire-busy',version:'1.0.0',trust:'trusted'},{'ui.press':async()=>{calls++;await gate;}});
  await f.host.core.host.emit('service.ui.view',{plugin:'wire-busy',id:'panel',title:'Busy actions',view:{lines:[{text:'Start',action:'start'}]},placement:{focus:true}});
  f.negotiate();
  const press=()=>{const source=f.state().state.surfaces.find(surface=>surface.id==='plugin-wire-busy-panel')!;
    return f.input(source.port,{kind:'surface-press',action:'start',revision:source.snapshot.revision}).receipt;};
  for(let i=0;i<4;i++)expect(press()).toMatchObject({status:'accepted'});
  await expect.poll(()=>calls).toBe(4);
  expect(press()).toMatchObject({status:'rejected'});expect(calls).toBe(4);
  expect(f.state().state.sessions[0].snapshot.notice).toBe('Four interface operations are already active');
});

it('waits for journal acceptance and deduplicates a repeated in-flight native submit',async()=>{
 const provider=new ScriptedProvider([{text:'Done'}]),f=await fixture(provider);f.negotiate();const main=f.state().state.sessions[0];
 let release!:()=>void,entered!:()=>void,writes=0;
 const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 f.host.core.runtime.setResolver('service.session.append',async({sessionId,cwd,event,data}:any)=>{
  if(event==='prompt.input.intent'){writes++;entered();await held;}
  await f.app.store.create(cwd,{id:sessionId});await f.app.store.append(sessionId,[{type:event,...data}],cwd);return {value:true};
 });
 const submitted=f.input(main.port,{kind:'submit',text:'One task'});await started;
 expect(submitted.receipt).toBeUndefined();f.receive(submitted.message);
 expect(f.messages.some(value=>value.type==='native-receipt'&&value.id===submitted.message.id)).toBe(false);
 expect(writes).toBe(1);expect(provider.requests).toHaveLength(0);
 expect(f.input('@navigation',{kind:'navigation-handle',input:{kind:'key',key:'f2'}}).receipt).toMatchObject({status:'accepted'});
 release();await expect.poll(()=>f.messages.find(value=>value.type==='native-receipt'&&value.id===submitted.message.id)).toMatchObject({status:'accepted'});
 await expect.poll(()=>provider.requests.length).toBe(1);expect(writes).toBe(1);
});

it('negotiates native steering without exposing the new method to legacy peers',async()=>{
  const legacy=await fixture();legacy.negotiate();const oldSession=legacy.state().state.sessions[0];
  expect(oldSession.methods).not.toContain('steer');
  expect(legacy.input(oldSession.port,{kind:'steer',text:'FORGED'}).receipt).toMatchObject({status:'rejected'});
  const modern=await fixture();modern.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements,'native-steer-v1'],encodings:['jsonl']}));
  expect(modern.state().state.sessions[0].methods).toContain('steer');
});

it.each([false,true])('negotiates private draft changes with capability %s',async supported=>{
  const change=vi.fn(()=>true);
  const f=await fixture(undefined,undefined,host=>{
    const registry=host.conversationWindows,windows=registry.snapshot();
    const session=windows[0].session;
    const decorated={...session,snapshot:()=>({...session.snapshot(),draft:{revision:7,text:'private draft',status:'draft' as const}}),draftChange:change};
    return {...host,conversationWindows:{...registry,snapshot:()=>windows.map(window=>({...window,session:decorated}))}};
  });
  f.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements,...(supported?['native-main-draft-v1']:[])],encodings:['jsonl']}));
  const main=f.state().state.sessions[0];
  expect(main.methods?.includes('draftChange')).toBe(supported);
  if(supported)expect(main.snapshot.draft).toEqual({revision:7,text:'private draft',status:'draft'});
  else expect(main.snapshot).not.toHaveProperty('draft');
  expect(f.input(main.port,{kind:'draft-change',text:'stale',revision:6}).receipt).toMatchObject({status:'rejected'});
  expect(f.input(main.port,{kind:'draft-change',text:'edited',revision:7}).receipt).toMatchObject({status:supported?'accepted':'rejected'});
  expect(change).toHaveBeenCalledTimes(supported?1:0);
  f.layout.act({type:'workspace',id:9});
  expect(f.input(main.port,{kind:'draft-change',text:'hidden',revision:7}).receipt).toMatchObject({status:'rejected'});
  expect(f.provider.requests).toEqual([]);
});

it('negotiates queued-work state without changing legacy native snapshots',async()=>{
  const legacy=await fixture();legacy.negotiate();(legacy.host.core as any).options.isWorkBlocked=()=>true;
  await legacy.host.core.submit('Legacy pending');
  expect(legacy.state().state.sessions[0].snapshot).not.toHaveProperty('pending');
  const modern=await fixture();modern.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements,'native-pending-work-v1'],encodings:['jsonl']}));
  (modern.host.core as any).options.isWorkBlocked=()=>true;await modern.host.core.submit('Modern pending');
  expect(modern.state().state.sessions[0].snapshot.pending).toBe(true);
  modern.host.core.interrupt();expect(modern.state().state.sessions[0].snapshot.pending).toBe(false);
});

it.each([false,true])('negotiates session restoration state with capability %s',async supported=>{
  const f=await fixture(new ScriptedProvider([{text:'Saved reply'}]));
  f.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements,...(supported?['native-session-restoring-v1']:[])],encodings:['jsonl']}));
  await f.host.submit('Save a session');
  let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});cleanup.push(()=>release());
  const resume=f.app.resume;f.app.resume=async(...args)=>{const replacement=await resume(...args),start=replacement.start.bind(replacement);
    replacement.start=async()=>{entered=true;await gate;await start();};return replacement;};
  const old=f.host.core,switching=old.host.emit('service.session.control',{action:'resume',id:old.sessionId});
  await expect.poll(()=>entered).toBe(true);
  if(supported)expect(f.state().state.sessions[0].snapshot.restoring).toBe(true);
  else expect(f.state().state.sessions[0].snapshot).not.toHaveProperty('restoring');
  release();await switching;
  expect(f.state().state.sessions[0].snapshot).not.toHaveProperty('restoring');
});
