import assert from 'node:assert/strict';
import {Fixture,Casebook} from './fixture.js';
export function resources(f:Fixture,b:Casebook){
 if(f.name!=='resources')return;
 const press=(key:string)=>f.emit('ui.press',{site:'plugin-resources-resources',key});
 const view=()=>f.views.at(-1)?.view;
 b.add(['hook.intended','command.intended','view.empty'],async()=>{
  f.resetHost();await f.start();assert.equal(f.views.length,0);await f.prompt('/resources');assert.match(JSON.stringify(view()),/CPU: waiting for interval/);assert.match(JSON.stringify(view()),/RSS:/);assert.equal(f.models.length,0);await press('pause');
 });
 b.add(['hook.unrelated','command.unrelated'],async()=>{
  await f.start();const count=f.views.length;assert.equal((await f.prompt('/resources-extra')).value?.drop,undefined);await f.emit('ui.press',{site:'another-pane',key:'sample'});assert.equal(f.views.length,count);assert.equal(f.models.length,0);
 });
 b.add(['hook.repeat','command.repeat','view.content'],async()=>{
  await f.start();for(let i=0;i<3;i++)await f.prompt('/resources');assert.match(JSON.stringify(view()),/Samples 3\/120/);await press('memory');assert.match(JSON.stringify(view()),/Resident memory history/);await press('pause');assert.match(JSON.stringify(view()),/Paused/);assert.equal(f.models.length,0);
 });
 b.add(['hook.failure','command.failure','view.error'],async()=>{
  await f.start();f.failView=true;assert.ok((await f.prompt('/resources',true)).faults.length);f.failView=false;
  const original=process.memoryUsage;
  try{process.memoryUsage=(()=>{throw Error('COUNTERS_UNAVAILABLE');}) as unknown as typeof original;await f.prompt('/resources');assert.match(JSON.stringify(view()),/Sampling failed.*COUNTERS_UNAVAILABLE/);}
  finally{process.memoryUsage=original;}
  await press('sample');assert.doesNotMatch(JSON.stringify(view()),/Sampling failed/);await press('pause');
 });
 b.add('view.lifecycle',async()=>{
  await f.start();await f.prompt('/resources');await press('close');const count=f.views.length;await press('sample');assert.equal(f.views.length,count);
  f.host.unregisterPlugin(f.name);await f.prompt('/resources');assert.equal(f.views.length,count);f.resetHost();await f.start();await f.prompt('/resources');assert.match(JSON.stringify(view()),/Samples 1\/120/);await press('close');
 });
}
