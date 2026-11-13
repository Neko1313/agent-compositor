import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildApp} from '../src/build.js';
import {AppUI} from '../src/ui.js';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {hello,type WireMessage} from '@agent-compositor/protocol';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[],uis:AppUI[]=[];
afterEach(async()=>{for(const ui of uis.splice(0))ui.close();for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const wait=(check:()=>boolean)=>expect.poll(check,{timeout:3000}).toBe(true);
async function fixture(open=true){
 const root=await mkdtemp(join(tmpdir(),'concurrent-git-ui-'));roots.push(root);const cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 execFileSync('git',['-c','init.defaultBranch=main','init'],{cwd,stdio:'ignore'});await writeFile(join(cwd,'review-evidence.txt'),'actual project');
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},permissions:{rules:[{tool:'extension_control',decision:'allow'},{tool:'git_review',decision:'allow'}]}}));
 const provider=new ScriptedProvider([{text:'MODEL_CONTINUES',hold:true},{text:'QUEUED_TASK_DONE'}]);
 const app=await buildApp({cwd,env:{HOME:home},provider,agentHub:false,pluginDirs:[resolve('plugins/git-review')]});apps.push(app);
 const core=app.createCore(async()=>false);expect((await core.invokeTool('extension_control',{action:'enable',name:'git-review',scope:'project'})).ok).toBe(true);await app.reloadPlugins(core);await core.close();
 const ui=new AppUI(app.createCore,app.reloadPlugins,[],app.commands);uis.push(ui);const messages:WireMessage[]=[],rendered=new Map<string,string>();
 ui.connect(message=>{messages.push(message);if(message.type==='render')rendered.set(message.surface,message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'');});ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));await ui.core.start();
 const key=(key:string,modifiers?:string[])=>ui.receive({type:'input',surface:'input',data:{kind:'key',key,modifiers}});
 const send=(text:string)=>{key('i',['meta']);ui.receive({type:'input',surface:'input',data:{kind:'text',text}});key('enter');};
 if(open){send('/git-review');await ui.settled();await wait(()=>rendered.has('plugin-git-review-main'));}
 return{root,cwd,provider,app,ui,key,send,messages,rendered};
}
it('uses the actual plugin tool, keeps the current model and queued prompt intact, and records no model verification credit',async()=>{
 const f=await fixture();f.send('Original task');await wait(()=>f.provider.requests.length===1);f.send('Next task');
 const before=structuredClone(f.ui.core.getMessages());
 await f.ui.core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});
 expect(f.rendered.get('plugin-git-review-main')).toContain('review-evidence.txt');expect(f.ui.core.getMessages()).toEqual(before);expect(f.ui.core.getState()).toBe('running');expect(f.provider.requests).toHaveLength(1);
 f.provider.release();await f.ui.settled();expect(f.provider.requests).toHaveLength(2);expect(JSON.stringify(f.provider.requests[1].messages)).not.toContain('git_review');expect(f.ui.core.failure).toBeUndefined();
});
it.each(['before-close','after-reopen'] as const)('restores the closed main conversation through /chat with first text %s, without duplicating or prompting the model',async firstText=>{
 const f=await fixture(false);let releaseText=()=>{},textWaiting=false;
 const textReady=new Promise<void>(done=>{releaseText=done;});
 f.ui.core.host.registerPlugin({name:'first-text-barrier',version:'1.0.0',trust:'trusted'},
  {'assistant.text':async()=>{textWaiting=true;await textReady;}});
 try{
  f.send('Original task');await wait(()=>f.provider.requests.length===1&&textWaiting);
  // Exercise both stored content and the first delta arriving after reopening.
  if(firstText==='before-close'){releaseText();await wait(()=>f.rendered.get('session')?.includes('MODEL_CONTINUES')===true);}
  const before=structuredClone(f.ui.core.getMessages());f.ui.windows.focused='session';f.key('q',['meta']);expect(f.ui.windows.has('session')).toBe(false);
  f.rendered.delete('session');
  f.send('/chat');await wait(()=>f.ui.windows.has('session'));
  if(firstText==='after-reopen'){expect(f.rendered.get('session')??'').not.toContain('MODEL_CONTINUES');releaseText();}
  await wait(()=>f.rendered.get('session')?.includes('MODEL_CONTINUES')===true);expect(f.rendered.get('session')).toContain('MODEL_CONTINUES');
  const focus:string[]=[];f.ui.core.host.registerPlugin({name:'focus-observer',version:'1.0.0',trust:'trusted'},{'ui.focus':event=>{focus.push(String(event.site));}});
  const ids=f.ui.windows.ids();f.send('/chat');await wait(()=>focus.includes('session'));expect(f.ui.windows.ids()).toEqual(ids);f.ui.core.host.unregisterPlugin('focus-observer');
  f.key('2',['meta']);expect(f.ui.windows.workspace).toBe(2);f.send('/chat');await wait(()=>f.ui.windows.workspace===1);
  f.send('/chat unexpected');await wait(()=>f.rendered.get('session')?.includes('Usage: /chat')===true);
  expect(f.ui.core.getMessages()).toEqual(before);expect(f.provider.requests).toHaveLength(1);expect(f.ui.core.getState()).toBe('running');
  f.provider.release();await f.ui.settled();
 }finally{releaseText();f.provider.release();f.ui.core.host.unregisterPlugin('first-text-barrier');}
});
it('opens and reopens a declared plugin panel immediately without entering the active model or its prompt queue',async()=>{
 const f=await fixture(false);f.send('Original task');await wait(()=>f.provider.requests.length===1);f.send('Next task');
 const before=structuredClone(f.ui.core.getMessages());
 f.send('/git-review');await wait(()=>f.rendered.get('plugin-git-review-main')?.includes('Choose an action')===true);
 expect(f.ui.core.getMessages()).toEqual(before);expect(f.provider.requests).toHaveLength(1);
 await f.ui.core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});
 expect(f.rendered.get('plugin-git-review-main')).toContain('review-evidence.txt');
 await f.ui.core.host.emit('ui.press',{site:'plugin-git-review-main',key:'close'});
 f.send('/git-review');await wait(()=>f.rendered.get('plugin-git-review-main')?.includes('review-evidence.txt')===true);
 f.send('/git-review unexpected');await wait(()=>[...f.rendered.values()].some(text=>text.includes('Usage: /git-review')));
 expect(f.provider.requests).toHaveLength(1);expect(f.provider.requests[0].signal.aborted).toBe(false);
 f.provider.release();await f.ui.settled();expect(f.provider.requests).toHaveLength(2);
 expect(JSON.stringify(f.provider.requests[1].messages)).not.toContain('/git-review');
 expect(f.provider.requests[1].messages.at(-1)?.content).toBe('Next task');
});
it('cancels a focused plugin process with Ctrl+C without stopping the model, and gates reload through the independent operation',async()=>{
 const f=await fixture(),pidFile=join(f.root,'pid');f.send('Original task');await wait(()=>f.provider.requests.length===1);
 f.ui.core.host.registerPlugin({name:'slow-git-fixture',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>e.plugin==='git-review'?$.next({...e,cmd:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`]}):undefined});
 const work=f.ui.core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});let pid=0;
 await expect.poll(async()=>{pid=Number(await readFile(pidFile,'utf8').catch(()=>''));return pid>0;},{timeout:3000}).toBe(true);expect(f.ui.core.hasActiveOperations).toBe(true);expect(await f.app.reloadPlugins(f.ui.core)).toContain('Wait');
 const frame=f.messages.filter(m=>m.type==='layout').at(-1)!.frames.find(frame=>frame.surface==='plugin-git-review-main')!;
 f.ui.receive({type:'input',surface:'plugin-git-review-main',data:{kind:'mouse',row:frame.y+1,col:frame.x+2,button:'left',action:'press'}});f.key('c',['ctrl']);await work;
 await wait(()=>!f.ui.core.hasActiveOperations);expect(()=>process.kill(pid,0)).toThrow();expect(f.provider.requests[0].signal.aborted).toBe(false);expect(f.ui.core.getState()).toBe('running');expect(f.rendered.get('plugin-git-review-main')).toMatch(/cancel/i);
 f.provider.release();await f.ui.settled();expect(f.ui.core.failure).toBeUndefined();
});
it('correlates same-name model and user tool cards when the older call completes first',async()=>{
 let modelStarted=false,userStarted=false,finishModel=()=>{},finishUser=()=>{};
 const provider=new ScriptedProvider([{toolCalls:[{name:'shared',args:{owner:'model'}}]},{text:'Model done'}]);
 const core=new AgentCore({cwd:process.cwd(),provider,rules:[{tool:'shared',decision:'allow'}],tools:[{
  name:'shared',description:'Controlled concurrent operation',parameters:{type:'object'},describe:()=>({tool:'shared'}),execute:async(_ctx,args:any)=>{
   await new Promise<void>(done=>{if(args.owner==='model'){modelStarted=true;finishModel=done;}else{userStarted=true;finishUser=done;}});
   return args.owner==='model'?{ok:true,data:'Model result'}:{ok:false,error:'User operation failed'};
  },
 }]});
 const ui=new AppUI(()=>core);uis.push(ui);let conversation='';
 ui.connect(message=>{if(message.type==='render'&&message.surface==='session')conversation=message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'';});
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));
 try{
  const main=core.submit('Run shared');await wait(()=>modelStarted);
  const user=core.invokeUserTool('shared',{owner:'user'});await wait(()=>userStarted);
  finishModel();await main;await wait(()=>conversation.includes('✓ shared'));
  expect(conversation.indexOf('✓ shared')).toBeLessThan(conversation.indexOf('… shared'));
  finishUser();await user;await wait(()=>conversation.includes('User operation failed'));
  expect(conversation).not.toContain('… shared');expect(conversation.indexOf('✓ shared')).toBeLessThan(conversation.indexOf('! shared'));
 }finally{finishModel();finishUser();await core.close();}
});

it.each(['titlebar','keyboard'] as const)('closes an active plugin with %s, settles its process and keeps the model, queue and draft intact',async mode=>{
 const f=await fixture(),pidFile=join(f.root,'closing-worker.pid');let work:Promise<unknown>|undefined;
 try{
  f.send('Original task');await wait(()=>f.provider.requests.length===1);f.send('Next task');
  f.key('i',['meta']);f.ui.receive({type:'input',surface:'input',data:{kind:'text',text:'UNSENT_CLOSE_DRAFT'}});
  f.ui.core.host.registerPlugin({name:'close-worker',version:'1.0.0',trust:'trusted'},{'service.exec.run':(e,$)=>e.plugin==='git-review'?$.next({...e,cmd:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`]}):undefined});
  work=f.ui.core.host.emit('ui.press',{site:'plugin-git-review-main',key:'status'});
  let pid=0;await expect.poll(async()=>{pid=Number(await readFile(pidFile,'utf8').catch(()=>''));return pid>0;}).toBe(true);
  const frame=f.messages.filter(m=>m.type==='layout').at(-1)!.frames.find(frame=>frame.surface==='plugin-git-review-main')!;
  f.ui.receive({type:'input',surface:'plugin-git-review-main',data:{kind:'mouse',row:frame.y+1,col:mode==='titlebar'?frame.x+frame.width-3:frame.x+3,button:'left',action:'press'}});
  if(mode==='keyboard')f.key('q',['meta']);
  await wait(()=>!f.ui.core.hasActiveOperations);await work;
  expect(()=>process.kill(pid,0)).toThrow();expect(f.ui.windows.has('plugin-git-review-main')).toBe(false);
  await wait(()=>!(f.rendered.get('status')??'').includes('UI tools'));
  await f.ui.core.host.emit('service.ui.view',{plugin:'git-review',id:'main',title:'Git review',view:{lines:[{text:'LATE_PLUGIN_PUBLICATION'}]}});
  expect(f.ui.windows.has('plugin-git-review-main')).toBe(false);
  expect(f.ui.core.getState()).toBe('running');expect(f.provider.requests[0].signal.aborted).toBe(false);expect(f.rendered.get('input')).toContain('UNSENT_CLOSE_DRAFT');
  // An explicit plugin command is an intentional reopen; the queued model task
  // must still remain separate from every panel operation.
  f.key('i',['meta']);for(const _ of 'UNSENT_CLOSE_DRAFT')f.key('backspace');f.send('/git-review');await wait(()=>f.ui.windows.has('plugin-git-review-main'));
  f.provider.release();await f.ui.settled();expect(f.provider.requests).toHaveLength(2);expect(f.provider.requests[1].messages.at(-1)?.content).toBe('Next task');
 }finally{f.ui.core.cancelOperations();await work;f.provider.release();}
});

it.each(['separate','shared'] as const)('closing a pane with %s owners keeps unrelated work and the main model intact',async mode=>{
 const provider=new ScriptedProvider([{text:'MAIN_IS_RUNNING',hold:true}]),signals=new Map<string,AbortSignal>();
 const core=new AgentCore({cwd:process.cwd(),provider,rules:[{tool:'held',decision:'allow'}],tools:[{name:'held',description:'Controlled owned operation',parameters:{type:'object'},describe:()=>({tool:'held',readOnly:true}),execute:async(ctx,args:any)=>{signals.set(args.id,ctx.signal);await new Promise<void>(done=>{if(ctx.signal.aborted)done();else ctx.signal.addEventListener('abort',()=>done(),{once:true});});return{ok:false,error:'Cancelled'};}}]});
 const ui=new AppUI(()=>core);uis.push(ui);const messages:WireMessage[]=[];ui.connect(m=>messages.push(m));ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));
 ui.resize(160,40);
 for(const name of ['first','second'])core.host.registerPlugin({name,version:'1.0.0',trust:'trusted'},{});
 await core.start();const main=core.submit('Continue working');await wait(()=>provider.requests.length===1);
 const first=core.invokeUserTool('held',{id:'first'},{owner:'first'}),second=core.invokeUserTool('held',{id:'second'},{owner:mode==='shared'?'first':'second'});
 try{
  const outcomes:unknown[]=[];void first.then(r=>outcomes.push(r));void second.then(r=>outcomes.push(r));
  await expect.poll(()=>({started:[...signals.keys()].sort(),calls:provider.requests.length,active:core.getOperations(),outcomes})).toMatchObject({started:['first','second'],calls:1});
  for(const [plugin,id]of [['first','main'],[mode==='shared'?'first':'second',mode==='shared'?'detail':'main']])await core.host.emit('service.ui.view',{plugin,id,title:plugin,view:{lines:[{text:'Working'}]}});
  const frames=messages.filter(m=>m.type==='layout').at(-1)!.frames;expect(frames.map(f=>f.surface)).toContain('plugin-first-main');
  const frame=frames.find(f=>f.surface==='plugin-first-main')!;
  ui.receive({type:'input',surface:'plugin-first-main',data:{kind:'mouse',row:frame.y+1,col:frame.x+frame.width-3,button:'left',action:'press'}});
  if(mode==='separate'){await first;expect(signals.get('first')!.aborted).toBe(true);expect(core.getOperations().map(op=>op.owner)).toEqual(['second']);}
  else{await ui.settled();expect(signals.get('first')!.aborted).toBe(false);expect(core.getOperations().map(op=>op.owner)).toEqual(['first','first']);}
  expect(signals.get('second')!.aborted).toBe(false);expect(provider.requests[0].signal.aborted).toBe(false);expect(ui.windows.has(mode==='shared'?'plugin-first-detail':'plugin-second-main')).toBe(true);
 }finally{core.cancelOperations();provider.release();await Promise.all([first,second,main]);await core.close();}
});
