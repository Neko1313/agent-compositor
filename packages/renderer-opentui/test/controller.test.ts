import {expect,it} from 'vitest';
import {controllerKey,type ConversationController} from '../src/controller.js';
import {createSurfaceRequestSession,hasSurfaceRequest,surfaceRequestStatus,type UiSurfaceSnapshot,type UiSurfaceSource} from '../src/surface.js';

const key=(name:string,sequence:string,extra:object={})=>({name,sequence,ctrl:false,meta:false,shift:false,...extra});
it('normalizes private controller text, shifted Unicode, named keys and protocol modifiers',()=>{
  expect(controllerKey(key('a','A',{shift:true}))).toEqual({kind:'text',text:'A'});
  expect(controllerKey(key('界','界'))).toEqual({kind:'text',text:'界'});
  expect(controllerKey(key('space',' '))).toEqual({kind:'text',text:' '});
  expect(controllerKey(key('return','\r'))).toEqual({kind:'key',key:'enter',modifiers:[]});
  expect(controllerKey(key('f5','\x1b[15~',{ctrl:true,shift:true}))).toEqual({kind:'key',key:'f5',modifiers:['ctrl','shift']});
  expect(controllerKey(key('x','x',{option:true}))).toEqual({kind:'key',key:'x',modifiers:['meta']});
  expect(controllerKey(key('j','\n',{ctrl:true}))).toEqual({kind:'key',key:'j',modifiers:['ctrl']});
});

it('keeps selected request projections exclusive and rejects stale or unfocused frame input',()=>{
  const frame:ConversationController={id:'lease-a',kind:'form',revision:1,inputRevision:0,preferredRows:3,view:{lines:[{text:'masked'}]}};
  let state:UiSurfaceSnapshot={revision:1,title:'Private',controller:frame,
    interaction:{id:'must-not-leak',kind:'form',plugin:'private',request:{title:'Private',
      fields:[{id:'secret',label:'Secret',type:'password',value:'RAW_PRIVATE_DEFAULT'}],actions:[{id:'save',label:'Save'}]}}};
  const calls:unknown[]=[];
  const source:UiSurfaceSource={id:'private',snapshot:()=>state,subscribe:()=>()=>{},press:()=>{},change:()=>{},
    controllerInput:(...args)=>calls.push(args),controllerViewport:(...args)=>calls.push(args),
    answerInteraction:()=>calls.push('native'),cancelController:id=>calls.push(id)};
  let active=true;
  const session=createSurfaceRequestSession(source,()=>active);
  expect(session.snapshot()).toEqual({messages:[],running:false,controller:frame});
  expect(JSON.stringify(session.snapshot())).not.toContain('RAW_PRIVATE_DEFAULT');
  expect(hasSurfaceRequest(state)).toBe(true);expect(surfaceRequestStatus(state)).toBe('Form');
  session.answerInteraction?.('must-not-leak',{});
  session.controllerInput?.('other',{kind:'text',text:'a'},1);
  session.controllerInput?.('lease-a',{kind:'text',text:'a'},0);
  active=false;session.controllerInput?.('lease-a',{kind:'text',text:'a'},1);session.cancelController?.('lease-a');
  expect(calls).toEqual([]);
  // Hidden live requests can be measured without admitting answers.
  session.controllerViewport?.('lease-a',60,8);expect(calls).toEqual([['lease-a',60,8]]);
  active=true;session.controllerInput?.('lease-a',{kind:'text',text:'a'},1);
  state={...state,controller:{...frame,revision:2}};
  session.controllerInput?.('lease-a',{kind:'text',text:'b'},2);
  expect(calls.slice(1)).toEqual([['lease-a',{kind:'text',text:'a'},1],['lease-a',{kind:'text',text:'b'},2]]);
  state={...state,controller:{...frame,id:'lease-b'}};session.cancelController?.('lease-a');
  expect(calls).toHaveLength(3);
});
