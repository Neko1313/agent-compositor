import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
it('installs CI review inactive, preserves settings through reload/restart/update/rollback, then disables and removes it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ci-review-lifecycle-')),cwd=join(root,'project'),home=join(root,'home'),catalog=join(root,'catalog'),source=join(catalog,'plugins/ci-review');let app:BuiltApp|undefined;
 try{
  await mkdir(cwd);await mkdir(home);await mkdir(join(catalog,'.claude-plugin'),{recursive:true});
  await cp(resolve('plugins/ci-review'),source,{recursive:true,filter:path=>basename(path)!=='node_modules'});
  const original=JSON.parse(await readFile(join(source,'plugin.json'),'utf8'));
  const publish=async(version:string)=>{await writeFile(join(source,'plugin.json'),JSON.stringify({...original,version}));await writeFile(join(catalog,'.claude-plugin/marketplace.json'),JSON.stringify({name:'ci-review-local',owner:{name:'Fixture'},plugins:[{name:'ci-review',version,source:'./plugins/ci-review'}]}));};
  await publish('0.1.0');
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},permissions:{rules:[{tool:'extension_control',decision:'allow'},{tool:'marketplace_control',decision:'allow'},{tool:'ci_review',decision:'allow'}]}}));
  const boot=async()=>{app=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false});const core=app.createCore(async()=>false);core.host.registerPlugin({name:'ci-lifecycle-gh',version:'1.0.0',trust:'trusted'},{'service.exec.run':event=>event.plugin==='ci-review'?{value:{exitCode:0,stdout:'LIFECYCLE_LOG_EVIDENCE',stderr:''}}:undefined});return core;};
  let core=await boot();
  const manage=async(action:string)=>{const result=await core.invokeTool('extension_control',{action,name:action==='install'?'ci-review@ci-review-local':'ci-review',scope:'project'});expect(result.ok,result.error).toBe(true);return result;};
  const check=async()=>{const result=await core.invokeTool('ci_review',{action:'logs',runId:701});expect(result.ok,result.error).toBe(true);expect((result.output as any).output).toContain('LIFECYCLE_LOG_EVIDENCE');expect(await app!.storage.config('ci-review.json')).toMatchObject({repository:'fixture/repo',maxChars:7000});};
  const added=await core.invokeTool('marketplace_control',{action:'add',source:catalog,scope:'project'});expect(added.ok,added.error).toBe(true);
  await manage('install');expect(app!.plugins.some(p=>p.manifest.name==='ci-review')).toBe(false);expect((await core.invokeTool('ci_review',{action:'logs',runId:701})).ok).toBe(false);
  await manage('enable');await app!.reloadPlugins(core);await app!.storage.configure('ci-review.json',{repository:'fixture/repo',maxChars:7000});await check();
  await app!.reloadPlugins(core);await app!.reloadPlugins(core);await check();
  await app!.close();app=undefined;core=await boot();await check();
  await publish('0.1.1');await manage('update');await app!.reloadPlugins(core);expect(app!.plugins.find(p=>p.manifest.name==='ci-review')?.manifest.version).toBe('0.1.1');await check();
  await manage('rollback');await app!.reloadPlugins(core);expect(app!.plugins.find(p=>p.manifest.name==='ci-review')?.manifest.version).toBe('0.1.0');await check();
  await manage('disable');await app!.reloadPlugins(core);expect((await core.invokeTool('ci_review',{action:'logs',runId:701})).ok).toBe(false);expect(app!.commands().some(c=>c.name==='/ci')).toBe(false);
  await manage('enable');await app!.reloadPlugins(core);await check();
  await manage('remove');await app!.reloadPlugins(core);expect(app!.plugins.some(p=>p.manifest.name==='ci-review')).toBe(false);expect((await core.invokeTool('ci_review',{action:'logs',runId:701})).ok).toBe(false);expect(await app!.storage.config('ci-review.json')).toMatchObject({repository:'fixture/repo',maxChars:7000});
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
},30000);
