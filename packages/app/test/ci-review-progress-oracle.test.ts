import {expect,it} from 'vitest';
import hooks from '../../../plugins/ci-review/hooks.js';
it.each(['success','failure','cancel'])('shows honest busy state until %s settles',async(outcome)=>{
 const state=new Map(),views:any[]=[];let release!:(value:any)=>void,entered!:()=>void;
 const ready=new Promise<void>(done=>{entered=done;}),pending=new Promise(done=>{release=done;});
 const api:any={state,signal:new AbortController().signal,background:()=>api,storage:{config:async()=>({repository:'fixture/repo'})},ui:{view:async(...args:any[])=>{views.push(args);},remove:async()=>{},notify:async()=>{}},agent:{tool:async(_name:string,_args:any,options:any)=>{options.signal.addEventListener('abort',()=>release({ok:false,error:'cancelled'}),{once:true});entered();return pending;}}};
 const press=(key:string)=>hooks['ui.press']({site:'plugin-ci-review-main',key},api),lines=()=>views.at(-1)[2].lines;
 await press('command:/ci');expect(lines().some((line:any)=>line.text.includes('CI operation in progress'))).toBe(false);
 state.set('ci-result',{heading:'Earlier result',output:'PREVIOUS_EVIDENCE'});
 const work=press('refresh');await ready;
 try{
  expect(lines().some((line:any)=>line.text.includes('CI operation in progress')&&line.tone==='accent')).toBe(true);
  expect(lines().some((line:any)=>line.text==='PREVIOUS_EVIDENCE')).toBe(true);
  expect(lines().some((line:any)=>line.action==='cancel')).toBe(true);expect(lines().some((line:any)=>line.action==='close')).toBe(true);
  expect(lines().find((line:any)=>line.text==='Refresh runs').action).toBeUndefined();
 }finally{if(outcome==='cancel')await press('cancel');else release(outcome==='success'?{ok:true,output:{output:'[]',exitCode:0,truncated:false}}:{ok:false,error:'Controlled CI failure'});await work;}
 expect(lines().some((line:any)=>line.text.includes('CI operation in progress'))).toBe(false);
 expect(lines().find((line:any)=>line.text==='Refresh runs').action).toBe('refresh');
 if(outcome==='cancel')expect(JSON.stringify(lines())).toContain('CI review cancelled.');
 if(outcome==='failure')expect(JSON.stringify(lines())).toContain('Controlled CI failure');
});
