import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../../packages/app/src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const names=(await readdir(join(process.cwd(),'plugins'),{withFileTypes:true})).filter(entry=>entry.isDirectory()&&(!process.env.PLUGIN_TEST_NAME||process.env.PLUGIN_TEST_NAME===entry.name)).map(entry=>entry.name);
it.each(names)('plugin lifecycle: %s stays off until scoped opt-in and unloads after disable',async name=>{
 const root=await mkdtemp(join(tmpdir(),'ac-plugin-contract-')),cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 const app=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false,pluginDirs:[join(process.cwd(),'plugins',name)]});
 try{
  const core=app.createCore(async()=>true);expect(app.plugins).toHaveLength(0);
  expect(app.commands().some(c=>c.name==='/marketplace')).toBe(true);
  expect((await core.invokeTool('extension_control',{action:'enable',name,scope:'project'})).ok).toBe(true);
  await app.reloadPlugins(core);expect(app.plugins.map(p=>p.manifest.name)).toEqual([name]);
  const plugin=app.plugins[0];expect(plugin.manifest.version).toBe(JSON.parse(await readFile(join(process.cwd(),'plugins',name,'plugin.json'),'utf8')).version);
  expect((await core.invokeTool('extension_control',{action:'disable',name,scope:'project'})).ok).toBe(true);
  await app.reloadPlugins(core);expect(app.plugins).toHaveLength(0);
  expect((await app.storage.config('mcp.json')).mcpServers??{}).toEqual({});
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
