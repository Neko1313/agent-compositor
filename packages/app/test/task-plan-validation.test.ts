import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp,type BuiltApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';

const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'plan-validation-'));roots.push(cwd);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness'],agent:{projectContext:false,fileReferences:false,skills:false}}));
 const app=await buildApp({cwd,env:{HOME:cwd},provider:new ScriptedProvider([])});apps.push(app);
 const core=app.createCore(async()=>false);
 expect(await core.invokeTool('task_plan',{goal:'Preserve',tasks:[{id:'saved',title:'Valid state',status:'pending'}]})).toMatchObject({ok:true});
 const file=join(app.storage.paths.state,'task-plans',core.sessionId+'.json');
 return{core,file,before:await readFile(file,'utf8')};
}
const cases=[0,2,4].flatMap(index=>['id','title','status'].map(field=>({index,field})));
it.each(cases)('reports the actual invalid $field at tasks[$index] without mutating arguments or saved state',async({index,field})=>{
 const f=await fixture(),args:{goal:string;tasks:Record<string,string>[]}={goal:'Reject invalid input',tasks:Array.from({length:5},(_,n)=>({id:'id-'+n,title:'Task '+n,status:'pending'}))};
 if(field==='status')args.tasks[index].status='unsupported';else delete args.tasks[index][field];
 const before=structuredClone(args);
 expect(await f.core.invokeTool('task_plan',args)).toMatchObject({ok:false,error:expect.stringContaining(`tasks[${index}].${field}`)});
 expect(args).toEqual(before);expect(await readFile(f.file,'utf8')).toBe(f.before);
});
it('reports a duplicate at its actual later index and preserves the valid plan',async()=>{
 const f=await fixture(),args={goal:'Reject duplicates',tasks:[{id:'same',title:'One',status:'pending'},{id:'other',title:'Two',status:'pending'},{id:'same',title:'Three',status:'pending'}]};
 const before=structuredClone(args);
 expect(await f.core.invokeTool('task_plan',args)).toMatchObject({ok:false,error:expect.stringContaining('tasks[2].id')});
 expect(args).toEqual(before);expect(await readFile(f.file,'utf8')).toBe(f.before);
});
