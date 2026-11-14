/** @jsxImportSource @opentui/react */
import {TextAttributes} from '@opentui/core';
import {flushSync} from '@opentui/react';
import type {UiTextView} from '@agent-compositor/events';
import {useAppearance} from './appearance.js';
import {handleActionMouseDown} from './mouse-action.js';
import {SurfaceRaster} from './surface-raster.js';

export const literalViewText=(text:string)=>text.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,point=>'\\u'+point.charCodeAt(0).toString(16).padStart(4,'0'));

interface TextViewProps {
  view:UiTextView;
  width:number;
  height:number;
  visible:boolean;
  action?:string;
  narrow?:boolean;
  linesActive?:boolean;
  elementId(key:string):string;
  canPress():boolean;
  press(action:string):void;
  select?(action:string):void;
}

export function TextViewTabs({view,elementId,canPress,press,select}:Omit<TextViewProps,'width'|'height'|'visible'|'action'>){
  const {color}=useAppearance();
  return view.tabs&&<box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
    {view.tabs.map(tab=><box key={tab.id} id={elementId('tab-'+tab.id)} height={1} paddingX={1}
      backgroundColor={tab.selected?color.selectionBackground:color.panel} onMouseDown={event=>{
        handleActionMouseDown(event,!tab.disabled&&canPress(),()=>{flushSync(()=>select?.(tab.action));press(tab.action);});
      }}><text selectable={false} fg={tab.disabled?color.muted:tab.selected?color.selectionText:color.text}>{literalViewText(tab.label)}</text></box>)}
  </box>;
}

/** Portable public presentation only. Input fields keep their producer-owned widget. */
export function TextViewContent({view,width,height,visible,action,narrow=width<60,linesActive=true,elementId,canPress,press,select}:TextViewProps){
  const {color,tones}=useAppearance();
  const activate=(target:string)=>{flushSync(()=>select?.(target));press(target);};
  function line(row:UiTextView['lines'][number],key:string){
    const chosen=Boolean(linesActive&&row.action&&row.action===action);
    return <box key={key} id={elementId(key)} flexShrink={0}
      backgroundColor={row.selected?color.selectionBackground:chosen?color.actionBackground:undefined} onMouseDown={event=>{
        if(row.action)handleActionMouseDown(event,canPress(),()=>activate(row.action!));
      }}><text selectable={!row.action} wrapMode="word" fg={row.selected?color.selectionText:chosen?color.actionText:tones[row.tone??'text']}
        attributes={row.bold||row.selected||chosen?TextAttributes.BOLD:TextAttributes.NONE}>{literalViewText(row.text)}</text></box>;
  }
  return <>
    {view.raster&&<SurfaceRaster raster={view.raster} width={width} height={height} visible={visible}/>}
    {view.lines.map((row,index)=>line(row,'line-'+index))}
    {view.table&&<>
      {!narrow&&<box flexDirection="row">{view.table.columns.map((column,index)=><text key={index} flexBasis={0}
        flexGrow={column.width??1} fg={color.muted} truncate>{literalViewText(column.label)}</text>)}</box>}
      {!view.table.rows.length&&<text fg={color.muted}>{literalViewText(view.table.empty??'No rows')}</text>}
      {view.table.rows.map(row=><box key={row.id} flexDirection="column" flexShrink={0}>
        <box id={elementId('row-'+row.id)} flexDirection={narrow?'column':'row'}
          backgroundColor={row.action===action?color.actionBackground:undefined} onMouseDown={event=>{
            if(row.action)handleActionMouseDown(event,canPress(),()=>activate(row.action!));
          }}>
          {row.cells.map((cell,index)=><text key={index} selectable={!row.action} wrapMode={narrow?'word':'none'}
            {...(narrow?{}:{flexBasis:0,flexGrow:view.table!.columns[index].width??1})} truncate={!narrow}
            fg={row.action===action?color.actionText:tones[row.tone??'text']}>
            {literalViewText((narrow?view.table!.columns[index].label+': ':'')+cell)}
          </text>)}
        </box>
        {row.expanded&&row.details?.map((detail,index)=>line(detail,'detail-'+row.id+'-'+index))}
      </box>)}
    </>}
  </>;
}
