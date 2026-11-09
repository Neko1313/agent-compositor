import { describe,it,expect,afterEach,vi } from 'vitest';
import { mkdtemp,rm,readFile,stat,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScriptedProvider } from '@agent-compositor/core';
import { ProjectStorage } from '@agent-compositor/config';
import { ProviderRouter } from '@agent-compositor/provider';
import { uiFormSchema } from '@agent-compositor/events';
import { FormDialog } from '../src/form.js';
import { AppUI } from '../src/ui.js';
import { buildApp } from '../src/build.js';
import { availableModels,profileSettings,profileId } from '../src/provider-settings.js';
import { modelControls } from '../src/models.js';
import proxy from '../../../plugins/network-proxy/hooks.js';
import { hello,type WireMessage } from '@agent-compositor/protocol';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function temp(){const root=await mkdtemp(join(tmpdir(),'native-settings-'));roots.push(root);return root;}
const key=(key:string,modifiers:string[]=[])=>({kind:'key' as const,key,modifiers});
const text=(text:string)=>({kind:'text' as const,text});
const form={title:'Connection',fields:[{id:'address',label:'Address',type:'url' as const,required:true},{id:'token',label:'Token',type:'password' as const},{id:'enabled',label:'Enabled',type:'toggle' as const,value:false},{id:'scope',label:'Scope',type:'select' as const,options:[{value:'project',label:'Project'},{value:'global',label:'Global'}]}],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]};

describe('native forms',()=>{
 it('edits text, masks secrets, validates URLs and handles toggles/selections',()=>{
  const d=new FormDialog(form);d.handle(key('enter'));d.handle(text('secret-test-token'));
  const rows=d.visible(70,16);expect(JSON.stringify(rows)).not.toContain('secret-test-token');expect(JSON.stringify(rows)).toContain('•••');
  d.handle(key('home'));d.handle(key('right'));d.handle(key('delete'));d.handle(key('end'));d.handle(key('backspace'));d.handle(key('a',['ctrl']));d.handle(text('replaced'));expect(d.values.token).toBe('replaced');
  d.handle(key('tab'));d.handle(key('enter'));expect(d.values.enabled).toBe(true);d.handle(text(' '));expect(d.values.enabled).toBe(false);
  d.handle(key('tab'));d.handle(key('right'));expect(d.values.scope).toBe('global');d.handle(key('left'));expect(d.values.scope).toBe('project');
  d.handle(key('tab'));expect(d.handle(key('enter'))).toBeUndefined();expect(d.error).toContain('required');
  d.handle(text('ftp://invalid'));d.handle(key('tab'));d.handle(key('tab'));d.handle(key('tab'));d.handle(key('tab'));d.handle(key('enter'));expect(d.error).toContain('HTTP(S)');
  d.handle(key('a',['ctrl']));d.handle(text('http://localhost:8080'));d.handle(key('tab'));d.handle(key('tab'));d.handle(key('tab'));d.handle(key('tab'));
  expect(d.handle(key('enter'))).toMatchObject({action:'save',values:{address:'http://localhost:8080',token:'replaced'}});
  d.clear();expect(d.values).toEqual({});
 });
 it('supports cancellation, scrolling, click focus and secret-safe declarations',()=>{
  const merged=new FormDialog(form);merged.handle(text('\t\t'));expect(merged.focus).toBe(2);
  const d=new FormDialog(form);d.visible(30,7);d.handle({kind:'mouse',row:1,col:2,button:'left',action:'press'});d.handle(text('http://localhost'));
  d.handle(key('u',['ctrl']));expect(d.values.address).toBe('');
  d.handle(key('up'));expect(d.handle(key('enter'))).toBe('cancel');
  d.handle(key('tab'));d.handle(key('tab'));d.visible(20,5);expect(d.scroll).toBeGreaterThan(0);
  expect(d.handle(key('escape'))).toBe('cancel');expect(d.handle(key('c',['ctrl']))).toBe('cancel');
  expect(uiFormSchema.safeParse({...form,fields:[{id:'secret',label:'Secret',type:'password',value:'leaked'}]}).success).toBe(false);
 });
 it('keeps required-field recovery and focused controls visible at narrow widths',()=>{
  const d=new FormDialog({...form,fields:[{...form.fields[0],label:'Connection endpoint',hint:'Use the address supplied by your provider.'},...form.fields.slice(1)]});
  let rows=d.visible(24,7);
  expect(rows.map(r=>r.text).join(' ')).toContain('(required)');
  expect(rows.at(-1)?.text).toContain('1/6');
  d.handle(key('tab',['shift']));
  expect(d.focus).toBe(5);
  d.handle(key('up')); d.handle(key('enter'));
  rows=d.visible(24,7);
  expect(rows.some(r=>r.tone==='danger'&&r.text.includes('required'))).toBe(true);
  expect(rows.some(r=>r.selected)).toBe(true);
  expect(rows.every(r=>Array.from(r.text).length<=24)).toBe(true);
  d.handle(text('http://local'));
  rows=d.visible(24,10);
  const hintRow=rows.findIndex(r=>r.text.includes('address supplied'));
  expect(hintRow).toBeGreaterThanOrEqual(0);
  d.handle(key('tab')); d.visible(24,10);
  d.handle({kind:'mouse',row:hintRow,col:1,button:'left',action:'press'});
  expect(d.focus).toBe(0);
 });
 it('routes a plugin form through AppUI without placing passwords in wire output or chat',async()=>{
  const root=await temp();const app=await buildApp({cwd:root,env:{HOME:root},provider:new ScriptedProvider([])});
  const ui=new AppUI(app.createCore);const wire:WireMessage[]=[];ui.connect(m=>wire.push(m));
  ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Layout'],encodings:['jsonl']}));
  let result:any;let opened=0;
  ui.core.host.registerPlugin({name:'form-test',version:'1.0.0',trust:'trusted',hookTimeouts:{'ui.press':10000}},{'ui.press':async(_,$)=>{opened++;result=await $.ui.form({title:'Private input',fields:[{id:'key',label:'API key',type:'password'}],actions:[{id:'save',label:'Save'}]});}});
  const pending=ui.core.host.emit('ui.press',{site:'test',key:'open'});await vi.waitFor(()=>expect(wire.some(m=>m.type==='declare'&&m.surfaces.some(s=>s.id==='settings-form'))).toBe(true));
  ui.receive({type:'input',surface:'settings-form',data:text('fake-private-api-key')});
  expect(JSON.stringify(wire)).not.toContain('fake-private-api-key');expect(JSON.stringify(ui.core.getMessages())).not.toContain('fake-private-api-key');
  ui.receive({type:'input',surface:'settings-form',data:key('tab')});ui.receive({type:'input',surface:'settings-form',data:key('enter')});await pending;
  expect(result.values.key).toBe('fake-private-api-key');
  const cancelled=ui.core.host.emit('ui.press',{site:'test',key:'open'});await vi.waitFor(()=>expect(opened).toBe(2));ui.close();await cancelled;expect(result).toBeNull();await app.close();await ui.settled();
 });
});

describe('provider connection settings',()=>{
 it('discovers IDs with the appropriate native authentication headers',async()=>{
  const calls:any[]=[];const fetcher=(async(url:any,init:any)=>{calls.push({url:String(url),headers:init.headers});return Response.json(url.hostname.includes('google')?{models:[{name:'models/gemini-test'}]}:{data:[{id:'test-model'},{id:'test-model'}]});})as typeof fetch;
  for(const type of ['openai-compat','openai-responses','anthropic','gemini']as const){const google=type==='gemini';const ids=await availableModels({type,baseUrl:google?'https://google.example/v1beta':'http://localhost/v1',model:'test-model',apiKey:'test-key'},fetcher);expect(ids).toEqual([google?'gemini-test':'test-model']);}
  expect(calls[0].headers.Authorization).toBe('Bearer test-key');expect(calls[2].headers['x-api-key']).toBe('test-key');expect(calls[3].headers['x-goog-api-key']).toBe('test-key');
  await expect(availableModels({baseUrl:'http://localhost',model:'x',apiKey:'secret'},(async()=>{throw Error('echo secret');})as typeof fetch)).rejects.toThrow('Connection failed');
  await expect(availableModels({baseUrl:'http://localhost',model:'x',apiKey:''},(async()=>new Response('bad',{status:401}))as typeof fetch)).rejects.toThrow('HTTP 401');
  await expect(availableModels({baseUrl:'http://localhost',model:'x',apiKey:''},(async()=>Response.json({}))as typeof fetch)).rejects.toThrow('enter a model ID manually');
  expect(()=>profileSettings({baseUrl:'ftp://host',model:'x'})).toThrow();expect(()=>profileSettings({baseUrl:'https://user:pass@host',model:'x'})).toThrow();expect(()=>profileSettings({baseUrl:'http://localhost',model:''})).toThrow();expect(()=>profileId('__proto__')).toThrow();
 });
 it('saves a profile and key privately, reloads them and changes the selected model',async()=>{
  const root=await temp();const app=await buildApp({cwd:root,env:{HOME:root},provider:new ScriptedProvider([])});const core=app.createCore(async()=>false);
  const answers:any[]=[{action:'next',values:{preset:'compatible'}},{action:'save',values:{id:'native-ui',type:'openai-compat',baseUrl:'http://localhost:4567/v1',model:'model-one',key:'test-ui-secret',clearKey:false,maxOutputTokens:'1000',timeoutMs:'20000',scope:'project'}}];
  core.host.setFormHandler(async()=>answers.shift()??null);
  await core.host.emit('ui.press',{site:'plugin-model-selector-models',key:'add'});
  const stored=JSON.parse(await readFile(join(app.storage.paths.state,'providers.json'),'utf8'));expect(stored.profiles['native-ui'].model).toBe('model-one');expect(JSON.stringify(stored)).not.toContain('test-ui-secret');
  const file=join(app.storage.paths.home,'credentials.json');expect((await stat(file)).mode&0o777).toBe(0o600);expect((await readFile(file,'utf8'))).toContain('test-ui-secret');expect(JSON.stringify(core.getMessages())).not.toContain('test-ui-secret');await app.close();
  const next=await buildApp({cwd:root,env:{HOME:root}});const active=next.createCore(async()=>false);
  const messages:any[]=[];active.subscribe(e=>messages.push(e));await active.host.emit('prompt.submit',{text:'/models'});expect(JSON.stringify(messages)).toContain('Active: native-ui · model-one');expect(JSON.stringify(messages)).not.toContain('test-ui-secret');
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"restored"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
  await active.submit('test restored connection');expect(fetch).toHaveBeenCalled();expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer test-ui-secret');await next.close();
 });
 it('supports cancel and native proxy settings without exposing URL credentials',async()=>{
  const root=await temp(),storage=new ProjectStorage(root,{HOME:root});await storage.init();let configured:any;let view:any;
  const $:any={storage,ui:{form:async()=>({action:'save',values:{enabled:true,url:'http://127.0.0.1:7890',username:'proxy-user',password:'proxy-test-secret',clearPassword:false,models:true,tools:false,noProxy:'localhost, .internal',scope:'project'}}),view:async(_id:any,_title:any,value:any)=>{view=value;},notify:async()=>{}},emit:async(_event:any,{config}:any)=>{configured=config;const url=new URL(config.url);url.username='';url.password='';return{value:{...config,url:url.href}};}};
  await proxy['prompt.submit']({text:'/proxy configure'},$);expect(configured.url).toContain('proxy-test-secret');expect(configured.tools).toBe(false);expect(JSON.stringify(view)).not.toContain('proxy-test-secret');expect((await stat(join(storage.paths.state,'proxy.json'))).mode&0o777).toBe(0o600);
  $.ui.form=async()=>null;await proxy['prompt.submit']({text:'/proxy configure'},$);
 });
});

describe('proxy summary disclosure',()=>{
 it('separates effective routing from configuration and keeps diagnostics credential-free',async()=>{
  const root=await temp(),storage=new ProjectStorage(root,{HOME:root});await storage.init();
  await storage.configure('proxy.json',{enabled:false,url:'http://proxy-user:proxy-private@localhost:7890',models:true,tools:false});
  const state=new Map<string,unknown>();let view:any;
  const $:any={storage,state,ui:{view:async(_id:any,_title:any,value:any)=>{view=value;},notify:vi.fn()},emit:async(_event:any,{config}:any)=>{const url=new URL(config.url);url.username='';url.password='';return{value:{...config,url:url.href}};}};
  await proxy['prompt.submit']({text:'/proxy status'},$);
  expect(view.lines).toContainEqual({text:'Models: direct · Tools: direct'});
  expect(view.lines).toContainEqual({text:'When enabled: models proxied · tools direct',tone:'muted'});
  expect(view.lines.some((r:any)=>r.text.includes('"enabled"'))).toBe(false);
  expect(view.lines.some((r:any)=>r.action==='show-diagnostics')).toBe(true);
  await proxy['ui.press']({site:'plugin-network-proxy-network',key:'show-diagnostics'},$);
  expect(view.lines.some((r:any)=>r.text.includes('"enabled": false'))).toBe(true);
  expect(JSON.stringify(view)).not.toContain('proxy-private');expect(JSON.stringify(view)).not.toContain('proxy-user');
  expect(view.lines.some((r:any)=>r.action==='hide-diagnostics')).toBe(true);
  await proxy['ui.press']({site:'plugin-network-proxy-network',key:'hide-diagnostics'},$);
  expect(view.lines.some((r:any)=>r.text.includes('"enabled"'))).toBe(false);
  await proxy['ui.press']({site:'plugin-network-proxy-network',key:'on'},$);
  expect(view.lines).toContainEqual({text:'Models: proxied · Tools: direct'});
  expect(view.lines).toContainEqual({text:'Proxy enabled',bold:true,tone:'success'});
  expect(view.lines.some((r:any)=>r.text.startsWith('When enabled:'))).toBe(false);
 });
 it('explains initial setup and identifies an invalid enable action as an error',async()=>{
  const state=new Map<string,unknown>();let view:any;
  const $:any={state,storage:{config:async()=>({enabled:false})},ui:{view:async(_id:any,_title:any,value:any)=>{view=value;},notify:vi.fn()},emit:async()=>({value:{enabled:false,models:true,tools:true}})};
  await proxy['prompt.submit']({text:'/proxy status'},$);
  expect(view.lines.some((r:any)=>r.text==='Configure an HTTP(S) proxy address before enabling.')).toBe(true);
  await proxy['ui.press']({site:'plugin-network-proxy-network',key:'on'},$);
  expect($.ui.notify).toHaveBeenCalledWith('Configure a proxy URL before enabling','error');
 });
});

describe('settings controller lifecycle',()=>{
 it('discovers models, retries invalid edits, copies keys, cancels and removes profiles',async()=>{
  const root=await temp(),storage=new ProjectStorage(root,{HOME:root});await storage.init();
  const router=new ProviderRouter({default:{baseUrl:'http://localhost/v1',model:'old',apiKey:'original-key'}});
  const auth={setKey:vi.fn(async(name:string,key:string)=>{router.profiles[name].apiKey=key;}),refresh:vi.fn(async()=>{})};
  const fetcher=vi.fn(async()=>Response.json({data:[{id:'alpha'},{id:'beta'}]}))as unknown as typeof fetch;
  const controls=modelControls(router,storage,auth,fetcher);let answers:any[]=[];const notifications:string[]=[];const requests:any[]=[];
  const $:any={signal:new AbortController().signal,ui:{form:async(request:any)=>{requests.push(request);return answers.shift()??null;},view:vi.fn(async()=>{}),notify:async(s:string)=>{notifications.push(s);}},emit:vi.fn(async()=>{})};
  const press=async(key:string)=>controls.hooks!['ui.press']!({site:'plugin-model-selector-models',key}as never,$);
  const values={id:'copy',type:'openai-compat',baseUrl:'http://localhost/v1',model:'alpha',key:'',clearKey:false,timeoutMs:'120000',maxOutputTokens:'',scope:'project'};
  answers=[{action:'save',values:{...values,id:'bad/id'}},{action:'discover',values},{action:'use',values:{model:'beta'}},{action:'save',values:{...values,model:'beta'}}];
  await press('edit:default');expect(requests.some(r=>r.description?.includes('starting with a letter'))).toBe(true);expect(router.profiles.copy.model).toBe('beta');expect(auth.setKey).toHaveBeenCalledWith('copy','original-key');
  answers=[{action:'use',values:{model:'alpha'}}];await press('discover:copy');expect(router.model).toBe('alpha');expect(JSON.parse(await readFile(join(storage.paths.state,'model.json'),'utf8'))).toEqual({profile:'copy',model:'alpha'});
  await press('test:copy');expect(auth.refresh).toHaveBeenCalled();expect(notifications.join()).toContain('Connection OK');
  answers=[{action:'cancel',values:{model:'beta'}}];await press('discover:copy');expect(router.model).toBe('alpha');
  await press('proxy');await press('access');expect($.emit).toHaveBeenCalledWith('prompt.submit',{text:'/proxy configure'});
  answers=[null];await press('add');expect(router.profiles.copy).toBeDefined();
  answers=[{action:'remove',values:{confirm:false}}];await press('remove:copy');expect(router.profiles.copy).toBeDefined();
  answers=[{action:'remove',values:{confirm:true}}];await press('remove:copy');expect(router.profiles.copy).toBeUndefined();expect(router.credentialProfile).toBe('default');
  await press('remove:default');expect(notifications.join()).toContain('cannot be removed');await press('use:missing');
 });
 it('honors project overrides when editing global settings and validates bounded model lists',async()=>{
  const root=await temp(),storage=new ProjectStorage(root,{HOME:root});await storage.init();
  await storage.configure('providers.json',{profiles:{default:{baseUrl:'http://project/v1',model:'project-model'}}});
  const router=new ProviderRouter({default:{baseUrl:'http://project/v1',model:'project-model',apiKey:''}});
  const controls=modelControls(router,storage,{setKey:async()=>{},refresh:async()=>{}},fetch);
  const $:any={signal:new AbortController().signal,ui:{form:async()=>({action:'save',values:{id:'default',type:'openai-compat',baseUrl:'http://global/v1',model:'global-model',key:'',clearKey:false,scope:'global',timeoutMs:'',maxOutputTokens:''}}),view:async()=>{},notify:async()=>{}}};
  await controls.hooks!['ui.press']!({site:'plugin-model-selector-models',key:'edit:default'}as never,$);
  expect(router.model).toBe('project-model');expect(JSON.parse(await readFile(join(storage.paths.home,'providers.json'),'utf8')).profiles.default.model).toBe('global-model');
  await expect(storage.configure('../escape.json',{})).rejects.toThrow();
  const profile={baseUrl:'http://localhost',model:'x',apiKey:''};
  await expect(availableModels(profile,(async()=>new Response('invalid JSON'))as typeof fetch)).rejects.toThrow('invalid model list');
  await expect(availableModels(profile,(async()=>new Response('x'.repeat(1048577)))as typeof fetch)).rejects.toThrow('exceeds');
  await expect(availableModels({...profile,baseUrl:'file:///tmp'},fetch)).rejects.toThrow('Invalid provider');
  expect(profileSettings({...profile,maxOutputTokens:'42',timeoutMs:null}).maxOutputTokens).toBe(42);expect(()=>profileSettings({...profile,timeoutMs:-1})).toThrow('positive integer');expect(()=>profileSettings({...profile,type:'other'})).toThrow('supported');
 });
 it('saves API keys through the native login form and cancels cleanly',async()=>{
  const root=await temp(),app=await buildApp({cwd:root,env:{HOME:root},provider:new ScriptedProvider([])}),core=app.createCore(async()=>false);
  let result:any=null;core.host.setFormHandler(async()=>result);
  await core.host.emit('prompt.submit',{text:'/login default'});
  await expect(readFile(join(app.storage.paths.home,'credentials.json'))).rejects.toThrow();
  result={action:'save',values:{key:'login-form-test-key'}};await core.host.emit('prompt.submit',{text:'/login default'});
  expect(await readFile(join(app.storage.paths.home,'credentials.json'),'utf8')).toContain('login-form-test-key');
  await core.host.emit('prompt.submit',{text:'/logout default'});expect(await readFile(join(app.storage.paths.home,'credentials.json'),'utf8')).not.toContain('login-form-test-key');await app.close();
 });
});
