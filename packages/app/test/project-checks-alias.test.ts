import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';

it.skipIf(process.platform==='win32')('supports an aliased project root while rejecting package links outside its canonical directory',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'checks-alias-')));
 let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  const project=join(root,'project'),alias=join(root,'selected-project'),home=join(root,'home');
  await Promise.all([mkdir(project),mkdir(home)]);await symlink(project,alias,'dir');
  await writeFile(join(project,'package.json'),JSON.stringify({scripts:{check:'node -e "console.log(\'ALIAS_CHECK_PASSED\')"'}}));
  await writeFile(join(project,'agent-compositor.json'),JSON.stringify({enabledPlugins:['project-checks'],agent:{projectContext:false,skills:false},permissions:{rules:[{tool:'project_check',decision:'allow'}]}}));
  const provider=new ScriptedProvider([]);
  app=await buildApp({cwd:alias,env:{HOME:home},provider,agentHub:false,pluginDirs:[resolve('plugins/project-checks')]});
  const core=app.createCore(async()=>false);await core.start();const reads:string[]=[],executions:unknown[]=[];
  core.host.registerPlugin({name:'alias-observer',version:'1.0.0',trust:'trusted'},{
   'service.fs.read':event=>{reads.push(event.path);},
   'service.exec.run':event=>{executions.push(event);},
  });
  expect(await core.invokeTool('project_check',{action:'list'})).toMatchObject({ok:true,output:{scripts:[expect.objectContaining({name:'check'})]}});
  expect(await core.invokeTool('project_check',{action:'run',name:'check'})).toMatchObject({ok:true,output:{stdout:expect.stringContaining('ALIAS_CHECK_PASSED'),exitCode:0}});
  expect(reads).toEqual([join(project,'package.json'),join(project,'package.json')]);expect(executions).toHaveLength(1);
  await writeFile(join(root,'outside.json'),JSON.stringify({scripts:{check:'echo OUTSIDE_MUST_NOT_RUN'}}));
  await rm(join(project,'package.json'));await symlink(join(root,'outside.json'),join(project,'package.json'));
  // Even an attached directory must not become this plugin's package source.
  await core.attachWorkspace(root);
  for(const args of [{action:'list'},{action:'run',name:'check'}])expect(await core.invokeTool('project_check',args)).toMatchObject({ok:false,error:expect.stringContaining('confined')});
  expect(reads).toHaveLength(2);expect(executions).toHaveLength(1);expect(provider.requests).toHaveLength(0);
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
});
