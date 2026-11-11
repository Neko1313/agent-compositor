import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {UndoStore,type ToolContext} from '@agent-compositor/tools';
import {Fixture,Casebook} from './fixture.js';
import {stopped} from './processes.js';
const exec=promisify(execFile);
async function git(f:Fixture,...args:string[]){return (await exec('git',args,{cwd:f.cwd,env:{PATH:process.env.PATH,HOME:f.home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout;}
async function repository(f:Fixture){await git(f,'init');await writeFile(join(f.cwd,'tracked.txt'),'original\n');await git(f,'add','tracked.txt');await git(f,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','Initial');}
function context(f:Fixture):ToolContext{return{cwd:f.cwd,signal:f.abort.signal,undo:new UndoStore(),settings:name=>f.storage.config(name),request:async<T>(service:string,payload:unknown)=>{const result=await f.host.emit(service,payload,f.abort.signal);const value=result.value as any;if(value?.deny)throw Error(value.deny);return (value&&Object.hasOwn(value,'value')?value.value:value) as T;}};}
const tool=(f:Fixture)=>f.module.tools.find((t:any)=>t.name==='git_review');
async function review(f:Fixture,args:any={action:'status'}){return tool(f).execute(context(f),args);}
export function gitReview(f:Fixture,b:Casebook){
 if(f.name!=='git-review')return;
 let ready=false;
 const prepare=async()=>{if(!ready){await repository(f);ready=true;}await f.storage.configure('git-review.json',{maxChars:16000});};
 b.add(['tool.success','process.success'],async()=>{
  await prepare();await writeFile(join(f.cwd,'tracked.txt'),'staged change\n');await git(f,'add','tracked.txt');await writeFile(join(f.cwd,'tracked.txt'),'working change\n');
  const before=await git(f,'diff','--cached'),status=await review(f);assert.equal(status.ok,true,status.error);assert.match(status.data.output,/tracked.txt/);
  const staged=await review(f,{action:'diff',staged:true}),work=await review(f,{action:'diff'});assert.match(staged.data.output,/\+staged change/);assert.doesNotMatch(staged.data.output,/\+working change/);assert.match(work.data.output,/\+working change/);assert.equal(await git(f,'diff','--cached'),before);
  const marker=join(f.root,'external-ran'),driver=join(f.root,'driver.cjs');await writeFile(driver,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unsafe');`);
  await git(f,'config','core.fsmonitor',`node ${driver}`);await git(f,'config','diff.trap.command',`node ${driver}`);await git(f,'config','diff.trap.textconv',`node ${driver}`);await writeFile(join(f.cwd,'.gitattributes'),'tracked.txt diff=trap\n');
  assert.equal((await review(f)).ok,true);assert.equal((await review(f,{action:'diff'})).ok,true);await assert.rejects(readFile(marker));
  await rm(join(f.cwd,'.gitattributes'));await git(f,'config','--unset','core.fsmonitor');await git(f,'config','--remove-section','diff.trap');
 });
 b.add('tool.invalid',async()=>{
  await prepare();let calls=0;f.runtime.setResolver('service.exec.run',()=>{calls++;return{value:{exitCode:0,stdout:'',stderr:''}};});
  try{for(const args of [undefined,{},null,[],{action:'commit'},{action:'diff',staged:'yes'},{action:'status',command:'anything'}])assert.equal((await review(f,args===undefined?{}:args)).ok,false);assert.equal(calls,0);}finally{f.resetHost();}
 });
 b.add('tool.denied',async()=>{
  await prepare();const app=await f.app({permissions:{rules:[{tool:'git_review',decision:'deny'}]}}),core=app.createCore(async()=>true);let calls=0;const views:any[]=[];
  core.host.registerPlugin({name:'process-audit',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>{calls++;}});core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});
  assert.equal((await core.invokeTool('git_review',{action:'status'})).ok,false);await core.submit('/git-review');await core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});assert.match(JSON.stringify(views.at(-1)),/denied/i);assert.equal(calls,0);
 });
 b.add(['hook.intended','command.intended','view.content','hook.repeat','command.repeat'],async()=>{
  await f.prompt('/git-review');await f.prompt('/git-review');assert.equal(f.views.length,2);for(const view of f.views){assert.equal(view.title,'Git review');assert.deepEqual(view.view.lines.filter((r:any)=>r.action).map((r:any)=>r.action),['status','working','staged','configure','close']);}
 });
 b.add(['hook.unrelated','command.unrelated'],async()=>{await f.prompt('/git-review-other');await f.prompt('ordinary work');assert.equal(f.views.length,0);});
 b.add(['hook.failure','command.failure'],async()=>{f.failView=true;try{assert.equal((await f.prompt('/git-review',true)).faults.length,1);}finally{f.failView=false;}await f.prompt('/git-review');assert.equal(f.views.at(-1).title,'Git review');});
 b.add(['view.empty','view.error'],async()=>{
  await prepare();const app=await f.app({permissions:{rules:[{tool:'git_review',decision:'allow'}]}}),core=app.createCore(async()=>true),views:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});await core.submit('/git-review');
  await writeFile(join(f.cwd,'tracked.txt'),'staged change\n');await core.host.emit('ui.press',{site:'plugin-git-review-main',key:'working'});assert.match(JSON.stringify(views.at(-1)),/No changes/);
  core.host.registerPlugin({name:'dependency-failure',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>({value:{exitCode:127,stdout:'',stderr:'Git dependency unavailable'}})});await core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});assert.match(JSON.stringify(views.at(-1)),/unavailable/);core.host.unregisterPlugin('dependency-failure');
  await core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});assert.match(JSON.stringify(views.at(-1)),/tracked|branch|master|main/);
 });
 b.add('view.lifecycle',async()=>{
  const app=await f.app(),core=app.createCore(async()=>true),events:any[]=[];core.subscribe(e=>{if(e.kind==='catalog')events.push(e);});await core.submit('/git-review');assert.ok(events.some(e=>e.event==='ui.surface'&&e.input.id==='plugin-git-review-main'));
  await core.invokeTool('extension_control',{action:'disable',name:f.name,scope:'project'});await app.reloadPlugins(core);assert.ok(events.some(e=>e.event==='ui.pluginRemoved'&&e.input.plugin===f.name));assert.ok(!app.commands().some(c=>c.name==='/git-review'));assert.equal((await core.invokeTool('git_review',{action:'status'})).ok,false);
  await core.invokeTool('extension_control',{action:'enable',name:f.name,scope:'project'});await app.reloadPlugins(core);await core.submit('/git-review');assert.equal(events.filter(e=>e.event==='ui.surface'&&e.input.id==='plugin-git-review-main').length,2);
 });
 b.add(['tool.failure','process.failure'],async()=>{
  await prepare();f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:process.execPath,args:['-e','process.stderr.write("DEPENDENCY_EXIT");process.exit(7)']})});
  try{const failed=await review(f);assert.equal(failed.ok,false);assert.match(failed.error,/exit 7.*DEPENDENCY_EXIT/);}finally{f.host.unregisterPlugin('dependency-control');}
  f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:join(f.root,'missing-git'),args:[]})});
  try{const failed=await review(f);assert.equal(failed.ok,false);assert.match(failed.error,/ENOENT/);}finally{f.host.unregisterPlugin('dependency-control');}
 });
 const processCheck=async(mode:'timeout'|'cancel'|'unload')=>{
  await prepare();const pidFile=join(f.root,'child-pids.json'),worker=join(f.root,'slow-git.cjs');await rm(pidFile,{force:true});
  await writeFile(worker,`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const fs=require('node:fs'),pidFile=${JSON.stringify(pidFile)};fs.writeFileSync(pidFile+'.tmp',JSON.stringify([process.pid,child.pid]));fs.renameSync(pidFile+'.tmp',pidFile);setInterval(()=>{},1000);`);
  f.host.registerPlugin({name:'dependency-control',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>$.next({...e,cmd:process.execPath,args:[worker],timeoutMs:mode==='timeout'?500:10000})});
  let ids:number[]=[];
  try{
   const work=review(f);for(let i=0;i<200;i++){ids=await readFile(pidFile,'utf8').then(JSON.parse,()=>[]);if(ids.length)break;await new Promise(done=>setTimeout(done,5));}assert.equal(ids.length,2,'Real dependency must have started');
   if(mode==='cancel')f.abort.abort(Error('Caller cancelled'));if(mode==='unload')f.host.unregisterPlugin(f.name);
   const result=await work;assert.equal(result.ok,false);assert.match(result.error,mode==='timeout'?/timed out/:/cancel|unloaded/i);for(const pid of ids)await stopped(pid);
  }finally{for(const pid of ids){try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}}f.resetHost();}
 };
 b.add('process.timeout',()=>processCheck('timeout'));
 b.add(['tool.cancel','process.cancel'],()=>processCheck('cancel'));
 b.add('process.cleanup',()=>processCheck('unload'));
 b.add(['state.fresh','state.invalid'],async()=>{
  await prepare();await f.storage.configure('git-review.json',{});assert.equal((await review(f)).ok,true);
  await f.storage.configure('git-review.json',{maxChars:'bad'});const before=await f.saved('git-review.json');const result=await review(f);assert.equal(result.ok,false);assert.match(result.error,/maxChars/);assert.equal(await f.saved('git-review.json'),before);await f.storage.configure('git-review.json',{});
 });
 b.add('state.restart',async()=>{
  await prepare();await f.storage.configure('git-review.json',{maxChars:4000});const app=await f.app();await app.close();
  const result=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{cwd:process.cwd(),timeout:30000});const output=JSON.parse(result.stdout.trim());assert.equal(output.settings.maxChars,4000);assert.equal(output.result.ok,true);
 });
 b.add('state.migration',async()=>{
  await prepare();await rm(f.file('git-review.json'),{force:true});const legacy=join(f.cwd,'.agent-compositor/git-review.json');await writeFile(legacy,'{"maxChars":4000}');assert.equal((await f.storage.config('git-review.json')).maxChars,4000);assert.equal((await review(f)).ok,true);assert.equal(await readFile(legacy,'utf8'),'{"maxChars":4000}');await rm(legacy);await f.storage.configure('git-review.json',{});
 });
 b.add('state.isolation',async()=>{
  await prepare();await f.storage.configure('git-review.json',{maxChars:4000});const other=await new Fixture(f.name,f.directory).init();try{assert.deepEqual(await other.storage.config('git-review.json'),{});assert.equal((await f.storage.config('git-review.json')).maxChars,4000);}finally{await other.close();}
 });
 b.add(['mutation.result','mutation.invalid','mutation.denied','mutation.recovery'],async()=>{
  await prepare();await f.storage.configure('git-review.json',{maxChars:7000});
  const press=()=>f.host.emit('ui.press',{site:'plugin-git-review-main',key:'configure'});
  f.host.setFormHandler(async()=>null);await press();assert.equal((await f.storage.config('git-review.json')).maxChars,7000);
  let calls=0;f.host.setFormHandler(async()=>++calls===1?{action:'save',values:{maxChars:'3999',scope:'project'}}:null);
  await press();assert.equal(calls,2);assert.equal((await f.storage.config('git-review.json')).maxChars,7000);
  f.host.setFormHandler(async()=>({action:'save',values:{maxChars:'8000',scope:'project'}}));
  const configure=f.storage.configure.bind(f.storage);f.storage.configure=async()=>{throw Error('EACCES: settings write denied');};
  try{await press();assert.match(f.text(),/write denied/);}finally{f.storage.configure=configure;}
  assert.equal((await f.storage.config('git-review.json')).maxChars,7000);await press();assert.equal((await f.storage.config('git-review.json')).maxChars,8000);assert.match(f.text(),/Settings saved/);
  f.host.setFormHandler(async()=>({action:'save',values:{maxChars:'9000',scope:'global'}}));await press();assert.equal((await f.storage.config('git-review.json')).maxChars,8000);assert.match(f.text(),/Saved 9000/);assert.match(f.text(),/8000 characters \(project override\)/);
  f.host.setFormHandler(undefined);
 });

}
