import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AgentCore,CoreHumanRequestContext,CompletionRequest,ModelProvider} from '@agent-compositor/core';
import {buildApp,type BuiltAppHumanRequests} from '../src/build.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[],release:(()=>void)[]=[];
afterEach(async()=>{for(const resolve of release.splice(0))resolve();for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
  const cwd=await mkdtemp(join(tmpdir(),'managed-human-requests-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const directory=join(cwd,'plugins','managed-probe');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'managed-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',hookTimeouts:{'prompt.submit':300000}}));
  await writeFile(join(directory,'hooks.js'),`export default {'prompt.submit':async(event,$)=>{
    if(!event.text.startsWith('Worker form'))return;const api=event.text.includes('background')?$.background():$;
    await api.ui.form({title:event.text,fields:[{id:'token',label:'Private token',type:'password'}],actions:[{id:'save',label:'Save'}]});
    return{drop:'Private managed form handled'};
  }};`);
  const requests:CompletionRequest[]=[];
  const provider:ModelProvider={name:'managed-request-router',async *complete(request){
    requests.push(request);let index=-1;for(let i=0;i<request.messages.length;i++)if(request.messages[i].role==='user')index=i;
    const prompt=request.messages[index]?.content??'';
    if(prompt==='Seed'||request.messages.slice(index+1).some(message=>message.role==='tool')){yield{type:'text_delta',text:'Completed'};yield{type:'finish',reason:'stop'};return;}
    yield{type:'tool_call',id:'reused-call',name:prompt==='Worker child'?'task':'ask_user',args:prompt==='Worker child'?{prompt:'Leaf question'}:{question:prompt,options:['Keep','Remote']}};
    yield{type:'finish',reason:'tool_calls'};
  }};
  const app=await buildApp({cwd,env:{HOME:cwd},provider,fixedConfig:{enabledPlugins:['agent-hub','session-manager','managed-probe'],
    agent:{tools:['agent_control','ask_user','task'],builtinTools:[],controlTools:['ask_user','task'],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
    permissions:{rules:[{tool:'agent_control',decision:'allow'}]},compaction:{enabled:false}}});cleanup.push(()=>app.close());
  const root=app.createCore(async()=>true,async()=>{throw Error('Unexpected construction callback');});await root.start();await root.submit('Seed');
  async function control(owner:AgentCore,args:Record<string,unknown>){const result=await owner.invokeTool('agent_control',args);expect(result.ok,result.error).toBe(true);return result.output as any;}
  const create=async(owner=root,name='Actual managed name')=>(await control(owner,{action:'create',name,worktree:false})).id as string;
  const send=(owner:AgentCore,id:string,prompt:string)=>control(owner,{action:'send',id,prompt});
  const idle=async(owner:AgentCore,id:string)=>expect.poll(async()=>((await control(owner,{action:'list',id}))[0]).state).toBe('idle');
  return{app,root,requests,control,create,send,idle};
}
function handlers(){
  const asks:{question:string;context:CoreHumanRequestContext;resolve:(answer:string)=>void}[]=[];
  const forms:{context:CoreHumanRequestContext;resolve:()=>void}[]=[];
  const value:BuiltAppHumanRequests={approve:async()=>false,ask:(request,context)=>new Promise(resolve=>{
    const entry={question:request.question,context:context!,resolve};asks.push(entry);release.push(()=>resolve('Keep'));
  }),form:(_plugin,_request,signal,context)=>new Promise(resolve=>{
    const finish=()=>resolve(null);forms.push({context,resolve:finish});release.push(finish);
    signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();
  })};
  return{asks,forms,value};
}

it('keeps managed roots and descendants on committed UI callbacks across preparation and Main resume',async()=>{
  const f=await fixture(),a=handlers(),offA=f.app.bindHumanRequests(a.value);
  const one=await f.create(),two=await f.create(f.root,'Second actual name');
  await f.send(f.root,one,'First worker question');await expect.poll(()=>a.asks.length).toBe(1);
  const original=a.asks[0].context;expect(original.origin.agentId).toBe('Actual managed name');
  expect(original.root.host).toBe(original.host);expect(original.root.instance).toBe(original.instance);expect(original.host).not.toBe(f.root.host);
  let candidateAsks=0;const next=await f.app.resume(f.root.sessionId,async()=>true,async()=>{candidateAsks++;return 'Wrong candidate';});
  // Constructing a candidate changes the hub's embedding callbacks, but has not
  // committed a replacement UI registration or revoked an independent worker.
  await f.send(f.root,two,'During preparation');await expect.poll(()=>a.asks.length).toBe(2);expect(candidateAsks).toBe(0);
  const b=handlers(),offB=f.app.bindHumanRequests(b.value);offA();await f.root.close();
  expect(original.root.signal.aborted).toBe(false);expect(original.signal.aborted).toBe(false);
  for(const ask of a.asks)ask.resolve('Keep');await f.idle(next,one);await f.idle(next,two);
  const republished=new Map<string,any>();next.subscribe(event=>{
    if(event.kind==='catalog'&&event.event==='ui.surface')republished.set(String(event.input.id),event.input.view);
  });
  await next.start();expect(republished.get('plugin-agent-hub-agent-'+one)?.lines.some((line:any)=>line.text==='Completed')).toBe(true);
  await f.control(next,{action:'stop',id:one});
  await f.send(next,one,'After replacement');await expect.poll(()=>b.asks.length).toBe(1);
  expect(b.asks[0].context.root).toBe(original.root);b.asks[0].resolve('Remote');await f.idle(next,one);
  await f.send(next,one,'Worker child');await expect.poll(()=>b.asks.length).toBe(2);
  const leaf=b.asks[1].context;expect(leaf.origin.depth).toBe(1);expect(leaf.host).not.toBe(original.host);
  expect(leaf.root).toBe(original.root);expect(leaf.origin.parent?.agentId).toBe('Actual managed name');
  b.asks[1].resolve('Keep');await f.idle(next,one);
  await f.send(next,one,'Worker form');await expect.poll(()=>b.forms.length).toBe(1);
  expect(b.forms[0].context.root).toBe(original.root);expect(candidateAsks).toBe(0);
  b.forms[0].resolve();await f.idle(next,one);offB();
});

it('uses the latest embedding callback only before a UI has ever registered, then fails closed after unbind',async()=>{
  const f=await fixture();let first=0,second=0;
  // No committed UI: preserve the public createCore embedding channel behavior.
  const firstCore=f.app.createCore(async()=>true,async()=>{first++;return 'Keep';});await firstCore.start();
  const id=await f.create(firstCore);await f.send(firstCore,id,'First embedding');await f.idle(firstCore,id);expect(first).toBe(1);
  const secondCore=f.app.createCore(async()=>true,async()=>{second++;return 'Keep';});await secondCore.start();
  await f.send(secondCore,id,'Second embedding');await f.idle(secondCore,id);expect(second).toBe(1);
  const ui=handlers(),off=f.app.bindHumanRequests(ui.value);off();
  await f.send(secondCore,id,'No current UI');await f.idle(secondCore,id);
  expect(first).toBe(1);expect(second).toBe(1);expect(ui.asks).toEqual([]);
});

it('archives only the selected managed background form and closes other pending forms without deadlock',async()=>{
  const f=await fixture(),ui=handlers();f.app.bindHumanRequests(ui.value);
  const one=await f.create(),two=await f.create(f.root,'Other managed name');
  await f.send(f.root,one,'Worker form background one');await f.send(f.root,two,'Worker form background two');
  await expect.poll(()=>ui.forms.length).toBe(2);const [first,other]=ui.forms;
  expect(first.context.serviceScope?.background).toBe(true);expect(other.context.serviceScope?.background).toBe(true);
  await f.control(f.root,{action:'archive',id:one});
  expect(first.context.root.signal.aborted).toBe(true);expect(other.context.root.signal.aborted).toBe(false);
  const closing=f.app.close();expect(f.app.close()).toBe(closing);await closing;
  expect(other.context.root.signal.aborted).toBe(true);expect(other.context.signal.aborted).toBe(true);
});
