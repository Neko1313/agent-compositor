import {randomUUID} from 'node:crypto';
import {answerHello,hello,COMPOSER_MEDIA_STATUS,nativeStateSchema,parseSemVer,type HelloAckMessage,type HelloMessage,type WireMessage} from '@agent-compositor/protocol';
import type {ControllerInput,ControllerView,ConversationSession,PublicRenderSlotSource,UiSurfaceSource,WindowLayoutSource} from '@agent-compositor/renderer-opentui';
import type {createOpenTuiHost} from './opentui-host.js';
import type {UiTextView} from '@agent-compositor/events';

type NativeInput=Extract<WireMessage,{type:'native-input'}>;
type NativeReceipt=Extract<WireMessage,{type:'native-receipt'}>;
type NativeState=Extract<WireMessage,{type:'native-state'}>;
type Host=ReturnType<typeof createOpenTuiHost>;
type Port={kind:'session';source:ConversationSession}|{kind:'surface';source:UiSurfaceSource}|{kind:'public';source:PublicRenderSlotSource};
const elements=['Text','Box','Layout','Pointer','native-presentation-v1','native-input-v1',COMPOSER_MEDIA_STATUS];
const sessionMethods=['submit','isImmediateCommand','interrupt','answerApproval','answerInteraction','cancelInteraction','controllerInput','controllerViewport','cancelController','editorInput','editorViewport'] as const;
const surfaceMethods=['press','change','answerApproval','answerInteraction','cancelInteraction','answerForm','cancelForm','controllerInput','controllerViewport','cancelController'] as const;
function hasAction(view:UiTextView|undefined,action:string){
  return Boolean(view&&(view.lines.some(line=>line.action===action)||view.tabs?.some(tab=>!tab.disabled&&tab.action===action)
    ||view.table?.rows.some(row=>row.action===action||row.expanded&&row.details?.some(line=>line.action===action))));
}
/** Relative native input belongs to a lease, while clicks belong to a painted view. */
function inputRevision(input:ControllerInput,frame:{revision:number;view:ControllerView},painted:number){
  if(painted>frame.revision)return;
  if(input.kind==='key'||input.kind==='text')return frame.revision;
  if(input.kind==='change')return frame.view.input?.id===input.id?frame.revision:undefined;
  return painted===frame.revision?painted:undefined;
}

/** Trusted, private presentation broker. Functions and leases never leave this side. */
export function createOpenTuiWireHost(options:{host:Host;layout:WindowLayoutSource;onCtrlC(): 'exit'|'handled';onFailure?(error:unknown):void},send:(message:WireMessage)=>void){
  const epoch=randomUUID(),localHello=hello('core',{surfaces:['terminal'],sites:[],elements,encodings:['jsonl']});
  const tokens=new WeakMap<object,string>(),subscriptions=new Map<object,()=>void>(),globalSubscriptions:(()=>void)[]=[];
  const receipts=new Map<number,{input:string;receipt:NativeReceipt}>();
  let serial=0,revision=0,mediaRevision=0,highestInput=-1,active=true,negotiated=false,mediaStatus=false,publishing=false,dirty=false;
  let receivedAck:HelloAckMessage|undefined,negotiatedVersion:string|undefined;
  let ports=new Map<string,Port>(),lastState='',offMedia:(()=>void)|undefined;
  function transmit(message:WireMessage){
    if(!active)return;
    try{send(message);}catch(error){close();if(options.onFailure)options.onFailure(error);else throw error;}
  }
  function token(source:object){let value=tokens.get(source);if(!value){value='port-'+(++serial);tokens.set(source,value);}return value;}
  function publish(){
    if(!active||!negotiated)return;
    dirty=true;if(publishing)return;
    publishing=true;
    try{while(dirty&&active){
      dirty=false;
      const observed=new Set<object>(),nextPorts=new Map<string,Port>();
      const watch=(source:{subscribe(listener:()=>void):()=>void})=>{
        observed.add(source);if(!subscriptions.has(source))subscriptions.set(source,source.subscribe(publish));
      };
      const windows=options.host.conversationWindows.snapshot();
      const sessions=windows.map(window=>{
        const source=window.session,port=token(source);watch(source);nextPorts.set(port,{kind:'session',source});
        return {port,id:source.id,conversationId:source.conversationId,generation:source.generation,paneId:source.paneId,
          label:source.label,current:source.isCurrent?.()!==false,snapshot:source.snapshot(),
          methods:sessionMethods.filter(method=>typeof source[method]==='function')};
      });
      const surfaces=options.host.surfaces.snapshot().map(source=>{
        const port=token(source);watch(source);nextPorts.set(port,{kind:'surface',source});
        return {port,id:source.id,snapshot:source.snapshot(),methods:surfaceMethods.filter(method=>typeof source[method]==='function')};
      });
      const layout=options.layout.snapshot(),publicRender:NativeState['state']['publicRender']=[];
      const ids=new Set(['status',...Object.keys(layout.locations),...windows.map(window=>window.id),...surfaces.map(surface=>surface.id)]);
      for(const id of ids){
        const source=options.host.publicRender.slot(id);if(!source)continue;
        const port=token(source);watch(source);nextPorts.set(port,{kind:'public',source});
        publicRender.push({port,id,...source.snapshot()});
      }
      for(const [source,off] of subscriptions)if(!observed.has(source)){off();subscriptions.delete(source);}
      ports=nextPorts;
      const state=nativeStateSchema.parse({sessions,windows:windows.map(window=>({id:window.id,label:window.label,session:token(window.session)})),
        surfaces,layout,navigation:options.host.navigation.snapshot(),appearance:options.host.appearance.snapshot(),publicRender,
        composerMedia:options.host.composerMedia.dimensions?.(),immediateCommands:options.host.immediateCommands()});
      const signature=JSON.stringify(state);if(signature===lastState)continue;
      transmit({type:'native-state',epoch,revision:++revision,state});if(active)lastState=signature;
    }}finally{publishing=false;}
  }
  function media(enabled:boolean,activeFrame:boolean,expanded=true){
    offMedia?.();offMedia=undefined;
    if(!enabled)return;
    const unsubscribe=options.host.composerMedia.subscribe(activeFrame,frame=>{
      if(!active||!negotiated)return;
      const dimensions=options.host.composerMedia.dimensions?.()??{width:8,height:4};
      transmit({type:'native-media',epoch,revision:++mediaRevision,dimensions,
        ...(frame?{frame:{width:frame.width,height:frame.height,rgba:Buffer.from(frame.rgba).toString('base64')}}:{}),
        ...(mediaStatus?{presentation:options.host.composerMedia.presentation?.()??{hasImage:Boolean(frame)}}:{})});
    },mediaStatus?{expanded}:undefined);
    if(active)offMedia=unsubscribe;else unsubscribe();
  }
  function receipt(message:NativeInput,result:Partial<NativeReceipt>={}){
    const value:NativeReceipt={type:'native-receipt',epoch:message.epoch,id:message.id,status:'accepted',...result};
    receipts.set(message.id,{input:JSON.stringify(message),receipt:value});if(receipts.size>512)receipts.delete(receipts.keys().next().value!);
    transmit(value);
  }
  function invoke(message:NativeInput):Partial<NativeReceipt>{
    const op=message.operation,target=message.target;
    if(target==='@layout'){
      if(op.kind==='layout-resize'){options.layout.resize(op.width,op.height);return {};}
      if(op.kind==='layout-action'){options.layout.act(op.action);return {};}
    }
    if(target==='@navigation'){
      const source=options.host.navigation;
      if(op.kind==='navigation-handle')return {consumed:source.handle(op.input)};
      if(op.kind==='navigation-toggle'){source.toggleArrange();return {};}
      if(op.kind==='navigation-open'){source.openFinder();return {};}
      const state=source.snapshot();
      if(op.kind==='navigation-choose'&&state.mode==='finder'&&state.revision===op.revision&&state.entries.some(entry=>entry.id===op.id)){
        const available=state.entries.find(entry=>entry.id===op.id)!.state!=='unavailable';source.choose(op.id,op.revision);
        return {status:available?'accepted':'rejected'};
      }
      if(op.kind==='navigation-query'&&state.mode==='finder'&&state.revision===op.revision){source.changeQuery(op.text,op.revision);return {};}
      if(op.kind==='navigation-select'&&state.mode==='finder'&&state.revision===op.revision&&state.entries.some(entry=>entry.id===op.id)){source.select(op.id,op.revision);return {};}
    }
    if(target==='@media'&&op.kind==='media-active'){
      if(!mediaStatus&&op.expanded!==undefined)return {status:'rejected'};
      media(op.enabled,op.active,op.expanded);return {};
    }
    if(target==='@host'&&op.kind==='ctrl-c')return {ctrlC:options.onCtrlC()};
    const port=ports.get(target);
    if(!port)return {status:'rejected'};
    if(port.kind==='session'&&!options.host.conversationWindows.snapshot().some(window=>window.session===port.source)
      ||port.kind==='surface'&&!options.host.surfaces.snapshot().includes(port.source)
      ||port.kind==='public'&&options.host.publicRender.slot(port.source.id)!==port.source)return {status:'rejected'};
    const layout=options.layout.snapshot(),normal=options.host.navigation.snapshot().mode==='normal'&&!layout.gesture;
    const paneId=port.kind==='session'?port.source.paneId:port.source.id;
    const visible=layout.frames.some(frame=>frame.surface===paneId),focused=visible&&layout.focused===paneId;
    if(port.kind==='public'){
      if(op.kind==='public-measure'&&(!op.metrics.visible||normal&&(visible||paneId==='status'))){port.source.measure(op.metrics);return {};}
      if(op.kind==='public-press'&&normal&&(visible||paneId==='status')&&port.source.snapshot().revision===op.revision
        &&hasAction(port.source.snapshot().override,op.action))return {status:port.source.press(op.action,op.revision)===false?'rejected':'accepted'};
      return {status:'rejected'};
    }
    const source=port.source;
    if(port.kind==='session'&&port.source.isCurrent?.()===false)return {status:'rejected'};
    if(port.kind==='session'){
      const session=port.source;
      if(op.kind==='submit')return {status:session.submit(op.text)===false?'rejected':'accepted'};
      if(op.kind==='interrupt'&&normal&&focused&&session.interrupt){session.interrupt();return {};}
      if(op.kind==='editor-input'&&normal&&focused&&session.snapshot().editor?.id===op.id&&session.editorInput){
        const revision=inputRevision(op.input,session.snapshot().editor!,op.revision);
        const ticket=revision===undefined?undefined:session.editorInput(op.id,op.input,revision);
        return ticket===undefined?{status:'rejected'}:{ticket};
      }
      if(op.kind==='editor-viewport'&&options.host.canNativeViewport(session)&&session.snapshot().editor?.id===op.id&&session.editorViewport){session.editorViewport(op.id,op.columns,op.rows,op.maxRows);return {};}
    }else{
      const surface=port.source;
      const state=surface.snapshot(),plain=!state.controller&&!state.approval&&!state.interaction&&!state.form;
      if(op.kind==='surface-press'&&normal&&visible&&plain&&state.revision===op.revision&&hasAction(state.view,op.action))
        return {status:surface.press(op.action,op.revision)===false?'rejected':'accepted'};
      if(op.kind==='surface-change'&&normal&&focused&&plain&&state.revision===op.revision&&state.view?.input?.id===op.field)
        return {status:surface.change(op.field,op.value,op.revision)===false?'rejected':'accepted'};
    }
    const state=source.snapshot(),interaction='interaction' in state?state.interaction:undefined;
    const form=port.kind==='surface'?port.source.snapshot().form:undefined;
    if(op.kind==='approval'&&normal&&focused&&!state.controller&&state.approval?.id===op.id&&source.answerApproval){source.answerApproval(op.id,op.allow);return {};}
    if(op.kind==='interaction'){
      if(!normal||!focused||state.controller||state.approval||(interaction??form)?.id!==op.id)return {status:'rejected'};
      if(source.answerInteraction){source.answerInteraction(op.id,op.value);return {};}
      if(port.kind==='surface'&&port.source.answerForm){port.source.answerForm(op.id,op.value);return {};}
    }
    if(op.kind==='cancel-interaction'){
      if(!normal||!focused||state.controller||state.approval||(interaction??form)?.id!==op.id)return {status:'rejected'};
      if(source.cancelInteraction){source.cancelInteraction(op.id);return {};}
      if(port.kind==='surface'&&port.source.cancelForm){port.source.cancelForm(op.id);return {};}
    }
    if(op.kind==='controller-input'&&normal&&focused&&state.controller?.id===op.id&&source.controllerInput){
      const revision=inputRevision(op.input,state.controller,op.revision);
      const ticket=revision===undefined?undefined:source.controllerInput(op.id,op.input,revision);
      return ticket===undefined?{status:'rejected'}:{ticket};
    }
    if(op.kind==='controller-viewport'&&visible&&state.controller?.id===op.id&&source.controllerViewport
      &&(port.kind!=='session'||options.host.canNativeViewport(port.source))){source.controllerViewport(op.id,op.columns,op.rows);return {};}
    if(op.kind==='cancel-controller'&&normal&&focused&&state.controller?.id===op.id&&source.cancelController){source.cancelController(op.id);return {};}
    return {status:'rejected'};
  }
  function receive(message:WireMessage){
    if(!active)return;
    if(message.type==='hello'){
      const remote:HelloMessage=message,ack=answerHello(localHello,remote);
      const supported=remote.role==='renderer'&&['native-presentation-v1','native-input-v1'].every(element=>remote.capabilities.elements.includes(element));
      negotiated=ack.ok&&supported&&Number(ack.version?.split('.')[1])>=7&&(!receivedAck||receivedAck.version===ack.version);
      mediaStatus=negotiated&&remote.capabilities.elements.includes(COMPOSER_MEDIA_STATUS);
      negotiatedVersion=negotiated?ack.version:undefined;
      transmit(negotiated?ack:{type:'hello-ack',ok:false,reason:'Native presentation and input v1 are required'});
      if(!active)return;
      if(negotiated&&!globalSubscriptions.length){
        for(const source of [options.layout,options.host.conversationWindows,options.host.surfaces,options.host.navigation,options.host.appearance])globalSubscriptions.push(source.subscribe(publish));
      }
      publish();return;
    }
    if(message.type==='hello-ack'){
      receivedAck=message;const version=message.version?parseSemVer(message.version):undefined;
      if(!message.ok||!version||version.major!==0||version.minor<7||negotiatedVersion&&message.version!==negotiatedVersion){
        close();options.onFailure?.(Error('Native presentation negotiation failed'));
      }
      return;
    }
    if(message.type==='bye'){close();return;}
    if(message.type!=='native-input')return;
    if(!negotiated||message.epoch!==epoch){transmit({type:'native-receipt',epoch:message.epoch,id:message.id,status:'rejected'});return;}
    const previous=receipts.get(message.id);if(previous){
      transmit(previous.input===JSON.stringify(message)?previous.receipt:{type:'native-receipt',epoch,id:message.id,status:'rejected'});return;
    }
    if(message.id<=highestInput){transmit({type:'native-receipt',epoch,id:message.id,status:'rejected'});return;}
    highestInput=message.id;
    try{receipt(message,invoke(message));}catch{receipt(message,{status:'rejected'});}
  }
  function close(){
    if(!active)return;active=false;mediaStatus=false;offMedia?.();offMedia=undefined;
    for(const off of globalSubscriptions.splice(0))off();
    for(const off of subscriptions.values())off();subscriptions.clear();ports.clear();receipts.clear();
  }
  return {epoch,hello:()=>transmit(localHello),receive,close};
}
