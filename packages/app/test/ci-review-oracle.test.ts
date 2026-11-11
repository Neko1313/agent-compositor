import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const runId=981234567890,repository='acme/widget';
const sample={databaseId:runId,workflowName:'checks',displayTitle:'Verify patch',headBranch:'main',status:'completed',conclusion:'failure',url:`https://github.com/${repository}/actions/runs/${runId}`,createdAt:'2026-11-11T00:00:00Z'};
async function fixture(decision='allow',provider=new ScriptedProvider([])){
 const root=await mkdtemp(join(tmpdir(),'ci-review-oracle-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['ci-review'],agent:{projectContext:false,skills:false},permissions:{rules:[{tool:'ci_review',decision}]}}));
 const app=await buildApp({cwd,env:{HOME:home},provider,agentHub:false,pluginDirs:[resolve('plugins/ci-review')]});apps.push(app);
 expect(app.plugins.some(p=>p.manifest.name==='ci-review'),'The complete candidate package must load').toBe(true);
 await app.storage.configure('ci-review.json',{repository});
 const core=app.createCore(async()=>false),calls:any[]=[],views:any[]=[];
 const response={stdout:JSON.stringify([sample]),stderr:'',exitCode:0};
 core.host.registerPlugin({name:'ci-oracle-exec',version:'1.0.0',trust:'trusted'},{'service.exec.run':e=>{if(e.plugin!=='ci-review')return;calls.push(e);return{value:{...response}};}});
 core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});await core.start();
 return{root,cwd,home,app,core,provider,calls,views,response};
}
it('loads an exact concurrent command without startup/model/process requests',async()=>{
 const f=await fixture();expect(f.calls).toHaveLength(0);await f.core.submit('/ci');
 expect(f.calls).toHaveLength(0);expect(f.provider.requests).toHaveLength(0);expect(f.views.at(-1)?.title).toBe('CI review');
 expect(f.app.commands().find(c=>c.name==='/ci')?.ui).toEqual({site:'plugin-ci-review-main'});
 await f.core.submit('/ci-other');expect(f.provider.requests).toHaveLength(1);expect(f.calls).toHaveLength(0);
});
it('routes only fixed read-only gh arguments and keeps large run IDs intact',async()=>{
 const f=await fixture();await f.app.storage.configure('ci-review.json',{repository,maxRuns:4,timeoutMs:900});
 for(const input of [{action:'runs'},{action:'run',runId},{action:'logs',runId},{action:'logs',runId,failedOnly:false}]){
  f.response.stdout=input.action==='runs'?JSON.stringify([sample]):input.action==='run'?JSON.stringify({...sample,jobs:[]}):'FAILED_LOG_LINE';
  const result=await f.core.invokeTool('ci_review',input);expect(result.ok,result.error).toBe(true);
  expect(result).toMatchObject({output:{exitCode:0,truncated:false}});expect((result.output as any).output).toContain(input.action==='logs'?'FAILED_LOG_LINE':'Verify patch');
 }
 const [list,detail,failed,full]=f.calls;
 for(const call of f.calls){expect(call).toMatchObject({plugin:'ci-review',cmd:'gh',timeoutMs:900});expect(call.args[call.args.indexOf('--repo')+1]).toBe(repository);}
 expect(list.args.slice(0,2)).toEqual(['run','list']);expect(list.args).toHaveLength(8);expect(list.args[list.args.indexOf('--limit')+1]).toBe('4');
 expect(new Set(list.args[list.args.indexOf('--json')+1].split(','))).toEqual(new Set(['databaseId','workflowName','displayTitle','headBranch','status','conclusion','url','createdAt']));
 expect(detail.args.slice(0,3)).toEqual(['run','view',String(runId)]);expect(detail.args).toHaveLength(7);expect(detail.args[detail.args.indexOf('--json')+1].split(',')).toContain('jobs');
 for(const [call,flag] of [[failed,'--log-failed'],[full,'--log']] as const){expect(call.args.slice(0,3)).toEqual(['run','view',String(runId)]);expect(call.args).toHaveLength(6);expect(call.args).toContain(flag);}
 expect(f.provider.requests).toHaveLength(0);
 const tools=(await import(pathToFileURL(resolve('plugins/ci-review/tools.ts')).href)).default;
 expect(tools.find((t:any)=>t.name==='ci_review').describe({action:'runs'})).toMatchObject({tool:'ci_review',readOnly:true});
});
it('rejects malformed or extra runtime inputs before requesting any execution',async()=>{
 const f=await fixture(),tools=(await import(pathToFileURL(resolve('plugins/ci-review/tools.ts')).href)).default,tool=tools.find((t:any)=>t.name==='ci_review');
 const requested:any[]=[];const ctx:any={cwd:f.cwd,signal:new AbortController().signal,settings:async()=>({repository}),request:async(...args:any[])=>{requested.push(args);return f.response;}};
 for(const input of [null,[],{}, {action:'rerun'}, {action:'runs',runId}, {action:'runs',repository:'elsewhere/repo'}, {action:'runs',command:'gh auth token'}, {action:'run'}, {action:'run',runId:'12'}, {action:'run',runId:-1}, {action:'run',runId:1.5}, {action:'run',runId:Number.MAX_SAFE_INTEGER+1}, {action:'run',runId,failedOnly:true}, {action:'logs',runId,failedOnly:'yes'}])expect((await tool.execute(ctx,input)).ok).toBe(false);
 expect(requested).toHaveLength(0);expect(f.calls).toHaveLength(0);
});
it('rejects missing or invalid scoped configuration before any gh request',async()=>{
 const f=await fixture();
 for(const patch of [{repository:null},{repository:'acme/repo;touch pwned'},{repository:'https://github.com/acme/repo'},{maxRuns:0},{maxRuns:31},{maxChars:999},{maxChars:64001},{timeoutMs:99},{timeoutMs:30001}]){
  await f.app.storage.configure('ci-review.json',{repository,maxRuns:10,maxChars:16000,timeoutMs:15000,...patch});
  expect((await f.core.invokeTool('ci_review',{action:'runs'})).ok).toBe(false);
 }
 expect(f.calls).toHaveLength(0);
});
it('bounds output and removes actual ANSI/OSC terminal controls from logs',async()=>{
 const f=await fixture();await f.app.storage.configure('ci-review.json',{repository,maxChars:1000});
 f.response.stdout='\x1b]52;c;CLIPBOARD_PAYLOAD\x07\x1b[31mVISIBLE_FAILURE\x1b[0m\n'+'x'.repeat(5000);
 const result=await f.core.invokeTool('ci_review',{action:'logs',runId});expect(result).toMatchObject({ok:true,output:{truncated:true}});
 const output=(result.output as any).output;expect(output).toContain('VISIBLE_FAILURE');expect(output.length).toBeLessThanOrEqual(1000);expect(output).not.toMatch(/[\x1b\x07]/);expect(output).not.toContain('CLIPBOARD_PAYLOAD');
});
it('reports denial, invalid JSON and real nonzero diagnostics without success',async()=>{
 const denied=await fixture('deny');expect((await denied.core.invokeTool('ci_review',{action:'runs'})).ok).toBe(false);expect(denied.calls).toHaveLength(0);
 const f=await fixture();f.response.stdout='not JSON';expect((await f.core.invokeTool('ci_review',{action:'runs'})).ok).toBe(false);
 f.response.stdout=JSON.stringify({wrong:'shape'});expect((await f.core.invokeTool('ci_review',{action:'runs'})).ok).toBe(false);
 f.response.stdout='partial';f.response.stderr='FIXTURE_FAILURE';f.response.exitCode=7;
 const result=await f.core.invokeTool('ci_review',{action:'logs',runId});expect(result.ok).toBe(false);expect(result.error).toMatch(/7/);expect(result.error).toContain('FIXTURE_FAILURE');
});
it('refreshes through the same tool and exposes a selectable failed run',async()=>{
 const f=await fixture();await f.core.submit('/ci');await f.core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});
 expect(f.calls).toHaveLength(1);expect(JSON.stringify(f.views.at(-1))).toContain('Verify patch');expect(JSON.stringify(f.views.at(-1))).toContain(String(runId));
 f.response.stdout=JSON.stringify({...sample,jobs:[]});await f.core.host.emit('ui.press',{site:'plugin-ci-review-main',key:`run:${runId}`});expect(f.calls).toHaveLength(2);
 f.response.stdout='VISIBLE_FAILED_LOG';await f.core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'logs-failed'});expect(JSON.stringify(f.views.at(-1))).toContain('VISIBLE_FAILED_LOG');expect(f.provider.requests).toHaveLength(0);
});
it('does not settle direct tool cancellation before its execution service settles',async()=>{
 const tools=(await import(pathToFileURL(resolve('plugins/ci-review/tools.ts')).href)).default,tool=tools.find((t:any)=>t.name==='ci_review');
 let release!:()=>void,entered!:()=>void,finished=false;
 const pending=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;}),controller=new AbortController();
 const ctx:any={cwd:process.cwd(),signal:controller.signal,settings:async()=>({repository}),request:async()=>{entered();await pending;return {stdout:JSON.stringify([sample]),stderr:'',exitCode:0};}};
 const work=tool.execute(ctx,{action:'runs'}).then((result:any)=>{finished=true;return result;},(error:unknown)=>{finished=true;return {ok:false,error:String(error)};});
 try{await ready;controller.abort();await new Promise(resolve=>setImmediate(resolve));expect(finished).toBe(false);release();expect(await work).toMatchObject({ok:false,error:expect.stringMatching(/cancel|abort/i)});}
 finally{release();await work;}
});
it('cancels and closes real SDK-owned processes while preserving the held main agent',async()=>{
 const provider=new ScriptedProvider([{text:'MAIN_AGENT_HELD',hold:true}]),f=await fixture('allow',provider),pidFile=join(f.root,'worker.pid');
 f.core.host.unregisterPlugin('ci-oracle-exec');
 f.core.host.registerPlugin({name:'ci-oracle-worker',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>e.plugin==='ci-review'?$.next({...e,cmd:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`]}):undefined});
 await f.core.submit('/ci');const main=f.core.submit('Continue the main task');await expect.poll(()=>provider.requests.length,{timeout:3000}).toBe(1);
 for(const action of ['cancel','close']){
  await rm(pidFile,{force:true});const work=f.core.host.emit('ui.press',{site:'plugin-ci-review-main',key:'refresh'});let pid=0;
  await expect.poll(async()=>{pid=Number(await readFile(pidFile,'utf8').catch(()=>''));return pid>0;},{timeout:3000}).toBe(true);
  await f.core.host.emit('ui.press',{site:'plugin-ci-review-main',key:action});const count=f.views.length;await work;
  expect(()=>process.kill(pid,0)).toThrow();expect(provider.requests[0].signal.aborted).toBe(false);expect(f.core.getState()).toBe('running');if(action==='close')expect(f.views).toHaveLength(count);
 }
 provider.release();await main;expect(provider.requests).toHaveLength(1);
},10000);
it('configures validated scoped values and shows effective settings after a global save',async()=>{
 const hooks=(await import(pathToFileURL(resolve('plugins/ci-review/hooks.ts')).href)).default,state=new Map(),views:any[]=[],saves:any[]=[];
 const effective={repository,maxRuns:10,maxChars:16000,timeoutMs:15000};
 const answers=[{action:'save',values:{repository:'bad repo',maxRuns:'0',maxChars:'1000',timeoutMs:'900',scope:'global'}},{action:'save',values:{repository:'other/repo',maxRuns:'4',maxChars:'1200',timeoutMs:'900',scope:'global'}}];
 const api:any={state,signal:new AbortController().signal,background:()=>api,storage:{config:async()=>effective,configure:async(...args:any[])=>{saves.push(args);}},ui:{form:async()=>answers.shift()??null,view:async(...args:any[])=>{views.push(args);},notify:async()=>{},remove:async()=>{}},agent:{tool:async()=>{throw Error('Configuration must not execute a tool');}}};
 await hooks['ui.press']({site:'plugin-ci-review-main',key:'configure'},api);
 expect(saves).toEqual([['ci-review.json',{repository:'other/repo',maxRuns:4,maxChars:1200,timeoutMs:900},'global']]);expect(JSON.stringify(views.at(-1))).toContain(repository);
});
