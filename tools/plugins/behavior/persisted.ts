import assert from 'node:assert/strict';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Fixture,Casebook} from './fixture.js';
export function persisted(f:Fixture,b:Casebook){
 const name=f.name;
 if(!['todos','ui-theme','cost'].includes(name))return;
 const tasks=[{content:'Verified task',status:'in_progress'}];
 const file=name==='todos'?'todos.json':name==='ui-theme'?'theme.json':'usage-behavior.json';
 const legacy=name==='todos'?JSON.stringify(tasks):name==='ui-theme'?'"amber"':JSON.stringify({in:7,out:2,turns:1});
 const command=name==='todos'?'/todos':name==='ui-theme'?'/theme amber':'/cost';
 const act=async()=>{
  if(name==='todos')await f.emit('tool.result',{tool:'todo',ok:true,output:{todos:tasks}});
  else if(name==='ui-theme')await f.prompt(command);
  else await f.emit('turn.usage',{turnId:'usage',inputTokens:7,outputTokens:2});
 };
 const show=async()=>{if(name==='ui-theme'){await f.emit('ui.render',{site:'status',surface:'terminal',props:{lines:[{text:'status'},{text:'Ready'}]}});}else await f.prompt(command);};
 b.add(['state.fresh','view.empty'],async()=>{await rm(f.file(file),{force:true});f.resetHost();await f.start();await show();if(name==='todos')assert.match(f.text(),/No tasks yet/);else if(name==='cost')assert.match(f.text(),/0 input/);else assert.ok(f.appearances.length>0);});
 b.add(['hook.repeat','mutation.result','view.content'],async()=>{
  await rm(f.file(file),{force:true});f.resetHost();await f.start();await act();await act();await show();
  const data=JSON.parse(await f.saved(file));if(name==='todos'){assert.deepEqual(data,tasks);assert.match(f.text(),/Verified task/);}else if(name==='ui-theme'){assert.equal(data,'amber');assert.match(f.text(),/e5bd85/);}else{assert.equal(data.in,14);assert.equal(data.out,4);assert.equal(data.turns,2);assert.match(f.text(),/14 input/);}
 });
 b.add('mutation.invalid',async()=>{const before=await f.saved(file);if(name==='todos')await f.emit('tool.result',{tool:'todo',ok:true,output:{todos:[{content:3,status:'unknown'}]}});else if(name==='ui-theme')await f.prompt('/theme missing');else await f.emit('turn.usage',{turnId:'invalid',inputTokens:'bad',outputTokens:2},true);assert.equal(await f.saved(file),before);});
 b.add('mutation.denied',async()=>{const before=await f.saved(file);f.denyWrite=true;await act();f.denyWrite=false;assert.equal(await f.saved(file),before);assert.match(f.notices.at(-1).message,/save|saved/i);});
 b.add(['hook.failure','command.failure','mutation.recovery','view.error'],async()=>{
  f.failWrite=true;await act();assert.match(f.notices.at(-1).message,/save|saved/i);f.failWrite=false;await act();const data=await f.saved(file);assert.ok(data.length>0);
  f.failView=true;const bad=await f.prompt(command,true);assert.equal(bad.faults.length,1);f.failView=false;await f.prompt(command);assert.ok(f.views.length+f.appearances.length>0);
 });
 b.add(['state.restart','view.lifecycle'],async()=>{await f.seed(file,legacy);f.resetHost();await f.start();await show();if(name==='todos')assert.match(f.text(),/Verified task/);else if(name==='ui-theme')assert.match(f.text(),/e5bd85/);else assert.match(f.text(),/7 input/);const before=f.views.length+f.appearances.length;f.host.unregisterPlugin(name);await f.prompt(command);assert.equal(f.views.length+f.appearances.length,before);f.resetHost();await f.start();await show();assert.ok(f.views.length+f.appearances.length>before);});
 b.add('state.invalid',async()=>{await f.seed(file,'not valid JSON');f.resetHost();await f.start();assert.equal(await f.saved(file),'not valid JSON');await show();if(name==='todos')assert.match(f.text(),/could not restore|No tasks/);if(name==='cost')assert.match(f.text(),/0 input/);if(name==='ui-theme')assert.match(f.text(),/restore theme/);});
 b.add('state.migration',async()=>{await writeFile(join(f.cwd,'.agent-compositor',file),legacy);await rm(f.file(file),{force:true});f.resetHost();await f.start();await show();await act();assert.ok((await f.saved(file)).length>0);assert.equal(await readFile(join(f.cwd,'.agent-compositor',file),'utf8'),legacy);});
 b.add('state.isolation',async()=>{const other=await new Fixture(name,f.directory).init();try{await other.start();await other.prompt(name==='ui-theme'?'/theme':command);assert.doesNotMatch(other.text(),/Verified task|14 input|e5bd85/);}finally{await other.close();}});
}
