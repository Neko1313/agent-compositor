import {expect,it} from 'vitest';
import {createEditorInputOwnership} from '../src/editor-ownership.js';

it('checks live editor focus before navigation even when chrome has not repainted',()=>{
  const ownership=createEditorInputOwnership(),owner={};
  let available=true,focused=true,normal=true,answer=false,visible=true;
  const notifications:boolean[]=[];
  const stop=ownership.subscribe(()=>notifications.push(ownership.snapshot()));
  const remove=ownership.register(owner,()=>available&&focused&&normal&&!answer&&visible);
  expect(ownership.ownsInput()).toBe(true);expect(ownership.snapshot()).toBe(true);
  for(const mode of ['answer','other pane','finder','hidden','unavailable']){
    available=mode!=='unavailable';focused=mode!=='other pane';normal=mode!=='finder';answer=mode==='answer';visible=mode!=='hidden';
    expect(ownership.ownsInput(),mode).toBe(false);
    ownership.refresh();expect(ownership.snapshot(),mode).toBe(false);
    available=focused=normal=visible=true;answer=false;
    expect(ownership.ownsInput(),mode+' return to Draft').toBe(true);
    ownership.refresh();
  }
  expect(notifications).toEqual([true,false,true,false,true,false,true,false,true,false,true]);
  stop();remove();expect(ownership.ownsInput()).toBe(false);expect(ownership.snapshot()).toBe(false);
});

it('keeps other resident owners and a replacement registration alive after stale cleanup',()=>{
  const ownership=createEditorInputOwnership(),main={},other={};
  const old=ownership.register(main,()=>true);
  const replacement=ownership.register(main,()=>false);
  old();expect(ownership.ownsInput()).toBe(false);
  const releaseOther=ownership.register(other,()=>true);
  replacement();expect(ownership.ownsInput()).toBe(true);
  releaseOther();expect(ownership.snapshot()).toBe(false);
});
