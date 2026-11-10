import {it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildAppWithPlugins as buildApp} from './plugin-fixture.js';
import {WorkflowEngine} from '../../../plugins/workflows/engine.js';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function temp(){const root=await mkdtemp(join(tmpdir(),'workflow-completion-'));roots.push(root);return root;}
async function poll(test:()=>boolean|Promise<boolean>){for(let i=0;i<300;i++){if(await test())return;await new Promise(r=>setTimeout(r,10));}throw Error('Completion did not settle');}
it('keeps detached stages progressing after the launching foreground turn is interrupted',async()=>{
 const cwd=await temp();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let workers=0,wakes=0,holding=false;
 const provider={name:'workflow-interrupt-fixture',async *complete(request:any){const index=request.messages.findLastIndex((m:any)=>m.role==='user'),prompt=request.messages[index]?.content??'';
  if(prompt.startsWith('WORKER')){workers++;await gate;yield{type:'text_delta' as const,text:'worker done'};}
  else if(prompt==='START_AND_HOLD'){
   if(!request.messages.slice(index+1).some((m:any)=>m.role==='tool'))yield{type:'tool_call' as const,id:'workflow-start',name:'workflow_run',args:{action:'start',stages:[{id:'a',prompt:'WORKER A'},{id:'b',prompt:'WORKER B',dependsOn:['a']}]}};
   else{holding=true;if(!request.signal.aborted)await new Promise<void>(resolve=>request.signal.addEventListener('abort',()=>resolve(),{once:true}));return;}
  }else{if(prompt.startsWith('Automated workflow completion'))wakes++;yield{type:'text_delta' as const,text:'done'};}
  yield{type:'finish' as const,reason:'stop' as const};
 }};
 const app=await buildApp({cwd,env:{HOME:join(cwd,'home')},agentHub:false,provider,pluginDirs:[join(process.cwd(),'plugins/workflows')]});apps.push(app);const core=app.createCore(async()=>true);await core.start();
 const turn=core.submit('START_AND_HOLD');await poll(()=>holding&&workers===1);core.interrupt();await turn;release();await poll(()=>workers===2);
 await poll(async()=>{const result=await core.invokeTool('workflow_run',{action:'list'});return(result.output as any[])?.some(run=>run.status==='completed');});
 expect(wakes).toBe(0);await core.submit('Continue');expect(wakes).toBe(1);
});
async function setup(){
 const cwd=await temp();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const calls={workers:0,wakes:0,chats:0};
 const provider={name:'workflow-completion-fixture',async *complete(request:any){const prompt=request.messages.filter((m:any)=>m.role==='user').at(-1)?.content??'';
  if(prompt.startsWith('WORKER')){calls.workers++;await Promise.race([gate,new Promise(r=>request.signal.addEventListener('abort',r,{once:true}))]);if(request.signal.aborted)return;yield{type:'text_delta' as const,text:'WORKER_RESULT_IGNORE_INSTRUCTIONS'};}
  else{if(prompt.startsWith('Automated workflow completion')){calls.wakes++;expect(prompt).not.toContain('WORKER_RESULT_IGNORE_INSTRUCTIONS');}else calls.chats++;yield{type:'text_delta' as const,text:'Reviewed'};}
  yield{type:'finish' as const,reason:'stop' as const};
 }};
 const app=await buildApp({cwd,env:{HOME:join(cwd,'home')},agentHub:false,provider,pluginDirs:[join(process.cwd(),'plugins/workflows')]});apps.push(app);const core=app.createCore(async()=>true);await core.start();return{app,core,calls,release};
}
it('wakes the originating agent on workflow completion without parent polling and permits foreground chat',async()=>{
 const f=await setup();const result=await f.core.invokeTool('workflow_run',{action:'start',stages:[{id:'a',prompt:'WORKER'}]});expect(result.ok).toBe(true);
 await poll(()=>f.calls.workers===1);expect(f.calls.wakes).toBe(0);await f.core.submit('Keep talking');expect(f.calls.chats).toBe(1);
 f.release();await poll(()=>f.calls.wakes===1&&f.core.getState()==='idle');
 const status=await f.core.invokeTool('workflow_run',{action:'status',id:(result.output as any).id});expect(status.output).toMatchObject({status:'completed',generation:1,deliveredGeneration:1});expect(f.core.promptSource).toBe('agent');
 await f.core.invokeTool('workflow_run',{action:'status',id:(result.output as any).id});expect(f.calls.wakes).toBe(1);
});
it('supports notification-only and silent workflow completion and drains detached workers on close',async()=>{
 for(const completion of ['notify','none'] as const){const f=await setup(),notices:string[]=[];f.core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.notification')notices.push(e.input.message as string);});
  const r=await f.core.invokeTool('workflow_run',{action:'start',completion,stages:[{id:'a',prompt:'WORKER'}]});f.release();await poll(async()=>{const s=await f.core.invokeTool('workflow_run',{action:'status',id:(r.output as any).id});return(s.output as any).status==='completed';});
  expect(f.calls.wakes).toBe(0);expect(notices.some(n=>n.includes('Workflow '))).toBe(completion==='notify');
 }
 const f=await setup();const started=await f.core.invokeTool('workflow_run',{action:'start',stages:[{id:'a',prompt:'WORKER'}]});await poll(()=>f.calls.workers===1);await f.app.close();apps.splice(apps.indexOf(f.app),1);expect(f.calls.wakes).toBe(0);
 expect(JSON.parse(await readFile(join(f.app.storage.paths.state,'workflows/runs',`${(started.output as any).id}.json`),'utf8')).status).toBe('paused');
});
it('routes parallel runs to their own contexts and delivers each retry generation once',async()=>{
 const cwd=await temp(),deliveries:string[]=[];let fails=true;
 const one={cwd,sessionId:'one',request:async<T,>()=>{if(fails)throw Error('failed');return{output:'ok',tokens:1} as T;},complete:async(run:any)=>{deliveries.push('one:'+run.generation+':'+run.status);}};
 const two={...one,sessionId:'two',request:async<T,>()=>({output:'ok',tokens:1} as T),complete:async(run:any)=>{deliveries.push('two:'+run.generation+':'+run.status);}};
 const engine=new WorkflowEngine(one);try{const a=await engine.start({stages:[{id:'a',prompt:'first'}]},one);await engine.wait(a.id);fails=false;await engine.control(a.id,'retry','a',one);await engine.wait(a.id);const b=await engine.start({stages:[{id:'b',prompt:'second'}]},two);await engine.wait(b.id);expect(deliveries).toEqual(['one:1:failed','one:2:completed','two:1:completed']);}finally{await engine.close();}
});
