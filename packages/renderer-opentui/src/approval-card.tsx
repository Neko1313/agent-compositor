/** @jsxImportSource @opentui/react */
import {TextAttributes,type ScrollBoxRenderable} from '@opentui/core';
import {useKeyboard} from '@opentui/react';
import {useRef} from 'react';
import {color} from './colors.js';
import type {ConversationApproval,ConversationSession} from './session.js';
import {handleActionMouseDown} from './mouse-action.js';

// Keep control and bidirectional formatting characters visible in the action being reviewed.
function approvalText(value:string){
  return value.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,point=>'\\u'+point.charCodeAt(0).toString(16).padStart(4,'0'));
}
const actions=[
  {key:'y',label:'Alt+Y Allow once',allow:true},
  {key:'n',label:'Alt+N Deny',allow:false},
] as const;

export function ApprovalCard({request,session,height,isActive}:{
  request:ConversationApproval;session:ConversationSession;height:number;isActive():boolean;
}){
  const scroller=useRef<ScrollBoxRenderable>(null),answered=useRef(false);
  const current=()=>isActive()&&session.snapshot().approval?.id===request.id;
  function answer(allow:boolean){
    if(answered.current||!current()||!session.answerApproval)return;
    answered.current=true;
    try{session.answerApproval(request.id,allow);}catch(error){answered.current=false;throw error;}
  }
  useKeyboard(key=>{
    if(key.defaultPrevented||!current())return;
    if(key.name==='pageup'||key.name==='pagedown'){
      key.preventDefault();scroller.current?.scrollBy(key.name==='pageup'?-1:1,'viewport');return;
    }
    if(!key.meta||key.ctrl||key.shift||key.super||key.hyper)return;
    const action=actions.find(action=>action.key===key.name);
    if(!action||!session.answerApproval)return;
    key.preventDefault();if(!key.repeated)answer(action.allow);
  });
  return <box flexDirection="column" flexShrink={0} paddingX={1} border borderColor={color.running}
    backgroundColor={color.panel} title=" Approval required " titleColor={color.running}>
    <scrollbox ref={scroller} maxHeight={Math.max(1,Math.min(12,Math.floor(height/3)))}
      focusable={false} scrollX={false} scrollY contentOptions={{minHeight:0}}>
      <text wrapMode="word" fg={color.text} attributes={TextAttributes.BOLD}>{`Tool: ${approvalText(request.tool)}`}</text>
      {request.reason&&<text wrapMode="word" fg={color.text}>{`Reason: ${approvalText(request.reason)}`}</text>}
      {request.details.map(({label,value},index)=><text key={index} wrapMode="word" fg={color.text}>{`${approvalText(label)}: ${approvalText(value)}`}</text>)}
    </scrollbox>
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
      {session.answerApproval?actions.map(action=><box key={action.key} height={1} paddingX={1} backgroundColor={color.rule}
        onMouseDown={event=>{handleActionMouseDown(event,!answered.current&&current()&&!!session.answerApproval,()=>answer(action.allow));}}>
        <text selectable={false} fg={color.text} attributes={TextAttributes.BOLD}>{action.label}</text>
      </box>):<text fg={color.muted}>Waiting for host decision</text>}
    </box>
  </box>;
}
