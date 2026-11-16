import {describe,expect,it} from 'vitest';
import {decodeLine,encodeMessage,hello,COMPOSER_MEDIA_STATUS,nativeProtocolElements,type NativeState,type NativeInputMessage,type NativeReceiptMessage,type WireMessage} from '@agent-compositor/protocol';
import {createNativePresentationClient} from '../src/native-client.js';

function initial():NativeState {
  return {sessions:[{port:'main-port',id:'journal',conversationId:'main',generation:1,paneId:'session',label:'Main',current:true,
    methods:['interrupt','answerApproval','answerInteraction','cancelInteraction','controllerInput','controllerViewport','cancelController','editorInput','editorViewport'],
    snapshot:{messages:[],running:false}}],windows:[{id:'session',label:'Main',session:'main-port'}],surfaces:[],publicRender:[],immediateCommands:['/chat','/settings'],
    layout:{revision:1,width:100,height:30,frames:[{surface:'session',x:0,y:0,width:100,height:30}],focused:'session',workspace:1,workspaces:[1],
      locations:{session:1},axis:'horizontal',fullscreen:false,compact:false,pointer:'default'},
    navigation:{revision:1,mode:'normal',query:'',entries:[]},appearance:{revision:1,appearance:{}}};
}
const coreHello=(mediaStatus=false)=>hello('core',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements,...(mediaStatus?[COMPOSER_MEDIA_STATUS]:[])],encodings:['jsonl']});
function transport(options:{deferred?:boolean;state?:NativeState;mediaStatus?:boolean;consume?:(input:NativeInputMessage)=>boolean}={}){
  let state=options.state??initial(),epoch='epoch-one',revision=0;
  const inputs:NativeInputMessage[]=[],outgoing:WireMessage[]=[];
  const client=createNativePresentationClient(message=>{
    // Every direction uses the real codec: no functions or shared DTO aliases.
    const decoded=decodeLine(encodeMessage(message));outgoing.push(decoded);
    if(decoded.type==='hello'){receive(coreHello(options.mediaStatus));receive({type:'hello-ack',ok:true,version:'0.7.0'});publish();}
    if(decoded.type==='native-input'){inputs.push(decoded);if(!options.deferred)receipt(decoded.id,{consumed:options.consume?.(decoded)??false});}
  });
  function receive(message:WireMessage){client.receive(decodeLine(encodeMessage(message)));}
  function publish(next=state,version=++revision,wireEpoch=epoch){state=next;revision=Math.max(revision,version);receive({type:'native-state',epoch:wireEpoch,revision:version,state:next});}
  function receipt(id:number,fields:Partial<NativeReceiptMessage>={}){receive({type:'native-receipt',epoch,id,status:'accepted',...fields});}
  client.hello();
  return {client,inputs,outgoing,receive,publish,receipt,get state(){return state;},setEpoch(value:string){epoch=value;revision=0;}};
}
function controller(inputRevision=0,value=''){
  return {id:'request-one',kind:'form' as const,revision:1,inputRevision,preferredRows:3,
    view:{lines:[{text:'Private form',cells:[{ch:'窗',bold:true}]}],input:{id:'field',value}}};
}
function withController(){const state=initial();state.sessions[0].snapshot.controller=controller();return state;}
function frame(t:ReturnType<typeof transport>){return t.client.sessions()[0].snapshot().controller!;}
const tick=()=>new Promise<void>(resolve=>queueMicrotask(resolve));

describe('native presentation client',()=>{
  it('negotiates before publishing, and preserves local sources and unchanged snapshot identities',async()=>{
    const t=transport();await t.client.ready;
    const main=t.client.sessions()[0],snapshot=main.snapshot(),windows=t.client.conversationWindows.snapshot(),layout=t.client.windowLayout.snapshot();
    expect(t.outgoing[0]).toMatchObject({type:'hello',role:'renderer',capabilities:{elements:expect.arrayContaining([...nativeProtocolElements])}});
    let changes=0;main.subscribe(()=>changes++);t.publish(structuredClone(t.state));
    expect(t.client.sessions()[0]).toBe(main);expect(main.snapshot()).toBe(snapshot);
    expect(t.client.conversationWindows.snapshot()).toBe(windows);expect(t.client.windowLayout.snapshot()).toBe(layout);expect(changes).toBe(0);
    expect(main.isImmediateCommand?.(' /settings more ')).toBe(true);expect(main.isImmediateCommand?.('hello')).toBe(false);
    expect(Object.isFrozen(main.snapshot())).toBe(true);expect(Object.isFrozen(main.snapshot().messages)).toBe(true);
    t.client.close();
  });

  it('exposes draft changes only when the host offers the method',async()=>{
    const state=initial();state.sessions[0].methods!.push('draftChange');
    state.sessions[0].snapshot.draft={revision:3,text:'private',status:'review'};
    const t=transport({state,deferred:true}),main=t.client.sessions()[0];
    expect(main.snapshot().draft).toEqual({revision:3,text:'private',status:'review'});
    const result=main.draftChange!('edited',3);
    expect(t.inputs.at(-1)?.operation).toEqual({kind:'draft-change',text:'edited',revision:3});
    t.receipt(t.inputs.at(-1)!.id,{status:'rejected'});expect(await result).toBe(false);
    const next=structuredClone(state);next.sessions[0].methods=next.sessions[0].methods!.filter(method=>method!=='draftChange');
    t.publish(next);expect(main.draftChange).toBeUndefined();t.client.close();
  });

  it('exposes negotiated review actions and preserves their exact versions',async()=>{
    const state=initial();state.sessions[0].methods!.push('draftReview','draftResolve','draftRefresh');
    state.sessions[0].snapshot.draft={revision:4,text:'',status:'conflict',variants:[{id:'writer:1',kind:'draft',text:'private'}]};
    const t=transport({state,deferred:true}),main=t.client.sessions()[0];
    expect(main.snapshot().draft?.variants).toEqual([{id:'writer:1',kind:'draft',text:'private'}]);
    const choice=main.draftResolve!(['writer:1'],'selected',4);
    expect(t.inputs.at(-1)?.operation).toEqual({kind:'draft-resolve',ids:['writer:1'],text:'selected',revision:4});
    t.receipt(t.inputs.at(-1)!.id);expect(await choice).toBe(true);
    const review=main.draftReview!(5);expect(t.inputs.at(-1)?.operation).toEqual({kind:'draft-review',revision:5});
    t.receipt(t.inputs.at(-1)!.id,{status:'rejected'});expect(await review).toBe(false);
    const refresh=main.draftRefresh!(6);expect(t.inputs.at(-1)?.operation).toEqual({kind:'draft-refresh',revision:6});
    t.receipt(t.inputs.at(-1)!.id);expect(await refresh).toBe(true);t.client.close();
  });

  it('retains synchronous submit admission and navigation consumed semantics',()=>{
    const t=transport({consume:input=>input.operation.kind==='navigation-handle'&&input.operation.input.kind==='key'&&input.operation.input.key==='F2'});
    expect(t.client.sessions()[0].submit('draft 窗')).toBe(true);
    expect(t.client.navigation.handle({kind:'key',key:'a',text:'a'})).toBe(false);
    expect(t.client.navigation.handle({kind:'key',key:'F2'})).toBe(true);
    expect(t.inputs.map(value=>value.operation)).toEqual([{kind:'submit',text:'draft 窗'},
      {kind:'navigation-handle',input:{kind:'key',key:'a',text:'a'}},{kind:'navigation-handle',input:{kind:'key',key:'F2'}}]);
    expect(t.client.pending()).toBe(false);t.client.close();
  });

  it('waits only for asynchronous admission, preserves a rejected draft and drops rejected navigation input',async()=>{
    const t=transport({deferred:true}),main=t.client.sessions()[0];let draft='unsent 窗';
    const result=main.submit(draft);expect(result).toBeInstanceOf(Promise);
    const cleared=Promise.resolve(result).then(accepted=>{if(accepted)draft='';});
    let settled=false;void t.client.settled().then(()=>{settled=true;});await tick();
    expect(t.client.pending()).toBe(true);expect(settled).toBe(false);expect(draft).toBe('unsent 窗');
    t.receipt(t.inputs[0].id,{status:'rejected'});await cleared;await t.client.settled();expect(draft).toBe('unsent 窗');
    const navigation=t.client.navigation.handle({kind:'key',key:'a'});t.receipt(t.inputs[1].id,{status:'rejected'});
    expect(await navigation).toBe(true);expect(settled).toBe(true);
    const accepted=main.submit(draft);t.receipt(t.inputs[2].id);expect(await accepted).toBe(true);
    // A running model state has no bearing on input admission settlement.
    const next=structuredClone(t.state);next.sessions[0].snapshot.running=true;t.publish(next);expect(t.client.pending()).toBe(false);t.client.close();
  });

  it('keeps all copies but deduplicates resident conversations and ignores opaque-port churn in the input generation',async()=>{
    const t=transport(),generation=t.client.generation(),old=t.client.sessions()[0];
    const next=structuredClone(t.state);next.sessions=[{...next.sessions[0],port:'replacement-copy-ports'},
      {...next.sessions[0],port:'copy-port',paneId:'window-1'}];
    next.windows=[{id:'window-1',label:'Main 1',session:'copy-port'},{id:'session',label:'Main',session:'replacement-copy-ports'}];
    t.publish(next);expect(t.client.conversationWindows.snapshot()).toHaveLength(2);expect(t.client.sessions()).toHaveLength(1);
    expect(t.client.sessions()[0].paneId).toBe('session');expect(t.client.generation()).toBe(generation);
    expect(old.isCurrent?.()).toBe(false);expect(old.submit('retained')).toBe(false);
    next.sessions=next.sessions.map(value=>({...value,generation:2}));t.publish(structuredClone(next));expect(t.client.generation()).not.toBe(generation);
    t.client.close();
  });

  it('does not retroactively reject admitted input when its own effect rebuilds ports before the receipt',async()=>{
    const t=transport({deferred:true}),old=t.client.sessions()[0],accepted=old.submit('/new-window');
    const next=structuredClone(t.state);next.sessions[0].port='new-port';next.windows[0].session='new-port';t.publish(next);
    expect(old.submit('stale')).toBe(false);expect(t.client.pending()).toBe(true);
    t.receipt(t.inputs[0].id);expect(await accepted).toBe(true);expect(t.inputs).toHaveLength(1);t.client.close();
  });

  it('fences old epochs, state revisions and receipts, allowing replacement only after a fresh Core hello',async()=>{
    const t=transport({deferred:true}),main=t.client.sessions()[0],pending=main.submit('old'),generation=t.client.generation();
    const old=structuredClone(t.state),replacement=initial();replacement.sessions[0].id='new-journal';
    t.publish(replacement,2,'epoch-two');expect(t.client.sessions()[0]).toBe(main);
    t.receive(coreHello());t.setEpoch('epoch-two');t.publish(replacement,1);
    expect(await pending).toBe(false);expect(main.submit('stale')).toBe(false);expect(t.client.generation()).not.toBe(generation);
    const current=t.client.sessions()[0];t.publish(old,999,'epoch-one');expect(t.client.sessions()[0]).toBe(current);
    const update=structuredClone(replacement);update.sessions[0].snapshot.notice='new';t.publish(update,3);t.publish(replacement,2);
    expect(current.snapshot().notice).toBe('new');
    const input=current.submit('new');t.receive({type:'native-receipt',epoch:'epoch-one',id:t.inputs.at(-1)!.id,status:'accepted'});
    expect(t.client.pending()).toBe(true);t.receipt(t.inputs.at(-1)!.id);expect(await input).toBe(true);t.client.close();
  });

  it('maps host controller tickets to local FIFO acknowledgements without rewinding later typed text',async()=>{
    const t=transport({deferred:true,state:withController()}),main=t.client.sessions()[0];
    expect(main.controllerInput?.('wrong',{kind:'text',text:'secret'},1)).toBeUndefined();
    expect(main.controllerInput?.('request-one',{kind:'change',id:'field',value:'A'},1)).toBe(1);
    expect(main.controllerInput?.('request-one',{kind:'change',id:'field',value:'AB'},1)).toBe(2);
    t.receipt(t.inputs[0].id,{ticket:41});t.receipt(t.inputs[1].id,{ticket:42});await tick();
    let next=structuredClone(t.state);next.sessions[0].snapshot.controller=controller(40,'');t.publish(next);
    expect(frame(t).inputRevision).toBe(0);
    // Mid-handler invalidation cannot acknowledge even one input.
    next=structuredClone(t.state);next.sessions[0].snapshot.controller={...controller(40,'partial'),revision:2};t.publish(next);expect(frame(t).inputRevision).toBe(0);
    next=structuredClone(t.state);next.sessions[0].snapshot.controller={...controller(41,'A'),revision:3};t.publish(next);expect(frame(t).inputRevision).toBe(1);
    next=structuredClone(t.state);next.sessions[0].snapshot.controller={...controller(42,'AB'),revision:4};t.publish(next);expect(frame(t).inputRevision).toBe(2);
    expect(frame(t).view.lines[0].cells).toEqual([{ch:'窗',bold:true}]);expect(t.client.pending()).toBe(false);t.client.close();
  });

  it('reconciles a completed frame received before its admission receipt, including a rebuilt copy port',async()=>{
    const t=transport({deferred:true,state:withController()}),old=t.client.sessions()[0];
    expect(old.controllerInput?.('request-one',{kind:'text',text:'A'},1)).toBe(1);
    const next=structuredClone(t.state);next.sessions[0]={...next.sessions[0],port:'new-main-port',snapshot:{...next.sessions[0].snapshot,controller:controller(21,'A')}};
    next.windows[0].session='new-main-port';t.publish(next);expect(frame(t).inputRevision).toBe(0);
    t.receipt(t.inputs[0].id,{ticket:21});await tick();expect(frame(t).inputRevision).toBe(1);
    expect(old.controllerInput?.('request-one',{kind:'text',text:'stale'},1)).toBeUndefined();t.client.close();
  });

  it('does not let a rejected later input acknowledge an earlier handler, and releases rejected fields after the prefix finishes',async()=>{
    const t=transport({deferred:true,state:withController()}),main=t.client.sessions()[0];
    main.controllerInput?.('request-one',{kind:'text',text:'A'},1);main.controllerInput?.('request-one',{kind:'text',text:'B'},1);
    t.receipt(t.inputs[1].id,{status:'rejected'});await tick();expect(frame(t).inputRevision).toBe(0);
    t.receipt(t.inputs[0].id,{ticket:4});await tick();expect(frame(t).inputRevision).toBe(0);
    const next=structuredClone(t.state);next.sessions[0].snapshot.controller=controller(4,'A');t.publish(next);expect(frame(t).inputRevision).toBe(2);
    // A rejected only input also produces an immediate local ACK.
    expect(main.controllerInput?.('request-one',{kind:'text',text:'C'},1)).toBe(3);
    t.receipt(t.inputs[2].id,{status:'rejected'});await tick();expect(frame(t).inputRevision).toBe(3);t.client.close();
  });

  it('keeps selected editor tickets independent from controller successors and validates displayed revisions',async()=>{
    const state=withController();state.sessions[0].snapshot.editor={...controller(25,'draft'),id:'editor-one',kind:'editor',available:true};
    const t=transport({deferred:true,state}),main=t.client.sessions()[0];
    expect(main.editorInput?.('editor-one',{kind:'key',key:'F2'},0)).toBeUndefined();
    expect(main.editorInput?.('editor-one',{kind:'key',key:'F2'},1)).toBe(1);
    main.editorViewport?.('editor-one',80,3,19);expect(t.inputs[1].operation).toEqual({kind:'editor-viewport',id:'editor-one',columns:80,rows:3,maxRows:19});
    t.receipt(t.inputs[0].id,{ticket:26});t.receipt(t.inputs[1].id);await tick();
    const next=structuredClone(t.state);next.sessions[0].snapshot.editor!.inputRevision=26;next.sessions[0].snapshot.controller={...controller(),id:'successor'};t.publish(next);
    expect(main.snapshot().editor!.inputRevision).toBe(1);expect(main.snapshot().controller!.inputRevision).toBe(0);
    expect(main.controllerInput?.('request-one',{kind:'text',text:'stale'},1)).toBeUndefined();t.client.close();
  });

  it('retires absent controller/editor bookkeeping so a reintroduced frame starts with a fresh local ticket',async()=>{
    const state=withController();state.sessions[0].snapshot.editor={...controller(),id:'editor-one',kind:'editor',available:true};
    const t=transport({deferred:true,state}),main=t.client.sessions()[0];
    expect(main.controllerInput?.('request-one',{kind:'text',text:'old question'},1)).toBe(1);
    expect(main.editorInput?.('editor-one',{kind:'text',text:'old editor'},1)).toBe(1);
    t.receipt(t.inputs[0].id,{ticket:11});t.receipt(t.inputs[1].id,{ticket:12});await tick();
    const completed=structuredClone(state);completed.sessions[0].snapshot.controller!.inputRevision=11;completed.sessions[0].snapshot.editor!.inputRevision=12;t.publish(completed);
    expect(main.snapshot().controller!.inputRevision).toBe(1);expect(main.snapshot().editor!.inputRevision).toBe(1);
    const removed=structuredClone(completed);delete removed.sessions[0].snapshot.controller;delete removed.sessions[0].snapshot.editor;t.publish(removed);
    t.publish(structuredClone(state));
    expect(main.snapshot().controller!.inputRevision).toBe(0);expect(main.snapshot().editor!.inputRevision).toBe(0);
    expect(main.controllerInput?.('request-one',{kind:'text',text:'fresh question'},1)).toBe(1);
    expect(main.editorInput?.('editor-one',{kind:'text',text:'fresh editor'},1)).toBe(1);t.client.close();
  });

  it('keeps late admitted receipts detached from a retired surface frame and its same-ID successor',async()=>{
    const state=initial();state.surfaces=[{port:'private-port',id:'private-request',methods:['controllerInput'],snapshot:{revision:1,title:'Private',controller:controller()}}];
    const t=transport({deferred:true,state}),surface=t.client.surfaces.snapshot()[0];
    expect(surface.controllerInput?.('request-one',{kind:'text',text:'retired'},1)).toBe(1);
    const absent=structuredClone(state);delete absent.surfaces[0].snapshot.controller;t.publish(absent);t.publish(structuredClone(state));
    expect(surface.controllerInput?.('request-one',{kind:'text',text:'successor'},1)).toBe(1);
    const current=surface.snapshot();let changes=0;surface.subscribe(()=>changes++);
    t.receipt(t.inputs[0].id,{ticket:0});await tick();
    expect(surface.snapshot()).toBe(current);expect(surface.snapshot().controller!.inputRevision).toBe(0);expect(changes).toBe(0);
    t.receipt(t.inputs[1].id,{ticket:20});await tick();
    const completed=structuredClone(state);completed.surfaces[0].snapshot.controller!.inputRevision=20;t.publish(completed);
    expect(surface.snapshot().controller!.inputRevision).toBe(1);expect(t.client.pending()).toBe(false);t.client.close();
  });

  it('retains hidden resident frame continuity across Main copy-port churn without treating visibility as retirement',async()=>{
    const state=withController();state.sessions[0].snapshot.editor={...controller(),id:'editor-one',kind:'editor',available:true};
    state.surfaces=[{port:'private-port',id:'private-request',methods:['controllerInput'],snapshot:{revision:1,title:'Private',controller:controller()}}];
    const t=transport({deferred:true,state}),main=t.client.sessions()[0],surface=t.client.surfaces.snapshot()[0];
    main.controllerInput?.('request-one',{kind:'text',text:'question'},1);main.editorInput?.('editor-one',{kind:'text',text:'editor'},1);
    surface.controllerInput?.('request-one',{kind:'text',text:'private'},1);
    t.receipt(t.inputs[0].id,{ticket:10});t.receipt(t.inputs[1].id,{ticket:20});t.receipt(t.inputs[2].id,{ticket:30});await tick();
    const hidden=structuredClone(state);hidden.layout.frames=[];hidden.layout.workspace=9;
    hidden.sessions[0].snapshot.controller!.inputRevision=10;hidden.sessions[0].snapshot.editor!.inputRevision=20;
    hidden.surfaces[0].snapshot.controller!.inputRevision=30;t.publish(hidden);
    expect(main.snapshot().controller!.inputRevision).toBe(1);expect(main.snapshot().editor!.inputRevision).toBe(1);
    expect(surface.snapshot().controller!.inputRevision).toBe(1);
    const copied=structuredClone(hidden);copied.sessions=[{...copied.sessions[0],port:'new-main-port'},
      {...structuredClone(copied.sessions[0]),port:'copy-port',paneId:'window-1'}];
    copied.windows=[{id:'session',label:'Main',session:'new-main-port'},{id:'window-1',label:'Main 1',session:'copy-port'}];t.publish(copied);
    const current=t.client.sessions()[0];expect(main.isCurrent?.()).toBe(false);
    expect(current.controllerInput?.('request-one',{kind:'text',text:'second question'},1)).toBe(2);
    expect(current.editorInput?.('editor-one',{kind:'text',text:'second editor'},1)).toBe(2);
    expect(surface.controllerInput?.('request-one',{kind:'text',text:'second private'},1)).toBe(2);t.client.close();
  });

  it('retains surface/public ports, sends producer identities, and fences removed/old displayed callbacks',()=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',methods:['answerInteraction','cancelInteraction','controllerInput'],snapshot:{revision:2,title:'Tools',view:{lines:[{text:'Action',action:'run'}]}}}];
    state.publicRender=[{port:'public-port',id:'session',revision:4,defaultView:{lines:[{text:'default'}]},override:{lines:[{text:'override',action:'extra'}]}}];
    const t=transport({state}),surface=t.client.surfaces.snapshot()[0],slot=t.client.publicRender.slot('session')!;
    expect(t.client.publicRender.slot('absent')).toBeUndefined();const snap=slot.snapshot();t.publish(structuredClone(state));expect(slot.snapshot()).toBe(snap);
    surface.press('run',1);slot.press('extra',3);expect(t.inputs).toHaveLength(0);
    surface.press('run',2);surface.change('query','value',2);slot.measure({columns:60,rows:20,visible:true,scrollOffset:9,scrollOrigin:'input'});slot.press('extra',4);
    expect(t.inputs.map(value=>[value.target,value.operation.kind])).toEqual([['tools-port','surface-press'],['tools-port','surface-change'],['public-port','public-measure'],['public-port','public-press']]);
    const next=structuredClone(state);next.surfaces=[];next.publicRender=[];t.publish(next);
    surface.press('run',2);slot.press('extra',4);expect(t.inputs).toHaveLength(4);expect(t.client.publicRender.slot('session')).toBeUndefined();t.client.close();
  });

  it('retries only the latest still-focused surface edit after a revision rejection',async()=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',snapshot:{revision:2,title:'Tools',view:{lines:[],input:{id:'reply',value:''}}}}];
    state.layout.frames=[{surface:'tools',x:0,y:0,width:100,height:30}];state.layout.focused='tools';state.layout.locations={tools:1};
    const t=transport({state,deferred:true}),surface=t.client.surfaces.snapshot()[0];
    surface.change('reply','first',2);surface.change('reply','latest',2);expect(t.client.pending()).toBe(true);
    const next=structuredClone(state);next.surfaces[0].snapshot.revision=3;t.publish(next);
    t.receipt(t.inputs[0].id,{status:'rejected'});await tick();expect(t.inputs).toHaveLength(2);
    t.receipt(t.inputs[1].id,{status:'rejected'});await tick();expect(t.inputs).toHaveLength(3);
    expect(t.inputs[2].operation).toMatchObject({kind:'surface-change',field:'reply',value:'latest',revision:3});
    let settled=false;void t.client.settled().then(()=>{settled=true;});await tick();expect(settled).toBe(false);
    t.receipt(t.inputs[2].id);await t.client.settled();expect(settled).toBe(true);
    surface.change('reply','no retry',3);const changed=structuredClone(next);changed.surfaces[0].snapshot.revision=4;changed.surfaces[0].snapshot.view!.input!.id='replacement';t.publish(changed);
    t.receipt(t.inputs[3].id,{status:'rejected'});await t.client.settled();expect(t.inputs).toHaveLength(4);t.client.close();
  });
  it('preserves the last edit when Enter races an earlier published prefix',async()=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',snapshot:{revision:2,title:'Tools',view:{lines:[{text:'Send',action:'send'}],input:{id:'reply',value:'',submitAction:'send'}}}}];
    state.layout.frames=[{surface:'tools',x:0,y:0,width:100,height:30}];state.layout.focused='tools';state.layout.locations={tools:1};
    const t=transport({state,deferred:true}),surface=t.client.surfaces.snapshot()[0];
    surface.change('reply','AB',2);surface.change('reply','ABC',2);surface.press('send',2);surface.press('send',2);
    expect(t.inputs.map(input=>input.operation.kind)).toEqual(['surface-change','surface-change']);
    const next=structuredClone(state);next.surfaces[0].snapshot.revision=3;next.surfaces[0].snapshot.view!.input!.value='AB';t.publish(next);
    t.receipt(t.inputs[0].id);t.receipt(t.inputs[1].id,{status:'rejected'});await tick();
    expect(t.inputs[2].operation).toMatchObject({kind:'surface-change',value:'ABC',revision:3});
    t.receipt(t.inputs[2].id);await tick();
    expect(t.inputs[3].operation).toMatchObject({kind:'surface-press',action:'send',revision:3});
    t.receipt(t.inputs[3].id);await t.client.settled();t.client.close();
  });
  it.each(['rejected','focus','new edit'] as const)('does not submit an edit after %s',async reason=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',snapshot:{revision:2,title:'Tools',view:{lines:[{text:'Send',action:'send'}],input:{id:'reply',value:'',submitAction:'send'}}}}];
    state.layout.frames=[{surface:'tools',x:0,y:0,width:100,height:30}];state.layout.focused='tools';state.layout.locations={tools:1};
    const t=transport({state,deferred:true}),surface=t.client.surfaces.snapshot()[0];surface.change('reply','ABC',2);surface.press('send',2);
    if(reason==='focus'){const next=structuredClone(state);next.layout.focused='session';t.publish(next);}
    if(reason==='new edit')surface.change('reply','ABCD',2);
    t.receipt(t.inputs[0].id,{status:reason==='rejected'?'rejected':'accepted'});await tick();
    expect(t.inputs.some(input=>input.operation.kind==='surface-press')).toBe(false);
    if(reason==='new edit')t.receipt(t.inputs[1].id);await t.client.settled();t.client.close();
  });
  it('bounds retries and reports an edit that remains rejected',async()=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',snapshot:{revision:2,title:'Tools',view:{lines:[],input:{id:'reply',value:''}}}}];
    state.layout.frames=[{surface:'tools',x:0,y:0,width:100,height:30}];state.layout.focused='tools';state.layout.locations={tools:1};
    const t=transport({state,deferred:true}),surface=t.client.surfaces.snapshot()[0];surface.change('reply','value',2);
    for(let index=0;index<3;index++){
      const next=structuredClone(state);next.surfaces[0].snapshot.revision=3+index;t.publish(next);
      t.receipt(t.inputs[index].id,{status:'rejected'});await tick();
    }
    await t.client.settled();expect(t.inputs).toHaveLength(3);expect(surface.snapshot().error).toContain('Input was not saved');expect(t.client.pending()).toBe(false);t.client.close();
  });
  it('reports a rejected edit instead of overwriting a producer-replaced field value',async()=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',snapshot:{revision:2,title:'Tools',view:{lines:[],input:{id:'reply',value:'original'}}}}];
    state.layout.frames=[{surface:'tools',x:0,y:0,width:100,height:30}];state.layout.focused='tools';state.layout.locations={tools:1};
    const t=transport({state,deferred:true}),surface=t.client.surfaces.snapshot()[0];surface.change('reply','user edit',2);
    const next=structuredClone(state);next.surfaces[0].snapshot.revision=3;next.surfaces[0].snapshot.view!.input!.value='producer replacement';t.publish(next);
    t.receipt(t.inputs[0].id,{status:'rejected'});await t.client.settled();expect(t.inputs).toHaveLength(1);
    expect(surface.snapshot().error).toContain('Input was not saved');t.client.close();
  });
  it('does not retry an edit after its window loses focus or its port is retired',async()=>{
    const state=initial();state.surfaces=[{port:'tools-port',id:'tools',snapshot:{revision:2,title:'Tools',view:{lines:[],input:{id:'reply',value:''}}}}];
    state.layout.frames=[{surface:'tools',x:0,y:0,width:50,height:30},{surface:'session',x:50,y:0,width:50,height:30}];state.layout.focused='tools';state.layout.locations={tools:1,session:1};
    const t=transport({state,deferred:true}),surface=t.client.surfaces.snapshot()[0];surface.change('reply','private',2);
    const next=structuredClone(state);next.surfaces[0].snapshot.revision=3;next.layout.focused='session';t.publish(next);t.receipt(t.inputs[0].id,{status:'rejected'});await t.client.settled();expect(t.inputs).toHaveLength(1);
    next.layout.focused='tools';t.publish(structuredClone(next));surface.change('reply','other',3);next.surfaces=[];t.publish(structuredClone(next));t.receipt(t.inputs[1].id,{status:'rejected'});await t.client.settled();expect(t.inputs).toHaveLength(2);t.client.close();
  });
  it('preserves private native answer IDs/aliases without leaking non-JSON capabilities',()=>{
    const state=initial();state.sessions[0].snapshot.approval={id:'ask',tool:'exec',reason:'Manual',details:[]};
    const t=transport({state}),main=t.client.sessions()[0];main.answerApproval?.('wrong',true);main.answerApproval?.('ask',true);
    expect(t.inputs.map(value=>value.operation)).toEqual([{kind:'approval',id:'ask',allow:true}]);
    const next=structuredClone(state);delete next.sessions[0].snapshot.approval;
    next.sessions[0].snapshot.interaction={id:'form',kind:'form',plugin:'test',request:{title:'Form',fields:[{id:'name',label:'Name',type:'text'}],actions:[{id:'save',label:'Save'}]}};
    t.publish(next);main.answerInteraction?.('form',{capability:()=>{}});expect(t.inputs).toHaveLength(1);
    main.answerInteraction?.('form',{action:'save',values:{}});main.cancelInteraction?.('form');expect(t.inputs).toHaveLength(3);t.client.close();
  });

  it('sends media visibility changes once, decodes only current frames, and replays subscription on epoch replacement',()=>{
    const t=transport(),frames:(number[]|undefined)[]=[];
    const stop=t.client.composerMedia.subscribe(false,value=>frames.push(value?[...value.rgba]:undefined));
    expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:false});
    t.publish(structuredClone(t.state));t.publish(structuredClone(t.state));expect(t.inputs).toHaveLength(1);
    const rgba=btoa(String.fromCharCode(1,2,3,255));
    t.receive({type:'native-media',epoch:'wrong',revision:1,dimensions:{width:3,height:2},frame:{width:1,height:1,rgba}});
    expect(frames).toEqual([undefined]);
    t.receive({type:'native-media',epoch:'epoch-one',revision:1,dimensions:{width:3,height:2},frame:{width:1,height:1,rgba}});
    expect(frames.at(-1)).toEqual([1,2,3,255]);expect(t.client.composerMedia.dimensions?.()).toEqual({width:3,height:2});
    const stopActive=t.client.composerMedia.subscribe(true,()=>{});expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:true});
    stopActive();stop();expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:false,active:false});
    t.receive({type:'native-media',epoch:'epoch-one',revision:2,dimensions:{width:3,height:2},frame:{width:1,height:1,rgba}});expect(frames).toHaveLength(2);
    const afterHidden:(unknown)[]=[];const stopAgain=t.client.composerMedia.subscribe(false,value=>afterHidden.push(value));expect(afterHidden).toEqual([undefined]);
    t.receive(coreHello());t.setEpoch('epoch-two');t.publish(initial());expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:false});
    stopAgain();t.client.close();
  });

  it('negotiates compact status, aggregates expansion, and never delivers pixels to compact subscribers',()=>{
    const t=transport({mediaStatus:true}),compact:(unknown)[]=[],expanded:(unknown)[]=[],status:(unknown)[]=[];
    const stop=t.client.composerMedia.subscribe(false,frame=>{compact.push(frame);status.push(t.client.composerMedia.presentation?.());},{expanded:false});
    expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:false,expanded:false});
    t.receive({type:'native-media',epoch:'epoch-one',revision:1,dimensions:{width:18,height:6},presentation:{label:'Thinking 窗',alt:'Original Ghost',hasImage:true}});
    expect(compact).toEqual([undefined,undefined]);expect(status.at(-1)).toEqual({label:'Thinking 窗',alt:'Original Ghost',hasImage:true});
    const stopExpanded=t.client.composerMedia.subscribe(true,frame=>expanded.push(frame));
    expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:true,expanded:true});
    t.receive({type:'native-media',epoch:'epoch-one',revision:2,dimensions:{width:18,height:6},presentation:{label:'Searching',hasImage:true},frame:{width:1,height:1,rgba:'/wAA/w=='}});
    expect(compact.every(value=>value===undefined)).toBe(true);expect(expanded.at(-1)).toMatchObject({width:1,height:1,rgba:new Uint8Array([255,0,0,255])});
    stopExpanded();expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:false,expanded:false});
    t.receive({type:'native-media',epoch:'epoch-one',revision:3,dimensions:{width:18,height:6},presentation:{label:'Done!',hasImage:true}});
    expect(status.at(-1)).toEqual({label:'Done!',hasImage:true});expect(t.client.composerMedia.dimensions?.()).toEqual({width:18,height:6});
    stop();expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:false,active:false,expanded:false});
    expect(t.client.composerMedia.presentation?.()).toEqual({label:'Done!',hasImage:true});
    t.client.close();expect(t.client.composerMedia.presentation?.()).toBeUndefined();
  });

  it('retains bounded status across last-unsubscribe without retaining its image pixels',()=>{
    const t=transport({mediaStatus:true}),frames:(unknown)[]=[];
    const stop=t.client.composerMedia.subscribe(false,frame=>frames.push(frame));
    t.receive({type:'native-media',epoch:'epoch-one',revision:1,dimensions:{width:18,height:6},
      presentation:{label:'Ready',alt:'Original Ghost',hasImage:true},frame:{width:1,height:1,rgba:'/wAA/w=='}});
    expect(frames.at(-1)).toMatchObject({rgba:new Uint8Array([255,0,0,255])});stop();
    const presentation=t.client.composerMedia.presentation?.();
    expect(presentation).toEqual({label:'Ready',alt:'Original Ghost',hasImage:true});
    const resumed:(unknown)[]=[];
    const stopAgain=t.client.composerMedia.subscribe(false,frame=>resumed.push(frame));
    expect(resumed).toEqual([undefined]);expect(t.client.composerMedia.presentation?.()).toBe(presentation);
    stopAgain();t.client.close();expect(t.client.composerMedia.presentation?.()).toBeUndefined();
  });

  it('keeps exact legacy media messages and ignores unnegotiated presentation fields',()=>{
    const t=transport(),frames:(unknown)[]=[];
    const stop=t.client.composerMedia.subscribe(false,value=>frames.push(value),{expanded:false});
    expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:false});
    t.receive({type:'native-media',epoch:'epoch-one',revision:1,dimensions:{width:8,height:4},frame:{width:1,height:1,rgba:'/wAA/w=='},presentation:{label:'Unnegotiated',hasImage:true}});
    expect(frames).toEqual([undefined,undefined]);expect(t.client.composerMedia.presentation?.()).toBeUndefined();
    stop();expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:false,active:false});t.client.close();
  });

  it('revokes media status on epoch replacement and close without accepting retired metadata',()=>{
    const t=transport({mediaStatus:true}),status:(unknown)[]=[];
    t.client.composerMedia.subscribe(false,()=>status.push(t.client.composerMedia.presentation?.()),{expanded:false});
    t.receive({type:'native-media',epoch:'epoch-one',revision:1,dimensions:{width:18,height:6},presentation:{label:'Old producer',hasImage:true}});
    expect(status.at(-1)).toEqual({label:'Old producer',hasImage:true});
    t.receive(coreHello(true));t.setEpoch('epoch-two');t.publish(initial());expect(status.at(-1)).toBeUndefined();
    expect(t.inputs.at(-1)!.operation).toEqual({kind:'media-active',enabled:true,active:false,expanded:false});
    t.receive({type:'native-media',epoch:'epoch-one',revision:999,dimensions:{width:18,height:6},presentation:{label:'Retired',hasImage:true}});
    expect(t.client.composerMedia.presentation?.()).toBeUndefined();
    t.receive({type:'native-media',epoch:'epoch-two',revision:1,dimensions:{width:18,height:6},presentation:{label:'New producer',hasImage:false}});
    expect(status.at(-1)).toEqual({label:'New producer',hasImage:false});t.client.close();expect(status.at(-1)).toBeUndefined();
  });

  it('fails negotiation/close safely, settles pending admissions and never retargets old callbacks',async()=>{
    const t=transport({deferred:true}),main=t.client.sessions()[0],input=main.submit('held'),ctrl=t.client.onCtrlC();
    t.client.close();expect(await input).toBe(false);expect(await ctrl).toBe('handled');await t.client.settled();expect(t.client.pending()).toBe(false);
    expect(t.client.onCtrlC()).toBe('exit');expect(main.submit('closed')).toBe(false);
    const rejected=createNativePresentationClient(()=>{});rejected.hello();rejected.receive({type:'hello-ack',ok:false,reason:'private exception'});
    await expect(rejected.ready).rejects.toThrow('Native presentation negotiation failed');
    const closed=createNativePresentationClient(()=>{});closed.close();await expect(closed.ready).rejects.toThrow('closed before initial state');
  });

  it('requires both peer native capabilities and acknowledgement of its own hello before private state admission',async()=>{
    let publishOnAck=false;
    const client=createNativePresentationClient(message=>{
      if(message.type==='hello-ack'&&publishOnAck)client.receive({type:'native-state',epoch:'negotiated',revision:1,state:withController()});
    });client.hello();
    client.receive({type:'hello-ack',ok:true,version:'0.7.0'});
    client.receive({type:'native-state',epoch:'not-negotiated',revision:1,state:withController()});
    expect(client.sessions()).toEqual([]);let ready=false;void client.ready.then(()=>{ready=true;});await tick();expect(ready).toBe(false);
    // A synchronous peer may publish from inside our acknowledgement callback.
    publishOnAck=true;client.receive(coreHello());
    await client.ready;expect(client.sessions()[0].snapshot().controller?.id).toBe('request-one');client.close();
    const noAck=createNativePresentationClient(()=>{});noAck.hello();noAck.receive(coreHello());
    noAck.receive({type:'native-state',epoch:'missing-ack',revision:1,state:initial()});expect(noAck.sessions()).toEqual([]);noAck.close();
  });

  it('rejects missing capabilities, incompatible ACK versions and a late negative acknowledgement',async()=>{
    for(const version of ['1.7.0','0.8.0','0.6.0','invalid']){
      const client=createNativePresentationClient(()=>{});client.hello();client.receive(coreHello());client.receive({type:'hello-ack',ok:true,version});
      await expect(client.ready).rejects.toThrow('negotiation failed');
    }
    const missing=createNativePresentationClient(()=>{});missing.hello();missing.receive({...coreHello(),capabilities:{surfaces:['terminal'],sites:[],elements:[],encodings:['jsonl']}});
    await expect(missing.ready).rejects.toThrow('negotiation failed');
    const t=transport({deferred:true});const pending=t.client.sessions()[0].submit('draft');
    t.receive({type:'hello-ack',ok:false,reason:'private reason'});expect(await pending).toBe(false);expect(t.client.sessions()[0].isCurrent?.()).toBe(false);
  });
});
