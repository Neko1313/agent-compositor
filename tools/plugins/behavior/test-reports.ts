import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Fixture,type Casebook} from './fixture.js';
const exec=promisify(execFile),site='plugin-test-reports-main';
export function testReports(f:Fixture,b:Casebook){
 if(f.name!=='test-reports')return;
 const seed=async()=>{await writeFile(join(f.cwd,'report.json'),JSON.stringify({testResults:[{name:'sample.test.ts',status:'failed',assertionResults:[{fullName:'first failure',status:'failed',failureMessages:['FIRST_DETAIL']},{fullName:'second failure',status:'failed',failureMessages:['SECOND_DETAIL']},{status:'passed'}]}]}));await f.storage.configure('test-reports.json',{path:'report.json',maxFailures:10,maxBytes:12000});};
 const setup=async()=>{await seed();const app=await f.app({permissions:{rules:[{tool:'test_report',decision:'allow'},{tool:'extension_control',decision:'allow'}]}}),core=app.createCore(async()=>false),events:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')events.push(e.input);});await core.start();return{app,core,events,press:(key:string)=>core.host.emit('ui.press',{site,key}),screen:()=>JSON.stringify(events.at(-1)?.view)};};
 b.add(['hook.intended','command.intended','hook.repeat','command.repeat','view.empty'],async()=>{
  const x=await setup();await x.core.submit('/test-report');await x.core.submit('/test-report');assert.equal(x.events.length,2);assert.match(x.screen(),/Enter a Vitest\/Jest/);assert.equal(x.core.getMessages().filter(m=>m.role==='user').length,0);
 });
 b.add(['hook.unrelated','command.unrelated'],async()=>{
  const x=await setup();await x.core.host.emit('prompt.submit',{text:'/test-report-unrelated'});await x.core.host.emit('ui.press',{site:'unrelated',key:'read'});assert.equal(x.events.length,0);
 });
 b.add(['view.content','view.lifecycle'],async()=>{
  const x=await setup();await x.core.submit('/test-report');await x.press('read');assert.match(x.screen(),/3 tests · 1 passed · 2 failed · 0 skipped/);assert.match(x.screen(),/FIRST_DETAIL/);
  await x.press('failure:1');assert.match(x.screen(),/SECOND_DETAIL/);await x.press('close');const n=x.events.length;await x.press('read');assert.equal(x.events.length,n);
  await x.core.submit('/test-report');assert.match(x.screen(),/SECOND_DETAIL/);
  assert.equal((await x.core.invokeTool('extension_control',{action:'disable',name:f.name,scope:'project'})).ok,true);await x.app.reloadPlugins(x.core);const count=x.events.length;await x.press('read');assert.equal(x.events.length,count);
 });
 b.add(['hook.failure','command.failure','view.error'],async()=>{
  const x=await setup();await x.core.submit('/test-report');await x.press('read');await x.core.host.emit('ui.change',{site,id:'report-path:0',value:'missing.json'});await x.press('read');assert.match(x.screen(),/ENOENT/);assert.match(x.screen(),/Last loaded: report.json/);assert.match(x.screen(),/FIRST_DETAIL/);
  await x.app.storage.configure('test-reports.json',{maxBytes:'invalid'});await x.core.submit('/test-report');assert.match(x.screen(),/Maximum bytes/);await x.press('read');assert.match(x.screen(),/Read failed/);
 });
 b.add(['state.fresh','state.invalid'],async()=>{
  const x=await setup();await x.app.storage.configure('test-reports.json',{});await x.core.submit('/test-report');assert.match(x.screen(),/reports\/tests.json/);await x.app.storage.configure('test-reports.json',{maxFailures:null});const before=await x.app.storage.config('test-reports.json');await x.press('read');assert.deepEqual(await x.app.storage.config('test-reports.json'),before);assert.match(x.screen(),/Maximum failures/);
 });
 b.add('state.restart',async()=>{
  const x=await setup();await x.app.close();const child=await exec('bun',[join(import.meta.dirname,'restart.ts'),f.name,f.cwd,f.home,f.directory],{cwd:process.cwd(),timeout:30000});const result=JSON.parse(child.stdout.trim());assert.equal(result.settings.path,'report.json');assert.equal(result.settings.maxBytes,12000);assert.equal(result.result.ok,true);assert.equal(result.result.output.failed,2);
 });
 b.add('state.migration',async()=>{
  await seed();await rm(f.file('test-reports.json'),{force:true});const legacy=join(f.cwd,'.agent-compositor/test-reports.json');await writeFile(legacy,'{"path":"report.json","maxBytes":2048}');assert.equal((await f.storage.config('test-reports.json')).maxBytes,2048);assert.equal(await readFile(legacy,'utf8'),'{"path":"report.json","maxBytes":2048}');await rm(legacy);
 });
 b.add('state.isolation',async()=>{await seed();const other=await new Fixture(f.name,f.directory).init();try{assert.deepEqual(await other.storage.config('test-reports.json'),{});assert.equal((await f.storage.config('test-reports.json')).path,'report.json');}finally{await other.close();}});
 b.add(['mutation.result','mutation.invalid','mutation.denied','mutation.recovery'],async()=>{
  const x=await setup();await x.core.submit('/test-report');const original=await x.app.storage.config('test-reports.json');x.core.host.setFormHandler(async()=>null);await x.press('configure');assert.deepEqual(await x.app.storage.config('test-reports.json'),original);
  let forms=0,description='';const values={path:'report.json',maxFailures:'2',maxBytes:'2048',scope:'project'};
  x.core.host.setFormHandler(async(_plugin,form)=>{description=form.description??'';return ++forms===1?{action:'save',values:{...values,maxBytes:'10'}}:null;});await x.press('configure');assert.equal(forms,2);assert.match(description,/Maximum bytes/);assert.deepEqual(await x.app.storage.config('test-reports.json'),original);
  forms=0;x.core.host.setFormHandler(async(_plugin,form)=>{description=form.description??'';return ++forms===1?{action:'save',values}:null;});const configure=x.app.storage.configure.bind(x.app.storage);x.app.storage.configure=async()=>{throw Error('EACCES: settings write denied');};try{await x.press('configure');assert.match(description,/write denied/);}finally{x.app.storage.configure=configure;}
  assert.deepEqual(await x.app.storage.config('test-reports.json'),original);x.core.host.setFormHandler(async()=>({action:'save',values}));await x.press('configure');assert.equal((await x.app.storage.config('test-reports.json')).maxBytes,2048);assert.match(x.screen(),/Settings saved/);assert.match(x.screen(),/report-path:1/);
  await x.press('tab');await x.core.host.emit('ui.change',{site,id:'report-path:1',value:'report.json'});assert.equal(x.events.at(-1)?.view.lines.find((line:any)=>line.action==='read')?.selected,true);await x.press('enter');assert.match(x.screen(),/Report loaded/);
  x.core.host.setFormHandler(async()=>({action:'save',values:{...values,maxBytes:'4000',scope:'global'}}));await x.press('configure');assert.equal((await x.app.storage.config('test-reports.json')).maxBytes,2048);assert.match(x.screen(),/global scope/);assert.match(x.screen(),/2048 bytes/);
 });
}
