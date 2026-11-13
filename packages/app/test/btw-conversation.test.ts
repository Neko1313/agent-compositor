import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {runHeadless} from '../src/headless.js';

it('opens and continues an independent btw agent while the main model is held, then restores it',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'btw-conversation-'));
 const provider=new ScriptedProvider([{text:'MAIN_HELD',hold:true},{text:'SIDE_RESULT'},{text:'SIDE_FOLLOWUP'}]);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-hub','btw'],agent:{verifyCompletion:false,projectContext:false,skills:false}}));
 let app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins')]});
 let main:Promise<void>|undefined;
 try{
  const core=app.createCore(async()=>true);const notices:unknown[]=[],views:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&['ui.notification','plugin.fault'].includes(e.event))notices.push(e.input);if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});await core.start();
  await expect(core.host.emit('service.agent.open',{prompt:'NOT_USER_AUTHORIZED'})).rejects.toThrow('explicit user invocation');
  expect(provider.requests).toHaveLength(0);
  main=core.submit('MAIN_TASK_MUST_STAY_SEPARATE');
  await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
  await core.invokeCommand('/btw SIDE_QUESTION');
  await vi.waitFor(()=>expect(provider.requests,JSON.stringify(notices)).toHaveLength(2));
  const records=JSON.parse(await readFile(join(app.storage.paths.state,'agents.json'),'utf8'));
  expect(records).toHaveLength(1);expect(records[0].branch).toBeUndefined();
  const id=records[0].id,site=`plugin-agent-hub-agent-${id}`;
  expect(views.some(view=>view.title==='Agents')).toBe(false);
  expect(provider.requests[1].messages.some(m=>m.content==='SIDE_QUESTION')).toBe(true);
  expect(provider.requests[1].messages.some(m=>m.content.includes('MAIN_TASK_MUST_STAY_SEPARATE'))).toBe(false);
  await core.host.emit('ui.change',{site,id:'message-0',value:'FOLLOWUP_QUESTION'});
  await core.host.emit('ui.press',{site,key:'enter'});
  await vi.waitFor(()=>expect(provider.requests).toHaveLength(3));
  expect(provider.requests[2].messages.some(m=>m.content==='SIDE_RESULT')).toBe(true);
  expect(provider.requests[2].messages.some(m=>m.content==='FOLLOWUP_QUESTION')).toBe(true);
  expect(core.getState()).toBe('running');
  expect(core.getMessages().filter(m=>m.role==='user').map(m=>m.content)).toEqual(['MAIN_TASK_MUST_STAY_SEPARATE']);
  core.interrupt();await main;main=undefined;await app.close();
  const resumed=new ScriptedProvider([{text:'AFTER_RESTART'}]);
  app=await buildApp({cwd,env:{HOME:cwd},provider:resumed,pluginDirs:[join(process.cwd(),'plugins')]});
  const restored=app.createCore(async()=>true);await restored.start();await restored.invokeCommand('/btw');
  expect(resumed.requests).toHaveLength(0);
  await restored.host.emit('ui.change',{site,id:'message-0',value:'CONTINUE_AFTER_RESTART'});
  await restored.host.emit('ui.press',{site,key:'enter'});
  await vi.waitFor(()=>expect(resumed.requests).toHaveLength(1));
  expect(resumed.requests[0].messages.some(m=>m.content==='SIDE_FOLLOWUP')).toBe(true);
  expect(JSON.parse(await readFile(join(app.storage.paths.state,'agents.json'),'utf8'))).toHaveLength(1);
 }finally{await app.close();await main;await rm(cwd,{recursive:true,force:true});}
});

it('reports unavailable agent support and oversized questions without falling through to the main model',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'btw-unavailable-')),provider=new ScriptedProvider([{text:'ONCE_ANSWER'}]);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['btw'],agent:{projectContext:false,skills:false,verifyCompletion:false}}));
 const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,pluginDirs:[join(process.cwd(),'plugins')]});
 try{
  const core=app.createCore(async()=>false),notices:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.notification')notices.push(e.input);});await core.start();
  await core.invokeCommand('/btw Side question');expect(notices.at(-1).message).toMatch(/agent-hub/);expect(provider.requests).toHaveLength(0);
  await core.invokeCommand('/btw '+'x'.repeat(4001));expect(notices.at(-1).message).toMatch(/4000/);expect(provider.requests).toHaveLength(0);
  await core.invokeCommand('/btw --once What is 21*2?');expect(notices.at(-1).message).toBe('ONCE_ANSWER');expect(provider.requests).toHaveLength(1);
  expect(core.getMessages().filter(message=>message.role==='user')).toHaveLength(0);
 }finally{await app.close();await rm(cwd,{recursive:true,force:true});}
});

it('keeps a one-shot command independent of foreground interruption and cancels its own operation',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'btw-once-cancel-')),provider=new ScriptedProvider([{text:'CANCELLED_ONCE_ANSWER',hold:true}]);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['btw'],agent:{projectContext:false,skills:false,verifyCompletion:false}}));
 const app=await buildApp({cwd,env:{HOME:cwd},agentHub:false,pluginDirs:[join(process.cwd(),'plugins')],provider});let work:Promise<unknown>|undefined;
 try{
  const core=app.createCore(async()=>false),notices:any[]=[];core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.notification')notices.push(event.input);});await core.start();
  work=core.invokeCommand('/btw --once Separate question').then(()=>({cancelled:false}),error=>({cancelled:/cancel/i.test(String(error))}));
  await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));core.interrupt();expect(provider.requests[0].signal.aborted).toBe(false);
  expect(core.cancelOperations('btw')).toBe(true);expect(await work).toEqual({cancelled:true});expect(provider.requests[0].signal.aborted).toBe(true);
  expect(core.hasActiveOperations).toBe(false);expect(notices.some(event=>event.message==='CANCELLED_ONCE_ANSWER')).toBe(false);
 }finally{await app.close();await work;await rm(cwd,{recursive:true,force:true});}
});

it('returns a failed headless result when the actual one-shot model dependency fails',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'btw-once-failure-'));
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['btw'],agent:{projectContext:false,skills:false,verifyCompletion:false}}));
 const app=await buildApp({cwd,env:{HOME:cwd},agentHub:false,pluginDirs:[join(process.cwd(),'plugins')],provider:{name:'unavailable-fixture',async *complete(){throw Error('CONTROLLED_PROVIDER_FAILURE');}}});
 try{
  let output='';expect(await runHeadless(app,'/btw --once Question','json',text=>{output+=text;})).toBe(1);
  const result=JSON.parse(output);expect(result.response).toContain('CONTROLLED_PROVIDER_FAILURE');expect(result.error).toBe(result.response);
 }finally{await app.close();await rm(cwd,{recursive:true,force:true});}
});

it('keeps a newer pane draft when a policy-controlled send waits for a human and is denied',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'btw-message-approval-')),provider=new ScriptedProvider([{text:'SIDE_READY'}]);
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['btw','agent-hub'],agent:{projectContext:false,skills:false,verifyCompletion:false},permissions:{rules:[{tool:'agent_message',decision:'ask'}]}}));
 const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins')]});
 let answer=(value:boolean)=>{};
 try{
  let asked=0;const core=app.createCore(async()=>{asked++;return new Promise<boolean>(done=>{answer=done;});}),views:any[]=[];
  core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});await core.start();await core.invokeCommand('/btw FIRST_QUESTION');
  await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
  const [record]=JSON.parse(await readFile(join(app.storage.paths.state,'agents.json'),'utf8')),site=`plugin-agent-hub-agent-${record.id}`;
  await core.host.emit('ui.change',{site,id:'message-0',value:'WAITING_MESSAGE'});
  const send=core.host.emit('ui.press',{site,key:'enter'});const checked=send.then(result=>expect(result.faults).toEqual([]));
  await vi.waitFor(()=>expect(asked).toBe(1));
  await core.host.emit('ui.press',{site,key:'enter'});expect(asked).toBe(1);
  await new Promise(done=>setTimeout(done,1100));
  await core.host.emit('ui.change',{site,id:'message-0',value:'NEW_UNSENT_DRAFT'});answer(false);await checked;
  await core.host.emit('ui.focus',{site});
  // Reopening republishes the current field; denial must never clear it.
  await core.invokeCommand('/btw');
  expect(views.filter(view=>view.id===site).at(-1).view.input.value).toBe('NEW_UNSENT_DRAFT');
  expect(provider.requests).toHaveLength(1);
 }finally{answer(false);await app.close();await rm(cwd,{recursive:true,force:true});}
});
