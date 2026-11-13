/** @jsxImportSource @opentui/react */
import {MouseButton,TextAttributes,type InputRenderable,type ScrollBoxRenderable,type KeyBinding} from '@opentui/core';
import {flushSync} from '@opentui/react';
import {useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {color} from './colors.js';
import type {WindowNavigationSource} from './navigation.js';

const literal=(value:string)=>value.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,
  point=>'\\u'+point.charCodeAt(0).toString(16).padStart(4,'0'));
const editingKeys:KeyBinding[]=[
  {name:'z',ctrl:true,action:'undo'},
  {name:'y',ctrl:true,action:'redo'},
  {name:'z',ctrl:true,shift:true,action:'redo'},
];

/** A private launcher above resident panes; no editor or decision is unmounted. */
export function WindowFinder({source,width,height}:{source:WindowNavigationSource;width:number;height:number}){
  const state=useSyncExternalStore(source.subscribe,source.snapshot);
  const input=useRef<InputRenderable>(null),list=useRef<ScrollBoxRenderable>(null);
  const syncing=useRef(false);
  const boxWidth=Math.max(1,Math.min(width,92)),boxHeight=Math.max(1,Math.min(height,22));
  const entryOrder=JSON.stringify(state.entries.map(entry=>entry.id));
  useLayoutEffect(()=>{
    if(input.current&&input.current.value!==state.query){
      syncing.current=true;
      try{input.current.setText(state.query);}finally{syncing.current=false;}
    }
  },[state.query]);
  useLayoutEffect(()=>{
    if(state.selected)list.current?.scrollChildIntoView('window-finder-entry-'+state.selected);
  },[state.selected,entryOrder,state.query,state.selectionRevision,width,height]);
  return <box position="absolute" left={Math.max(0,Math.floor((width-boxWidth)/2))}
    top={Math.max(0,Math.floor((height-boxHeight)/3))} width={boxWidth} height={boxHeight}
    flexDirection="column" border borderColor={color.accent} backgroundColor={color.panel}
    title=" Windows " titleColor={color.accent} paddingX={1}
    onMouseDown={event=>event.stopPropagation()} onMouseUp={event=>event.stopPropagation()}
    onMouseMove={event=>event.stopPropagation()} onMouseDrag={event=>event.stopPropagation()}>
    <box height={1} flexShrink={0}><input ref={input} flexGrow={1} minWidth={1} focused={state.mode==='finder'} maxLength={512} keyBindings={editingKeys}
      placeholder="Search window or command…" textColor={color.text} focusedTextColor={color.text}
      backgroundColor={color.background} focusedBackgroundColor={color.background} placeholderColor={color.muted}
      onKeyDown={event=>{if(source.snapshot().mode!=='finder')event.preventDefault();}}
      onPaste={event=>{if(source.snapshot().mode!=='finder')event.preventDefault();}}
      onInput={value=>{
        const current=source.snapshot();
        if(!syncing.current&&current.mode==='finder')flushSync(()=>source.changeQuery(value,current.revision));
      }}/></box>
    <text fg={color.muted} flexShrink={0} truncate>{state.entries.length+' windows · ↑↓ select · Enter open'}</text>
    <scrollbox ref={list} flexGrow={1} flexBasis={0} minHeight={1} focusable={false} scrollY scrollX={false}>
      {state.entries.length===0&&<text fg={color.muted}>No matching windows</text>}
      {state.entries.map(entry=>{
        const selected=entry.id===state.selected,unavailable=entry.state==='unavailable';
        const status=entry.workspace===undefined?entry.state==='available'?'Available':unavailable?'Unavailable':'Closed':'WS '+entry.workspace;
        return <box key={entry.id} id={'window-finder-entry-'+entry.id} flexDirection="row" height={1} flexShrink={0}
          backgroundColor={selected?color.accent:undefined} onMouseDown={event=>{
            event.stopPropagation();
            if(event.button===MouseButton.LEFT&&!unavailable&&source.snapshot().mode==='finder')
              flushSync(()=>source.choose(entry.id,state.revision));
          }}>
          <text fg={selected?color.background:unavailable?color.muted:color.text} flexGrow={1} truncate
            attributes={selected?TextAttributes.BOLD:TextAttributes.NONE}>{literal(entry.title)}</text>
          <text fg={selected?color.background:color.muted}>{'  '+status}</text>
        </box>;
      })}
    </scrollbox>
    {state.opening&&<text fg={color.running} flexShrink={0}>Opening window…</text>}
    {state.error&&<text fg={color.error} wrapMode="word" flexShrink={0}>{literal(state.error)}</text>}
    <text fg={color.muted} truncate flexShrink={0}>Esc cancel · Ctrl+U clear · Alt+0 Main</text>
  </box>;
}
