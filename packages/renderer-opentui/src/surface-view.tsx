/** @jsxImportSource @opentui/react */
import {MouseButton, TextAttributes, type InputRenderable, type ScrollBoxRenderable} from '@opentui/core';
import {flushSync, useKeyboard} from '@opentui/react';
import {useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {UiTextView} from '@agent-compositor/events';
import {color} from './colors.js';
import {handleActionMouseDown} from './mouse-action.js';
import {Interaction} from './interaction.js';
import {ApprovalCard} from './approval-card.js';
import {surfaceActions} from './surface-actions.js';
import type {UiSurfaceSource} from './surface.js';
import {createSurfaceRequestSession,hasSurfaceRequest,surfaceInteraction} from './surface.js';
import {SurfaceRaster} from './surface-raster.js';

const toneColor={text:color.text,muted:color.muted,accent:color.accent,success:color.accent,warning:color.running,danger:color.error};
const literal=(text:string)=>text.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,point=>'\\u'+point.charCodeAt(0).toString(16).padStart(4,'0'));

export function SurfaceView({source,focused,width,height,isActive,isVisible}: {
  source:UiSurfaceSource;focused:boolean;width:number;height:number;isActive():boolean;isVisible():boolean;
}) {
  const state=useSyncExternalStore(source.subscribe,source.snapshot);
  const view=state.view;
  const input=useRef<InputRenderable>(null);
  const fieldId=useRef<string|undefined>(undefined);
  const syncingInput=useRef(false);
  const scroller=useRef<ScrollBoxRenderable>(null);
  const [selected,setSelected]=useState<string>();
  const [searching,setSearching]=useState(false);
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
  const narrow=width<60;
  const activeRequest=useRef(isActive);activeRequest.current=isActive;
  const requestSession=useMemo(()=>createSurfaceRequestSession(source,()=>activeRequest.current()),[source]);
  const interaction=surfaceInteraction(state);
  useLayoutEffect(()=>{
    const id=action?locations.get(action):undefined;
    if(id)scroller.current?.scrollChildIntoView(id);
  },[action,state.revision,width,height]);
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
    return isVisible()&&current.revision===state.revision&&!hasSurfaceRequest(current);
  };
  const press=(key:string)=>{if(canPress())source.press(key,state.revision);};
  useKeyboard(key=>{
    if(key.defaultPrevented||!isActive()||hasSurfaceRequest(source.snapshot()))return;
    if(key.name==='escape'&&!key.meta&&!key.ctrl&&searching){key.preventDefault();flushSync(()=>setSearching(false));return;}
    if(key.name==='tab'&&!key.ctrl&&!key.meta){
      key.preventDefault();
      if(view?.input)flushSync(()=>setSearching(value=>!value));
      else if(actions.length)flushSync(()=>setSelected(actions[(index+(key.shift?-1:1)+actions.length)%actions.length]));
      return;
    }
    if(key.name==='pageup'||key.name==='pagedown'){
      key.preventDefault();scroller.current?.scrollBy(key.name==='pageup'?-1:1,'viewport');return;
    }
    if(searching)return;
    if(key.ctrl||key.meta||key.super||key.hyper)return;
    if(key.name==='up'||key.name==='down'){
      key.preventDefault();if(actions.length)flushSync(()=>setSelected(actions[Math.max(0,Math.min(actions.length-1,index+(key.name==='up'?-1:1)))]));
    }else if(key.name==='return'&&action){key.preventDefault();if(!key.repeated&&isActive())press(action);}
    else if((key.name==='left'||key.name==='right')&&view?.tabs){
      const tabs=view.tabs.filter(tab=>!tab.disabled);
      const current=Math.max(0,tabs.findIndex(tab=>tab.selected));
      const tab=tabs[(current+(key.name==='left'?-1:1)+tabs.length)%tabs.length];
      if(tab){key.preventDefault();if(!key.repeated){flushSync(()=>setSelected(tab.action));press(tab.action);}}
    }
  });

  if(hasSurfaceRequest(state))return <box flexGrow={1} flexDirection="column" minHeight={0}>
    {state.approval&&<ApprovalCard key={'approval:'+state.approval.id} request={state.approval}
      session={requestSession} height={height} isActive={isActive}/>}
    {interaction&&<box visible={!state.approval} flexGrow={1} flexDirection="column" minHeight={0}>
      <Interaction key={interaction.kind+':'+interaction.id} interaction={interaction} session={requestSession}
        editing focused={focused&&!state.approval} width={width} height={height}
        isActive={()=>isActive()&&!source.snapshot().approval} setEditing={()=>{}} draftToggle={false}/>
    </box>}
  </box>;

  function line(line:UiTextView['lines'][number],key:string){
    const target=line.action;
    const chosen=Boolean(target&&target===action&&!searching);
    return <box key={key} id={elementId(key)} flexShrink={0}
      backgroundColor={chosen?color.rule:undefined} onMouseDown={event=>{
        if(target)handleActionMouseDown(event,canPress(),()=>{
          flushSync(()=>{setSelected(target);setSearching(false);});press(target);
        });
      }}>
      <text selectable={!target} wrapMode="word" fg={chosen?color.accent:toneColor[line.tone??'text']}
        attributes={line.bold||chosen?TextAttributes.BOLD:TextAttributes.NONE}>{literal(line.text)}</text>
    </box>;
  }
  return <box flexGrow={1} flexDirection="column" paddingX={1} minHeight={0}>
    {view?.tabs&&<box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
      {view.tabs.map(tab=><box key={tab.id} id={elementId('tab-'+tab.id)} height={1} paddingX={1}
        backgroundColor={tab.selected?color.accent:color.panel} onMouseDown={event=>{
          handleActionMouseDown(event,!tab.disabled&&canPress(),()=>{
            flushSync(()=>{setSelected(tab.action);setSearching(false);});press(tab.action);
          });
        }}><text selectable={false} fg={tab.disabled?color.muted:tab.selected?color.background:color.text}>{literal(tab.label)}</text></box>)}
    </box>}
    {view?.input&&<box height={1} flexShrink={0} flexDirection="row" onMouseDown={event=>{
      if(event.button===MouseButton.LEFT&&isVisible()&&!hasSurfaceRequest(source.snapshot()))flushSync(()=>setSearching(true));
    }}>
      <text fg={color.muted}>{literal(view.input.label??'Search')+': '}</text>
      <input key={view.input.id} ref={input} flexGrow={1} minWidth={1} maxLength={4000}
        focused={focused&&searching} placeholder={view.input.placeholder} backgroundColor={color.panel} focusedBackgroundColor={color.panel}
        textColor={color.text} focusedTextColor={color.text} placeholderColor={color.muted}
        onKeyDown={key=>{if(!isActive()||!searching||hasSurfaceRequest(source.snapshot()))key.preventDefault();}}
        onPaste={event=>{if(!isActive()||!searching||hasSurfaceRequest(source.snapshot()))event.preventDefault();}}
        onInput={value=>{
          const current=source.snapshot();
          if(!syncingInput.current&&isActive()&&searching&&!hasSurfaceRequest(current)&&current.view?.input?.id===view.input!.id)source.change(view.input!.id,value,current.revision);
        }} />
    </box>}
    <scrollbox ref={scroller} flexGrow={1} flexBasis={0} minHeight={1} focusable={false} scrollY scrollX={false}>
      {!view&&<text fg={color.muted}>Waiting for this view</text>}
      {view?.raster&&<SurfaceRaster raster={view.raster} width={width-2} height={height} visible={isVisible()}/>}
      {view?.lines.map((row,index)=>line(row,'line-'+index))}
      {view?.table&&<>
        {!narrow&&<box flexDirection="row">{view.table.columns.map((column,index)=><text key={index} flexBasis={0}
          flexGrow={column.width??1} fg={color.muted} truncate>{literal(column.label)}</text>)}</box>}
        {!view.table.rows.length&&<text fg={color.muted}>{literal(view.table.empty??'No rows')}</text>}
        {view.table.rows.map(row=><box key={row.id} flexDirection="column" flexShrink={0}>
          <box id={elementId('row-'+row.id)} flexDirection={narrow?'column':'row'}
            backgroundColor={row.action===action?color.rule:undefined} onMouseDown={event=>{
              const target=row.action;
              if(target)handleActionMouseDown(event,canPress(),()=>{
                flushSync(()=>{setSelected(target);setSearching(false);});press(target);
              });
            }}>
            {row.cells.map((cell,index)=><text key={index} selectable={!row.action} wrapMode={narrow?'word':'none'}
              {...(narrow?{}:{flexBasis:0,flexGrow:view.table!.columns[index].width??1})} truncate={!narrow}
              fg={row.action===action?color.accent:toneColor[row.tone??'text']}>
              {literal((narrow?view.table!.columns[index].label+': ':'')+cell)}
            </text>)}
          </box>
          {row.expanded&&row.details?.map((detail,index)=>line(detail,'detail-'+row.id+'-'+index))}
        </box>)}
      </>}
    </scrollbox>
    {state.error&&<text wrapMode="word" fg={color.error}>{literal(state.error)}</text>}
    {state.busy&&<text fg={color.running}>Working…</text>}
    {focused&&<text truncate fg={color.muted}>{view?.hint??(view?.input?'Tab search/actions · ↑↓ select · Enter activate':'↑↓ select · Enter activate · PgUp/PgDn scroll')}</text>}
  </box>;
}
