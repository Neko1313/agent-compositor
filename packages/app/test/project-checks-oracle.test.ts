import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {buildApp} from '../src/build.js';import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(decision='allow'){
 const root=await mkdtemp(join(tmpdir(),'checks-oracle-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 await writeFile(join(cwd,'package.json'),JSON.stringify({name:'fixture',scripts:{check:'node -e "console.log(123)"',fail:'exit 7',slow:'sleep 30','build:types':'echo TYPES'}}));
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['project-checks'],agent:{projectContext:false,skills:false},permissions:{rules:[{tool:'project_check',decision}]}}));
 const provider=new ScriptedProvider([]),app=await buildApp({cwd,env:{HOME:home},provider,agentHub:false,pluginDirs:[resolve('plugins/project-checks')]});apps.push(app);expect(app.plugins.some(p=>p.manifest.name==='project-checks'),'The candidate package must load').toBe(true);const core=app.createCore(async()=>false);await core.start();return{root,cwd,home,app,core,provider};
}
it('discovers real package scripts on demand and rejects unknown or malformed calls before execution',async()=>{
 const f=await fixture(),seen:any[]=[];f.core.host.registerPlugin({name:'exec-observer',version:'1.0.0',trust:'trusted'},{'service.exec.run':e=>{seen.push(e);return{value:{stdout:'OK',stderr:'',exitCode:0}};}});
 expect(await f.core.invokeTool('project_check',{action:'list'})).toMatchObject({ok:true,output:{scripts:expect.arrayContaining([expect.objectContaining({name:'check',command:'node -e "console.log(123)"'})])}});
 expect(seen).toHaveLength(0);
 for(const args of [{action:'run',name:'missing'},{action:'run',name:'check; touch injected'},{action:'unknown'},{action:'run',name:7},{action:'list',unexpected:true}])expect((await f.core.invokeTool('project_check',args)).ok).toBe(false);
 expect(seen).toHaveLength(0);expect(f.provider.requests).toHaveLength(0);
});
it('uses fixed owned npm arguments, preserves truthful exit status and bounds combined output',async()=>{
 const f=await fixture();let call:any;f.core.host.registerPlugin({name:'exec-fixture',version:'1.0.0',trust:'trusted'},{'service.exec.run':e=>{call=e;return{value:{stdout:'x'.repeat(18000),stderr:'diagnostic',exitCode:0}};}});
 await f.app.storage.configure('project-checks.json',{maxChars:1000,timeoutMs:700});
 const r=await f.core.invokeTool('project_check',{action:'run',name:'check'});expect(r).toMatchObject({ok:true,output:{exitCode:0,truncated:true}});expect(call).toMatchObject({plugin:'project-checks',cmd:'npm',args:['run','--','check'],timeoutMs:700});expect((r.output as any).stdout.length+(r.output as any).stderr.length).toBeLessThanOrEqual(1000);
 f.core.host.unregisterPlugin('exec-fixture');f.core.host.registerPlugin({name:'exec-failure',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>({value:{stdout:'partial',stderr:'FAILURE_DETAIL',exitCode:7}})});
 expect(await f.core.invokeTool('project_check',{action:'run',name:'fail'})).toMatchObject({ok:false,error:expect.stringMatching(/7[\s\S]*FAILURE_DETAIL/)});
});
it('keeps permission denial before side effects and reports invalid settings and missing package files',async()=>{
 const f=await fixture('deny');let executions=0;f.core.host.registerPlugin({name:'exec-observer',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>{executions++;return{value:{stdout:'bad',stderr:'',exitCode:0}};}});
 expect((await f.core.invokeTool('project_check',{action:'run',name:'check'})).ok).toBe(false);expect(executions).toBe(0);
 const allowed=await fixture();await allowed.app.storage.configure('project-checks.json',{timeoutMs:0});expect((await allowed.core.invokeTool('project_check',{action:'run',name:'check'})).ok).toBe(false);
 await allowed.app.storage.configure('project-checks.json',{timeoutMs:1000});await rm(join(allowed.cwd,'package.json'));expect((await allowed.core.invokeTool('project_check',{action:'list'})).ok).toBe(false);
});
it('opens exact commands without a model, routes UI actions through the tool and closes without reopening',async()=>{
 const f=await fixture(),views:any[]=[];f.core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});
 await f.core.submit('/checks');expect(f.provider.requests).toHaveLength(0);expect(views.at(-1)?.title).toBe('Project checks');
 expect(f.app.commands().find(c=>c.name==='/checks')?.ui).toEqual({site:'plugin-project-checks-main'});
 await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'refresh'});expect(JSON.stringify(views.at(-1))).toContain('Run check');
 f.core.host.registerPlugin({name:'exec-fixture',version:'1.0.0',trust:'trusted'},{'service.exec.run':()=>({value:{stdout:'ACTUAL_PANEL_RESULT',stderr:'',exitCode:0}})});
 await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'run:check'});expect(JSON.stringify(views.at(-1))).toContain('ACTUAL_PANEL_RESULT');
 await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'close'});const count=views.length;await new Promise(done=>setImmediate(done));expect(views).toHaveLength(count);
});
it('cancels and reaps an actual owned process through the panel while a model stays active',async()=>{
 const f=await fixture(),pidFile=join(f.root,'worker.pid');
 const held=new ScriptedProvider([{text:'MODEL_STILL_ACTIVE',hold:true}]);
 const app=await buildApp({cwd:f.cwd,env:{HOME:f.home},provider:held,agentHub:false,pluginDirs:[resolve('plugins/project-checks')]});apps.push(app);expect(app.plugins.some(p=>p.manifest.name==='project-checks'),'The candidate package must load').toBe(true);const core=app.createCore(async()=>false);await core.start();core.host.registerPlugin({name:'exec-delay',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>e.plugin==='project-checks'?$.next({...e,cmd:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`]}):undefined});
 await core.submit('/checks');await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'refresh'});const running=core.submit('Continue main task');await expect.poll(()=>held.requests.length).toBe(1);
 const work=core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'run:slow'});let pid=0;await expect.poll(async()=>{pid=Number(await readFile(pidFile,'utf8').catch(()=>''));return pid>0;}).toBe(true);
 await core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'cancel'});await work;expect(()=>process.kill(pid,0)).toThrow();expect(held.requests[0].signal.aborted).toBe(false);held.release();await running;
});

it('runs an actual local npm script without installing dependencies or calling a model',async()=>{
 const f=await fixture();const result=await f.core.invokeTool('project_check',{action:'run',name:'check'});expect(result).toMatchObject({ok:true,output:{exitCode:0,truncated:false}});expect((result.output as any).stdout).toContain('123');expect(f.provider.requests).toHaveLength(0);
});
