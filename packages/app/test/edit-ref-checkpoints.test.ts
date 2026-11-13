import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('preserves the real pre-tool checkpoint and rewind flow for a reference-only edit',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'ref-checkpoints-'));roots.push(cwd);await writeFile(join(cwd,'a.ts'),'old\n');
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness','checkpoints'],agent:{projectContext:false,fileReferences:false,skills:false},permissions:{rules:[{tool:'edit',path:join(cwd,'a.ts'),decision:'allow'}]}}));
 const provider=new ScriptedProvider([]),app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[new URL('../../../plugins/checkpoints',import.meta.url).pathname]});apps.push(app);expect(app.pluginErrors).toEqual([]);
 const core=app.createCore(async()=>false);const read=await core.invokeTool('read',{path:'a.ts'}),editRef=(read.output as any).editRef;expect(editRef).toEqual(expect.any(String));
 expect(await core.invokeTool('edit',{editRef,oldText:'old',newText:'new'})).toMatchObject({ok:true});
 expect(JSON.parse(await app.storage.legacyRead('.agent-compositor/checkpoints.json'))).toMatchObject([{path:join(cwd,'a.ts'),content:'old\n'}]);
 await core.submit('/rewind');expect(await readFile(join(cwd,'a.ts'),'utf8')).toBe('old\n');expect(provider.requests).toHaveLength(0);
});
