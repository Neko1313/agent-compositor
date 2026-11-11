import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm,mkdtemp,cp,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {buildApp,type BuiltApp} from '../../packages/app/src/build.js';
import {behavior} from './behavior/index.js';
import {Runtime} from '@agent-compositor/runtime';
import {attach} from '@agent-compositor/hooks';
import {ScriptedProvider} from '@agent-compositor/core';
const exec=promisify(execFile);
/** A small useful operation, deliberately not a claim of complete component coverage. */
export async function probe(app:BuiltApp,name:string,existingCore?:ReturnType<BuiltApp['createCore']>){
 const core=existingCore??app.createCore(async()=>true),events:any[]=[];
 core.subscribe(event=>{if(event.kind==='catalog')events.push(event);});await core.start();
 const command:Record<string,string>={'auto-approve':'/auto status',btw:'/btw What is two plus two?', 'checkpoint-history':'/checkpoints',cost:'/cost',doctor:'/doctor',export:'/export',mascot:'/mascot status',mcp:'/mcp','network-proxy':'/proxy status','output-style':'/style terse','session-ctl':'/clear','slash-commands':'/help',todos:'/todos','ui-theme':'/theme amber',web:'/web',workflows:'/workflows'};
 const eventCount=events.length;
 const unrelated=await core.host.emit('ui.press',{site:'certification-unrelated-surface',key:'not-owned'});
 assert.deepEqual(unrelated.faults,[]);assert.equal(events.length,eventCount,'An unrelated UI event must have no owned effects');
 if(command[name]){
  const unknown=command[name].split(' ')[0]+'-unrelated';
  const before=events.length;const ignored=await core.host.emit('prompt.submit',{text:unknown});
  assert.deepEqual(ignored.faults,[]);assert.equal((ignored.value as {drop?:unknown}|undefined)?.drop,undefined,'A similarly prefixed command must pass through');assert.equal(events.length,before);
  await core.submit(command[name]);
  const own=events.filter(e=>e.input?.plugin===name&&['ui.notification','ui.surface','ui.appearance'].includes(e.event));
  assert.ok(own.length>0,`${name} must produce its own documented output`);
  if(name==='btw')assert.ok(own.some(e=>e.input.message==='contract model answer'));
  if(name==='doctor')assert.ok(own.some(e=>e.input.message?.includes('provider ping: OK')));
  if(name==='ui-theme')assert.equal(JSON.parse(await readFile(join(app.storage.paths.state,'theme.json'),'utf8')),'amber');
 }
 if(name==='plugin-author'){
  const result=await core.invokeTool('plugin_dev',{action:'guide',topic:'contracts'});assert.equal(result.ok,true,result.error??'Tool failed');assert.match(JSON.stringify(result.output),/plugin|hook/i);
 }else if(name==='callix'){
  await writeFile(join(app.storage.paths.project,'contract.txt'),'contract text');
  const result=await core.invokeTool('glob',{pattern:'*.txt'});assert.equal(result.ok,true,result.error??'Tool failed');assert.match(JSON.stringify(result.output),/contract.txt/);
 }else if(name==='monty'){
  const result=await core.invokeTool('run_python',{code:'6*7'});assert.equal(result.ok,true,result.error??'Tool failed');assert.equal((result.output as any).output,42);
 }else if(name==='guard-scope'){
  const target=join(app.storage.paths.project,'../escaped.txt');await rm(target,{force:true});
  const result=await core.invokeTool('write',{path:target,content:'must not escape'});assert.equal(result.ok,false);await assert.rejects(readFile(target));
 }else if(name==='guard-secrets'){
  await core.submit('AKIAIOSFODNN7EXAMPLE');assert.equal(core.getMessages().filter(m=>m.role==='user').length,0);
  assert.ok(events.some(e=>e.input?.plugin===name&&e.input.message?.includes('blocked')));
 }else if(name==='memory'){
  const file=join(app.storage.paths.state,'memory.md'),before=await readFile(file,'utf8').catch(()=>'');
  await core.submit('# certification note');const after=await readFile(file,'utf8');assert.equal(after.split('certification note').length,before.split('certification note').length+1);
 }else if(name==='background-jobs'){
  await app.storage.configure('background-jobs.json',{mode:'notify'});
  const launched=await core.invokeTool('exec',{command:'printf BACKGROUND_CONTRACT',background:true,timeoutMs:2000});assert.equal(launched.ok,true,launched.error??'Background launch failed');
  const id=(launched.output as any).shellId;let status:any;
  for(let i=0;i<200;i++){const result=await core.invokeTool('background_jobs',{action:'status',id});assert.equal(result.ok,true,result.error??'Background status failed');status=result.output;if(status.subscription?.delivery==='delivered')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(status.subscription?.delivery,'delivered');assert.equal(status.exitCode,0);
  assert.equal(((await core.invokeTool('exec_output',{id})).output as any).stdout,'BACKGROUND_CONTRACT');
 }else if(name==='notify-done'){
  await core.host.emit('turn.complete',{turnId:'contract'});assert.equal(events.filter(e=>e.input?.plugin===name&&e.input.message==='turn complete').length,1);
 }else if(name==='turn-log'){
  const file=join(app.storage.paths.state,'turn-log.jsonl'),before=await readFile(file,'utf8').catch(()=>'');
  await core.host.emit('prompt.submit',{text:'contract log entry'});await core.host.emit('turn.complete',{turnId:'contract'});
  const after=await readFile(file,'utf8');assert.equal(after.trim().split('\n').length,(before.trim()?before.trim().split('\n').length:0)+1);assert.equal(JSON.parse(after.trim().split('\n').at(-1)!).prompt,'contract log entry');
 }else if(name==='checkpoints'){
  const file=join(app.storage.paths.project,'checkpoint.txt');await writeFile(file,'before');
  const result=await core.invokeTool('write',{path:file,content:'after'});assert.equal(result.ok,true,result.error??'Tool failed');await core.submit('/rewind');assert.equal(await readFile(file,'utf8'),'before');
 }else if(name==='plan-mode'){
  const file=join(app.storage.paths.project,'plan.txt');await rm(file,{force:true});await core.submit('/plan');
  assert.equal((await core.invokeTool('write',{path:file,content:'denied'})).ok,false);await assert.rejects(readFile(file));
  await core.submit('/plan');assert.equal((await core.invokeTool('write',{path:file,content:'allowed'})).ok,true);assert.equal(await readFile(file,'utf8'),'allowed');
 }else if(name==='project-checks'){
  await writeFile(join(app.storage.paths.project,'package.json'),JSON.stringify({scripts:{check:'node -e "console.log(123)"'}}));
  const listed=await core.invokeTool('project_check',{action:'list'});assert.equal(listed.ok,true,listed.error??'Discovery failed');assert.equal((listed.output as any).scripts[0].name,'check');
  const result=await core.invokeTool('project_check',{action:'run',name:'check'});assert.equal(result.ok,true,result.error??'Check failed');assert.match((result.output as any).stdout,/123/);
  await core.submit('/checks');assert.ok(events.some(e=>e.event==='ui.surface'&&e.input.title==='Project checks'));
 }else if(name==='ci-review'){
  await app.storage.configure('ci-review.json',{repository:'fixture/repo'});
  core.host.unregisterPlugin('package-gh');core.host.registerPlugin({name:'package-gh',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>({value:{exitCode:0,stdout:'[]',stderr:''}})});
  const runs=await core.invokeTool('ci_review',{action:'runs'});assert.equal(runs.ok,true,runs.error??'CI request failed');assert.deepEqual(JSON.parse((runs.output as any).output),[]);
  await core.submit('/ci');assert.ok(events.some(e=>e.event==='ui.surface'&&e.input.title==='CI review'));
 }else if(name==='git-review'){
  await exec('git',['init'],{cwd:app.storage.paths.project});
  await writeFile(join(app.storage.paths.project,'git-review-evidence.txt'),'Read-only package lifecycle');
  const status=await core.invokeTool('git_review',{action:'status'});assert.equal(status.ok,true,status.error??'Git status failed');assert.match((status.output as any).output,/git-review-evidence/);
  await core.submit('/git-review');assert.ok(events.some(e=>e.event==='ui.surface'&&e.input.title==='Git review'));
 }else if(!command[name])throw Error('Add an actual package probe for '+name);
 return events.filter(e=>e.input?.plugin===name).map(e=>({event:e.event,message:e.input.message,text:e.input.text}));
}
export async function exercisePackage(directory:string,name:string,artifactInstalled=false,fullBehavior=false){
 const root=await mkdtemp(join(tmpdir(),'ac-certified-package-')),cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 let app:BuiltApp|undefined;const observations:any[]=[];
 const market=join(root,'market');await mkdir(join(market,'.claude-plugin'),{recursive:true});
 const manifest=JSON.parse(await readFile(join(directory,'plugin.json'),'utf8'));
 await cp(directory,join(market,'plugins',name),{recursive:true,dereference:false});
 await writeFile(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'certification',owner:{name:'Contract fixture'},plugins:[{name,version:manifest.version,source:'./plugins/'+name}]}));
 await symlink(join(process.cwd(),'node_modules'),join(cwd,'node_modules'),'dir');
 const options={cwd,env:{HOME:home},provider:new ScriptedProvider(Array.from({length:40},()=>({text:'contract model answer'}))),agentHub:false,sessionId:'certification',pluginDirs:[directory]};
 try{
  await mkdir(join(cwd,'.agent-compositor'),{recursive:true});await writeFile(join(cwd,'.agent-compositor/independent.json'),'{"keep":true}');
  app=await buildApp(options);assert.deepEqual(app.pluginErrors,[]);assert.equal(app.plugins.length,0);
  let core=app.createCore(async()=>true);
  assert.equal((await core.invokeTool('marketplace_control',{action:'add',source:market,scope:'project'})).ok,true);
  const install=await core.invokeTool('extension_control',{action:'install',name:name+'@certification',scope:'project'});assert.equal(install.ok,true,install.error??'Installation failed');
  await app.reloadPlugins(core);assert.equal(app.plugins.length,0);observations.push({phase:'installed-inactive'});
  assert.equal((await core.invokeTool('extension_control',{action:'enable',name,scope:'project'})).ok,true);await app.reloadPlugins(core);
  assert.equal(app.plugins.length,1);observations.push({phase:'activate',events:await probe(app,name,core)});
  if(name==='notify-done'){
   let down=true;const notices:string[]=[];
   const host=attach(new Runtime(),{session:{id:'sink-contract',cwd},notify:message=>{if(down)throw Error('notification unavailable');notices.push(message);}});
   host.registerPlugin(app.plugins[0].manifest,app.plugins[0].hooks);
   await host.emit('prompt.submit',{text:'unrelated'});assert.equal(notices.length,0);
   assert.equal((await host.emit('turn.complete',{turnId:'dependency-failure'})).faults.length,1);assert.equal(notices.length,0);
   down=false;await host.emit('turn.complete',{turnId:'one'});await host.emit('turn.complete',{turnId:'two'});assert.deepEqual(notices,['turn complete','turn complete']);
   host.unregisterPlugin(name);await host.emit('turn.complete',{turnId:'disabled'});assert.equal(notices.length,2);
   observations.push({phase:'notification-failure-and-repeat',notifications:notices});
  }

  observations.push({phase:'repeat',events:await probe(app,name,core)});
  const checkAll=async(phase:string)=>{if(fullBehavior)observations.push({phase,requirements:await behavior(name,join(cwd,'.agent-compositor/plugins',name))});};
  await checkAll('all-components-active');
  // Reuse the same core too: callbacks from the previous generation must be gone.
  await app.reloadPlugins(core);await app.reloadPlugins(core);observations.push({phase:'reload',events:await probe(app,name,core)});await checkAll('all-components-reloaded');
  await app.close();app=undefined;
  const restart=await exec(process.execPath,[join(import.meta.dirname,'package-restart.ts'),cwd,home,directory,name,...(fullBehavior?['--full']:[])],{cwd:process.cwd(),timeout:60000,maxBuffer:2000000});
  observations.push({phase:'fresh-process-restart',output:restart.stdout});
  app=await buildApp(options);core=app.createCore(async()=>true);
  if(fullBehavior){
   const parts=manifest.version.split('.'),next=`${parts[0]}.${parts[1]}.${BigInt(parts[2])+1n}`;
   await writeFile(join(market,'plugins',name,'plugin.json'),JSON.stringify({...manifest,version:next}));
   await writeFile(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'certification',owner:{name:'Contract fixture'},plugins:[{name,version:next,source:'./plugins/'+name}]}));
   const update=await core.invokeTool('extension_control',{action:'update',name,scope:'project'});assert.equal(update.ok,true,update.error??'Synthetic contract-preserving update failed');
   await app.reloadPlugins(core);assert.equal(app.plugins[0].manifest.version,next);await probe(app,name,core);await checkAll('all-components-after-synthetic-update');
   const rollback=await core.invokeTool('extension_control',{action:'rollback',name,scope:'project'});assert.equal(rollback.ok,true,rollback.error??'Rollback failed');
   await app.reloadPlugins(core);assert.equal(app.plugins[0].manifest.version,manifest.version);await probe(app,name,core);await checkAll('all-components-after-rollback');
  }

  assert.equal((await core.invokeTool('extension_control',{action:'disable',name,scope:'project'})).ok,true);await app.reloadPlugins(core);assert.equal(app.plugins.length,0);
  const removed:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&(e as any).input?.plugin===name)removed.push(e);});
  await core.host.emit('prompt.submit',{text:'# disabled package must not act'});await core.host.emit('turn.complete',{turnId:'disabled'});assert.equal(removed.length,0);
  observations.push({phase:'disabled',ownedEffects:removed.length});
  assert.equal((await core.invokeTool('extension_control',{action:'enable',name,scope:'project'})).ok,true);await app.reloadPlugins(core);observations.push({phase:'reenable',events:await probe(app,name,core)});await checkAll('all-components-reenabled');
  assert.equal((await core.invokeTool('extension_control',{action:'remove',name,scope:'project'})).ok,true);await app.reloadPlugins(core);assert.equal(app.plugins.length,0);
  assert.equal(await readFile(join(cwd,'.agent-compositor/independent.json'),'utf8'),'{"keep":true}');observations.push({phase:'remove',independentSettings:true});
  return{plugin:name,artifactInstalled,observations};
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
}
