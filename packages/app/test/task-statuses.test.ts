import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider,type ScriptedStep} from '@agent-compositor/core';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(steps:ScriptedStep[]=[],todos=false){
 const cwd=await mkdtemp(join(tmpdir(),'task-statuses-'));roots.push(cwd);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:todos?['todos']:['agent-harness'],agent:{projectContext:false,fileReferences:false,skills:false}}));
 const provider=new ScriptedProvider(steps),app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:todos?[join(process.cwd(),'plugins/todos')]:[]});apps.push(app);
 const core=app.createCore(async()=>false);return{app,core,provider};
}
it('accepts the Todo active-state spelling and persists the canonical plan without mutating input',async()=>{
 const f=await fixture(),args={goal:'Work',tasks:[{id:'one',title:'Do work',status:'in_progress'}]};
 expect(await f.core.invokeTool('task_plan',args)).toMatchObject({ok:true,output:{tasks:[{status:'running'}]}});
 expect(args.tasks[0].status).toBe('in_progress');
 const file=join(f.app.storage.paths.state,'task-plans',f.core.sessionId+'.json');
 expect(JSON.parse(await readFile(file,'utf8')).tasks[0].status).toBe('running');
 for(const [tasks,field] of [[[{id:'one',title:'Do work',status:'unknown'}],'tasks[0].status'],[[args.tasks[0],args.tasks[0]],'tasks[1].id'],[[{id:'one',status:'pending'}],'tasks[0].title']] as const){
  const before=await readFile(file,'utf8');expect(await f.core.invokeTool('task_plan',{goal:'Bad',tasks})).toMatchObject({ok:false,error:expect.stringContaining(field)});expect(await readFile(file,'utf8')).toBe(before);
 }
});
it.each(['running','in_progress'])('blocks premature completion for either active input spelling: %s',async status=>{
 const f=await fixture([{toolCalls:[{name:'task_plan',args:{goal:'Work',tasks:[{id:'one',title:'Inspect',status}]}}]},{text:'Finished too early.'},{toolCalls:[{name:'task_plan',args:{goal:'Work',tasks:[{id:'one',title:'Inspect',status:'completed',evidence:'Inspected'}]}}]},{text:'Finished.'}]);
 await f.core.submit('Perform the work');expect(f.core.failure).toBeUndefined();expect(f.provider.requests).toHaveLength(4);expect(f.provider.requests[2].messages.some(message=>message.content.includes('unfinished work'))).toBe(true);
});
it('normalizes running Todo input before emitting the frozen service shape and rejects unsupported states',async()=>{
 const f=await fixture(),seen:any[]=[];
 f.core.host.registerPlugin({name:'observe',version:'1.0.0',trust:'trusted'},{'service.todo.update':e=>{seen.push(e.todos);}});
 expect(await f.core.invokeTool('todo',{todos:[{content:'Work',status:'running'}]})).toMatchObject({ok:true,output:{todos:[{content:'Work',status:'in_progress'}]}});
 expect(seen).toEqual([[{content:'Work',status:'in_progress'}]]);
 expect(await f.core.invokeTool('todo',{todos:[{content:'Bad',status:'blocked'}]})).toMatchObject({ok:false});
 expect(await f.core.invokeTool('todo',{})).toMatchObject({output:{todos:[{content:'Work',status:'in_progress'}]}});
});
it('keeps separate projects private through the real Todos plugin persistence hooks',async()=>{
 const a=await fixture([],true);await a.core.start();
 const first=[{content:'Project A',status:'pending'}];await a.core.invokeTool('todo',{todos:first});
 const b=await fixture([],true);await b.core.start();
 const second=[{content:'Project B',status:'in_progress'}];await b.core.invokeTool('todo',{todos:second});
 expect(await a.core.invokeTool('todo',{})).toMatchObject({output:{todos:first}});
 expect(JSON.parse(await readFile(join(a.app.storage.paths.state,'todos.json'),'utf8'))).toEqual(first);
 expect(JSON.parse(await readFile(join(b.app.storage.paths.state,'todos.json'),'utf8'))).toEqual(second);
});
