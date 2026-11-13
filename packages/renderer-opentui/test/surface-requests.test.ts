import {expect,it} from 'vitest';
import {createSurfaceRequestSession,hasSurfaceRequest,surfaceInteraction,surfaceRequestStatus,type UiSurfaceSnapshot,type UiSurfaceSource} from '../src/surface.js';
import type {ConversationApproval,ConversationInteraction} from '../src/session.js';

const form=(id:string):Extract<ConversationInteraction,{kind:'form'}>=>({id,kind:'form',plugin:'private-owner',
  request:{title:'Connection',fields:[{id:'name',label:'Name',type:'text'}],actions:[{id:'save',label:'Save'}]}});
const question=(id:string):Extract<ConversationInteraction,{kind:'question'}>=>({id,kind:'question',
  request:{questions:[{id:'mode',question:'Choose mode',options:['First','Second']}]}});
const approval=(id:string):ConversationApproval=>({id,tool:'exec',reason:'Manual review',details:[{label:'Command',value:'controlled fixture'}]});
function fixture(id:string,initial:Partial<UiSurfaceSnapshot>){
  let state:UiSurfaceSnapshot={revision:1,title:id,...initial};
  const calls:{kind:string;id:string;value?:unknown}[]=[];
  const source:UiSurfaceSource={id,snapshot:()=>state,subscribe:()=>()=>{},press:()=>{},change:()=>{},
    answerApproval:(id,value)=>{calls.push({kind:'approval',id,value});},
    answerInteraction:(id,value)=>{calls.push({kind:'interaction',id,value});},
    cancelInteraction:id=>{calls.push({kind:'cancel',id});},
    answerForm:(id,value)=>{calls.push({kind:'legacy-form',id,value});},
    cancelForm:id=>{calls.push({kind:'legacy-cancel',id});},
  };
  return{source,calls,set(next:Partial<UiSurfaceSnapshot>){state={revision:state.revision+1,title:id,...next};}};
}

it('prioritizes explicit private requests over legacy form aliases and Working labels',()=>{
  const legacy=form('legacy'),current=question('question');
  const state:UiSurfaceSnapshot={revision:1,title:'Tool',busy:true,form:legacy,interaction:current,approval:approval('approval')};
  expect(surfaceInteraction(state)).toBe(current);expect(surfaceRequestStatus(state)).toBe('Approval');
  expect(surfaceRequestStatus({...state,approval:undefined})).toBe('Question');
  expect(surfaceRequestStatus({...state,approval:undefined,interaction:undefined})).toBe('Form');
  expect(surfaceRequestStatus({revision:1,title:'Tool',busy:true})).toBe('Working');
  expect(surfaceRequestStatus({revision:1,title:'Tool'})).toBe('');
  for(const request of [{approval:state.approval},{interaction:current},{form:legacy}])
    expect(hasSurfaceRequest({revision:1,title:'Tool',...request})).toBe(true);
  expect(hasSurfaceRequest({revision:1,title:'Tool',busy:true})).toBe(false);
});

it('dispatches answers and cancellation only to the active source and its current request identity',()=>{
  const a=fixture('pane-a',{interaction:question('question-a')}),b=fixture('pane-b',{interaction:form('form-b')});
  let focused='pane-a';
  const first=createSurfaceRequestSession(a.source,()=>focused===a.source.id),second=createSurfaceRequestSession(b.source,()=>focused===b.source.id);
  first.answerInteraction?.('form-b',{action:'save'});second.answerInteraction?.('form-b',{action:'save'});second.cancelInteraction?.('form-b');
  expect(a.calls).toEqual([]);expect(b.calls).toEqual([]);
  const answer={answers:[{id:'mode',selected:['Second']}]};first.answerInteraction?.('question-a',answer);
  expect(a.calls).toEqual([{kind:'interaction',id:'question-a',value:answer}]);expect(b.calls).toEqual([]);
  focused='pane-b';first.cancelInteraction?.('question-a');second.cancelInteraction?.('form-b');
  expect(a.calls).toHaveLength(1);expect(b.calls).toEqual([{kind:'cancel',id:'form-b'}]);
});

it('keeps a stable adapter current through validation revisions and rejects callbacks for replaced requests',()=>{
  const f=fixture('private',{interaction:form('same-request')}),session=createSurfaceRequestSession(f.source,()=>true);
  const revised={...form('same-request'),error:'Complete the required field'};
  f.set({interaction:revised});expect(session.snapshot().interaction).toBe(revised);
  session.answerInteraction?.('same-request',{action:'save',values:{name:'Ada'}});
  f.set({interaction:form('next-request')});session.answerInteraction?.('same-request',{action:'save'});session.cancelInteraction?.('same-request');
  expect(f.calls).toEqual([{kind:'interaction',id:'same-request',value:{action:'save',values:{name:'Ada'}}}]);
  session.cancelInteraction?.('next-request');expect(f.calls.at(-1)).toEqual({kind:'cancel',id:'next-request'});
});

it('reserves input for a private approval and passes only its matching explicit decision',()=>{
  const f=fixture('private',{approval:approval('approval-a'),interaction:question('question-a')});
  let active=true;const session=createSurfaceRequestSession(f.source,()=>active);
  session.answerInteraction?.('question-a',{});session.cancelInteraction?.('question-a');session.answerApproval?.('other',true);
  expect(f.calls).toEqual([]);
  active=false;session.answerApproval?.('approval-a',true);expect(f.calls).toEqual([]);
  active=true;session.answerApproval?.('approval-a',false);
  expect(f.calls).toEqual([{kind:'approval',id:'approval-a',value:false}]);
  f.set({approval:approval('approval-b')});session.answerApproval?.('approval-a',true);
  expect(f.calls).toHaveLength(1);
  session.answerApproval?.('approval-b',true);expect(f.calls.at(-1)).toEqual({kind:'approval',id:'approval-b',value:true});
  delete f.source.answerApproval;expect(session.answerApproval).toBeUndefined();
});

it('keeps form-only callback compatibility without routing questions through the legacy form API',()=>{
  const f=fixture('legacy',{form:form('form')});delete f.source.answerInteraction;delete f.source.cancelInteraction;
  const session=createSurfaceRequestSession(f.source,()=>true),value={action:'save',values:{name:'Legacy'}};
  session.answerInteraction?.('form',value);session.cancelInteraction?.('form');
  expect(f.calls).toEqual([{kind:'legacy-form',id:'form',value},{kind:'legacy-cancel',id:'form'}]);
  f.set({form:form('form'),interaction:question('question')});
  session.answerInteraction?.('question',{});session.cancelInteraction?.('question');session.answerInteraction?.('form',value);
  expect(f.calls).toHaveLength(2);
});
