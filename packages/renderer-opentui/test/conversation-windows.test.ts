import {expect,it} from 'vitest';
import {conversationInputWindow,groupConversationWindows,type ConversationWindow} from '../src/conversation-windows.js';
import type {ConversationSession} from '../src/session.js';

function port(id:string,conversationId?:string):ConversationSession{
  const state={messages:[],running:false};
  return{id,conversationId,label:'Main',snapshot:()=>state,subscribe:()=>()=>{},submit:()=>{}};
}
const window=(id:string,session:ConversationSession):ConversationWindow=>({id,label:id,session});

it('groups copied windows under one input identity without merging independent conversations',()=>{
  const main=port('core-a','main'),copy=port('core-a','main'),side=port('core-b');
  const groups=groupConversationWindows([window('session',main),window('window-2',copy),window('side',side)]);
  expect(groups.map(group=>[group.id,group.windows.map(window=>window.id)])).toEqual([
    ['main',['session','window-2']],['core-b',['side']],
  ]);
  expect(conversationInputWindow(groups[0],'window-2').session).toBe(copy);
  expect(conversationInputWindow(groups[1],'window-2').session).toBe(side);
});

it('parks the resident input at its previous closed or hidden identity until another copy is explicitly focused',()=>{
  const main=port('core-a','main');
  const [group]=groupConversationWindows([window('session',main),window('window-2',main)]);
  expect(conversationInputWindow(group,'plugin-settings','window-2').id).toBe('window-2');
  expect(conversationInputWindow(group,'session','window-2').id).toBe('session');
  expect(conversationInputWindow(group,'input','removed-window').id).toBe('session');
});

it('keeps the logical resident key and selected pane across an atomic Core replacement',()=>{
  const previous=groupConversationWindows([window('session',port('old','main')),window('window-2',port('old','main'))])[0];
  const replacement=groupConversationWindows([window('session',port('new','main')),window('window-2',port('new','main'))])[0];
  expect(replacement.id).toBe(previous.id);
  expect(conversationInputWindow(replacement,'plugin-settings','window-2').session.id).toBe('new');
  expect(()=>groupConversationWindows([window('session',port('new','main')),window('window-2',port('old','main'))]))
    .toThrow('one conversation generation');
  expect(()=>groupConversationWindows([
    window('session',{...port('same-journal','main'),generation:2}),window('window-2',{...port('same-journal','main'),generation:1}),
  ])).toThrow('one conversation generation');
});

it('rejects colliding or excessive pane identities before mounting native owners',()=>{
  const main=port('core-a','main');
  expect(()=>groupConversationWindows([window('session',main),window('session',main)])).toThrow('distinct bounded');
  expect(()=>groupConversationWindows(Array.from({length:257},(_,index)=>window('window-'+index,main)))).toThrow('Too many');
  expect(groupConversationWindows([])).toEqual([]);
  expect(()=>conversationInputWindow({id:'main',windows:[]},'input')).toThrow('window identity');
});
