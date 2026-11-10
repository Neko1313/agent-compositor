import { afterEach,describe,it,expect,vi } from "vitest";
import { mkdtemp,mkdir,cp,writeFile,readFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { ScriptedProvider } from "@agent-compositor/core";
import { hello,type WireMessage } from "@agent-compositor/protocol";
import { buildApp } from "../src/build.js";
import { AppUI } from "../src/ui.js";

const roots:string[]=[],cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(config:Record<string,unknown>={},hub=false){
  const cwd=await mkdtemp('/tmp/ac-private-controllers-');roots.push(cwd);
  await mkdir(join(cwd,'plugins'));
  await cp(new URL('../../../tools/visual/controller-plugin',import.meta.url),join(cwd,'plugins/controller-proof'),{recursive:true});
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['controller-proof','session-manager'],agent:{builtinTools:['exec'],controlTools:[],skills:false,projectContext:false,fileReferences:false},
    ui:{controllers:Object.fromEntries(['editor','approval','question','form','history','placement'].map(kind=>[kind,'controller-proof']))},sessionProvider:'controller-proof',...config}));
  const options={cwd,env:{HOME:join(cwd,'home')},agentHub:hub};
  const provider=new ScriptedProvider([{text:'Custom submission completed'},{text:'Continued custom session'}]);
  const app=await buildApp({...options,provider});
  const ui=new AppUI(app.createCore,app.reloadPlugins,[],app.commands,{}, {resume:app.resume});
  const wire:WireMessage[]=[],screens=new Map<string,string>();
  ui.connect(message=>{wire.push(message);if(message.type==='render')screens.set(message.surface,message.grid?.map(row=>row.map(c=>c.ch).join('')).join('\n')??'');});
  ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Layout'],encodings:['jsonl']}));ui.resize(100,32);
  const input=(data:Extract<WireMessage,{type:'input'}>['data'])=>ui.receive({type:'input',surface:'input',data});
  const key=(key:string)=>input({kind:'key',key});const text=(text:string)=>input({kind:'text',text});
  cleanups.push(async()=>{ui.close();await ui.settled();await app.close();});
  return{cwd,options,app,ui,provider,wire,screens,key,text,async send(value:string){text(value);key('f2');await ui.settled();}};
}
describe('external private UI and repository composition',()=>{
  it('routes non-tiling Alt shortcuts to the replacement editor',async()=>{
    const f=await setup(),handled:unknown[]=[];
    f.ui.core.host.unregisterPlugin('controller-proof');
    f.ui.core.host.registerPlugin({name:'controller-proof',version:'1.0.0',trust:'trusted'},{},'user',[],{
      editor:()=>({snapshot:()=>({text:'',cursor:0}),render:()=>({lines:[{text:'Custom shortcuts'}]}),handle:input=>{handled.push(input);}}),
    });
    f.ui.receive({type:'input',surface:'input',data:{kind:'key',key:'?',modifiers:['meta']}});
    f.ui.receive({type:'input',surface:'input',data:{kind:'key',key:'h',modifiers:['meta']}});
    expect(handled).toEqual([{kind:'key',key:'?',modifiers:['meta']}]);
  });

  it('replaces editor behavior, preserves draft across reload, and keeps draft out of render hooks and journal',async()=>{
    const f=await setup();let observed='';
    f.ui.core.host.registerPlugin({name:'observer',version:'1.0.0',trust:'render-only'},{'ui.render':event=>{observed+=JSON.stringify(event);}});
    expect(f.screens.get('input')).toContain('CUSTOM INPUT');
    f.text('private unsent draft');f.key('enter');await f.ui.settled();
    expect(f.provider.requests).toHaveLength(0);expect(observed).not.toContain('private unsent draft');
    await f.app.reloadPlugins(f.ui.core);expect(f.screens.get('input')).toContain('private unsent draft');
    f.key('f2');await f.ui.settled();expect(f.provider.requests).toHaveLength(1);
    expect(f.ui.core.getMessages().at(-1)?.content).toBe('Custom submission completed');
    const stored=await f.app.store.load(f.ui.core.sessionId,f.cwd);expect(JSON.stringify(stored)).toContain('private unsent draft');
    expect(()=>f.app.store.root(f.cwd)).toThrow('no filesystem root');
  });

  it('uses custom approval, question and private form input, with fail-closed invalid approvals',async()=>{
    const f=await setup();
    f.text('/private-approval');f.key('f2');await vi.waitFor(()=>expect(f.screens.get('input')).toContain('CUSTOM APPROVAL'));
    f.key('f4');await f.ui.settled();expect(f.screens.get('session')).toContain('Custom tool denied');
    f.text('/private-question');f.key('f2');await vi.waitFor(()=>expect(f.screens.get('input')).toContain('CUSTOM QUESTION'));
    f.key('f4');await f.ui.settled();expect(f.screens.get('session')).toContain('Answer: custom response');
    f.text('/private-form');f.key('f2');await vi.waitFor(()=>expect(f.screens.get('settings-form')).toContain('CUSTOM PRIVATE FORM'));
    f.text('fake-local-secret');expect(JSON.stringify(f.wire)).not.toContain('fake-local-secret');
    f.key('f5');await f.ui.settled();
    expect(await f.app.storage.read('controller-proof','form-result','project',f.ui.core.sessionId)).toMatchObject({values:{token:'fake-local-secret'}});
    expect(JSON.stringify(await f.app.store.load(f.ui.core.sessionId,f.cwd))).not.toContain('fake-local-secret');
    expect(f.provider.requests).toHaveLength(0);
  });

  it('browses, searches, renames, forks and resumes through a non-local repository, including startup resume',async()=>{
    const f=await setup();await f.app.store.create(f.cwd,{id:'remote-chat',name:'Remote workspace'});
    await f.app.store.append('remote-chat',[{type:'prompt.submit',text:'Stored earlier prompt'},{type:'assistant.text',turnId:'old',text:'Stored earlier response'},{type:'turn.complete',turnId:'old',text:'Stored earlier response'}],f.cwd);
    await f.app.store.rename('remote-chat','Renamed remote workspace',f.cwd);
    const fork=await f.app.store.fork('remote-chat',{name:'Forked workspace'},f.cwd);expect(fork.parentId).toBe('remote-chat');
    await f.app.store.archive(fork.id,f.cwd);expect((await f.app.store.list(f.cwd)).some(m=>m.id===fork.id)).toBe(false);
    await f.app.store.unarchive(fork.id,f.cwd);expect(await f.app.store.findByPrefix(fork.id,f.cwd)).toMatchObject({id:fork.id});await f.app.store.remove(fork.id,f.cwd);
    await f.send('/history');expect(f.screens.get('plugin-session-manager-sessions')).toContain('CUSTOM HISTORY');
    f.text('Stored earlier response');await f.ui.settled();expect(f.screens.get('plugin-session-manager-sessions')).toContain('Renamed remote workspace');
    f.key('enter');await f.ui.settled();expect(f.ui.core.sessionId).toBe('remote-chat');expect(f.ui.windows.has('plugin-session-manager-sessions')).toBe(false);
    await f.send('Continue');expect(f.provider.requests[0].messages.some(m=>m.content==='Stored earlier response')).toBe(true);
    const next=await buildApp({...f.options,resumeSessionId:'remote-chat',provider:new ScriptedProvider([])});
    try{expect(next.resumedEvents.some(e=>e.text==='Continue')).toBe(true);}finally{await next.close();}
    expect(await readFile(join(f.app.storage.paths.state,'custom-repository.log'),'utf8')).toContain('disposed');
  });

  it('cancels active private input and stale asynchronous submissions on unload',async()=>{
    const f=await setup();f.text('/private-form');f.key('f2');await vi.waitFor(()=>expect(f.screens.get('settings-form')).toContain('CUSTOM PRIVATE FORM'));
    f.ui.core.host.unregisterPlugin('controller-proof');await f.ui.settled();expect(f.screens.get('input')).toContain('Selected editor is unavailable');
    expect(f.ui.windows.has('settings-form')).toBe(false);
    let finish!:(value:unknown)=>void;
    f.ui.core.host.registerPlugin({name:'controller-proof',version:'1.0.0',trust:'trusted'},{},'user',[],{editor:()=>({snapshot:()=>({text:'',cursor:0}),render:()=>({lines:[{text:'Async editor'}]}),handle:()=>new Promise(resolve=>{finish=resolve;})})});
    f.key('enter');f.ui.core.host.unregisterPlugin('controller-proof');await f.ui.settled();finish({type:'submit',text:'stale submission'});await Promise.resolve();
    expect(f.provider.requests).toHaveLength(0);
  });

  it('restores independent-agent conversations through the selected backend',async()=>{
    const f=await setup({enabledPlugins:['controller-proof','session-manager','agent-hub'],permissions:{rules:[{tool:'agent_control',decision:'allow'}]}},true);
    await f.ui.core.start();
    const created=await f.ui.core.invokeTool('agent_control',{action:'create',name:'custom-store-agent',worktree:false,maxTokens:10000});
    expect(created.ok).toBe(true);const id=(created.output as {id:string}).id;
    await f.ui.core.invokeTool('agent_control',{action:'send',id,prompt:'Independent custom repository task'});
    await vi.waitFor(async()=>{
      const result=(await f.ui.core.host.emit('service.agent.control',{action:'list'})).value as {value:{id:string;state:string}[]};
      expect(result.value.find(row=>row.id===id)?.state).toBe('idle');
    },{timeout:10000});
    await cleanups.pop()!();
    const restart=await buildApp({...f.options,provider:new ScriptedProvider([])});
    try{
      const core=restart.createCore(async()=>false),views:string[]=[];
      core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.surface')views.push(String(event.input.text));});
      await core.start();expect(views.join('\n')).toContain('Custom submission completed');
    }finally{await restart.close();}
  });

  it('cancels a pending private form when switching sessions',async()=>{
    const f=await setup();await f.app.store.create(f.cwd,{id:'other-session',name:'Other session'});
    let result:unknown='pending';
    f.ui.core.host.registerPlugin({name:'form-requester',version:'1.0.0',trust:'trusted'},{'ui.press':async(_,$)=>{
      result=await $.ui.form({title:'Pending',fields:[{id:'token',label:'Token',type:'password'}],actions:[{id:'save',label:'Save'}]});
    }});
    const pending=f.ui.core.host.emit('ui.press',{site:'test',key:'open'});
    await vi.waitFor(()=>expect(f.screens.get('settings-form')).toContain('CUSTOM PRIVATE FORM'));
    await f.ui.core.host.emit('service.session.control',{action:'resume',id:'other-session'});await pending;
    expect(result).toBeNull();expect(f.ui.core.sessionId).toBe('other-session');expect(f.ui.windows.has('settings-form')).toBe(false);
  });

  it('fails explicitly when a configured storage provider is absent or incomplete',async()=>{
    const f=await setup();
    await writeFile(join(f.cwd,'agent-compositor.json'),JSON.stringify({sessionProvider:'missing'}));
    await expect(buildApp({...f.options,provider:new ScriptedProvider([])})).rejects.toThrow('Selected session repository missing is unavailable');
    await writeFile(join(f.cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['controller-proof'],sessionProvider:'controller-proof'}));
    await writeFile(join(f.cwd,'plugins/controller-proof/hooks.js'),'export const sessionRepository=()=>({append:async()=>{}});');
    await expect(buildApp({...f.options,provider:new ScriptedProvider([])})).rejects.toThrow('complete storage contract');
  });
});
