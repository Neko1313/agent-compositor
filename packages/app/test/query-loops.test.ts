import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('preserves Callix query metadata and the configured repeated-query step limit',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'app-query-loop-'));roots.push(cwd);
 await writeFile(join(cwd,'actual.mjs'),'const value="QUERY_SENTINEL";\n');
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['callix'],agent:{tools:['grep'],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,maxRepeatedQuerySteps:2},compaction:{enabled:false}}));
 const provider=new ScriptedProvider(Array.from({length:12},()=>({toolCalls:[{name:'grep',args:{pattern:'QUERY_SENTINEL'}}]})));
 const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[resolve('plugins/callix')]});apps.push(app);const core=app.createCore(async()=>false),results:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.result')results.push(e.input);});
 await core.submit('Inspect the source');expect(core.failure).toContain('Repeated query results');expect(provider.requests).toHaveLength(3);expect(results).toHaveLength(3);expect(results.every(r=>r.ok&&r.output.matches[0].path==='actual.mjs')).toBe(true);
});
