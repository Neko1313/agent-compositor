/** @jsxImportSource @opentui/react */
import {MouseButton,TextAttributes,parseColor,defaultTextareaKeyBindings,type BoxRenderable,type InputRenderable,type MouseEvent,type KeyBinding} from '@opentui/core';
import {flushSync,useKeyboard,usePaste} from '@opentui/react';
import {useLayoutEffect,useRef} from 'react';
import {controllerKey,type ConversationController,type ConversationEditor,type WindowController,type ControllerInput,type ControllerView} from './controller.js';
import {color} from './colors.js';
import {handleActionMouseDown} from './mouse-action.js';
import {SurfaceRaster} from './surface-raster.js';

const tones={text:color.text,muted:color.muted,accent:color.accent,success:color.accent,warning:color.running,danger:color.error};
const literal=(text:string)=>text.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,point=>'\\u'+point.charCodeAt(0).toString(16).padStart(4,'0'));
const fieldKeys:KeyBinding[]=[{name:'z',ctrl:true,action:'undo'},{name:'y',ctrl:true,action:'redo'},{name:'z',ctrl:true,shift:true,action:'redo'}];
const nativeFieldKeys=[...defaultTextareaKeyBindings,...fieldKeys].filter(binding=>!['newline','submit'].includes(binding.action));
function cellColor(value:string|undefined,fallback:string){
  try{return parseColor(value??fallback);}catch{return parseColor(fallback);}
}

interface ControllerFrameSource {
  snapshot():{controller?:ConversationController|WindowController;editor?:ConversationEditor};
  controllerInput?(id:string,input:ControllerInput,revision:number):number|undefined;
  controllerViewport?(id:string,columns:number,rows:number):void;
  editorInput?(id:string,input:ControllerInput,revision:number):number|undefined;
  editorViewport?(id:string,columns:number,rows:number,maxRows?:number):void;
}

/** A private validated frame, with input forwarded to its host-owned lease. */
export function ControllerFrame({controller,session,width,height,maxRows=height,focused,isActive,isVisible,main=false}: {
  controller:ConversationController|ConversationEditor|WindowController;session:ControllerFrameSource;width:number;height:number;maxRows?:number;
  focused:boolean;isActive():boolean;isVisible():boolean;main?:boolean;
}) {
  const bounds=useRef<BoxRenderable>(null);
  const field=useRef<InputRenderable>(null);
  const syncing=useRef(false);
  const fieldId=useRef<string|undefined>(undefined);
  const latestChange=useRef(0);
  const captured=useRef(false);
  const view=controller.view;
  const hintRows=Number(Boolean(view.hint)&&height>1);
  const contentHeight=Math.max(1,height-hintRows);
  const current=()=>{
    const state=session.snapshot(),frame=controller.kind==='editor'?state.editor:state.controller;
    return isActive()&&frame?.id===controller.id&&(frame.kind!=='editor'||frame.available)?frame:undefined;
  };
  const send=(input:ControllerInput,revision?:number)=>{
    const frame=current();
    let ticket:number|undefined;
    if(frame&&(revision===undefined||revision===frame.revision))
      flushSync(()=>{ticket=(frame.kind==='editor'?session.editorInput:session.controllerInput)?.(frame.id,input,revision??frame.revision);});
    return ticket;
  };
  useLayoutEffect(()=>{
    if(!isVisible()||width<=0||maxRows<=0)return;
    if(controller.kind==='editor')session.editorViewport?.(controller.id,width,contentHeight,Math.max(1,maxRows-hintRows));
    else session.controllerViewport?.(controller.id,width,Math.max(1,maxRows-hintRows));
  },[session,controller.id,width,maxRows,hintRows,contentHeight,isVisible()]);
  useLayoutEffect(()=>{
    const input=view.input;
    if(fieldId.current!==input?.id){fieldId.current=input?.id;latestChange.current=0;}
    // Intermediate async acknowledgements must not rewind newer local typing.
    if(controller.inputRevision<latestChange.current)return;
    if(input&&field.current&&field.current.value!==input.value){
      syncing.current=true;
      try{field.current.setText(input.value);}finally{syncing.current=false;}
    }
  },[view.input?.id,view.input?.value,controller.inputRevision,focused]);
  useKeyboard(key=>{
    if(key.defaultPrevented||!current())return;
    // Parent hooks may subscribe after a child on the first mount. Explicitly
    // leave host cancellation and Main's input-owner/interrupt chords to them.
    if(key.ctrl&&!key.meta&&key.name==='c'||main&&(key.meta&&!key.ctrl&&key.name==='i'||key.ctrl&&!key.meta&&key.name==='x'))return;
    // A declared portable input owns its native text editing. Its changes use
    // the semantic port; function keys and decisions still reach the controller.
    const historyNavigation=controller.kind==='history'&&!key.ctrl&&!key.meta&&!key.option&&!key.super&&!key.hyper
      &&['up','down','pageup','pagedown'].includes(key.name);
    if(view.input&&!historyNavigation&&(controllerKey(key).kind==='text'||nativeFieldKeys.some(binding=>binding.name===key.name
      &&Boolean(binding.ctrl)===key.ctrl&&Boolean(binding.meta)===Boolean(key.meta||key.option)
      &&Boolean(binding.shift)===key.shift&&Boolean(binding.super)===Boolean(key.super)&&!key.hyper)))return;
    key.preventDefault();key.stopPropagation();
    send(controllerKey(key));
  });
  usePaste(event=>{
    if(event.defaultPrevented||!current()||view.input)return;
    event.preventDefault();event.stopPropagation();
    send({kind:'text',text:new TextDecoder().decode(event.bytes),paste:true});
  });
  function mouse(event:MouseEvent,action:'press'|'move'|'release'){
    const held=captured.current;
    if(action==='release')captured.current=false;
    const frame=current(),area=bounds.current;
    if(event.defaultPrevented||!frame||frame.revision!==controller.revision||!area)return;
    const row=event.y-area.y,col=event.x-area.x;
    if(row<0||col<0||row>=area.height||col>=area.width||(action!=='press'&&!held))return;
    if(action==='press')captured.current=true;
    event.preventDefault();event.stopPropagation();
    send({kind:'mouse',row,col,button:event.button===MouseButton.LEFT?'left':event.button===MouseButton.RIGHT?'right':'middle',action},controller.revision);
  }
  useLayoutEffect(()=>{if(!focused||!isActive())captured.current=false;},[focused,isActive()]);
  function action(event:MouseEvent,target:string|undefined){
    if(target)handleActionMouseDown(event,Boolean(current())&&current()?.revision===controller.revision,
      ()=>send({kind:'action',action:target},controller.revision));
  }
  function line(row:ControllerView['lines'][number],id:string){
    return <box key={id} height={1} flexShrink={0} backgroundColor={row.selected?color.accent:undefined} onMouseDown={event=>action(event,row.action)}>
      <text selectable={false} wrapMode="none" truncate fg={row.selected?color.background:tones[row.tone??'text']}
        attributes={row.bold||row.selected?TextAttributes.BOLD:TextAttributes.NONE}>
        {row.cells?row.cells.slice(0,width).map((cell,index)=><span key={index}
          fg={cellColor(row.selected?color.background:cell.fg,tones[row.tone??'text'])} bg={cellColor(row.selected?color.accent:cell.bg,color.background)}
          attributes={(cell.bold||row.selected?TextAttributes.BOLD:0)|(cell.dim?TextAttributes.DIM:0)
            |(cell.italic?TextAttributes.ITALIC:0)|(cell.underline?TextAttributes.UNDERLINE:0)}>{literal(cell.ch)}</span>):literal(row.text)}
      </text>
    </box>;
  }
  return <box width={width} height={Math.max(1,height)} flexShrink={0} overflow="hidden" flexDirection="column">
    <box ref={bounds} width={width} height={contentHeight} flexShrink={0} overflow="hidden" flexDirection="column"
    onMouseDown={event=>mouse(event,'press')} onMouseMove={event=>mouse(event,'move')} onMouseUp={event=>mouse(event,'release')}>
    {view.tabs&&<box height={1} flexShrink={0} flexDirection="row" gap={1}>
      {view.tabs.map(tab=><box key={tab.id} paddingX={1} backgroundColor={tab.selected?color.accent:color.panel}
        onMouseDown={event=>{if(!tab.disabled)action(event,tab.action);}}>
        <text truncate fg={tab.disabled?color.muted:tab.selected?color.background:color.text}>{literal(tab.label)}</text>
      </box>)}
    </box>}
    {view.input&&<box height={1} flexShrink={0} flexDirection="row" onMouseDown={event=>{
      handleActionMouseDown(event,Boolean(current()),()=>field.current?.focus());
    }}>
      <text fg={color.muted}>{literal(view.input.label??'Search')+': '}</text>
      <input key={view.input.id} ref={field} focused={focused} flexGrow={1} minWidth={1} maxLength={4000} keyBindings={fieldKeys}
        placeholder={view.input.placeholder} textColor={color.text} focusedTextColor={color.text}
        backgroundColor={color.panel} focusedBackgroundColor={color.panel} placeholderColor={color.muted}
        onKeyDown={key=>{if(!current())key.preventDefault();}} onPaste={event=>{if(!current())event.preventDefault();}}
        onInput={value=>{
          if(syncing.current||!current())return;
          const ticket=send({kind:'change',id:view.input!.id,value});
          if(ticket!==undefined)latestChange.current=ticket;
        }}/>
    </box>}
    {view.raster&&<SurfaceRaster raster={view.raster} width={width} height={height} visible={isVisible()}/>}
    {view.lines.slice(0,contentHeight).map((row,index)=>line(row,'line-'+index))}
    {view.table&&<>
      <box height={1} flexShrink={0} flexDirection="row">{view.table.columns.map((column,index)=><text key={index}
        flexBasis={0} flexGrow={column.width??1} truncate fg={color.muted}>{literal(column.label)}</text>)}</box>
      {!view.table.rows.length&&<text fg={color.muted}>{literal(view.table.empty??'No rows')}</text>}
      {view.table.rows.slice(0,height).map(row=><box key={row.id} flexDirection="column" flexShrink={0}>
        <box height={1} flexDirection="row" onMouseDown={event=>action(event,row.action)}>
          {row.cells.map((cell,index)=><text key={index} flexBasis={0} flexGrow={view.table!.columns[index].width??1}
            truncate fg={tones[row.tone??'text']}>{literal(cell)}</text>)}
        </box>
        {row.expanded&&row.details?.slice(0,height).map((row,index)=>line(row,'detail-'+index))}
      </box>)}
    </>}
    </box>
    {hintRows>0&&<text width={width} height={1} truncate fg={color.muted}>{literal(view.hint!)}</text>}
  </box>;
}
