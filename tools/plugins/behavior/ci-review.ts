import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {UndoStore,type ToolContext} from '@agent-compositor/tools';
import {Fixture,Casebook} from './fixture.js';
import {stopped} from './processes.js';
const exec=promisify(execFile);
function context(f:Fixture):ToolContext{return{cwd:f.cwd,signal:f.abort.signal,undo:new UndoStore(),settings:name=>f.storage.config(name),request:async<T>(service:string,payload:unknown)=>{const result=await f.host.emit(service,payload,f.abort.signal);const value=result.value as any;if(value?.deny)throw Error(value.deny);return (value&&Object.hasOwn(value,'value')?value.value:value) as T;}};}
const tool=(f:Fixture)=>f.module.tools.find((t:any)=>t.name==='ci_review');
async function review(f:Fixture,args:any={action:'runs'}){return tool(f).execute(context(f),args);}
export function ciReview(f:Fixture,b:Casebook){
 if(f.name!=='ci-review')return;
 const sample={databaseId:701,workflowName:'Checks',displayTitle:'CI fixture run',headBranch:'main',status:'completed',conclusion:'failure',url:'https://github.com/fixture/repo/actions/runs/701',createdAt:'2026-11-12T00:00:00Z'};
 const prepare=async()=>{
  await f.storage.configure('ci-review.json',{repository:'fixture/repo',maxChars:16000});
  f.host.unregisterPlugin('ci-dependency');f.host.registerPlugin({name:'ci-dependency',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:process.execPath,args:['-e','console.log('+JSON.stringify(JSON.stringify([sample]))+')']})});
 };
 b.add(['tool.success','process.success','network.success'],async()=>{
  await prepare();const result=await review(f);assert.equal(result.ok,true,result.error);assert.equal(JSON.parse(result.data.output)[0].databaseId,701);
  f.host.unregisterPlugin('ci-dependency');let request:any;f.runtime.setResolver('service.exec.run',e=>{request=e;return {value:{exitCode:0,stdout:'FAILED_LOG',stderr:''}};});
  try{const result=await review(f,{action:'logs',runId:701});assert.equal(result.ok,true);assert.equal(result.data.output,'FAILED_LOG');assert.equal(request.cmd,'gh');assert.deepEqual(request.args,['run','view','701','--log-failed','--repo','fixture/repo']);}finally{f.resetHost();}
 });
 b.add(['network.status','network.malformed','network.unavailable'],async()=>{
  await prepare();f.host.unregisterPlugin('ci-dependency');let response={exitCode:1,stdout:'',stderr:'HTTP 403: repository access denied'};
  f.runtime.setResolver('service.exec.run',()=>({value:response}));
  try{
   const denied=await review(f);assert.equal(denied.ok,false);assert.match(denied.error,/403/);
   response={exitCode:0,stdout:'{broken',stderr:''};const malformed=await review(f);assert.equal(malformed.ok,false);assert.match(malformed.error,/invalid JSON/);
   response={exitCode:1,stdout:'',stderr:'could not resolve host api.github.com'};const unavailable=await review(f);assert.equal(unavailable.ok,false);assert.match(unavailable.error,/resolve host/);
  }finally{f.resetHost();}
 });
 b.add('tool.invalid',async()=>{
  await prepare();f.host.unregisterPlugin('ci-dependency');let calls=0;f.runtime.setResolver('service.exec.run',()=>{calls++;return{value:{exitCode:0,stdout:'',stderr:''}};});
  try{for(const args of [undefined,{},null,[],{action:'rerun'},{action:'run',runId:'701'},{action:'runs',repository:'other/repo'}])assert.equal((await review(f,args===undefined?{}:args)).ok,false);assert.equal(calls,0);}finally{f.resetHost();}
 });
 b.add('tool.denied',async()=>{
  await prepare();const app=await f.app({permissions:{rules:[{tool:'ci_review',decision:'deny'}]}}),core=app.createCore(async()=>true);let calls=0;const views:any[]=[];
  core.host.registerPlugin({name:'process-audit',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>{calls++;}});core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});
  assert.equal((await core.invokeTool('ci_review',{action:'runs'})).ok,false);await core.submit('/ci');await core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});assert.match(JSON.stringify(views.at(-1)),/denied/i);assert.equal(calls,0);
 });
 b.add(['hook.intended','command.intended','view.content','hook.repeat','command.repeat'],async()=>{
  await f.prompt('/ci');await f.prompt('/ci');assert.equal(f.views.length,2);for(const view of f.views){assert.equal(view.title,'CI review');assert.deepEqual(view.view.lines.filter((r:any)=>r.action).map((r:any)=>r.action),['refresh','configure','close']);}
 });
 b.add(['hook.unrelated','command.unrelated'],async()=>{await f.prompt('/ci-other');await f.prompt('ordinary work');assert.equal(f.views.length,0);});
 b.add(['hook.failure','command.failure'],async()=>{f.failView=true;try{assert.equal((await f.prompt('/ci',true)).faults.length,1);}finally{f.failView=false;}await f.prompt('/ci');assert.equal(f.views.at(-1).title,'CI review');});
 b.add(['view.empty','view.error'],async()=>{
  await prepare();const app=await f.app({permissions:{rules:[{tool:'ci_review',decision:'allow'}]}}),core=app.createCore(async()=>true),views:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});await core.submit('/ci');
  let response={exitCode:0,stdout:'[]',stderr:''};core.host.registerPlugin({name:'ci-view-dependency',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>({value:response})});
  await core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});assert.match(JSON.stringify(views.at(-1)),/No runs returned/);
  response={exitCode:127,stdout:'',stderr:'gh dependency unavailable'};await core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});assert.match(JSON.stringify(views.at(-1)),/unavailable/);
  response={exitCode:0,stdout:JSON.stringify([sample]),stderr:''};await core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});assert.match(JSON.stringify(views.at(-1)),/CI fixture run/);
 });
 b.add('view.lifecycle',async()=>{
  const app=await f.app(),core=app.createCore(async()=>true),events:any[]=[];core.subscribe(e=>{if(e.kind==='catalog')events.push(e);});await core.submit('/ci');assert.ok(events.some(e=>e.event==='ui.surface'&&e.input.id==='plugin-ci-review-main'));
  await core.invokeTool('extension_control',{action:'disable',name:f.name,scope:'project'});await app.reloadPlugins(core);assert.ok(events.some(e=>e.event==='ui.pluginRemoved'&&e.input.plugin===f.name));assert.ok(!app.commands().some(c=>c.name==='/ci'));assert.equal((await core.invokeTool('ci_review',{action:'runs'})).ok,false);
  await core.invokeTool('extension_control',{action:'enable',name:f.name,scope:'project'});await app.reloadPlugins(core);await core.submit('/ci');assert.equal(events.filter(e=>e.event==='ui.surface'&&e.input.id==='plugin-ci-review-main').length,2);
 });
 b.add(['tool.failure','process.failure'],async()=>{
  await prepare();f.host.unregisterPlugin('ci-dependency');f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:process.execPath,args:['-e','process.stderr.write("DEPENDENCY_EXIT");process.exit(7)']})});
  try{const failed=await review(f);assert.equal(failed.ok,false);assert.match(failed.error,/exit 7.*DEPENDENCY_EXIT/);}finally{f.host.unregisterPlugin('dependency-control');}
  f.host.unregisterPlugin('ci-dependency');f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:join(f.root,'missing-gh'),args:[]})});
  try{const failed=await review(f);assert.equal(failed.ok,false);assert.match(failed.error,/ENOENT/);}finally{f.host.unregisterPlugin('dependency-control');}
 });
 const processCheck=async(mode:'timeout'|'cancel'|'unload')=>{
  await prepare();const pidFile=join(f.root,'child-pids.json'),worker=join(f.root,'slow-gh.cjs');await rm(pidFile,{force:true});
  await writeFile(worker,`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const fs=require('node:fs'),pidFile=${JSON.stringify(pidFile)};fs.writeFileSync(pidFile+'.tmp',JSON.stringify([process.pid,child.pid]));fs.renameSync(pidFile+'.tmp',pidFile);setInterval(()=>{},1000);`);
  f.host.unregisterPlugin('ci-dependency');f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:process.execPath,args:[worker],timeoutMs:mode==='timeout'?500:10000})});
  let ids:number[]=[];
  try{
   const work=review(f);for(let i=0;i<200;i++){ids=await readFile(pidFile,'utf8').then(JSON.parse,()=>[]);if(ids.length)break;await new Promise(done=>setTimeout(done,5));}assert.equal(ids.length,2,'Real dependency must have started');
   if(mode==='cancel')f.abort.abort(Error('Caller cancelled'));if(mode==='unload')f.host.unregisterPlugin(f.name);
   const result=await work;assert.equal(result.ok,false);assert.match(result.error,mode==='timeout'?/timed out/:/cancel|unloaded/i);for(const pid of ids)await stopped(pid);
  }finally{for(const pid of ids){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}}f.resetHost();}
 };
 b.add(['process.timeout','network.timeout'],()=>processCheck('timeout'));
 b.add(['tool.cancel','process.cancel','network.cancel'],()=>processCheck('cancel'));
 b.add('process.cleanup',()=>processCheck('unload'));
 b.add(['state.fresh','state.invalid'],async()=>{
  await prepare();await f.storage.configure('ci-review.json',{});assert.equal((await review(f)).ok,false);await f.storage.configure('ci-review.json',{repository:'fixture/repo'});assert.equal((await review(f)).ok,true);
  await f.storage.configure('ci-review.json',{repository:'fixture/repo',maxChars:'bad'});const before=await f.saved('ci-review.json');const result=await review(f);assert.equal(result.ok,false);assert.match(result.error,/maxChars/);assert.equal(await f.saved('ci-review.json'),before);await f.storage.configure('ci-review.json',{});
 });
 b.add('state.restart',async()=>{
  await prepare();await f.storage.configure('ci-review.json',{repository:'fixture/repo',maxChars:4000});const app=await f.app();await app.close();
  const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{cwd:process.cwd(),timeout:30000});const output=JSON.parse(result.stdout.trim());assert.equal(output.settings.maxChars,4000);assert.equal(output.result.ok,true);
 });
 b.add('state.migration',async()=>{
  await prepare();await rm(f.file('ci-review.json'),{force:true});const legacy=join(f.cwd,'.agent-compositor/ci-review.json');await writeFile(legacy,'{"repository":"fixture/repo","maxChars":4000}');assert.equal((await f.storage.config('ci-review.json')).maxChars,4000);assert.equal((await review(f)).ok,true);assert.equal(await readFile(legacy,'utf8'),'{"repository":"fixture/repo","maxChars":4000}');await rm(legacy);await f.storage.configure('ci-review.json',{});
 });
 b.add('state.isolation',async()=>{
  await prepare();await f.storage.configure('ci-review.json',{repository:'fixture/repo',maxChars:4000});const other=await new Fixture(f.name,f.directory).init();try{assert.deepEqual(await other.storage.config('ci-review.json'),{});assert.equal((await f.storage.config('ci-review.json')).maxChars,4000);}finally{await other.close();}
 });
 b.add(['mutation.result','mutation.invalid','mutation.denied','mutation.recovery'],async()=>{
  await prepare();await f.storage.configure('ci-review.json',{repository:'fixture/repo',maxChars:7000});
  const press=()=>f.host.emit('ui.press',{site:'plugin-ci-review-main',key:'configure'});
  f.host.setFormHandler(async()=>null);await press();assert.equal((await f.storage.config('ci-review.json')).maxChars,7000);
  let calls=0;f.host.setFormHandler(async()=>++calls===1?{action:'save',values:{repository:'fixture/repo',maxRuns:'10',maxChars:'999',timeoutMs:'15000',scope:'project'}}:null);
  await press();assert.equal(calls,2);assert.equal((await f.storage.config('ci-review.json')).maxChars,7000);
  let attempts=0;let formDescription='';const saveValues={repository:'fixture/repo',maxRuns:'10',maxChars:'8000',timeoutMs:'15000',scope:'project'};f.host.setFormHandler(async (_plugin,input)=>{formDescription=input.description??'';return ++attempts===1?{action:'save',values:saveValues}:null;});
  const configure=f.storage.configure.bind(f.storage);f.storage.configure=async()=>{throw Error('EACCES: settings write denied');};
  try{await press();assert.match(formDescription,/write denied/);}finally{f.storage.configure=configure;}
  assert.equal((await f.storage.config('ci-review.json')).maxChars,7000);attempts=0;await press();assert.equal((await f.storage.config('ci-review.json')).maxChars,8000);assert.match(f.text(),/Settings saved/);
  f.host.setFormHandler(async()=>({action:'save',values:{repository:'fixture/repo',maxRuns:'10',maxChars:'9000',timeoutMs:'15000',scope:'global'}}));await press();assert.equal((await f.storage.config('ci-review.json')).maxChars,8000);assert.match(f.text(),/Saved in global scope/);assert.match(f.text(),/8000/);
  f.host.setFormHandler(undefined);
 });

}
