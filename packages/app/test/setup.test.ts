import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectStorage} from '@agent-compositor/config';
import {ProviderRouter} from '@agent-compositor/provider';
import {setupGuide} from '../src/setup.js';
import {modelControls} from '../src/models.js';
import {buildApp} from '../src/build.js';
import {validateUiFormResult} from '@agent-compositor/events';

async function fixture(failInstall=false){
 const root=await mkdtemp(join(tmpdir(),'setup-guide-')),storage=new ProjectStorage(root,{HOME:root});await storage.init();
 let configured=false,sideAvailable=true,restrictions:Record<string,string>={},loaded:string[]=[],enabled:string[]=[],forms:any[]=[],answers:any[]=[],operations:any[]=[],views:any[]=[],notices:any[]=[];
 const guide=setupGuide(storage,{model:async()=>({configured,profile:'fixture',model:'fixture-model'}),configure:async()=>{configured=true;},loaded:()=>loaded,enabled:()=>enabled,
  sideConversationAvailable:()=>sideAvailable,activationRestriction:name=>restrictions[name],
  control:async(args:any)=>{operations.push(args);if(args.action==='list')return{ok:true,data:{installed:{'project-checks':{version:'99.0.0'}},available:[]}};if(args.action==='install')return failInstall?{ok:false,error:'Download unavailable'}:{ok:true};enabled.push(args.name);return{ok:true};}});
 const api:any={session:{id:'fixture',cwd:root},signal:new AbortController().signal,ui:{view:async(_id:string,_title:string,view:any,placement:any)=>{views.push({...view,placement});},notify:async(message:string,level:string)=>{notices.push({message,level});},remove:async()=>{},form:async(form:any)=>{forms.push(form);return answers.shift()??null;}}};
 const press=(key:string)=>(guide.plugin.hooks['ui.press'] as any)({site:'plugin-setup-guide-setup',key},api);
 return{root,storage,guide,api,press,forms,answers,operations,views,notices,setConfigured:(value:boolean)=>{configured=value;},setSideAvailable:(value:boolean)=>{sideAvailable=value;},setRestrictions:(value:Record<string,string>)=>{restrictions=value;},setLoaded:(value:string[])=>{loaded=value;},setEnabled:(value:string[])=>{enabled=value;},close:()=>rm(root,{recursive:true,force:true})};
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

it.each(['goal','tools'])('does not install or enable anything when the %s form returns its cancel action',async stage=>{
 const f=await fixture();try{
  f.api.ui.form=async(form:any)=>{
   f.forms.push(form);
   const values=Object.fromEntries(form.fields.map((field:any)=>[field.id,field.value]));
   const action=form.title==='Choose your work'?(stage==='goal'?'cancel':'next'):'cancel';
   return validateUiFormResult(form,{action,values});
  };
  await f.press('tools');
  expect(f.forms).toHaveLength(stage==='goal'?1:2);
  expect(f.operations).toEqual([]);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('selected for this project'))).toBe(false);
 }finally{await f.close();}
});

it.each(['goal','tools'])('keeps the project unchanged when the real form handler cancels %s',async stage=>{
 const root=await mkdtemp(join(tmpdir(),'setup-cancel-action-'));
 const app=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{
  const core=app.createCore(async()=>false),services:any[]=[];let forms=0;
  core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='service.extension.control')services.push(event.input);});
  await core.start();
  core.host.setFormHandler(async(_plugin,form)=>{
   forms++;const values=Object.fromEntries(form.fields.map(field=>[field.id,field.value]));
   return validateUiFormResult(form,{action:forms===1&&stage==='tools'?'next':'cancel',values});
  });
  const result=await core.host.emit('ui.press',{site:'plugin-setup-guide-setup',key:'tools'});
  expect(result.faults).toEqual([]);expect(forms).toBe(stage==='goal'?1:2);expect(services).toEqual([]);
  await expect(readFile(join(root,'agent-compositor.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

it('recovers from invalid saved setup state without overwriting it until the user chooses',async()=>{
 const f=await fixture();try{
  const file=join(f.storage.paths.home,'setup.json');
  for(const invalid of ['{broken','null','[]','{"version":1,"status":"unexpected"}','{"version":2,"status":"complete"}']){
   await writeFile(file,invalid);expect(await f.guide.shouldOffer()).toBe(true);
   await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);
   expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('Saved setup status is invalid'))).toBe(true);
   expect(await readFile(file,'utf8')).toBe(invalid);
  }
  f.setConfigured(true);expect(await f.guide.shouldOffer()).toBe(false);f.setConfigured(false);
  await f.press('skip');expect(JSON.parse(await readFile(file,'utf8'))).toEqual({version:1,status:'skipped'});
  expect(await f.guide.shouldOffer()).toBe(false);
 }finally{await f.close();}
});

it('warns when side-conversation support is unavailable without changing its configuration',async()=>{
 const f=await fixture();try{
  f.setSideAvailable(false);f.answers.push({action:'next',values:{work:'chat'}},{action:'apply',values:{btw:true}});await f.press('tools');
  expect(f.forms[1].fields.find((field:any)=>field.id==='btw').hint).toContain('agent-hub is unavailable');
  expect(f.operations).toEqual([{action:'list'},{action:'install',name:'btw@agent-compositor',scope:'project'},{action:'enable',name:'btw',scope:'project'}]);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('app restart')&&line.text.includes('/btw --once'))).toBe(true);
 }finally{await f.close();}
});

it('never installs restricted selections and continues with allowed selections',async()=>{
 const f=await fixture();try{
  f.setRestrictions({'project-checks':'Blocked by disabledPlugins'});
  f.answers.push({action:'next',values:{work:'coding'}},{action:'apply',values:{'project-checks':true,resources:true}});await f.press('tools');
  expect(f.forms[1].fields.find((field:any)=>field.id==='project-checks')).toMatchObject({value:false,hint:'Blocked by disabledPlugins'});
  expect(f.operations).toEqual([{action:'list'},{action:'install',name:'resources@agent-compositor',scope:'project'},{action:'enable',name:'resources',scope:'project'}]);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('project-checks: Blocked by disabledPlugins'))).toBe(true);
 }finally{await f.close();}
});

it('does not contact plugin management when every selected plugin is restricted',async()=>{
 const f=await fixture();try{
  f.setRestrictions({web:'Excluded by enabledPlugins'});f.answers.push({action:'next',values:{work:'research'}},{action:'apply',values:{web:true}});await f.press('tools');
  expect(f.operations).toEqual([]);expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('Excluded by enabledPlugins'))).toBe(true);
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

it('offers independent resources and side conversations without enabling them by default',async()=>{
 const f=await fixture();try{
  f.answers.push({action:'next',values:{work:'coding'}},{action:'apply',values:{'project-checks':true,resources:true,btw:false}});
  await f.press('tools');const fields=f.forms[1].fields;
  expect(fields.find((field:any)=>field.id==='resources')).toMatchObject({value:false,hint:expect.stringContaining('without calling a model')});
  expect(fields.find((field:any)=>field.id==='btw')).toMatchObject({value:false,hint:expect.stringContaining('agent-hub')});
  expect(f.operations).toEqual([{action:'list'},{action:'enable',name:'project-checks',scope:'project'},{action:'install',name:'resources@agent-compositor',scope:'project'},{action:'enable',name:'resources',scope:'project'}]);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('Apply pending tools: project-checks, resources'))).toBe(true);
 }finally{await f.close();}
});
it('offers approval review as explicit opt-in and explains how to start it',async()=>{
 const f=await fixture();try{
  f.answers.push({action:'next',values:{work:'chat'}},{action:'apply',values:{'auto-approve':true}});await f.press('tools');
  expect(f.forms[1].fields.find((field:any)=>field.id==='auto-approve')).toMatchObject({value:false,hint:expect.stringContaining('/auto on')});
  expect(f.operations).toEqual([{action:'list'},{action:'install',name:'auto-approve@agent-compositor',scope:'project'},{action:'enable',name:'auto-approve',scope:'project'}]);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('/auto on')&&line.text.includes('model'))).toBe(true);
  f.setEnabled([]);await (f.guide.plugin.hooks['session.reload'] as any)({},f.api);
  expect(f.views.at(-1).lines.some((line:any)=>line.text.includes('/auto on'))).toBe(false);
 }finally{await f.close();}
});

it('lets setup finish when a selected plugin is disabled elsewhere before reload',async()=>{
 const f=await fixture();try{
  f.setConfigured(true);f.answers.push({action:'next',values:{work:'coding'}},{action:'apply',values:{'project-checks':true}});
  await f.press('tools');expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(true);
  f.setEnabled([]);await (f.guide.plugin.hooks['session.reload'] as any)({},f.api);
  expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(false);
  expect(f.views.at(-1).lines.some((line:any)=>line.text==='project-checks: no longer enabled')).toBe(true);
  await f.press('finish');expect(JSON.parse(await readFile(join(f.storage.paths.home,'setup.json'),'utf8')).status).toBe('complete');
 }finally{await f.close();}
});

it('tracks enabled recommendations across sessions and permits completion after they load or are disabled',async()=>{
 const f=await fixture();try{
  f.setConfigured(true);f.setEnabled(['project-checks','unrelated-plugin']);
  await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);
  expect(f.views.at(-1).lines.some((line:any)=>line.text==='Apply pending tools: project-checks')).toBe(true);
  await f.press('finish');expect(f.notices.at(-1).message).toMatch(/Apply plugin changes/);
  await expect(readFile(join(f.storage.paths.home,'setup.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
  const other={...f.api,session:{...f.api.session,id:'other'}};
  await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},other);
  expect(f.views.at(-1).lines.some((line:any)=>line.text==='Apply pending tools: project-checks')).toBe(true);
  f.setLoaded(['project-checks']);await (f.guide.plugin.hooks['session.reload'] as any)({},other);
  expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(false);
  await (f.guide.plugin.hooks['ui.press'] as any)({site:'plugin-setup-guide-setup',key:'finish'},other);
  expect(JSON.parse(await readFile(join(f.storage.paths.home,'setup.json'),'utf8')).status).toBe('complete');
 }finally{await f.close();}
});

it('refreshes an already open guide when completion detects an external change',async()=>{
 const f=await fixture();try{
  f.setConfigured(true);await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);
  expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(false);
  f.setEnabled(['project-checks']);await f.press('finish');
  expect(f.notices.at(-1).message).toMatch(/Apply plugin changes/);
  expect(f.views.at(-1).placement.focus).toBe(false);
  expect(f.views.at(-1).lines.some((line:any)=>line.text==='Apply pending tools: project-checks')).toBe(true);
 }finally{await f.close();}
});

it('refreshes a visible guide after a successful external selection change without taking focus',async()=>{
 const f=await fixture();try{
  f.setConfigured(true);f.answers.push({action:'next',values:{work:'coding'}},{action:'apply',values:{'project-checks':true}});
  await f.press('tools');const result={value:{changed:'project-checks',enabled:false}};
  f.api.next=async()=>{f.setEnabled([]);return result;};
  const actual=await (f.guide.plugin.hooks['service.extension.control'] as any)({action:'disable'},f.api);
  expect(actual).toBe(result);expect(f.views.at(-1).placement.focus).toBe(false);
  expect(f.views.at(-1).lines.some((line:any)=>line.action==='navigate:reload')).toBe(false);
  expect(f.views.at(-1).lines.some((line:any)=>line.text==='project-checks: no longer enabled')).toBe(true);
  const count=f.views.length;f.api.next=async()=>({deny:'Not allowed'});
  await (f.guide.plugin.hooks['service.extension.control'] as any)({action:'disable'},f.api);expect(f.views).toHaveLength(count);
  f.api.next=async()=>result;f.api.ui.view=async()=>{throw Error('View unavailable');};
  expect(await (f.guide.plugin.hooks['service.extension.control'] as any)({action:'disable'},f.api)).toBe(result);
 }finally{await f.close();}
});

it('does not open the guide in a different session during plugin management',async()=>{
 const f=await fixture();try{
  await (f.guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);
  const count=f.views.length,other={...f.api,session:{...f.api.session,id:'other'},next:async()=>({value:{changed:'project-checks'}})};
  await (f.guide.plugin.hooks['service.extension.control'] as any)({action:'disable'},other);
  expect(f.views).toHaveLength(count);
 }finally{await f.close();}
});

it('does not reopen a guide closed while its model status is loading',async()=>{
 const f=await fixture();try{
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
  const guide=setupGuide(f.storage,{model:async()=>{await blocked;return{configured:true,profile:'fixture',model:'fixture'};},configure:async()=>{},enabled:()=>[],loaded:()=>[],activationRestriction:()=>undefined,sideConversationAvailable:()=>true,control:async()=>({ok:true})});
  const showing=(guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},f.api);
  await (guide.plugin.hooks['ui.press'] as any)({site:'plugin-setup-guide-setup',key:'close'},f.api);release();await showing;
  expect(f.views).toHaveLength(0);
 }finally{await f.close();}
});

it('does not time out a slow extension operation while the setup hook is installed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'setup-slow-extension-'));
 const app=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{
  const core=app.createCore(async()=>false);await core.start();
  core.runtime.setResolver('service.extension.control',async()=>{await new Promise(resolve=>setTimeout(resolve,2200));return{value:{changed:'fixture'}};});
  const result=await core.host.emit('service.extension.control',{action:'disable',name:'fixture'});
  expect(result.faults).toEqual([]);expect(result.value).toEqual({value:{changed:'fixture'}});
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
},10000);

it('does not inspect or install plugins if their selection form is cancelled',async()=>{
 const f=await fixture();try{f.answers.push({action:'next',values:{work:'coding'}},null);await f.press('tools');expect(f.operations).toEqual([]);}finally{await f.close();}
});

it.each(['install','enable'])('stops selecting further plugins when %s completes after cancellation',async stage=>{
 const f=await fixture();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const controller=new AbortController(),calls:string[]=[];let enabled:string[]=[];
 const guide=setupGuide(f.storage,{model:async()=>({configured:false,profile:'',model:''}),configure:async()=>{},loaded:()=>[],enabled:()=>enabled,activationRestriction:()=>undefined,sideConversationAvailable:()=>true,
  control:async(args:any)=>{calls.push(`${args.action}:${args.name??''}`);if(args.action==='list')return {ok:true,data:{installed:stage==='enable'?{'project-checks':{},'test-reports':{}}:{},available:[]}};
   if(args.action===stage&&args.name?.startsWith('project-checks')){started();await gate;}if(args.action==='enable')enabled=[...enabled,args.name];return {ok:true};}});
 const api={...f.api,signal:controller.signal};f.answers.push({action:'next',values:{work:'coding'}},{action:'apply',values:{'project-checks':true,'test-reports':true}});
 try{
  await (guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},api);
  const running=(guide.plugin.hooks['ui.press'] as any)({site:'plugin-setup-guide-setup',key:'tools'},api);await entered;controller.abort();release();await expect(running).rejects.toThrow();
  expect(calls).toEqual(stage==='install'?['list:','install:project-checks@agent-compositor']:['list:','enable:project-checks']);
  const fresh={...api,signal:new AbortController().signal};await (guide.plugin.hooks['prompt.submit'] as any)({text:'/setup'},fresh);
  expect(f.views.at(-1).lines.some((line:any)=>line.text===(stage==='install'?'project-checks: installed; activation cancelled':'project-checks: selected for this project'))).toBe(true);
 }finally{release();await f.close();}
});

it('does not complete setup if model status returns after cancellation',async()=>{
 const f=await fixture();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const guide=setupGuide(f.storage,{model:async()=>{started();await gate;return {configured:true,profile:'fixture',model:'fixture'};},configure:async()=>{},loaded:()=>[],enabled:()=>[],activationRestriction:()=>undefined,sideConversationAvailable:()=>true,control:async()=>({ok:true})});
 const controller=new AbortController(),api={...f.api,signal:controller.signal};
 try{const finishing=(guide.plugin.hooks['ui.press'] as any)({site:'plugin-setup-guide-setup',key:'finish'},api);await entered;controller.abort();release();await expect(finishing).rejects.toThrow();await expect(readFile(join(f.storage.paths.home,'setup.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});}
 finally{release();await f.close();}
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

it('does not switch, save or remove a provider when a custom form returns cancel',async()=>{
 const root=await mkdtemp(join(tmpdir(),'setup-provider-cancel-'));try{
  const storage=new ProjectStorage(root,{HOME:root});await storage.init();
  const router=new ProviderRouter({default:{baseUrl:'http://127.0.0.1:11434/v1',model:'default-model',apiKey:''},saved:{baseUrl:'http://127.0.0.1:8080/v1',model:'saved-model',apiKey:''}});
  const keys:any[]=[],controls=modelControls(router,storage,{setKey:async(...args)=>{keys.push(args);},refresh:async()=>{}},async()=>{throw Error('Unexpected connection request');});
  let forms=0;const api:any={signal:new AbortController().signal,ui:{notify:async()=>{},view:async()=>{},form:async(form:any)=>{forms++;return{action:'cancel',values:Object.fromEntries(form.fields.map((field:any)=>[field.id,field.value??'']))};}}};
  await controls.configureSetup(api,['saved']);expect(forms).toBe(1);expect(router.credentialProfile).toBe('default');
  await (controls.hooks['ui.press'] as any)({site:'plugin-model-selector-models',key:'add'},api);expect(forms).toBe(2);
  api.ui.form=async(form:any)=>form.title==='Add provider'?{action:'next',values:{preset:'compatible'}}:
   {action:'cancel',values:{id:'cancelled',baseUrl:'http://127.0.0.1:8080/v1',model:'cancelled-model',key:'not-saved',scope:'project'}};
  await (controls.hooks['ui.press'] as any)({site:'plugin-model-selector-models',key:'add'},api);
  api.ui.form=async(form:any)=>({action:'cancel',values:{confirm:true}});
  await (controls.hooks['ui.press'] as any)({site:'plugin-model-selector-models',key:'remove:saved'},api);
  expect(router.profiles.saved).toBeDefined();expect(keys).toEqual([]);
  await expect(readFile(join(storage.paths.state,'providers.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
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

it.each([
 ['disabled list',{disabledPlugins:['agent-hub']},'agent-hub is unavailable'],
 ['allowlist',{enabledPlugins:['setup-guide','extension-manager','marketplace-manager']},'excluded by enabledPlugins'],
])('reports unavailable recommendations from the actual %s',async(_label,config,expected)=>{
 const root=await mkdtemp(join(tmpdir(),'setup-no-hub-')),file=join(root,'agent-compositor.json');
 const original=JSON.stringify(config);await writeFile(file,original);
 const app=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{
  const core=app.createCore(async()=>false),forms:any[]=[];await core.start();
  core.host.setFormHandler(async(_plugin,form)=>{forms.push(form);return forms.length===1?{action:'next',values:{work:'chat'}}:null;});
  const result=await core.host.emit('ui.press',{site:'plugin-setup-guide-setup',key:'tools'});
  expect(result.faults).toEqual([]);expect(forms[1].fields.find((field:any)=>field.id==='btw').hint).toContain(expected);
  expect(await readFile(file,'utf8')).toBe(original);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

it.each([
 ['disabled list',{disabledPlugins:['project-checks']},'disabledPlugins'],
 ['allowlist',{enabledPlugins:['setup-guide','extension-manager','marketplace-manager']},'enabledPlugins'],
])('avoids installation for a selected recommendation blocked by the actual %s',async(_label,config,restriction)=>{
 const root=await mkdtemp(join(tmpdir(),'setup-blocked-recommendation-')),file=join(root,'agent-compositor.json');
 const original=JSON.stringify(config);await writeFile(file,original);const app=await buildApp({cwd:root,env:{HOME:root},pluginDirs:[]});
 try{
  const core=app.createCore(async()=>false),forms:any[]=[],views:any[]=[];
  core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.push(event.input);});await core.start();
  core.host.setFormHandler(async(_plugin,form)=>{forms.push(form);return{action:forms.length===1?'next':'apply',values:{work:'coding','project-checks':true}};});
  const result=await core.host.emit('ui.press',{site:'plugin-setup-guide-setup',key:'tools'});
  expect(result.faults).toEqual([]);expect(forms[1].fields.find((field:any)=>field.id==='project-checks')).toMatchObject({value:false,hint:expect.stringContaining(restriction)});
  expect(views.at(-1).view.lines.some((line:any)=>line.text.includes(restriction))).toBe(true);
  expect(await readFile(file,'utf8')).toBe(original);await expect(readFile(join(app.storage.paths.state,'extensions-state.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
