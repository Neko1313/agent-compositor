import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScriptedProvider} from '@agent-compositor/core';
import {decodeLine,encodeMessage,hello,nativeProtocolElements,type NativeInputMessage,type NativeOperation,type NativeStateMessage,type WireMessage} from '@agent-compositor/protocol';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {createOpenTuiWireHost} from '../src/opentui-wire.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(provider=new ScriptedProvider([])){
  const cwd=await mkdtemp(join(tmpdir(),'opentui-wire-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,fixedConfig:{enabledPlugins:['session-manager'],
    agent:{tools:['read','ask_user'],builtinTools:['read'],controlTools:['ask_user'],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
    permissions:{rules:[{tool:'read',decision:'allow'}]},compaction:{enabled:false}}});cleanup.push(()=>app.close());
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(160,50);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();
  const messages:WireMessage[]=[];
  const broker=createOpenTuiWireHost({host,layout,onCtrlC:()=>host.core.getState()==='running'?'handled':'exit'},message=>messages.push(decodeLine(encodeMessage(message))));cleanup.push(()=>broker.close());
  const receive=(message:WireMessage)=>broker.receive(decodeLine(encodeMessage(message)));
  const negotiate=(native=true)=>receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:native?[...nativeProtocolElements]:['Text'],encodings:['jsonl']}));
  const state=()=>messages.slice().reverse().find((message):message is NativeStateMessage=>message.type==='native-state')!;
  let id=0;
  const input=(target:string,operation:NativeOperation,extra:Partial<NativeInputMessage>={})=>{
    const message:NativeInputMessage={type:'native-input',epoch:broker.epoch,id:++id,target,operation,...extra};receive(message);
    return {message,receipt:messages.slice().reverse().find(value=>value.type==='native-receipt'&&value.id===message.id)};
  };
  return {cwd,host,layout,provider,messages,broker,receive,negotiate,state,input};
}

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
  expect(f.input(main.port,{kind:'submit',text:'Main work'}).receipt).toMatchObject({status:'accepted'});
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
