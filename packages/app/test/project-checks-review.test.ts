import {afterEach,expect,it} from 'vitest';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {buildApp} from '../src/build.js';import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const a of apps.splice(0))await a.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(scripts:Record<string,string>={check:'echo PASS'}){
 const root=await mkdtemp(join(tmpdir(),'project-checks-review-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);await writeFile(join(cwd,'package.json'),JSON.stringify({scripts}));await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['project-checks'],agent:{projectContext:false,skills:false},permissions:{rules:[{tool:'project_check',decision:'allow'}]}}));
 const app=await buildApp({cwd,env:{HOME:home},provider:new ScriptedProvider([]),agentHub:false,pluginDirs:[resolve('plugins/project-checks')]});apps.push(app);const core=app.createCore(async()=>false),views:any[]=[],notices:string[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);if(e.kind==='catalog'&&e.event==='ui.notification')notices.push(String(e.input.message));});await core.start();await core.submit('/checks');return{root,cwd,home,app,core,views,notices};
}
it('bounds script metadata previews as well as process output',async()=>{
 const f=await fixture({check:'echo '+ 'x'.repeat(60000)});await f.app.storage.configure('project-checks.json',{maxChars:1000});const result=await f.core.invokeTool('project_check',{action:'list'});expect(result).toMatchObject({ok:true,output:{truncated:true}});const data=result.output as any;expect(data.scripts.reduce((n:number,s:any)=>n+s.name.length+s.command.length,0)).toBeLessThanOrEqual(1000);
});
it('does not copy project-only settings into global scope',async()=>{
 const f=await fixture();await f.app.storage.configure('project-checks.json',{onlyProject:'local value',maxChars:3000});f.core.host.setFormHandler(async()=>({action:'save',values:{maxChars:'5000',timeoutMs:'400',scope:'global'}}));await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'configure'});
 const saved=JSON.parse(await readFile(join(f.app.storage.paths.home,'project-checks.json'),'utf8'));expect(saved.onlyProject).toBeUndefined();expect(saved.maxChars).toBe(5000);expect((await f.app.storage.config('project-checks.json')).maxChars).toBe(3000);
});
it('shows usage for an unsupported UI command argument',async()=>{
 const f=await fixture();await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'command:/checks unexpected'});expect(f.notices.join('\n')).toMatch(/Usage.*checks/);
});
it('keeps cancellation near the top even with many package scripts',async()=>{
 const f=await fixture(Object.fromEntries(Array.from({length:100},(_,i)=>['check'+i,'echo '+i])));await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'refresh'});
 f.core.host.registerPlugin({name:'wait-check',version:'1.0.0',trust:'trusted'},{'service.exec.run':async(_e,$)=>new Promise(done=>$.signal.addEventListener('abort',()=>done({value:{exitCode:143,stdout:'',stderr:'cancelled'}}),{once:true}))});
 const work=f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'run:check0'});
 try{await expect.poll(()=>f.views.at(-1)?.view.lines.some((line:any)=>line.action==='cancel')).toBe(true);expect(f.views.at(-1).view.lines.slice(0,7).some((line:any)=>line.action==='cancel')).toBe(true);}finally{await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'cancel'});await work;}
});
it('clears the running operation after the initiating hook expires',async()=>{
 const f=await fixture();const plugin=f.app.plugins.find(p=>p.manifest.name==='project-checks')!;
 f.core.host.unregisterPlugin('project-checks');f.core.host.registerPlugin({...plugin.manifest,hookTimeouts:{'ui.press':100}},plugin.hooks);
 f.core.host.registerPlugin({name:'wait-check',version:'1.0.0',trust:'trusted'},{'service.exec.run':async(_e,$)=>new Promise(done=>$.signal.addEventListener('abort',()=>done({value:{exitCode:143,stdout:'',stderr:'cancelled'}}),{once:true}))});
 await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'run:check'});
 await expect.poll(()=>f.views.at(-1)?.view.lines.some((line:any)=>line.action==='refresh')).toBe(true);
 expect(JSON.stringify(f.views.at(-1))).toMatch(/failed|cancel|expired|timeout/i);
 await f.core.host.emit('ui.press',{site:'plugin-project-checks-main',key:'refresh'});
 expect(JSON.stringify(f.views.at(-1))).toContain('echo PASS');
});
