import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import tools from '../../../plugins/ci-review/tools.js';
import hooks from '../../../plugins/ci-review/hooks.js';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const run={databaseId:123,workflowName:'checks',displayTitle:'Old repository result',headBranch:'main',status:'completed',conclusion:'failure',url:'https://github.com/acme/old/actions/runs/123',createdAt:'2026-11-11T00:00:00Z'};
function context(settings:unknown,stdout:string){let executions=0;return{ctx:{cwd:process.cwd(),signal:new AbortController().signal,settings:async()=>settings,request:async()=>{executions++;return{exitCode:0,stdout,stderr:''};}} as any,executions:()=>executions};}
it('rejects a summary for a different run instead of mislabeling it as the requested run',async()=>{
 const f=context({repository:'acme/old'},JSON.stringify({...run,databaseId:124,jobs:[]}));
 expect((await tools[0].execute(f.ctx,{action:'run',runId:123})).ok).toBe(false);
});
it('rejects unbounded repository configuration before a remote request or oversized panel line',async()=>{
 const f=context({repository:'x'.repeat(12000)+'/repo'},JSON.stringify([run]));
 expect((await tools[0].execute(f.ctx,{action:'runs'})).ok).toBe(false);expect(f.executions()).toBe(0);
});
it('retains complete selectable run records when output is truncated',async()=>{
 const runs=Array.from({length:8},(_,i)=>({...run,databaseId:i+1,displayTitle:'Run '+i}));
 const f=context({repository:'acme/old',maxChars:1000},JSON.stringify(runs));
 const result=await tools[0].execute(f.ctx,{action:'runs'});expect(result).toMatchObject({ok:true,data:{truncated:true}});
 const list=JSON.parse((result as any).data.output);expect(list.length).toBeGreaterThan(0);expect(list.length).toBeLessThan(8);expect((result as any).data.output.length).toBeLessThanOrEqual(1000);
});
it('keeps a configured network operation alive beyond the default UI hook budget',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ci-review-delay-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['ci-review'],agent:{projectContext:false,skills:false},permissions:{rules:[{tool:'ci_review',decision:'allow'}]}}));
 const app=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false,pluginDirs:[resolve('plugins/ci-review')]});apps.push(app);await app.storage.configure('ci-review.json',{repository:'acme/old',timeoutMs:5000});
 const core=app.createCore(async()=>false),views:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});
 core.host.registerPlugin({name:'slow-gh',version:'1.0.0',trust:'trusted',hookTimeouts:{'service.exec.run':5000}},{'service.exec.run':async()=>{await new Promise(resolve=>setTimeout(resolve,1200));return{value:{exitCode:0,stdout:JSON.stringify([run]),stderr:''}};}});
 await core.start();await core.submit('/ci');const result=await core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});
 expect(result.faults).toEqual([]);expect(JSON.stringify(views.at(-1))).toContain('Old repository result');
},6000);
it('clears old run actions and selection when effective repository changes without fetching automatically',async()=>{
 const state=new Map(),views:any[]=[],calls:any[]=[];let current={repository:'acme/old',maxRuns:10,maxChars:16000,timeoutMs:15000};
 const api:any={state,signal:new AbortController().signal,background:()=>api,storage:{config:async()=>current,configure:async(_name:string,value:typeof current)=>{current=value;}},ui:{view:async(...args:any[])=>{views.push(args);},remove:async()=>{},notify:async()=>{},form:async()=>({action:'save',values:{repository:'acme/new',maxRuns:'10',maxChars:'16000',timeoutMs:'15000',scope:'project'}})},agent:{tool:async(_name:string,args:any)=>{calls.push(args);return{ok:true,output:{output:JSON.stringify(args.action==='runs'?[run]:{...run,jobs:[]}),exitCode:0,truncated:false}};}}};
 const press=(key:string)=>hooks['ui.press']({site:'plugin-ci-review-main',key},api);
 await press('command:/ci');await press('refresh');await press('run:123');await press('configure');
 const panel=JSON.stringify(views.at(-1));expect(panel).toContain('acme/new');expect(panel).not.toContain('run:123');expect(panel).not.toContain('logs-failed');expect(panel).not.toContain('Old repository result');expect(calls).toHaveLength(2);
});
it('discards an old repository response that arrives after effective configuration changes',async()=>{
 const state=new Map(),views:any[]=[];let current={repository:'acme/old',maxRuns:10,maxChars:16000,timeoutMs:15000},release!:(value:unknown)=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const api:any={state,signal:new AbortController().signal,background:()=>api,storage:{config:async()=>current},ui:{view:async(...args:any[])=>{views.push(args);},remove:async()=>{},notify:async()=>{}},agent:{tool:async()=>{entered();return pending;}}};
 const press=(key:string)=>hooks['ui.press']({site:'plugin-ci-review-main',key},api);
 await press('command:/ci');const work=press('refresh');await ready;current={...current,repository:'acme/new'};
 release({ok:true,output:{output:JSON.stringify([run]),exitCode:0,truncated:false}});await work;
 expect(JSON.stringify(views.at(-1))).toContain('acme/new');expect(JSON.stringify(views.at(-1))).not.toContain('Old repository result');expect(JSON.stringify(views.at(-1))).not.toContain('run:123');
});
it('keeps a partial list selectable and shows job statuses without raw JSON clutter',async()=>{
 const state=new Map(),views:any[]=[],calls:any[]=[];
 const api:any={state,signal:new AbortController().signal,background:()=>api,storage:{config:async()=>({repository:'acme/old'})},ui:{view:async(...args:any[])=>{views.push(args);},remove:async()=>{},notify:async()=>{}},agent:{tool:async(_name:string,args:any)=>{calls.push(args);return {ok:true,output:{output:JSON.stringify(args.action==='runs'?[run]:{...run,jobs:[{databaseId:9,name:'Type checking',status:'completed',conclusion:'failure'}]}),exitCode:0,truncated:args.action==='runs'}};}}};
 const press=(key:string)=>hooks['ui.press']({site:'plugin-ci-review-main',key},api);
 await press('command:/ci');await press('refresh');expect(JSON.stringify(views.at(-1))).toContain('run:123');expect(JSON.stringify(views.at(-1))).toContain('Output truncated');
 await press('run:123');const panel=JSON.stringify(views.at(-1));expect(panel).toContain('Type checking · failure');expect(panel).toContain('Workflow: checks');expect(panel).not.toContain('databaseId');expect(calls).toHaveLength(2);
});
