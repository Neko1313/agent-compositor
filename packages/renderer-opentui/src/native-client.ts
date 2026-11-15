import {answerHello,hello,parseSemVer,COMPOSER_MEDIA_STATUS,NATIVE_STEER,NATIVE_PENDING_WORK,NATIVE_SESSION_RESTORING,nativeProtocolElements,nativeStateMessage,nativeInputMessage,nativeReceiptMessage,nativeMediaMessage,
  type NativeState,type NativeSession,type NativeSurface,type NativeOperation,type NativeReceiptMessage,type WireMessage} from '@agent-compositor/protocol';
import type {ConversationSession,ConversationSnapshot} from './session.js';
import type {ConversationWindow,ConversationWindowRegistry} from './conversation-windows.js';
import type {UiSurfaceSource,UiSurfaceRegistry,UiSurfaceSnapshot} from './surface.js';
import type {WindowLayoutSource,WindowLayoutSnapshot} from './layout.js';
import type {WindowNavigationSource,WindowNavigationSnapshot} from './navigation.js';
import type {AppearanceSource,AppearanceSnapshot} from './appearance.js';
import type {PublicRenderSlots,PublicRenderSlotSource,PublicRenderSlotSnapshot} from './public-render.js';
import type {ComposerMedia} from './ghost.js';
import type {ControllerInput} from './controller.js';

export interface NativePresentationClient {
  hello():void;
  receive(message:WireMessage):void;
  readonly ready:Promise<void>;
  close():void;
  sessions():readonly ConversationSession[];
  readonly conversationWindows:ConversationWindowRegistry;
  readonly surfaces:UiSurfaceRegistry;
  readonly windowLayout:WindowLayoutSource;
  readonly navigation:WindowNavigationSource;
  readonly appearance:AppearanceSource;
  readonly publicRender:PublicRenderSlots;
  readonly composerMedia:ComposerMedia;
  onCtrlC(): 'exit'|'handled'|Promise<'exit'|'handled'>;
  pending():boolean;
  settled():Promise<void>;
  generation():string;
}

function freeze<T>(value:T):T {
  if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}
  return value;
}
function store<T>(initial:T){
  let value=freeze(initial),signature=JSON.stringify(initial);
  const listeners=new Set<()=>void>();
  return {snapshot:()=>value,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    set(next:T,force=false){const key=JSON.stringify(next);if(!force&&key===signature)return false;
      value=freeze(next);signature=key;return true;},notify(){for(const listener of [...listeners])listener();}};
}
const initialLayout:WindowLayoutSnapshot={revision:0,width:0,height:0,frames:[],focused:'',workspace:1,workspaces:[1],locations:{},
  axis:'horizontal',fullscreen:false,compact:false,pointer:'default'};
const initialNavigation:WindowNavigationSnapshot={revision:0,mode:'normal',query:'',entries:[]};
type Frame={id:string;revision:number;inputRevision:number};
type Ticket={local:number;status:'pending'|'accepted'|'rejected';host?:number};
type Track={issued:number;completed:number;raw:number;tickets:Ticket[]};
type Pending={target:string;resolve:(receipt:NativeReceiptMessage|undefined)=>void};

/** Data-only local ports. Receipts acknowledge admission, never model completion. */
export function createNativePresentationClient(send:(message:WireMessage)=>void):NativePresentationClient {
  const localHello=hello('renderer',{surfaces:['terminal'],sites:['conversation','tools','help','status','plugin:*'],
    elements:['Text','Box','Layout','Pointer',...nativeProtocolElements,COMPOSER_MEDIA_STATUS,NATIVE_STEER,NATIVE_PENDING_WORK,NATIVE_SESSION_RESTORING],encodings:['jsonl']});
  let closed=false,sentHello=false,peerHello=false,acknowledged=false,negotiated=false,allowEpoch=false,epoch='',stateRevision=-1,mediaRevision=-1,nextId=0;
  let initialized=false,resolveReady!:()=>void,rejectReady!:(reason:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  void ready.catch(()=>{});
  const retired=new Set<string>(),pending=new Map<number,Pending>(),waiters=new Set<()=>void>(),tracks=new Map<string,Track>();
  const surfaceChanges=new Set<object>(),surfaceSerial=new WeakMap<object,number>();
  const layout=store(initialLayout),navigation=store(initialNavigation),appearance=store<AppearanceSnapshot>({revision:0,appearance:{}});
  const windows=store<readonly ConversationWindow[]>([]),surfaceList=store<readonly UiSurfaceSource[]>([]);
  let canonical:readonly ConversationSession[]=[],commands:readonly string[]=[];
  type SessionEntry={dto:NativeSession;source:ConversationSession;value:ReturnType<typeof store<ConversationSnapshot>>};
  type SurfaceEntry={dto:NativeSurface;source:UiSurfaceSource;value:ReturnType<typeof store<UiSurfaceSnapshot>>};
  type SurfaceEdit={field:string;values:Set<string>;result?:boolean;done:Promise<boolean>};
  const surfaceEdits=new WeakMap<SurfaceEntry,SurfaceEdit>();
  const waitingSubmits=new WeakMap<SurfaceEntry,SurfaceEdit>();
  type PublicDto=NativeState['publicRender'][number];
  type PublicEntry={dto:PublicDto;source:PublicRenderSlotSource;value:ReturnType<typeof store<PublicRenderSlotSnapshot>>};
  const sessions=new Map<string,SessionEntry>(),surfaces=new Map<string,SurfaceEntry>(),publicEntries=new Map<string,PublicEntry>();
  let publicIds=new Map<string,PublicEntry>();
  type MediaFrame={width:number;height:number;rgba:Uint8Array};
  const mediaListeners=new Set<{active:boolean;expanded:boolean;listener:(frame:MediaFrame|undefined)=>void}>();
  let dimensions={width:8,height:4},mediaFrame:MediaFrame|undefined,mediaEnabled=false,mediaActive=false,mediaExpanded=false,mediaStatus=false;
  let mediaPresentation:Extract<WireMessage,{type:'native-media'}>['presentation'];

  function idle(){if(!pending.size&&!surfaceChanges.size){for(const done of waiters)done();waiters.clear();}}
  function settle(id:number,receipt?:NativeReceiptMessage){const entry=pending.get(id);if(!entry)return;
    pending.delete(id);entry.resolve(receipt);idle();}
  function revoke(target?:string){for(const [id,entry] of [...pending])if(target===undefined||entry.target===target)settle(id);}
  function request(target:string,operation:NativeOperation,revision?:number):NativeReceiptMessage|undefined|Promise<NativeReceiptMessage|undefined>{
    if(closed||!initialized)return;
    const id=++nextId,parsed=nativeInputMessage.safeParse({type:'native-input',epoch,id,target,operation,...revision===undefined?{}:{revision}});
    if(!parsed.success)return;
    let received=false,result:NativeReceiptMessage|undefined,resolve!:Pending['resolve'];
    const promise=new Promise<NativeReceiptMessage|undefined>(done=>{resolve=receipt=>{received=true;result=receipt;done(receipt);};});
    pending.set(id,{target,resolve});
    try{send(parsed.data);}catch{settle(id);}
    // A synchronous transport can deliver its receipt inside send().
    return received?result:promise;
  }
  function accepted(target:string,operation:NativeOperation,revision?:number):boolean|Promise<boolean>{
    const result=request(target,operation,revision);
    return result instanceof Promise?result.then(value=>value?.status==='accepted'):result?.status==='accepted';
  }
  function fire(target:string,operation:NativeOperation,revision?:number){void accepted(target,operation,revision);}
  function isSession(entry:SessionEntry){return !closed&&sessions.get(entry.dto.port)===entry&&entry.dto.current;}
  function isSurface(entry:SurfaceEntry){return !closed&&surfaces.get(entry.dto.port)===entry;}
  function sessionKey(dto:NativeSession,kind:'controller'|'editor',frame:Frame){
    return JSON.stringify([epoch,'session',dto.conversationId??dto.id,dto.id,dto.generation??dto.id,kind,frame.id]);
  }
  function surfaceKey(dto:NativeSurface,frame:Frame){return JSON.stringify([epoch,'surface',dto.port,frame.id]);}
  function pruneTracks(next:NativeState){
    const retained=new Set<string>();
    for(const dto of next.sessions){
      if(dto.snapshot.controller)retained.add(sessionKey(dto,'controller',dto.snapshot.controller));
      if(dto.snapshot.editor)retained.add(sessionKey(dto,'editor',dto.snapshot.editor));
    }
    for(const dto of next.surfaces)if(dto.snapshot.controller)retained.add(surfaceKey(dto,dto.snapshot.controller));
    // Presence, including hidden resident sources and Main copies, owns this
    // bookkeeping. Completed or pending receipts cannot retain a retired frame.
    for(const key of tracks.keys())if(!retained.has(key))tracks.delete(key);
  }
  function track(key:string,raw:number){let value=tracks.get(key);if(!value){value={issued:0,completed:0,raw,tickets:[]};tracks.set(key,value);}
    value.raw=Math.max(value.raw,raw);advance(value);return value;}
  function advance(value:Track){
    // A later rejection cannot acknowledge a preceding handler that is still
    // executing: its eventual frame could otherwise overwrite newer local text.
    while(value.tickets.length){const ticket=value.tickets[0];
      if(ticket.status!=='rejected'&&!(ticket.status==='accepted'&&ticket.host!==undefined&&ticket.host<=value.raw))break;
      value.completed=ticket.local;value.tickets.shift();}
  }
  function sessionSnapshot(dto:NativeSession):ConversationSnapshot {
    const value={...dto.snapshot};
    if(value.controller)value.controller={...value.controller,inputRevision:track(sessionKey(dto,'controller',value.controller),value.controller.inputRevision).completed};
    if(value.editor)value.editor={...value.editor,inputRevision:track(sessionKey(dto,'editor',value.editor),value.editor.inputRevision).completed};
    return value;
  }
  function surfaceSnapshot(dto:NativeSurface):UiSurfaceSnapshot {
    const value={...dto.snapshot};
    if(value.controller)value.controller={...value.controller,inputRevision:track(surfaceKey(dto,value.controller),value.controller.inputRevision).completed};
    return value;
  }
  function refreshFrames(){
    const changed=[];
    for(const entry of sessions.values())if(entry.value.set(sessionSnapshot(entry.dto)))changed.push(entry.value);
    for(const entry of surfaces.values())if(entry.value.set(surfaceSnapshot(entry.dto)))changed.push(entry.value);
    for(const value of changed)value.notify();
  }
  function input(target:string,key:string,frame:Frame,kind:'controller-input'|'editor-input',value:ControllerInput){
    const current=track(key,frame.inputRevision),ticket:Ticket={local:++current.issued,status:'pending'};current.tickets.push(ticket);
    const receipt=request(target,{kind,id:frame.id,input:value as Extract<NativeOperation,{kind:'controller-input'}>['input'],revision:frame.revision},frame.revision);
    const finish=(result:NativeReceiptMessage|undefined)=>{
      if(tracks.get(key)!==current)return;
      ticket.status=result?.status==='accepted'&&result.ticket!==undefined?'accepted':'rejected';ticket.host=result?.ticket;
      advance(current);refreshFrames();
    };
    if(receipt instanceof Promise)void receipt.then(finish);else finish(receipt);
    return ticket.local;
  }
  function createSession(dto:NativeSession):SessionEntry {
    const entry={} as SessionEntry;entry.dto=dto;entry.value=store(sessionSnapshot(dto));
    const has=(name:NonNullable<NativeSession['methods']>[number])=>entry.dto.methods?.includes(name);
    const interaction=(id:string)=>!entry.dto.snapshot.controller&&entry.dto.snapshot.interaction?.id===id;
    const optional={
      steer:(text:string)=>isSession(entry)?accepted(entry.dto.port,{kind:'steer',text}):false,
      interrupt:()=>{if(isSession(entry))fire(entry.dto.port,{kind:'interrupt'});},
      answerApproval:(id:string,allow:boolean)=>{if(isSession(entry)&&!entry.dto.snapshot.controller&&entry.dto.snapshot.approval?.id===id)fire(entry.dto.port,{kind:'approval',id,allow});},
      answerInteraction:(id:string,value:unknown)=>{if(isSession(entry)&&interaction(id))fire(entry.dto.port,{kind:'interaction',id,value:value as never});},
      cancelInteraction:(id:string)=>{if(isSession(entry)&&interaction(id))fire(entry.dto.port,{kind:'cancel-interaction',id});},
      controllerInput:(id:string,value:ControllerInput,revision:number)=>{const frame=entry.dto.snapshot.controller;
        if(isSession(entry)&&frame?.id===id&&frame.revision===revision)return input(entry.dto.port,sessionKey(entry.dto,'controller',frame),frame,'controller-input',value);},
      controllerViewport:(id:string,columns:number,rows:number)=>{if(isSession(entry)&&entry.dto.snapshot.controller?.id===id)fire(entry.dto.port,{kind:'controller-viewport',id,columns,rows});},
      cancelController:(id:string)=>{if(isSession(entry)&&entry.dto.snapshot.controller?.id===id)fire(entry.dto.port,{kind:'cancel-controller',id});},
      editorInput:(id:string,value:ControllerInput,revision:number)=>{const frame=entry.dto.snapshot.editor;
        if(isSession(entry)&&frame?.id===id&&frame.revision===revision)return input(entry.dto.port,sessionKey(entry.dto,'editor',frame),frame,'editor-input',value);},
      editorViewport:(id:string,columns:number,rows:number,maxRows?:number)=>{if(isSession(entry)&&entry.dto.snapshot.editor?.id===id)fire(entry.dto.port,{kind:'editor-viewport',id,columns,rows,...maxRows===undefined?{}:{maxRows}});},
    };
    entry.source={get id(){return entry.dto.id;},get conversationId(){return entry.dto.conversationId;},get generation(){return entry.dto.generation;},
      get paneId(){return entry.dto.paneId;},get label(){return entry.dto.label;},isCurrent:()=>isSession(entry),snapshot:entry.value.snapshot,subscribe:entry.value.subscribe,
      submit:text=>isSession(entry)?accepted(entry.dto.port,{kind:'submit',text}):false,
      isImmediateCommand:text=>isSession(entry)&&commands.includes(text.trim().split(/\s+/,1)[0]),
    };
    for(const name of Object.keys(optional) as (keyof typeof optional)[])Object.defineProperty(entry.source,name,{enumerable:true,get:()=>has(name)?optional[name]:undefined});
    return entry;
  }
  function changeSurface(entry:SurfaceEntry,field:string,value:string,revision:number){
    const sequence=(surfaceSerial.get(entry)??0)+1;surfaceSerial.set(entry,sequence);
    const initialValue=entry.dto.snapshot.view?.input?.value;
    // A producer may publish an earlier local keystroke while a later edit is
    // in flight. Retry only against bounded values this field actually sent.
    const previous=surfaceEdits.get(entry),values=previous?.field===field?new Set(previous.values):new Set<string>();
    if(initialValue!==undefined)values.add(initialValue);values.add(value);
    while(values.size>64)values.delete(values.values().next().value!);
    let resolveEdit!:(accepted:boolean)=>void;
    const edit:SurfaceEdit={field,values,done:new Promise(resolve=>{resolveEdit=resolve;})};surfaceEdits.set(entry,edit);
    const token={};surfaceChanges.add(token);
    const finish=(accepted=false)=>{edit.result=accepted;resolveEdit(accepted);surfaceChanges.delete(token);idle();};
    const attempt=(current:number,retries:number):void=>{
      const outcome=request(entry.dto.port,{kind:'surface-change',field,value,revision:current},current);
      const complete=(receipt:NativeReceiptMessage|undefined)=>{
        const snapshot=entry.dto.snapshot,position=layout.snapshot(),navigationState=navigation.snapshot();
        if(receipt?.status==='rejected'&&retries>0&&isSurface(entry)&&surfaceSerial.get(entry)===sequence
          &&snapshot.revision!==current&&snapshot.view?.input?.id===field&&edit.values.has(snapshot.view.input.value)&&!snapshot.controller&&!snapshot.approval&&!snapshot.interaction&&!snapshot.form
          &&navigationState.mode==='normal'&&!position.gesture&&position.focused===entry.dto.id&&position.frames.some(frame=>frame.surface===entry.dto.id)){
          attempt(snapshot.revision,retries-1);return;
        }
        if(receipt?.status==='rejected'&&isSurface(entry)&&surfaceSerial.get(entry)===sequence&&snapshot.view?.input?.id===field){
          if(entry.value.set({...entry.value.snapshot(),error:'Input was not saved; check the field and try again.'}))entry.value.notify();
        }
        finish(receipt?.status==='accepted');
      };
      if(outcome instanceof Promise)void outcome.then(complete).catch(()=>finish());else complete(outcome);
    };
    attempt(revision,2);
  }
  function createSurface(dto:NativeSurface):SurfaceEntry {
    const entry={} as SurfaceEntry;entry.dto=dto;entry.value=store(surfaceSnapshot(dto));
    const has=(name:NonNullable<NativeSurface['methods']>[number])=>entry.dto.methods?.includes(name);
    const interaction=(id:string)=>!entry.dto.snapshot.controller&&(entry.dto.snapshot.interaction??entry.dto.snapshot.form)?.id===id;
    const answer=(id:string,value:unknown)=>{if(isSurface(entry)&&interaction(id))fire(entry.dto.port,{kind:'interaction',id,value:value as never});};
    const cancel=(id:string)=>{if(isSurface(entry)&&interaction(id))fire(entry.dto.port,{kind:'cancel-interaction',id});};
    const optional={
      answerApproval:(id:string,allow:boolean)=>{if(isSurface(entry)&&!entry.dto.snapshot.controller&&entry.dto.snapshot.approval?.id===id)fire(entry.dto.port,{kind:'approval',id,allow});},
      answerInteraction:answer,cancelInteraction:cancel,answerForm:answer,cancelForm:cancel,
      controllerInput:(id:string,value:ControllerInput,revision:number)=>{const frame=entry.dto.snapshot.controller;
        if(isSurface(entry)&&frame?.id===id&&frame.revision===revision)return input(entry.dto.port,surfaceKey(entry.dto,frame),frame,'controller-input',value);},
      controllerViewport:(id:string,columns:number,rows:number)=>{if(isSurface(entry)&&entry.dto.snapshot.controller?.id===id)fire(entry.dto.port,{kind:'controller-viewport',id,columns,rows});},
      cancelController:(id:string)=>{if(isSurface(entry)&&entry.dto.snapshot.controller?.id===id)fire(entry.dto.port,{kind:'cancel-controller',id});},
    };
    entry.source={get id(){return entry.dto.id;},snapshot:entry.value.snapshot,subscribe:entry.value.subscribe,
      press:(action,revision)=>{
        if(!isSurface(entry)||entry.dto.snapshot.revision!==revision)return;
        const edit=surfaceEdits.get(entry),field=entry.dto.snapshot.view?.input;
        if(field?.submitAction===action&&edit?.field===field.id&&edit.result===undefined){
          // The host serializes admitted edits before submission, but an edit
          // rejected on a stale revision must be retried before Enter is sent.
          if(waitingSubmits.get(entry)===edit)return;
          waitingSubmits.set(entry,edit);
          const token={};surfaceChanges.add(token);
          void edit.done.then(accepted=>{
            try{
              if(waitingSubmits.get(entry)!==edit)return;
              waitingSubmits.delete(entry);
              const snapshot=entry.dto.snapshot,position=layout.snapshot();
              if(!accepted||!isSurface(entry)||surfaceEdits.get(entry)!==edit||snapshot.view?.input?.id!==edit.field
                ||snapshot.view.input.submitAction!==action||snapshot.controller||snapshot.approval||snapshot.interaction||snapshot.form
                ||navigation.snapshot().mode!=='normal'||position.gesture||position.focused!==entry.dto.id||!position.frames.some(frame=>frame.surface===entry.dto.id))return;
              fire(entry.dto.port,{kind:'surface-press',action,revision:snapshot.revision},snapshot.revision);
            }finally{surfaceChanges.delete(token);idle();}
          });return;
        }
        if(field?.submitAction===action&&edit?.field===field.id&&edit.result===false)return;
        fire(entry.dto.port,{kind:'surface-press',action,revision},revision);
      },
      change:(field,value,revision)=>{if(isSurface(entry)&&entry.dto.snapshot.revision===revision)changeSurface(entry,field,value,revision);},
    };
    for(const name of Object.keys(optional) as (keyof typeof optional)[])Object.defineProperty(entry.source,name,{enumerable:true,get:()=>has(name)?optional[name]:undefined});
    return entry;
  }
  function createPublic(dto:PublicDto):PublicEntry {
    const entry={} as PublicEntry;entry.dto=dto;entry.value=store<PublicRenderSlotSnapshot>({revision:dto.revision,defaultView:dto.defaultView,override:dto.override});
    const active=()=>!closed&&publicEntries.get(entry.dto.port)===entry;
    entry.source={get id(){return entry.dto.id;},snapshot:entry.value.snapshot,subscribe:entry.value.subscribe,
      measure:metrics=>{if(active())fire(entry.dto.port,{kind:'public-measure',metrics});},
      press:(action,revision)=>{if(active()&&entry.dto.revision===revision)fire(entry.dto.port,{kind:'public-press',action,revision},revision);},
    };return entry;
  }
  function apply(next:NativeState){
    commands=next.immediateCommands;
    pruneTracks(next);
    const changes=new Set<{notify():void}>();
    function prune<T>(map:Map<string,T>,ports:readonly {port:string}[]){const ids=new Set(ports.map(value=>value.port));
      for(const key of map.keys())if(!ids.has(key))map.delete(key);}
    prune(sessions,next.sessions);prune(surfaces,next.surfaces);prune(publicEntries,next.publicRender);
    for(const dto of next.sessions){let entry=sessions.get(dto.port);
      if(!entry){entry=createSession(dto);sessions.set(dto.port,entry);}else{const current=entry.dto.current;entry.dto=dto;
        if(entry.value.set(sessionSnapshot(dto),current!==dto.current))changes.add(entry.value);}}
    for(const dto of next.surfaces){let entry=surfaces.get(dto.port);
      if(!entry){entry=createSurface(dto);surfaces.set(dto.port,entry);}else{entry.dto=dto;if(entry.value.set(surfaceSnapshot(dto)))changes.add(entry.value);}}
    for(const dto of next.publicRender){let entry=publicEntries.get(dto.port);
      if(!entry){entry=createPublic(dto);publicEntries.set(dto.port,entry);}else{entry.dto=dto;
        if(entry.value.set({revision:dto.revision,defaultView:dto.defaultView,override:dto.override}))changes.add(entry.value);}}
    publicIds=new Map([...publicEntries.values()].map(entry=>[entry.dto.id,entry]));
    const previousWindows=windows.snapshot();
    const nextWindows=next.windows.map(dto=>previousWindows.find(value=>value.id===dto.id&&value.label===dto.label&&value.session===sessions.get(dto.session)!.source)
      ??{id:dto.id,label:dto.label,session:sessions.get(dto.session)!.source});
    // Registries contain function-bearing local ports; compare their identities,
    // rather than serializing those ports as though they were wire values.
    if(previousWindows.length!==nextWindows.length||nextWindows.some((value,index)=>value!==previousWindows[index])){
      windows.set(nextWindows,true);changes.add(windows);}
    const nextSurfaces=next.surfaces.map(dto=>surfaces.get(dto.port)!.source),previousSurfaces=surfaceList.snapshot();
    if(nextSurfaces.length!==previousSurfaces.length||nextSurfaces.some((value,index)=>value!==previousSurfaces[index])){surfaceList.set(nextSurfaces,true);changes.add(surfaceList);}
    const groups=new Map<string,SessionEntry>();for(const dto of next.sessions){const entry=sessions.get(dto.port)!,key=dto.conversationId??dto.id;
      if(!groups.has(key)||dto.paneId==='session')groups.set(key,entry);}
    const nextCanonical=[...groups.values()].map(entry=>entry.source);
    if(nextCanonical.length!==canonical.length||nextCanonical.some((value,index)=>value!==canonical[index]))canonical=Object.freeze(nextCanonical);
    if(layout.set(next.layout))changes.add(layout);
    if(navigation.set(next.navigation??initialNavigation))changes.add(navigation);
    if(appearance.set(next.appearance??{revision:0,appearance:{}}))changes.add(appearance);
    dimensions=next.composerMedia??{width:8,height:4};
    for(const value of changes)value.notify();
  }
  function mediaOperation(enabled:boolean,active:boolean,expanded:boolean):NativeOperation{
    return {kind:'media-active',enabled,active,...(mediaStatus?{expanded}:{})};
  }
  function notifyMedia(){for(const item of mediaListeners)item.listener(item.expanded?mediaFrame:undefined);}
  function updateMedia(){const enabled=mediaListeners.size>0,active=enabled&&[...mediaListeners].some(value=>value.active),expanded=enabled&&[...mediaListeners].some(value=>value.expanded);
    const changed=enabled!==mediaEnabled||active!==mediaActive||mediaStatus&&expanded!==mediaExpanded;
    mediaEnabled=enabled;mediaActive=active;mediaExpanded=expanded;
    // Keep bounded status across effect resubscription while the next frame is
    // in transit. Hidden pixels are released; epoch changes and close revoke both.
    if(!enabled)mediaFrame=undefined;
    if(changed)fire('@media',mediaOperation(enabled,active,expanded));}
  const client:NativePresentationClient={
    ready,hello(){if(closed||sentHello)return;sentHello=true;send(localHello);},
    receive(message){if(closed)return;
      if(message.type==='hello'){
        const ack=answerHello(localHello,message),supported=message.role==='core'&&nativeProtocolElements.every(value=>message.capabilities.elements.includes(value));
        const ok=ack.ok&&supported&&Number(ack.version?.split('.')[1])>=7;
        if(ok){peerHello=true;negotiated=acknowledged;allowEpoch=true;
          const nextStatus=message.capabilities.elements.includes(COMPOSER_MEDIA_STATUS);
          if(mediaStatus!==nextStatus){mediaStatus=nextStatus;mediaPresentation=undefined;notifyMedia();}}
        send(ok?ack:{type:'hello-ack',ok:false,reason:'Native presentation and input v1 are required'});
        if(!ok){rejectReady(new Error('Native presentation negotiation failed'));client.close();return;}
        return;
      }
      if(message.type==='hello-ack'){
        const version=message.version?parseSemVer(message.version):undefined;
        if(!message.ok||version?.major!==0||version.minor!==7){rejectReady(new Error('Native presentation negotiation failed'));client.close();return;}
        if(sentHello){acknowledged=true;negotiated=peerHello;}return;
      }
      if(message.type==='bye'){client.close();return;}
      if(message.type==='native-state'){
        const parsed=nativeStateMessage.safeParse(message);if(!parsed.success||!negotiated)return;
        const next=parsed.data;if(retired.has(next.epoch))return;
        const changedEpoch=next.epoch!==epoch;
        if(changedEpoch){if(!allowEpoch)return;if(epoch)retired.add(epoch);revoke();sessions.clear();surfaces.clear();publicEntries.clear();tracks.clear();
          epoch=next.epoch;stateRevision=-1;mediaRevision=-1;mediaFrame=undefined;mediaPresentation=undefined;allowEpoch=false;}
        if(next.revision<=stateRevision)return;stateRevision=next.revision;
        initialized=true;apply(freeze(next.state));
        resolveReady();if(changedEpoch){notifyMedia();if(mediaEnabled)fire('@media',mediaOperation(mediaEnabled,mediaActive,mediaExpanded));}return;
      }
      if(message.type==='native-receipt'){
        const parsed=nativeReceiptMessage.safeParse(message);if(parsed.success&&parsed.data.epoch===epoch)settle(parsed.data.id,parsed.data);return;
      }
      if(message.type==='native-media'){
        const parsed=nativeMediaMessage.safeParse(message);if(!parsed.success||parsed.data.epoch!==epoch||parsed.data.revision<=mediaRevision)return;
        const value=parsed.data;mediaRevision=value.revision;dimensions=value.dimensions;
        if(!mediaListeners.size)return;
        mediaPresentation=mediaStatus&&value.presentation?freeze(value.presentation):undefined;
        mediaFrame=value.frame?{width:value.frame.width,height:value.frame.height,rgba:Uint8Array.from(atob(value.frame.rgba),char=>char.charCodeAt(0))}:undefined;
        notifyMedia();
      }
    },
    close(){if(closed)return;
      if(mediaEnabled)fire('@media',mediaOperation(false,false,false));
      closed=true;revoke();surfaceChanges.clear();idle();tracks.clear();mediaFrame=undefined;mediaPresentation=undefined;dimensions={width:8,height:4};notifyMedia();mediaListeners.clear();
      rejectReady(new Error('Native presentation closed before initial state'));},
    sessions:()=>canonical,conversationWindows:windows,surfaces:surfaceList,
    windowLayout:{snapshot:layout.snapshot,subscribe:layout.subscribe,resize:(width,height)=>fire('@layout',{kind:'layout-resize',width,height}),act:action=>fire('@layout',{kind:'layout-action',action})},
    navigation:{snapshot:navigation.snapshot,subscribe:navigation.subscribe,handle:input=>{
      const receipt=request('@navigation',{kind:'navigation-handle',input:input as never});
      const consumed=(value:NativeReceiptMessage|undefined)=>value?.status==='accepted'?value.consumed===true:true;
      return receipt instanceof Promise?receipt.then(consumed):consumed(receipt);
    },
      toggleArrange:()=>fire('@navigation',{kind:'navigation-toggle'}),openFinder:()=>fire('@navigation',{kind:'navigation-open'}),
      choose:(id,revision)=>{if(navigation.snapshot().revision===revision)fire('@navigation',{kind:'navigation-choose',id,revision},revision);},
      changeQuery:(text,revision)=>{if(navigation.snapshot().revision===revision)fire('@navigation',{kind:'navigation-query',text,revision},revision);},
      select:(id,revision)=>{if(navigation.snapshot().revision===revision)fire('@navigation',{kind:'navigation-select',id,revision},revision);}},
    appearance,publicRender:{slot:id=>publicIds.get(id)?.source},
    composerMedia:{dimensions:()=>dimensions,presentation:()=>mediaPresentation,subscribe(active,listener,options){if(closed){listener(undefined);return()=>{};}
      const item={active,listener,expanded:options?.expanded!==false};mediaListeners.add(item);listener(item.expanded?mediaFrame:undefined);updateMedia();return()=>{mediaListeners.delete(item);updateMedia();};}},
    onCtrlC(){if(closed)return 'exit';const result=request('@host',{kind:'ctrl-c'});
      const outcome=(value:NativeReceiptMessage|undefined)=>value?.status==='accepted'&&value.ctrlC==='exit'?'exit' as const:'handled' as const;
      return result instanceof Promise?result.then(outcome):outcome(result);},
    pending:()=>pending.size>0||surfaceChanges.size>0,settled:()=>pending.size||surfaceChanges.size?new Promise<void>(resolve=>waiters.add(resolve)):Promise.resolve(),
    generation:()=>JSON.stringify([epoch,...canonical.map(value=>[value.conversationId??value.id,value.id,value.generation??value.id])]),
  };
  return client;
}
