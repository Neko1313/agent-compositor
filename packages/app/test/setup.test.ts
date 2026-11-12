import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectStorage} from '@agent-compositor/config';
import {ProviderRouter} from '@agent-compositor/provider';
import {setupGuide} from '../src/setup.js';
import {modelControls} from '../src/models.js';
import {buildApp} from '../src/build.js';

async function fixture(failInstall=false){
 const root=await mkdtemp(join(tmpdir(),'setup-guide-')),storage=new ProjectStorage(root,{HOME:root});await storage.init();
 let configured=false,loaded:string[]=[],enabled:string[]=[],forms:any[]=[],answers:any[]=[],operations:any[]=[],views:any[]=[],notices:any[]=[];
 const guide=setupGuide(storage,{model:async()=>({configured,profile:'fixture',model:'fixture-model'}),configure:async()=>{configured=true;},loaded:()=>loaded,enabled:()=>enabled,
  control:async(args:any)=>{operations.push(args);if(args.action==='list')return{ok:true,data:{installed:{'project-checks':{version:'99.0.0'}},available:[]}};if(args.action==='install')return failInstall?{ok:false,error:'Download unavailable'}:{ok:true};enabled.push(args.name);return{ok:true};}});
 const api:any={signal:new AbortController().signal,ui:{view:async(_id:string,_title:string,view:any)=>{views.push(view);},notify:async(message:string,level:string)=>{notices.push({message,level});},remove:async()=>{},form:async(form:any)=>{forms.push(form);return answers.shift()??null;}}};
 const press=(key:string)=>(guide.plugin.hooks['ui.press'] as any)({site:'plugin-setup-guide-setup',key},api);
 return{root,storage,guide,api,press,forms,answers,operations,views,notices,setConfigured:(value:boolean)=>{configured=value;},setLoaded:(value:string[])=>{loaded=value;},close:()=>rm(root,{recursive:true,force:true})};
}

it('shows a local guide without mutations, supports skipping and keeps manual setup available',async()=>{
 const f=await fixture();try{
  expect(await f.guide.shouldOffer()).toBe(true);await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);
  expect(f.operations).toEqual([]);expect(f.forms).toEqual([]);expect(f.views.at(-1).lines[1].text).toMatch(/choose a connection/);
  await f.press('finish');expect(f.notices.at(-1).level).toBe('warn');
  await f.press('skip');expect(JSON.parse(await readFile(join(f.storage.paths.home,'setup.json'),'utf8')).status).toBe('skipped');expect(await f.guide.shouldOffer()).toBe(false);
  await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);await f.press('model');await f.press('finish');
  expect(JSON.parse(await readFile(join(f.storage.paths.home,'setup.json'),'utf8')).status).toBe('complete');
 }finally{await f.close();}
});

it('keeps installed pins, enables only selected plugins and waits for reload before completing',async()=>{
 const f=await fixture();try{
  f.setConfigured(true);f.answers.push({action:'next',values:{work:'coding'}},{action:'apply',values:{'project-checks':true}});
  await f.press('tools');expect(f.operations).toEqual([{action:'list'},{action:'enable',name:'project-checks',scope:'project'}]);
  expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(true);
  await f.press('finish');expect(f.notices.at(-1).message).toMatch(/Apply plugin changes/);
  f.setLoaded(['project-checks']);await (f.guide.plugin.hooks['session.reload'] as any)({},f.api);await f.press('finish');
  expect(JSON.parse(await readFile(join(f.storage.paths.home,'setup.json'),'utf8')).status).toBe('complete');
 }finally{await f.close();}
});

it('does not inspect or install plugins if their selection form is cancelled',async()=>{
 const f=await fixture();try{f.answers.push({action:'next',values:{work:'coding'}},null);await f.press('tools');expect(f.operations).toEqual([]);}finally{await f.close();}
});

it('reports an installation failure without claiming activation or enabling the missing package',async()=>{
 const f=await fixture(true);try{
  f.answers.push({action:'next',values:{work:'research'}},{action:'apply',values:{web:true}});await f.press('tools');
  expect(f.operations).toEqual([{action:'list'},{action:'install',name:'web@agent-compositor',scope:'project'}]);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('Download unavailable'))).toBe(true);
  expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(false);
 }finally{await f.close();}
});

it('reuses the provider editor with five fields, private key handling and no connection request on save',async()=>{
 const root=await mkdtemp(join(tmpdir(),'setup-profile-'));try{
  const storage=new ProjectStorage(root,{HOME:root});await storage.init();const router=new ProviderRouter({default:{baseUrl:'http://127.0.0.1:11434/v1',model:'fallback',apiKey:''}});
  const keys:any[]=[],forms:any[]=[],views:any[]=[];let fetches=0;
  const controls=modelControls(router,storage,{setKey:async(...args)=>{keys.push(args);},refresh:async()=>{}},async()=>{fetches++;throw Error('Unexpected connection request');});
  const api:any={signal:new AbortController().signal,ui:{notify:async()=>{},view:async(...args:any[])=>{views.push(args);},form:async(form:any)=>{forms.push(form);return forms.length===1?{action:'next',values:{preset:'compatible'}}:{action:'save',values:{id:'first-setup',baseUrl:'http://127.0.0.1:8080/v1',model:'fixture-model',key:'PRIVATE_SETUP_FIXTURE',scope:'project'}};}}};
  await controls.configureSetup(api,[]);expect(forms[1].fields.map((field:any)=>field.id)).toEqual(['id','baseUrl','model','key','scope']);
  expect(keys).toEqual([['first-setup','PRIVATE_SETUP_FIXTURE']]);expect(router.model).toBe('fixture-model');expect(fetches).toBe(0);expect(views).toEqual([]);
  expect(await readFile(join(storage.paths.state,'providers.json'),'utf8')).not.toContain('PRIVATE_SETUP_FIXTURE');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('offers setup for the implicit fallback provider but not an explicitly selected model',async()=>{
 const root=await mkdtemp(join(tmpdir(),'setup-detection-'));
 const initial=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{
  expect(await initial.shouldOfferSetup?.()).toBe(true);expect(initial.commands().some(command=>command.name==='/setup')).toBe(true);
  const core=initial.createCore(async()=>false);await core.start();await initial.reloadPlugins(core);
  expect(core.host.hasPlugin('setup-guide')).toBe(true);expect((await core.host.emit('prompt.submit',{text:'/setup'})).value).toMatchObject({drop:'setup-guide: handled'});
  await core.host.emit('prompt.submit',{text:'/model selected-without-a-profile'});expect(await initial.shouldOfferSetup?.()).toBe(false);
 }finally{await initial.close();}
 const configured=await buildApp({cwd:root,env:{HOME:root,AGENT_MODEL:'explicit-model'},pluginDirs:[]});
 try{expect(await configured.shouldOfferSetup?.()).toBe(false);}finally{await configured.close();}
 await writeFile(join(root,'agent-compositor.json'),JSON.stringify({enabledPlugins:['model-selector']}));
 const disabled=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{expect(await disabled.shouldOfferSetup?.()).toBe(false);expect(disabled.commands().some(command=>command.name==='/setup')).toBe(false);}finally{await disabled.close();await rm(root,{recursive:true,force:true});}
});

it('keeps the guide available when saved provider JSON was skipped as malformed during startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'setup-invalid-settings-'));const storage=new ProjectStorage(root,{HOME:root});await storage.init();
 await writeFile(join(storage.paths.state,'providers.json'),'{');
 const app=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{expect(app.config.warnings).toContain('Saved provider connections could not be loaded');expect(await app.shouldOfferSetup?.()).toBe(true);}finally{await app.close();await rm(root,{recursive:true,force:true});}
});

it('does not use the guide to bypass a disabled model-settings component',async()=>{
 const root=await mkdtemp(join(tmpdir(),'setup-capability-ceiling-'));
 await writeFile(join(root,'agent-compositor.json'),JSON.stringify({enabledPlugins:['setup-guide']}));
 const app=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{
  const core=app.createCore(async()=>false),views:any[]=[];core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.push(event.input);});await core.start();
  await core.host.emit('ui.press',{site:'plugin-setup-guide-setup',key:'model'});
  expect(views.at(-1).view.lines.some((line:any)=>line.text.includes('Model settings are disabled'))).toBe(true);
  await expect(readFile(join(app.storage.paths.state,'providers.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
