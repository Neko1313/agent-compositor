/** @jsxImportSource @opentui/react */
import {MouseButton, type InputRenderable, type ScrollBoxRenderable} from '@opentui/core';
import {flushSync, useKeyboard} from '@opentui/react';
import {useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {useAppearance} from './appearance.js';
import {Interaction} from './interaction.js';
import {ApprovalCard} from './approval-card.js';
import {surfaceActions,surfaceSubmitAction} from './surface-actions.js';
import type {UiSurfaceSource} from './surface.js';
import {createSurfaceRequestSession,hasSurfaceRequest,surfaceInteraction} from './surface.js';
import {TextViewContent,TextViewTabs,literalViewText as literal} from './text-view.js';
import type {PublicRenderSlotSource} from './public-render.js';
import {usePublicRenderMeasurement,usePublicRenderSnapshot,usePublicScrollMemory} from './public-render-view.js';
import {createConversationScrollMemory} from './conversation-scroll.js';
import {ControllerFrame} from './controller-view.js';
import {isWindowController} from './controller.js';

export function SurfaceView({source,focused,width,height,isActive,isVisible,publicRender}: {
  source:UiSurfaceSource;focused:boolean;width:number;height:number;isActive():boolean;isVisible():boolean;
  publicRender?:PublicRenderSlotSource;
}) {
  const {color,presentation}=useAppearance();
  const state=useSyncExternalStore(source.subscribe,source.snapshot);
  const publicState=usePublicRenderSnapshot(publicRender);
  const override=hasSurfaceRequest(state)?undefined:publicState.override;
  // Render hooks cannot replace the producer's input field or acquire its owner.
  const view=override?{...override,input:state.view?.input,scrollKeys:state.view?.scrollKeys}:state.view;
  const input=useRef<InputRenderable>(null);
  const fieldId=useRef<string|undefined>(undefined);
  const syncingInput=useRef(false);
  const scroller=useRef<ScrollBoxRenderable>(null);
  const memory=useMemo(()=>{const memory=createConversationScrollMemory();memory.reset(source);memory.record(source.id,{top:0,followBottom:false});return memory;},[source]);
  const publicVisible=isVisible()&&!hasSurfaceRequest(state);
  const scrollReady=usePublicScrollMemory(scroller,source.id,publicVisible,source,memory,Boolean(override));
  const publicScroll=usePublicRenderMeasurement(publicRender,scroller,publicVisible,undefined,
    {ready:scrollReady,input:offset=>{if(override)memory.record(source.id,{top:offset,followBottom:false});}});
  const [selected,setSelected]=useState<string>();
  const [searching,setSearching]=useState(false);
  const pendingRasterReveal=useRef<number | undefined>(undefined);
  const preserveScroll=useRef(false);
  const actions=surfaceActions(view);
  const index=Math.max(0,actions.indexOf(selected??''));
  const action=actions[index];
  const elementId=(key:string)=>'surface-'+source.id+'-'+key;
  const locations=new Map<string,string>();
  const locate=(action:string|undefined,key:string)=>{if(action&&!locations.has(action))locations.set(action,elementId(key));};
  view?.lines.forEach((line,index)=>locate(line.action,'line-'+index));
  view?.table?.rows.forEach(row=>{
    locate(row.action,'row-'+row.id);
    if(row.expanded)row.details?.forEach((line,index)=>locate(line.action,'detail-'+row.id+'-'+index));
  });
  const activeRequest=useRef(isActive);activeRequest.current=isActive;
  const requestSession=useMemo(()=>createSurfaceRequestSession(source,()=>activeRequest.current()),[source]);
  const interaction=surfaceInteraction(state);
  useLayoutEffect(()=>{pendingRasterReveal.current=undefined;preserveScroll.current=false;},[source]);
  useLayoutEffect(()=>{
    const id=action?locations.get(action):undefined;
    if(id&&!preserveScroll.current)scroller.current?.scrollChildIntoView(id);
  },[action,state.revision,publicState.revision,width,height]);
  useLayoutEffect(()=>{
    const revision=pendingRasterReveal.current;
    if(revision===undefined||state.revision<=revision||state.busy)return;
    pendingRasterReveal.current=undefined;
    if(isActive()&&isVisible()&&!hasSurfaceRequest(state)&&view?.raster&&scroller.current){
      preserveScroll.current=true;scroller.current.scrollTo(0);publicScroll.input();
    }
  },[state.revision,state.busy,view?.raster,isActive,isVisible,publicScroll]);
  useLayoutEffect(()=>{
    const field=view?.input;
    if(input.current&&field&&(fieldId.current!==field.id||(!state.busy&&(!focused||!searching)&&input.current.value!==field.value))){
      syncingInput.current=true;
      try{input.current.setText(field.value);}finally{syncingInput.current=false;}
    }
    fieldId.current=field?.id;
  },[focused,searching,state.busy,view?.input?.id,view?.input?.value]);

  const canPress=()=>{
    const current=source.snapshot();
    return isVisible()&&current.revision===state.revision&&!hasSurfaceRequest(current)
      &&(!publicRender||publicRender.snapshot().revision===publicState.revision);
  };
  const press=(key:string)=>{if(canPress()){
    pendingRasterReveal.current=override||view?.raster?undefined:state.revision;
    if(override)publicRender?.press(key,publicState.revision);else source.press(key,state.revision);
  }};
  useKeyboard(key=>{
    if(key.defaultPrevented||!isActive()||hasSurfaceRequest(source.snapshot()))return;
    if(key.name==='escape'&&!key.meta&&!key.ctrl&&searching){key.preventDefault();flushSync(()=>setSearching(false));return;}
    if(key.name==='tab'&&!key.ctrl&&!key.meta){
      key.preventDefault();
      pendingRasterReveal.current=undefined;
      preserveScroll.current=false;
      if(view?.input)flushSync(()=>setSearching(value=>!value));
      else if(actions.length)flushSync(()=>setSelected(actions[(index+(key.shift?-1:1)+actions.length)%actions.length]));
      return;
    }
    if(key.name==='pageup'||key.name==='pagedown'){
      key.preventDefault();pendingRasterReveal.current=undefined;preserveScroll.current=true;publicScroll.input();scroller.current?.scrollBy(key.name==='pageup'?-1:1,'viewport');return;
    }
    if(searching)return;
    if(key.ctrl||key.meta||key.super||key.hyper)return;
    if(key.name==='up'||key.name==='down'){
      key.preventDefault();pendingRasterReveal.current=undefined;preserveScroll.current=false;if(actions.length)flushSync(()=>setSelected(actions[Math.max(0,Math.min(actions.length-1,index+(key.name==='up'?-1:1)))]));
    }else if(key.name==='return'&&action){key.preventDefault();if(!key.repeated&&isActive())press(action);}
    else if((key.name==='left'||key.name==='right')&&view?.tabs){
      const tabs=view.tabs.filter(tab=>!tab.disabled);
      const current=Math.max(0,tabs.findIndex(tab=>tab.selected));
      const tab=tabs[(current+(key.name==='left'?-1:1)+tabs.length)%tabs.length];
      if(tab){key.preventDefault();pendingRasterReveal.current=undefined;preserveScroll.current=false;if(!key.repeated){flushSync(()=>setSelected(tab.action));press(tab.action);}}
    }
  });

  if(hasSurfaceRequest(state))return <box flexGrow={1} flexDirection="column" minHeight={0}>
    {state.controller&&<ControllerFrame key={state.controller.id} controller={state.controller} session={isWindowController(state.controller)?source:requestSession}
      width={width} height={height} focused={focused} isActive={isActive} isVisible={isVisible}/>}
    {state.approval&&<ApprovalCard key={'approval:'+state.approval.id} request={state.approval}
      session={requestSession} height={height} isActive={isActive}/>}
    {interaction&&<box visible={!state.approval} flexGrow={1} flexDirection="column" minHeight={0}>
      <Interaction key={interaction.kind+':'+interaction.id} interaction={interaction} session={requestSession}
        editing focused={focused&&!state.approval} width={width} height={height}
        isActive={()=>isActive()&&!source.snapshot().approval} setEditing={()=>{}} draftToggle={false}/>
    </box>}
  </box>;

  const select=(target:string)=>{pendingRasterReveal.current=undefined;preserveScroll.current=false;setSelected(target);setSearching(false);};
  return <box flexGrow={1} flexDirection="column" paddingX={1} minHeight={0}>
    {view&&<TextViewTabs view={view} elementId={elementId} canPress={canPress} press={press} select={select}/>}
    {view?.input&&<box height={1} flexShrink={0} flexDirection="row" onMouseDown={event=>{
      if(event.button===MouseButton.LEFT&&isVisible()&&!hasSurfaceRequest(source.snapshot()))flushSync(()=>setSearching(true));
    }}>
      <text fg={color.muted}>{literal(view.input.label??'Search')+': '}</text>
      <input key={view.input.id} ref={input} flexGrow={1} minWidth={1} maxLength={4000}
        focused={focused&&searching} placeholder={view.input.placeholder} backgroundColor={color.panel} focusedBackgroundColor={color.panel}
        textColor={color.text} focusedTextColor={color.text} placeholderColor={color.muted}
        onKeyDown={key=>{if(!isActive()||!searching||hasSurfaceRequest(source.snapshot()))key.preventDefault();}}
        onPaste={event=>{if(!isActive()||!searching||hasSurfaceRequest(source.snapshot()))event.preventDefault();}}
        onSubmit={()=>{const submit=surfaceSubmitAction(view);if(isActive()&&searching&&submit)press(submit);}}
        onInput={value=>{
          const current=source.snapshot();
          if(!syncingInput.current&&isActive()&&searching&&!hasSurfaceRequest(current)&&current.view?.input?.id===view.input!.id)source.change(view.input!.id,value,current.revision);
        }} />
    </box>}
    <scrollbox ref={scroller} flexGrow={1} flexBasis={0} minHeight={1} focusable={false} scrollY scrollX={false} onMouse={event=>{
      const box=scroller.current,bar=box?.verticalScrollBar;
      if(event.type==='scroll'||(event.type==='down'&&event.button===0&&event.target===box&&bar?.visible&&event.x>=bar.x&&event.x<bar.x+bar.width&&event.y>=bar.y&&event.y<bar.y+bar.height)){
        pendingRasterReveal.current=undefined;preserveScroll.current=true;
      }
      publicScroll.onMouse(event);
    }}>
      {!view&&<text fg={color.muted}>Waiting for this view</text>}
      {view&&<TextViewContent view={view} width={width-2} height={height} visible={isVisible()} action={action} narrow={width<60} linesActive={!searching}
        elementId={elementId} canPress={canPress} press={press} select={select}/>}
    </scrollbox>
    {state.error&&<text wrapMode="word" fg={color.error}>{literal(state.error)}</text>}
    {state.busy&&<text fg={color.running}>Working…</text>}
    {focused&&(view?.hint||presentation.hints)&&<text truncate fg={color.muted}>{literal(view?.hint??(view?.input?'Tab search/actions · ↑↓ select · Enter activate':'↑↓ select · Enter activate · PgUp/PgDn scroll'))}</text>}
  </box>;
}
