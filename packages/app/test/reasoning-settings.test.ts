import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStorage} from '@agent-compositor/config';
import {ProviderRouter} from '@agent-compositor/provider';
import {ScriptedProvider} from '@agent-compositor/core';
import {modelControls} from '../src/models.js';
import {profileSettings,reasoningOptions} from '../src/provider-settings.js';
import {buildApp} from '../src/build.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function temp(){const root=await mkdtemp(join(tmpdir(),'reasoning-settings-'));roots.push(root);return root;}
it('persists effort, applies it immediately without losing a manually selected model, and clears it explicitly',async()=>{
 const cwd=await temp(),storage=new ProjectStorage(cwd,{HOME:cwd});await storage.init();const bodies:any[]=[];
 const fetcher=vi.fn(async(_url:any,init:any)=>{bodies.push(JSON.parse(init.body));return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');})as unknown as typeof fetch;
 const router=new ProviderRouter({default:{baseUrl:'http://fixture.invalid/v1',model:'profile-model',apiKey:'private-key',fetch:fetcher}});router.select('manual-model');
 const controls=modelControls(router,storage,{setKey:async()=>{},refresh:async()=>{}},fetcher);let effort='high';
 const $:any={signal:new AbortController().signal,ui:{form:async(request:any)=>{expect(request.fields[0].options.some((o:any)=>o.value==='xhigh')).toBe(true);return{action:'save',values:{reasoningEffort:effort,scope:'project'}};},view:async()=>{},notify:async()=>{}}};
 const change=()=>controls.hooks['ui.press']({site:'plugin-model-selector-models',key:'reasoning:default'},$);
 await change();expect(router.model).toBe('manual-model');expect(router.reasoningEffort).toBe('high');
 for await(const _ of router.complete({messages:[{role:'user',content:'hello'}],tools:[],signal:new AbortController().signal})){}
 expect(bodies.at(-1)).toMatchObject({model:'manual-model',reasoning_effort:'high'});
 effort='';await change();expect(router.reasoningEffort).toBeUndefined();for await(const _ of router.complete({messages:[{role:'user',content:'hello'}],tools:[],signal:new AbortController().signal})){}
 expect(bodies.at(-1)).not.toHaveProperty('reasoning_effort');const saved=await readFile(join(storage.paths.state,'providers.json'),'utf8');expect(JSON.parse(saved).profiles.default.reasoningEffort).toBeNull();expect(saved).not.toContain('private-key');
});
it('loads saved effort and keeps provider-default clears from resurrecting legacy settings on restart',async()=>{
 const cwd=await temp(),storage=new ProjectStorage(cwd,{HOME:cwd});await storage.init();await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({providers:{default:{reasoningEffort:'high'}}}));
 for(const effort of [undefined,'low',null]){await storage.configure('providers.json',{profiles:{default:{type:'openai-compat',baseUrl:'http://fixture.invalid/v1',model:'test',...(effort===undefined?{}:{reasoningEffort:effort})}}});const app=await buildApp({cwd,env:{HOME:cwd},provider:new ScriptedProvider([])});try{const core=app.createCore(async()=>false),views:any[]=[];core.host.registerPlugin({name:'view-observer',version:'1.0.0',trust:'trusted'},{'service.ui.view':e=>{views.push(e);}});await core.host.emit('prompt.submit',{text:'/model'});expect(JSON.stringify(views)).toContain(`Reasoning: ${effort===undefined?'high':effort??'provider default'}`);}finally{await app.close();}}
});
it('offers protocol-specific choices and validates optional effort without credentials',()=>{
 expect(reasoningOptions('gemini').map(o=>o.value)).toEqual(['','minimal','low','medium','high']);expect(reasoningOptions('anthropic').map(o=>o.value)).not.toContain('none');
 expect(profileSettings({baseUrl:'http://localhost',model:'test',reasoningEffort:'HIGH'}).reasoningEffort).toBe('high');expect(()=>profileSettings({baseUrl:'http://localhost',model:'test',reasoningEffort:{}})).toThrow('reasoningEffort');
});
