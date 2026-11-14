import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {CoreHumanRequestContext,ModelProvider} from '@agent-compositor/core';
import {decodeLine,encodeMessage,hello,nativeProtocolElements,type NativeOperation,type NativeStateMessage,type WireMessage} from '@agent-compositor/protocol';
import type {UiSurfaceSource} from '@agent-compositor/renderer-opentui';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {createOpenTuiWireHost} from '../src/opentui-wire.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});

it.each([false,true])('preserves managed request ownership through Main resume and closes retained forms (selected=%s)',async selected=>{
  const cwd=await mkdtemp(join(tmpdir(),'opentui-managed-requests-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const plugin=join(cwd,'plugins','managed-window');await mkdir(plugin,{recursive:true});
  await writeFile(join(plugin,'plugin.json'),JSON.stringify({name:'managed-window',version:'1.0.0',trust:'trusted',main:'hooks.js',hookTimeouts:{'prompt.submit':300000}}));
  await writeFile(join(plugin,'hooks.js'),`export default {'prompt.submit':async(event,$)=>{
    if(!event.text.startsWith('Worker form'))return;
    await $.background().ui.form({title:'Worker local form',fields:[{id:'token',label:'Token',type:'password'}],actions:[{id:'save',label:'Save'}]});
    return{drop:'Private worker form complete'};
  }};
  export const controllers={question:()=>({render:()=>({lines:[{text:'Selected worker question'},{text:'Reply',action:'reply'}]}),
    handle:input=>input.kind==='action'&&input.action==='reply'?{answer:'Keep'}:undefined}),
    form:()=>({render:()=>({lines:[{text:'Selected worker form'}]}),handle:()=>undefined})};`);
  const provider:ModelProvider={name:'managed-window-loopback',async *complete(request){
    let index=-1;for(let i=0;i<request.messages.length;i++)if(request.messages[i].role==='user')index=i;
    const prompt=request.messages[index]?.content??'';
    if(prompt==='Seed'||request.messages.slice(index+1).some(message=>message.role==='tool')){
      yield{type:'text_delta',text:'Completed'};yield{type:'finish',reason:'stop'};return;
    }
    yield{type:'tool_call',id:'same-provider-call',name:'ask_user',args:{question:prompt,options:['Keep','Remote']}};
    yield{type:'finish',reason:'tool_calls'};
  }};
  const app=await buildApp({cwd,env:{HOME:cwd},provider,fixedConfig:{enabledPlugins:['agent-hub','session-manager','managed-window'],
    ...(selected?{ui:{controllers:{question:'managed-window',form:'managed-window'}}}:{}),
    agent:{tools:['agent_control','ask_user','task'],builtinTools:[],controlTools:['ask_user','task'],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
    permissions:{rules:[{tool:'agent_control',decision:'allow'}]},compaction:{enabled:false}}});cleanup.push(()=>app.close());
  const contexts:CoreHumanRequestContext[]=[],bind=app.bindHumanRequests;
  // Observe genuine Core contexts while forwarding to the unmodified host.
  app.bindHumanRequests=handlers=>bind({...handlers,
    ask:(request,context)=>{if(context)contexts.push(context);return handlers.ask!(request,context);},
    form:(owner,request,signal,context)=>{contexts.push(context);return handlers.form!(owner,request,signal,context);},
  });
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(160,42);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();await host.submit('Seed');
  const messages:WireMessage[]=[],copy=(value:WireMessage)=>decodeLine(encodeMessage(value));
  const broker=createOpenTuiWireHost({host,layout,onCtrlC:()=> 'handled'},message=>messages.push(copy(message)));cleanup.push(()=>broker.close());
  broker.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements],encodings:['jsonl']}));
  broker.receive({type:'hello-ack',ok:true,version:'0.7.0'});
  const state=()=>messages.slice().reverse().find((message):message is NativeStateMessage=>message.type==='native-state')!;
  let serial=0;
  const input=(source:UiSurfaceSource,operation:NativeOperation,port=state().state.surfaces.find(row=>row.id===source.id)!.port)=>{
    const id=++serial;broker.receive(copy({type:'native-input',epoch:broker.epoch,id,target:port,operation}));
    return messages.slice().reverse().find(message=>message.type==='native-receipt'&&message.id===id);
  };
  const windows=()=>host.surfaces.snapshot().filter(source=>source.id.startsWith('agent-request-'));
  const control=async(args:Record<string,unknown>)=>{const result=await host.core.invokeTool('agent_control',args);expect(result.ok).toBe(true);return result.output;};
  const created=await control({action:'create',name:'Actual worker',worktree:false}) as {id:string};
  await control({action:'send',id:created.id,prompt:'First private question'});await expect.poll(()=>windows().length).toBe(1);
  const source=windows()[0],pending=source.snapshot(),original=contexts[0],oldMain=host.core;
  const port=state().state.surfaces.find(row=>row.id===source.id)!.port;
  expect(pending.title).toContain('Actual worker');expect(host.session.snapshot().interaction).toBeUndefined();
  expect(original.origin.depth).toBe(0);expect(original.root.host).toBe(original.host);expect(original.host).not.toBe(oldMain.host);
  expect(host.publicRender.slot(source.id)).toBeUndefined();
  await oldMain.host.emit('service.session.control',{action:'resume',id:oldMain.sessionId});
  expect(host.core).not.toBe(oldMain);expect(windows()).toEqual([source]);expect(original.root.signal.aborted).toBe(false);
  expect(source.snapshot().controller?.id??source.snapshot().interaction?.id).toBe(pending.controller?.id??pending.interaction?.id);
  expect(state().state.surfaces.find(row=>row.id===source.id)!.port).toBe(port);
  const answer=(window:UiSurfaceSource)=>{
    layout.act({type:'open',id:window.id});const frame=window.snapshot().controller;
    return input(window,frame?{kind:'controller-input',id:frame.id,revision:frame.revision,input:{kind:'action',action:'reply'}}
      :{kind:'interaction',id:window.snapshot().interaction!.id,value:{answers:[{id:'answer',selected:['Keep']}]}});
  };
  expect(answer(source)).toMatchObject({status:'accepted'});await expect.poll(()=>windows().length).toBe(0);
  expect(host.session.snapshot().notice??'').not.toContain('needs input');
  await expect.poll(async()=>((await control({action:'list',id:created.id})) as {state:string}[])[0].state).toBe('idle');
  await control({action:'send',id:created.id,prompt:'Later private question'});await expect.poll(()=>windows().length).toBe(1);
  expect(contexts[1].root).toBe(original.root);expect(contexts[1].host).toBe(original.host);
  expect(answer(windows()[0])).toMatchObject({status:'accepted'});await expect.poll(()=>windows().length).toBe(0);
  await expect.poll(async()=>((await control({action:'list',id:created.id})) as {state:string}[])[0].state).toBe('idle');
  await control({action:'send',id:created.id,prompt:'Worker form retained'});await expect.poll(()=>windows().length).toBe(1);
  const form=windows()[0],formContext=contexts.at(-1)!;
  expect(formContext.root).toBe(original.root);expect(formContext.serviceScope?.background).toBe(true);
  if(selected)expect(form.snapshot().controller?.view.lines[0].text).toBe('Selected worker form');
  else expect(form.snapshot().form?.request.title).toBe('Worker local form');
  await control({action:'archive',id:created.id});await expect.poll(()=>windows().length).toBe(0);
  expect(original.root.signal.aborted).toBe(true);
  expect(input(source,{kind:'cancel-interaction',id:pending.interaction?.id??'retired'},port)).toMatchObject({status:'rejected'});
  const last=await control({action:'create',name:'Last worker',worktree:false}) as {id:string};
  await control({action:'send',id:last.id,prompt:'Worker form shutdown'});await expect.poll(()=>windows().length).toBe(1);
  const lastContext=contexts.at(-1)!;await app.close();expect(lastContext.root.signal.aborted).toBe(true);
  await expect.poll(()=>windows().length).toBe(0);
});
