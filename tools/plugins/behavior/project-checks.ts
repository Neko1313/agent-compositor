import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {UndoStore,type ToolContext} from '@agent-compositor/tools';
import {Fixture,Casebook} from './fixture.js';
import {stopped} from './processes.js';
const exec=promisify(execFile),site='plugin-project-checks-main';
function context(f:Fixture):ToolContext{return{cwd:f.cwd,signal:f.abort.signal,undo:new UndoStore(),resolvePath:async path=>path,settings:name=>f.storage.config(name),request:async<T>(service:string,payload:unknown)=>{const result=await f.host.emit(service,payload,f.abort.signal);const value=result.value as any;if(value?.deny)throw Error(value.deny);return (value&&Object.hasOwn(value,'value')?value.value:value) as T;}};}
const check=(f:Fixture,args:any={action:'list'})=>f.module.tools.find((t:any)=>t.name==='project_check').execute(context(f),args);
export function projectChecks(f:Fixture,b:Casebook){
 if(f.name!=='project-checks')return;
 const prepare=async(scripts:Record<string,string>={check:'node -e "console.log(123)"'})=>{await writeFile(join(f.cwd,'package.json'),JSON.stringify({scripts}));await f.storage.configure('project-checks.json',{});};
 b.add(['tool.success','process.success'],async()=>{
  await prepare();const listed=await check(f);assert.equal(listed.ok,true,listed.error);assert.deepEqual(listed.data,{scripts:[{name:'check',command:'node -e "console.log(123)"'}],truncated:false});
  const result=await check(f,{action:'run',name:'check'});assert.equal(result.ok,true,result.error);assert.equal(result.data.exitCode,0);assert.match(result.data.stdout,/123/);
 });
 b.add('tool.invalid',async()=>{
  await prepare();let calls=0;f.runtime.setResolver('service.exec.run',()=>{calls++;return{value:{exitCode:0,stdout:'',stderr:''}};});
  try{for(const args of [null,[],{},{action:'exec'},{action:'list',name:'check'},{action:'run',name:'missing'},{action:'run',name:'check',cwd:'/'},{action:'run',name:'check; touch injected'}])assert.equal((await check(f,args)).ok,false);assert.equal(calls,0);}finally{f.resetHost();}
 });
 b.add('tool.denied',async()=>{
  await prepare();const app=await f.app({permissions:{rules:[{tool:'project_check',decision:'deny'}]}}),core=app.createCore(async()=>true),views:any[]=[];let calls=0;
  core.host.registerPlugin({name:'process-audit',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>{calls++;}});core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});
  assert.equal((await core.invokeTool('project_check',{action:'run',name:'check'})).ok,false);await core.submit('/checks');await core.host.emit('ui.press',{site,key:'run:check'});assert.match(JSON.stringify(views.at(-1)),/denied/i);assert.equal(calls,0);
 });
 b.add(['hook.intended','command.intended','view.content','hook.repeat','command.repeat'],async()=>{
  await f.prompt('/checks');await f.prompt('/checks');assert.equal(f.views.length,2);for(const view of f.views){assert.equal(view.title,'Project checks');assert.deepEqual(view.view.lines.filter((r:any)=>r.action).map((r:any)=>r.action),['refresh','configure','close']);}
 });
 b.add(['hook.unrelated','command.unrelated'],async()=>{await f.prompt('/checks-other');await f.prompt('ordinary work');assert.equal(f.views.length,0);});
 b.add(['hook.failure','command.failure'],async()=>{f.failView=true;try{assert.equal((await f.prompt('/checks',true)).faults.length,1);}finally{f.failView=false;}await f.prompt('/checks');assert.equal(f.views.at(-1).title,'Project checks');});
 b.add(['view.empty','view.error'],async()=>{
  await prepare({});const app=await f.app({permissions:{rules:[{tool:'project_check',decision:'allow'}]}}),core=app.createCore(async()=>true),views:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});await core.submit('/checks');
  await core.host.emit('ui.press',{site,key:'refresh'});assert.match(JSON.stringify(views.at(-1)),/No scripts/);
  await prepare();core.host.registerPlugin({name:'dependency-failure',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>({value:{exitCode:127,stdout:'',stderr:'npm dependency unavailable'}})});await core.host.emit('ui.press',{site,key:'run:check'});assert.match(JSON.stringify(views.at(-1)),/unavailable/);core.host.unregisterPlugin('dependency-failure');
  await core.host.emit('ui.press',{site,key:'run:check'});assert.match(JSON.stringify(views.at(-1)),/passed/);
 });
 b.add('view.lifecycle',async()=>{
  const app=await f.app(),core=app.createCore(async()=>true),events:any[]=[];core.subscribe(e=>{if(e.kind==='catalog')events.push(e);});await core.submit('/checks');assert.ok(events.some(e=>e.event==='ui.surface'&&e.input.id===site));
  await core.invokeTool('extension_control',{action:'disable',name:f.name,scope:'project'});await app.reloadPlugins(core);assert.ok(events.some(e=>e.event==='ui.pluginRemoved'&&e.input.plugin===f.name));assert.ok(!app.commands().some(c=>c.name==='/checks'));assert.equal((await core.invokeTool('project_check',{action:'list'})).ok,false);
  await core.invokeTool('extension_control',{action:'enable',name:f.name,scope:'project'});await app.reloadPlugins(core);await core.submit('/checks');assert.equal(events.filter(e=>e.event==='ui.surface'&&e.input.id===site).length,2);
 });
 b.add(['tool.failure','process.failure'],async()=>{
  await prepare({check:'node -e "console.error(456);process.exit(7)"'});const failed=await check(f,{action:'run',name:'check'});assert.equal(failed.ok,false);assert.match(failed.error,/exit 7/);assert.match(failed.error,/456/);
  f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:join(f.root,'missing-npm'),args:[]})});
  try{const result=await check(f,{action:'run',name:'check'});assert.equal(result.ok,false);assert.match(result.error,/ENOENT/);}finally{f.host.unregisterPlugin('dependency-control');}
 });
 const processCheck=async(mode:'timeout'|'cancel'|'unload')=>{
  await prepare();const pidFile=join(f.root,'child-pids.json'),worker=join(f.root,'slow-check.cjs');await rm(pidFile,{force:true});
  await writeFile(worker,`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const fs=require('node:fs'),pidFile=${JSON.stringify(pidFile)};fs.writeFileSync(pidFile+'.tmp',JSON.stringify([process.pid,child.pid]));fs.renameSync(pidFile+'.tmp',pidFile);setInterval(()=>{},1000);`);
  f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:process.execPath,args:[worker],timeoutMs:mode==='timeout'?500:10000})});
  let ids:number[]=[];
  try{
   const work=check(f,{action:'run',name:'check'});for(let i=0;i<200;i++){ids=await readFile(pidFile,'utf8').then(JSON.parse,()=>[]);if(ids.length)break;await new Promise(done=>setTimeout(done,5));}assert.equal(ids.length,2,'Real dependency must have started');
   if(mode==='cancel')f.abort.abort(Error('Caller cancelled'));if(mode==='unload')f.host.unregisterPlugin(f.name);
   const result=await work;assert.equal(result.ok,false);assert.match(result.error,mode==='timeout'?/timed out/:/cancel|unloaded/i);for(const pid of ids)await stopped(pid);
  }finally{for(const pid of ids){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}}f.resetHost();}
 };
 b.add('process.timeout',()=>processCheck('timeout'));b.add(['tool.cancel','process.cancel'],()=>processCheck('cancel'));b.add('process.cleanup',()=>processCheck('unload'));
 b.add(['state.fresh','state.invalid'],async()=>{
  await prepare();assert.equal((await check(f)).ok,true);await f.storage.configure('project-checks.json',{maxChars:'bad'});const before=await f.saved('project-checks.json');const result=await check(f);assert.equal(result.ok,false);assert.match(result.error,/maxChars/);assert.equal(await f.saved('project-checks.json'),before);await f.storage.configure('project-checks.json',{});
 });
 b.add('state.restart',async()=>{
  await prepare();await f.storage.configure('project-checks.json',{maxChars:4000,timeoutMs:2000});const app=await f.app();await app.close();
  const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{cwd:process.cwd(),timeout:30000});const output=JSON.parse(result.stdout.trim());assert.equal(output.settings.maxChars,4000);assert.equal(output.settings.timeoutMs,2000);assert.equal(output.result.ok,true);
 });
 b.add('state.migration',async()=>{
  await prepare();await rm(f.file('project-checks.json'),{force:true});const legacy=join(f.cwd,'.agent-compositor/project-checks.json');await writeFile(legacy,'{"maxChars":4000}');assert.equal((await f.storage.config('project-checks.json')).maxChars,4000);assert.equal((await check(f)).ok,true);assert.equal(await readFile(legacy,'utf8'),'{"maxChars":4000}');await rm(legacy);await f.storage.configure('project-checks.json',{});
 });
 b.add('state.isolation',async()=>{
  await prepare();await f.storage.configure('project-checks.json',{maxChars:4000});const other=await new Fixture(f.name,f.directory).init();try{assert.deepEqual(await other.storage.config('project-checks.json'),{});assert.equal((await f.storage.config('project-checks.json')).maxChars,4000);}finally{await other.close();}
 });
 b.add(['mutation.result','mutation.invalid','mutation.denied','mutation.recovery'],async()=>{
  await prepare();await f.storage.configure('project-checks.json',{maxChars:7000});const press=()=>f.host.emit('ui.press',{site,key:'configure'});
  f.host.setFormHandler(async()=>null);await press();assert.equal((await f.storage.config('project-checks.json')).maxChars,7000);
  let calls=0;f.host.setFormHandler(async()=>++calls===1?{action:'save',values:{maxChars:'999',timeoutMs:'2000',scope:'project'}}:null);await press();assert.equal(calls,2);assert.equal((await f.storage.config('project-checks.json')).maxChars,7000);
  f.host.setFormHandler(async()=>({action:'save',values:{maxChars:'8000',timeoutMs:'2000',scope:'project'}}));const configure=f.storage.configure.bind(f.storage);f.storage.configure=async()=>{throw Error('EACCES: settings write denied');};
  try{await press();assert.match(f.text(),/write denied/);}finally{f.storage.configure=configure;}assert.equal((await f.storage.config('project-checks.json')).maxChars,7000);await press();assert.equal((await f.storage.config('project-checks.json')).maxChars,8000);assert.match(f.text(),/Settings saved/);
  f.host.setFormHandler(async()=>({action:'save',values:{maxChars:'9000',timeoutMs:'2000',scope:'global'}}));await press();assert.equal((await f.storage.config('project-checks.json')).maxChars,8000);assert.match(f.text(),/Saved to global: maxChars 9000/);assert.match(f.text(),/Effective in this project: maxChars 8000/);f.host.setFormHandler(undefined);
 });
}
