import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const a of apps.splice(0))await a.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
it('locks independent versions, separates install/enable, checks updates, rolls back and rejects mutable versions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ac-updates-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home'),market=join(root,'market'),plugin=join(market,'plugins/probe');await mkdir(cwd);await mkdir(home);await mkdir(plugin,{recursive:true});await mkdir(join(market,'.claude-plugin'));
 async function publish(version:string,value=version){
  await writeFile(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'test-market',owner:{name:'Fixture'},plugins:[{name:'probe',version,source:'./plugins/probe'}]}));
  await writeFile(join(plugin,'plugin.json'),JSON.stringify({name:'probe',version,trust:'trusted'}));await writeFile(join(plugin,'tools.ts'),`export default[{name:'probe_value',description:'Probe',parameters:{type:'object'},describe:()=>({tool:'probe_value',readOnly:true}),execute:async()=>({ok:true,data:'${value}'})}];`);
 }
 await publish('1.0.0');const a=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false});apps.push(a);const core=a.createCore(async()=>true);
 expect((await core.invokeTool('marketplace_control',{action:'add',source:market,scope:'project'})).ok).toBe(true);
 expect(await core.invokeTool('extension_control',{action:'install',name:'probe@test-market',scope:'project'})).toMatchObject({ok:true,output:{version:'1.0.0',activated:false,enabled:false}});
 await a.reloadPlugins(core);expect(a.plugins).toHaveLength(0);
 await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(await core.invokeTool('probe_value',{})).toMatchObject({ok:true,output:'1.0.0'});
 await publish('1.1.0');
 expect(await core.invokeTool('extension_control',{action:'check-updates'})).toMatchObject({ok:true,output:{updates:[{name:'probe',installedVersion:'1.0.0',availableVersion:'1.1.0',updateAvailable:true}]}});
 expect(await core.invokeTool('probe_value',{})).toMatchObject({ok:true,output:'1.0.0'});
 expect(await core.invokeTool('extension_control',{action:'update',name:'probe',scope:'project'})).toMatchObject({ok:true,output:{version:'1.1.0',enabled:true}});
 await a.reloadPlugins(core);expect(await core.invokeTool('probe_value',{})).toMatchObject({ok:true,output:'1.1.0'});
 const state=JSON.parse(await readFile(join(a.storage.paths.state,'extensions-state.json'),'utf8'));expect(state.installed.probe.digest).toMatch(/^[a-f0-9]{64}$/);expect(state.installed.probe.qualified).toBe('probe@test-market');
 await publish('1.1.0','MUTATED');expect(await core.invokeTool('extension_control',{action:'update',name:'probe'})).toMatchObject({ok:false,error:expect.stringContaining('changed contents')});
 expect(await core.invokeTool('extension_control',{action:'rollback',name:'probe',scope:'project'})).toMatchObject({ok:true,output:{version:'1.0.0'}});await a.reloadPlugins(core);expect(await core.invokeTool('probe_value',{})).toMatchObject({ok:true,output:'1.0.0'});
 await publish('0.9.0');expect(await core.invokeTool('extension_control',{action:'update',name:'probe'})).toMatchObject({ok:false,error:expect.stringContaining('downgrade')});
 await publish('1.2.0');await writeFile(join(plugin,'plugin.json'),JSON.stringify({name:'probe',version:'1.3.0',trust:'trusted'}));expect(await core.invokeTool('extension_control',{action:'update',name:'probe'})).toMatchObject({ok:false,error:expect.stringContaining('Catalog version')});
 expect(await core.invokeTool('probe_value',{})).toMatchObject({ok:true,output:'1.0.0'});
});

it('installs a pinned release archive through the marketplace and retains that version independently of catalog changes',async()=>{
 const{createServer}=await import('node:http'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{createHash}=await import('node:crypto');const exec=promisify(execFile);
 const root=await mkdtemp(join(tmpdir(),'ac-archive-market-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home'),market=join(root,'market'),source=join(root,'source'),plugin=join(source,'probe');await mkdir(cwd);await mkdir(home);await mkdir(join(market,'.claude-plugin'),{recursive:true});await mkdir(plugin,{recursive:true});let bytes=Buffer.alloc(0),downloads=0;
 const server=createServer((_req,res)=>{downloads++;res.end(bytes);});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/package.tar.gz`;
 async function publish(version:string){
  await writeFile(join(plugin,'plugin.json'),JSON.stringify({name:'probe',version,trust:'trusted',compositor:{standard:1,apiVersion:1}}));await writeFile(join(plugin,'tools.js'),`export default[{name:'archive_probe',description:'Probe',parameters:{type:'object'},describe:()=>({tool:'archive_probe',readOnly:true}),execute:async()=>({ok:true,data:'${version}'})}];`);
  await mkdir(join(plugin,'node_modules/dependency'),{recursive:true});await writeFile(join(plugin,'node_modules/dependency/data'),version);
  const archive=join(root,'package.tar.gz');await exec('tar',['--format=ustar','-czf',archive,'-C',source,'probe']);bytes=await readFile(archive);
  await writeFile(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'archive-market',owner:{name:'Fixture'},plugins:[{name:'probe',version,source:{source:'archive',assets:{[`${process.platform}-${process.arch}`]:{url,sha256:createHash('sha256').update(bytes).digest('hex')}}}}]}));
 }
 try{
  await publish('1.0.0');const a=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false});apps.push(a);const core=a.createCore(async()=>true);
  await core.invokeTool('marketplace_control',{action:'add',source:market});
  expect((await a.createCore(async()=>false).invokeTool('extension_control',{action:'install',name:'probe@archive-market',scope:'project'})).ok).toBe(false);expect(downloads).toBe(0);
  expect(await core.invokeTool('extension_control',{action:'install',name:'probe@archive-market',scope:'project'})).toMatchObject({ok:true,output:{version:'1.0.0',enabled:false}});
  await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'});await a.reloadPlugins(core);expect(await core.invokeTool('archive_probe',{})).toMatchObject({ok:true,output:'1.0.0'});
  await publish('1.1.0');expect(await core.invokeTool('archive_probe',{})).toMatchObject({ok:true,output:'1.0.0'});
  expect(await core.invokeTool('extension_control',{action:'update',name:'probe',scope:'project'})).toMatchObject({ok:true,output:{version:'1.1.0'}});await a.reloadPlugins(core);expect(await core.invokeTool('archive_probe',{})).toMatchObject({ok:true,output:'1.1.0'});
  const dependency=join(cwd,'.agent-compositor/plugins/probe/node_modules/dependency/data');await writeFile(dependency,'TAMPERED');
  expect(await core.invokeTool('extension_control',{action:'rollback',name:'probe',scope:'project'})).toMatchObject({ok:false,error:expect.stringContaining('Installed plugin content changed')});await writeFile(dependency,'1.1.0');
  const lock=JSON.parse(await readFile(join(a.storage.paths.state,'extensions-state.json'),'utf8'));
  const backup=join(lock.backups.probe.at(-1).path,'node_modules/dependency/data');await writeFile(backup,'TAMPERED BACKUP');
  expect(await core.invokeTool('extension_control',{action:'rollback',name:'probe',scope:'project'})).toMatchObject({ok:false,error:expect.stringContaining('Backup content')});
  expect(await core.invokeTool('archive_probe',{})).toMatchObject({ok:true,output:'1.1.0'});await writeFile(backup,'1.0.0');
  expect(await core.invokeTool('extension_control',{action:'rollback',name:'probe',scope:'project'})).toMatchObject({ok:true,output:{version:'1.0.0'}});await a.reloadPlugins(core);expect(await readFile(dependency,'utf8')).toBe('1.0.0');
  const restarted=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false});apps.push(restarted);expect(restarted.plugins[0].manifest.version).toBe('1.0.0');
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
