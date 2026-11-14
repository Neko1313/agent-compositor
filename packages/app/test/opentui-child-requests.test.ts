import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {CoreHumanRequestContext,ModelProvider,CompletionRequest} from '@agent-compositor/core';
import {decodeLine,encodeMessage,hello,nativeProtocolElements,type NativeOperation,type NativeStateMessage,type WireMessage} from '@agent-compositor/protocol';
import type {UiSurfaceSource} from '@agent-compositor/renderer-opentui';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';
import {createOpenTuiWireHost} from '../src/opentui-wire.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(selected=false){
  const cwd=await mkdtemp(join(tmpdir(),'opentui-child-requests-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const directory=join(cwd,'plugins','child-probe'),trace=join(cwd,'private-receipts.jsonl'),publicTrace=join(cwd,'public-ui.jsonl'),effects=join(cwd,'effects.jsonl');
  await mkdir(directory,{recursive:true});await Promise.all([trace,publicTrace,effects].map(path=>writeFile(path,'')));
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'child-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',
    commands:[{name:'/child-many',description:'Start independent delegated requests',execution:'immediate'},
      {name:'/child-settings',description:'Open private settings',execution:'immediate'},
      {name:'/child-focus',description:'Continue a focused delegated request',execution:'immediate'},
      {name:'/child-stale-start',description:'Capture an ordinary child capability',execution:'immediate'},
      {name:'/child-stale-trigger',description:'Use the old capability inside a fresh UI action',execution:'immediate'}],hookTimeouts:{'command.invoke':300000,'prompt.submit':300000}}));
  await writeFile(join(directory,'hooks.js'),`
import {appendFile,readFile} from 'node:fs/promises';
const record=(key,value)=>appendFile(${JSON.stringify(trace)},JSON.stringify({key,value})+'\\n');
let captured,ready,finish;const childReady=new Promise(resolve=>{ready=resolve;}),childFinish=new Promise(resolve=>{finish=resolve;});
export default {
 'command.invoke':async(event,$)=>{
  if(event.name==='/child-focus'){
   await $.emit('service.agent.spawn',{prompt:'CHILD_QUESTION_focus',agentId:'Focus child'});await record('focus-child-answered',true);
   if(event.args==='hold'){while(true){$.signal.throwIfAborted();try{await readFile(${JSON.stringify(join(cwd,'focus-release'))});break;}catch{await new Promise(resolve=>setTimeout(resolve,5));}}}
   await $.ui.view('focus-result','Child result publication',{lines:[{text:'Child continuation completed'}]},{site:'split',workspace:1,focus:true});return;
  }
  if(event.name==='/child-stale-start'){void $.emit('service.agent.spawn',{prompt:'CHILD_STALE'}).catch(()=>{});await childReady;await record('stale-captured',true);return;}
  if(event.name==='/child-stale-trigger'){
   let denied=false;try{denied=await captured.ui.form({title:'Expired child form',fields:[{id:'name',label:'Name',type:'text'}],actions:[{id:'save',label:'Save'}]})===null;}catch{denied=true;}
   await record('stale-denied',denied);finish();await record('fresh-form',await $.ui.form({title:'Current after expired child',fields:[{id:'name',label:'Name',type:'text'}],actions:[{id:'save',label:'Save'}]}));return;
  }
  if(event.name==='/child-settings'){await record('settings',await $.ui.form({title:'Settings remain usable',fields:[{id:'name',label:'Name',type:'text'}],actions:[{id:'save',label:'Save'}]}));return;}
  if(event.name==='/child-many'){
   const [kind,count='2',mode='ordinary',alias='same-alias']=event.args.split(' '),receipt=$.background(),api=mode==='background'?receipt:$;
   const work=Array.from({length:Number(count)},async(_,index)=>{
    let value;try{value=mode==='background'
      ?await api.agent.tool('task',{prompt:'CHILD_'+kind+'_'+index})
      :await api.emit('service.agent.spawn',{prompt:'CHILD_'+kind+'_'+index,agentId:alias,...(mode==='detached'?{detached:true}:{})});}
    catch(error){value={error:String(error)};}await record('child-'+kind+'-'+index,value);
   });
   if(mode==='ordinary')await Promise.all(work);else{void Promise.all(work).catch(()=>{});await record('launcher-'+mode,true);}
  }
 },
 'prompt.submit':async(event,$)=>{
  if(event.text==='CHILD_STALE'){captured=$;ready();await childFinish;return{drop:'Held capability released'};}
  if(!event.text.startsWith('CHILD_FORM_'))return;
  const value=await $.ui.form({title:'Child local form',fields:[{id:'name',label:'Private name',type:'text'},
    {id:'token',label:'Token',type:'password',required:true}],actions:[{id:'save',label:'Save'}]});
  await record('private-form',value?{action:value.action,name:value.values.name,tokenLength:String(value.values.token??'').length}:null);
  return{drop:'Child private form handled'};
 },
 'ui.render':event=>appendFile(${JSON.stringify(publicTrace)},JSON.stringify(event)+'\\n'),
};`);
  await writeFile(join(directory,'tools.ts'),`
import {appendFile} from 'node:fs/promises';
export default [{name:'guarded_child',description:'Append one deterministic local effect',parameters:{type:'object',properties:{tag:{type:'string'}},required:['tag']},
 describe:args=>({tool:'guarded_child',path:'PRIVATE_ARG_'+args.tag}),execute:async(_ctx,args)=>{await appendFile(${JSON.stringify(effects)},args.tag+'\\n');return{ok:true,data:'effect recorded'};}}];`);
  if(selected){
    const controller=join(cwd,'plugins','child-selected');await mkdir(controller,{recursive:true});
    await writeFile(join(controller,'plugin.json'),JSON.stringify({name:'child-selected',version:'1.0.0',trust:'trusted',main:'hooks.js'}));
    await writeFile(join(controller,'hooks.js'),`export default {};export const controllers={question:({data})=>({
      render:()=>({lines:[{text:'SELECTED_CHILD_FRAME '+data.question},{text:'Answer',action:'answer'}]}),
      handle:input=>input.kind==='action'&&input.action==='answer'?{answer:'Remote'}:undefined,
    })};`);
  }
  const requests:CompletionRequest[]=[];
  const provider:ModelProvider={name:'child-request-router',async *complete(request){
    requests.push(request);const prompt=request.messages.filter(message=>message.role==='user').at(-1)?.content??'';
    if(prompt==='SAVED_CONTEXT'){yield{type:'text_delta',text:'Saved reply'};yield{type:'finish',reason:'stop'};return;}
    if(request.messages.some(message=>message.role==='tool')){yield{type:'text_delta',text:'Completed '+prompt.split('_')[0]};yield{type:'finish',reason:'stop'};return;}
    let name:string,args:unknown;
    if(prompt==='MAIN_HOLD'){name='ask_user';args={question:'MAIN_PRIVATE_QUESTION',options:['Keep','Discard'],allowOther:false};}
    else if(prompt.startsWith('TASK_')){name='task';args={prompt:'CHILD_'+prompt.slice(5)+'_0'};}
    else if(prompt.startsWith('CHILD_APPROVAL')){name='guarded_child';args={tag:prompt};}
    else if(prompt.startsWith('CHILD_NESTED')){name='task';args={prompt:'CHILD_QUESTION_LEAF'};}
    else if(prompt.startsWith('CHILD_QUESTIONNAIRE')){name='ask_questions';args={title:'CHILD_PRIVATE_QUESTIONNAIRE',questions:[{id:'target',question:'CHILD_PRIVATE_CHOICE',options:['Local','Remote']}]};}
    else{name='ask_user';args={question:'CHILD_PRIVATE_QUESTION '+prompt,options:['Local','Remote'],allowOther:false};}
    yield{type:'tool_call',id:'same-provider-call-id',name,args};yield{type:'finish',reason:'tool_calls'};
  }};
  const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,fixedConfig:{enabledPlugins:['session-manager','child-probe',...(selected?['child-selected']:[])],
    ...(selected?{ui:{controllers:{question:'child-selected'}}}:{}),
    agent:{tools:['task','ask_user','ask_questions','guarded_child'],builtinTools:[],controlTools:['task','ask_user','ask_questions'],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
    permissions:{rules:[{tool:'guarded_child',decision:'ask'}]},compaction:{enabled:false}}});cleanup.push(()=>app.close());
  expect(app.pluginErrors).toEqual([]);
  // Observe and forward the actual Core callback context, without fabricating or
  // rewriting it. Requests still enter the normal production host callbacks.
  const contexts:CoreHumanRequestContext[]=[],construct=app.createCore;
  app.createCore=(approve,ask)=>construct((request,context)=>{if(context)contexts.push(context);return approve(request,context);},
    ask?(request,context)=>{if(context)contexts.push(context);return ask(request,context);}:undefined);
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(180,50);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();
  const messages:WireMessage[]=[];
  const broker=createOpenTuiWireHost({host,layout,onCtrlC:()=> 'handled'},message=>messages.push(decodeLine(encodeMessage(message))));cleanup.push(()=>broker.close());
  broker.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements],encodings:['jsonl']}));
  broker.receive({type:'hello-ack',ok:true,version:'0.7.0'});
  const state=()=>messages.slice().reverse().find((message):message is NativeStateMessage=>message.type==='native-state')!;
  let inputId=0;
  const input=(source:UiSurfaceSource,operation:NativeOperation,port=state().state.surfaces.find(value=>value.id===source.id)!.port)=>{
    const id=++inputId;broker.receive(decodeLine(encodeMessage({type:'native-input',epoch:broker.epoch,id,target:port,operation})));
    return messages.find(message=>message.type==='native-receipt'&&message.id===id);
  };
  const children=()=>host.surfaces.snapshot().filter(source=>source.id.startsWith('agent-request-'));
  const focus=(source:UiSurfaceSource)=>layout.act({type:'open',id:source.id});
  const rows=async(path:string)=>{const text=await readFile(path,'utf8');return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));};
  const receipts=()=>rows(trace);
  const answered=(source:UiSurfaceSource,value:Extract<NativeOperation,{kind:'interaction'}>['value'])=>{focus(source);const request=source.snapshot().interaction??source.snapshot().form!;return input(source,{kind:'interaction',id:request!.id,value});};
  return{cwd,app,host,layout,provider,requests,contexts,children,focus,state,input,receipts,effects,publicTrace,answered};
}

it.each(['APPROVAL','QUESTION','QUESTIONNAIRE','FORM'] as const)('routes an ordinary model task child %s to a private source instead of Main',async kind=>{
  const f=await fixture(),run=f.host.submit('TASK_'+kind);await expect.poll(()=>f.children().length).toBe(1);
  const source=f.children()[0],snapshot=source.snapshot();
  expect(f.host.session.snapshot().approval).toBeUndefined();expect(f.host.session.snapshot().interaction).toBeUndefined();
  expect(snapshot.title).toContain('Agent');expect(snapshot.title).toContain('Parent');
  expect(snapshot.title).not.toMatch(/CHILD_|PRIVATE_|TOKEN/);expect(f.host.publicRender.slot(source.id)).toBeUndefined();
  f.focus(source);
  if(kind==='APPROVAL')expect(f.input(source,{kind:'approval',id:snapshot.approval!.id,allow:false})).toMatchObject({status:'accepted'});
  else if(kind==='FORM')expect(f.answered(source,{action:'save',values:{name:'PRIVATE_FORM_RESULT',token:'PRIVATE_CHILD_TOKEN'}})).toMatchObject({status:'accepted'});
  else expect(f.answered(source,{answers:[{id:kind==='QUESTIONNAIRE'?'target':'answer',selected:['Remote']}]})).toMatchObject({status:'accepted'});
  await run;await expect.poll(()=>f.children().length).toBe(0);
  expect(await readFile(f.effects,'utf8')).toBe('');
  if(kind==='FORM')expect(await f.receipts()).toContainEqual({key:'private-form',value:{action:'save',name:'PRIVATE_FORM_RESULT',tokenLength:19}});
  const main=JSON.stringify(await f.app.store.load(f.host.core.sessionId,f.cwd));expect(main).not.toMatch(/PRIVATE_CHILD_TOKEN|PRIVATE_FORM_RESULT/);
  f.host.publicRender.slot('session')?.measure({columns:80,rows:20,visible:true,scrollOffset:0});
  f.host.publicRender.slot('status')?.measure({columns:178,rows:2,visible:true,scrollOffset:0});
  await expect.poll(async()=>(await readFile(f.publicTrace,'utf8')).length).toBeGreaterThan(0);
  expect(await readFile(f.publicTrace,'utf8')).not.toMatch(/CHILD_PRIVATE_QUESTION|PRIVATE_CHILD_TOKEN|PRIVATE_FORM_RESULT|SELECTED_CHILD_FRAME/);
});

it('keeps five same-alias sibling questions independent while Main waits and settings retain an effect slot',async()=>{
  const f=await fixture(),main=f.host.submit('MAIN_HOLD');await expect.poll(()=>f.host.session.snapshot().interaction?.kind).toBe('question');
  const mainId=f.host.session.snapshot().interaction!.id;await f.host.submit('/child-many QUESTION 5');
  await expect.poll(()=>f.children().length).toBe(5);const sources=[...f.children()];
  expect(new Set(sources.map(source=>source.id)).size).toBe(5);expect(new Set(sources.map(source=>source.snapshot().title)).size).toBe(5);
  for(const source of sources){expect(source.snapshot().title).toContain('same-alias');expect(source.snapshot().title).not.toContain('CHILD_');}
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId);
  await f.host.submit('/child-settings');await expect.poll(()=>f.host.surfaces.snapshot().some(source=>source.snapshot().form?.request.title==='Settings remain usable')).toBe(true);
  const settings=f.host.surfaces.snapshot().find(source=>source.snapshot().form?.request.title==='Settings remain usable')!;
  f.answered(settings,{action:'save',values:{name:'Settings'}});await expect.poll(async()=>(await f.receipts()).some(row=>row.key==='settings')).toBe(true);
  const first=sources[0],id=first.snapshot().interaction!.id;f.focus(first);
  expect(f.input(first,{kind:'cancel-interaction',id})).toMatchObject({status:'accepted'});await expect.poll(()=>f.children().length).toBe(4);
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId);
  for(const source of sources.slice(1)){expect(source.snapshot().interaction).toBeDefined();f.answered(source,{answers:[{id:'answer',selected:['Remote']}]});}
  await expect.poll(()=>f.children().length).toBe(0);f.layout.act({type:'open',id:'session'});
  f.host.session.answerInteraction!(mainId,{answers:[{id:'answer',selected:['Keep']}]});await main;
  expect(f.host.session.snapshot().messages.filter(message=>message.role==='user').map(message=>message.text)).toEqual(['MAIN_HOLD']);
});

it('fences hidden, foreign and retired answers through the broker and reopens the same child request',async()=>{
  const f=await fixture(),main=f.host.submit('MAIN_HOLD');await expect.poll(()=>f.host.session.snapshot().interaction).toBeDefined();
  const mainId=f.host.session.snapshot().interaction!.id;
  await f.host.submit('/child-many APPROVAL 2');await expect.poll(()=>f.children().length).toBe(2);
  const [first,second]=f.children(),one=first.snapshot().approval!.id,two=second.snapshot().approval!.id;
  const oldPort=f.state().state.surfaces.find(source=>source.id===first.id)!.port;f.focus(first);f.layout.act({type:'close'});
  expect(f.input(first,{kind:'approval',id:one,allow:true})).toMatchObject({status:'rejected'});
  f.focus(first);expect(first.snapshot().approval?.id).toBe(one);
  expect(f.input(first,{kind:'approval',id:two,allow:true})).toMatchObject({status:'rejected'});
  expect(f.input(second,{kind:'approval',id:two,allow:true})).toMatchObject({status:'rejected'});
  expect(f.input(first,{kind:'approval',id:one,allow:true})).toMatchObject({status:'accepted'});
  await expect.poll(()=>f.children().length).toBe(1);expect(second.snapshot().approval?.id).toBe(two);
  expect(f.input(first,{kind:'approval',id:one,allow:true},oldPort)).toMatchObject({status:'rejected'});
  f.focus(second);expect(f.input(second,{kind:'approval',id:two,allow:false})).toMatchObject({status:'accepted'});
  await expect.poll(()=>f.children().length).toBe(0);expect((await readFile(f.effects,'utf8')).trim().split('\n')).toHaveLength(1);
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId);f.layout.act({type:'open',id:'session'});
  f.host.session.answerInteraction!(mainId,{answers:[{id:'answer',selected:['Keep']}]});await main;
});

it('binds selected child controllers to the actual source registry and revokes only that source owner',async()=>{
  const f=await fixture(true);await f.host.submit('/child-many QUESTION 2');await expect.poll(()=>f.children().length).toBe(2);
  const contexts=f.contexts.filter(context=>context.origin.depth===1);expect(contexts).toHaveLength(2);
  expect(new Set(contexts.map(context=>context.host.controllers)).size).toBe(2);
  for(const context of contexts)expect(context.host.controllers).not.toBe(f.host.core.host.controllers);
  const sources=[...f.children()];for(const source of sources){expect(source.snapshot().view).toBeUndefined();expect(source.snapshot().controller?.view.lines[0].text).toContain('SELECTED_CHILD_FRAME');}
  contexts[0].host.unregisterPlugin('child-selected');await expect.poll(()=>f.children().length).toBe(1);
  const survivor=f.children()[0];expect(survivor.snapshot().controller).toBeDefined();f.focus(survivor);
  const frame=survivor.snapshot().controller!;
  expect(f.input(survivor,{kind:'controller-input',id:frame.id,input:{kind:'action',action:'answer'},revision:frame.revision})).toMatchObject({status:'accepted'});
  await expect.poll(()=>f.children().length).toBe(0);
  expect(f.host.core.host.hasPlugin('child-selected')).toBe(true);
});

it('shows the exact direct parent for a nested child and cleans up pending child input on shutdown',async()=>{
  const f=await fixture(),run=f.host.submit('TASK_NESTED');await expect.poll(()=>f.children().length).toBe(1);
  const leaf=f.contexts.find(context=>context.origin.depth===2)!;expect(leaf).toBeDefined();
  const source=f.children()[0];expect(source.snapshot().title).toContain('Parent');
  expect(source.snapshot().title).not.toContain('CHILD_');expect(leaf.origin.parent!.agentId).toBeDefined();
  expect(source.snapshot().title).toContain(leaf.origin.parent!.agentId!);
  const oldPort=f.state().state.surfaces.find(value=>value.id===source.id)!.port,request=source.snapshot().interaction!.id;
  await f.host.close();await run;expect(leaf.signal.aborted).toBe(true);expect(f.children()).toEqual([]);
  expect(f.input(source,{kind:'interaction',id:request,value:{answers:[{id:'answer',selected:['Remote']}] }},oldPort)).toMatchObject({status:'rejected'});
});

it.each(['background','detached'] as const)('keeps an explicit %s child independent after its launcher settles',async mode=>{
  const f=await fixture(),main=f.host.submit('MAIN_HOLD');await expect.poll(()=>f.host.session.snapshot().interaction).toBeDefined();
  const mainId=f.host.session.snapshot().interaction!.id;f.layout.act({type:'open',id:'session'});
  await f.host.submit('/child-many QUESTION 1 '+mode);
  await expect.poll(async()=>(await f.receipts()).some(row=>row.key==='launcher-'+mode)).toBe(true);
  await expect.poll(()=>f.children().length).toBe(1);const source=f.children()[0];
  expect(f.host.session.snapshot().interaction?.id).toBe(mainId);expect(f.layout.snapshot().focused).toBe('session');
  expect(source.snapshot().title).toContain('Agent');f.answered(source,{answers:[{id:'answer',selected:['Remote']}]});
  await expect.poll(()=>f.children().length).toBe(0);expect(f.host.session.snapshot().interaction?.id).toBe(mainId);
  f.layout.act({type:'open',id:'session'});f.host.session.answerInteraction!(mainId,{answers:[{id:'answer',selected:['Keep']}]});await main;
});

it('keeps source aliases literal and revokes detached requests when an idle saved Core is replaced',async()=>{
  const f=await fixture();await f.host.submit('SAVED_CONTEXT');
  const literal='A'.repeat(47)+'😀',alias='A'.repeat(23)+'\n'+'A'.repeat(24)+'😀\x1b[31m\u202ealias';
  await f.host.submit('/child-many QUESTION 1 detached '+alias);
  await expect.poll(()=>f.children().length).toBe(1);await expect.poll(()=>f.host.core.hasActiveOperations).toBe(false);
  const source=f.children()[0],old=f.host.core,port=f.state().state.surfaces.find(value=>value.id===source.id)!.port;
  const request=source.snapshot().interaction!.id,context=f.contexts.find(value=>value.origin.depth===1)!;
  expect(source.snapshot().title).not.toMatch(/[\p{Cc}\p{Bidi_Control}\p{Cs}]/u);expect(source.snapshot().title).toContain(literal);
  expect(source.snapshot().title).not.toContain('CHILD_');
  await old.host.emit('service.session.control',{action:'resume',id:old.sessionId});
  await expect.poll(()=>f.host.core!==old).toBe(true);expect(f.children()).toEqual([]);expect(context.signal.aborted).toBe(true);
  expect(f.input(source,{kind:'interaction',id:request,value:{answers:[{id:'answer',selected:['Remote']}]}},port)).toMatchObject({status:'rejected'});
});

it('rejects an expired ordinary child handle inside a fresh UI action without falling through Main',async()=>{
  const f=await fixture(),main=f.host.submit('MAIN_HOLD');await expect.poll(()=>f.host.session.snapshot().interaction).toBeDefined();
  const mainId=f.host.session.snapshot().interaction!.id;await f.host.submit('/child-stale-start');
  await expect.poll(async()=>(await f.receipts()).some(row=>row.key==='stale-captured')).toBe(true);
  await expect.poll(()=>f.host.core.hasActiveOperations).toBe(false);await f.host.submit('/child-stale-trigger');
  await expect.poll(async()=>(await f.receipts()).some(row=>row.key==='stale-denied'&&row.value===true)).toBe(true);
  await expect.poll(()=>f.host.surfaces.snapshot().some(source=>source.snapshot().form?.request.title==='Current after expired child')).toBe(true);
  expect(f.children()).toEqual([]);expect(f.host.session.snapshot().interaction?.id).toBe(mainId);
  expect(f.host.surfaces.snapshot().some(source=>source.snapshot().form?.request.title==='Expired child form')).toBe(false);
  const current=f.host.surfaces.snapshot().find(source=>source.snapshot().form?.request.title==='Current after expired child')!;
  f.answered(current,{action:'save',values:{name:'Current'}});await expect.poll(async()=>(await f.receipts()).some(row=>row.key==='fresh-form')).toBe(true);
  f.layout.act({type:'open',id:'session'});f.host.session.answerInteraction!(mainId,{answers:[{id:'answer',selected:['Keep']}]});await main;
});

it.each([false,true])('renews only its focused live child continuation intent (newer navigation: %s)',async newerNavigation=>{
  const f=await fixture();await f.host.submit('/child-focus'+(newerNavigation?' hold':''));
  await expect.poll(()=>f.children().length).toBe(1);const source=f.children()[0];
  f.answered(source,{answers:[{id:'answer',selected:['Remote']}]});
  await expect.poll(async()=>(await f.receipts()).some(row=>row.key==='focus-child-answered')).toBe(true);
  if(newerNavigation){f.layout.act({type:'workspace',id:3});await writeFile(join(f.cwd,'focus-release'),'ready');}
  const result='plugin-child-probe-focus-result';await expect.poll(()=>f.host.surfaces.snapshot().some(value=>value.id===result)).toBe(true);
  if(newerNavigation){expect(f.layout.snapshot().workspace).toBe(3);expect(f.layout.snapshot().focused).not.toBe(result);}
  else expect(f.layout.snapshot().focused).toBe(result);
});
