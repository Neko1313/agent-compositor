import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {ModelProvider} from '@agent-compositor/core';
import {buildApp} from '../src/build.js';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createOpenTuiHost} from '../src/opentui-host.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});

async function fixture(){
  const cwd=await mkdtemp(join(tmpdir(),'agent-manager-ui-lifecycle-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const directory=join(cwd,'plugins','manager-controls'),trace=join(cwd,'receipts.jsonl');await mkdir(directory,{recursive:true});await writeFile(trace,'');
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'manager-controls',version:'1.0.0',trust:'trusted',main:'hooks.js',
    hookTimeouts:{'prompt.submit':300000,'ui.press':300000}}));
  await writeFile(join(directory,'hooks.js'),`
import {appendFile,readFile} from 'node:fs/promises';
const record=value=>appendFile(${JSON.stringify(trace)},JSON.stringify(value)+'\\n');
export default {
 'session.start':async(_event,$)=>$.ui.view('controls','Manager controls',{lines:[
  {text:'Create',action:'create'},{text:'Create peer',action:'create-peer'},{text:'Send',action:'send'},
  {text:'Send model',action:'send-model'},{text:'Archive',action:'archive'}
 ]},{site:'split'}),
 'prompt.submit':async(event,$)=>{
  if(event.text!=='Managed ordinary form')return;
  const value=await $.ui.form({title:'Managed ordinary form',fields:[{id:'token',label:'Token',type:'password'}],actions:[{id:'save',label:'Save'}]});
  await record({kind:'form-result',value});return{drop:'Managed form handled'};
 },
 'ui.press':async(event,$)=>{
  if(event.site!=='plugin-manager-controls-controls')return;
  try{
   const creating=event.key.startsWith('create');
   const id=creating?undefined:(await $.emit('service.agent.control',{action:'list'})).value.find(row=>row.name==='UI worker').id;
   const args=creating?{action:'create',name:event.key==='create'?'UI worker':'Peer worker',worktree:false}:
    event.key==='send'||event.key==='send-model'?{action:'send',id,prompt:event.key==='send'?'Managed ordinary form':'Managed visible follow-up'}:{action:'archive',id};
   const result=(await $.emit('service.agent.control',args)).value;
   await record({kind:'control',action:event.key,result});
  }catch(error){await record({kind:'fault',action:event.key,error:String(error),stack:error.stack});throw error;}
 },
 'service.ui.view':async(event,$)=>{
  if(event.plugin==='agent-hub'&&event.title==='UI worker'&&event.placement?.focus){
   let gated=false;try{await readFile(${JSON.stringify(join(cwd,'focus-gate'))});gated=true;}catch{}
   if(gated){await record({kind:'focus-pending'});while(true){$.signal.throwIfAborted();try{await readFile(${JSON.stringify(join(cwd,'focus-release'))});break;}catch{await new Promise(resolve=>setTimeout(resolve,5));}}}
  }
  return $.next();
 }
};`);
  let releaseModel!:()=>void;const modelGate=new Promise<void>(resolve=>{releaseModel=resolve;});cleanup.push(releaseModel);
  const provider:ModelProvider={name:'manager-ui-loopback',async *complete(request){
    const worker=request.messages.filter(message=>message.role==='user').at(-1)?.content==='Managed visible follow-up';
    if(worker)await modelGate;yield{type:'text_delta',text:worker?'Visible worker completion':'Seed reply'};yield{type:'finish',reason:'stop'};
  }};
  const app=await buildApp({cwd,env:{HOME:cwd},provider,fixedConfig:{enabledPlugins:['agent-hub','session-manager','manager-controls'],
    agent:{tools:['agent_control'],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},
    permissions:{rules:[{tool:'agent_control',decision:'allow'}]},compaction:{enabled:false}}});cleanup.push(()=>app.close());
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});layout.resize(160,42);cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();await host.submit('Seed');
  const receipts=async()=>{const text=await readFile(trace,'utf8');return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));};
  const controls=()=>host.surfaces.snapshot().find(source=>source.id==='plugin-manager-controls-controls')!;
  const press=async(action:string)=>{
    const source=controls();layout.act({type:'open',id:source.id});expect(source.press!(action,source.snapshot().revision)).toBe(true);
    await expect.poll(()=>source.snapshot().busy).toBe(false);
  };
  const surface=(id:string)=>host.surfaces.snapshot().find(source=>source.id===id)!;
  const action=async(id:string,key:string)=>{
    const source=surface(id);layout.act({type:'open',id});expect(source.press!(key,source.snapshot().revision)).toBe(true);
    await expect.poll(()=>source.snapshot().busy).toBe(false);
  };
  return{cwd,host,layout,receipts,press,surface,action,releaseModel};
}

it('archives an ordinary managed form through a fresh UI action after an unrelated completed action',async()=>{
  const {host,receipts,press,surface,action}=await fixture();
  await press('create');const id=(await receipts()).find(row=>row.action==='create').result.id;
  await press('create-peer');const peer=(await receipts()).find(row=>row.action==='create-peer').result.id;
  await host.submit('/agents');const overview='plugin-agent-hub-agents';expect(surface(overview).snapshot().view?.table?.rows.some(row=>row.id===id)).toBe(true);
  await action('plugin-agent-hub-agent-'+id,'history:'+id);
  expect(surface('plugin-agent-hub-history-'+id)).toBeDefined();
  const oldMain=host.core;await oldMain.host.emit('service.session.control',{action:'resume',id:oldMain.sessionId});expect(host.core).not.toBe(oldMain);
  await press('send');expect((await receipts()).filter(row=>row.kind==='fault'),JSON.stringify(await receipts())).toEqual([]);
  await expect.poll(()=>host.surfaces.snapshot().filter(source=>source.id.startsWith('agent-request-')).length,{message:JSON.stringify(await receipts())}).toBe(1);
  await press('archive');const rows=await receipts();
  expect(rows.filter(row=>row.kind==='fault'),JSON.stringify(rows)).toEqual([]);
  expect(rows).toContainEqual({kind:'form-result',value:null});
  expect(rows.find(row=>row.kind==='control'&&row.action==='archive')?.result).toMatchObject({archived:id});
  expect(host.surfaces.snapshot().some(source=>source.id==='plugin-agent-hub-agent-'+id)).toBe(false);
  expect(host.surfaces.snapshot().some(source=>source.id==='plugin-agent-hub-history-'+id)).toBe(false);
  expect(surface(overview).snapshot().view?.table?.rows.some(row=>row.id===id)).toBe(false);
  expect(surface('plugin-agent-hub-agent-'+peer).snapshot().view?.tabs?.some(tab=>tab.id===id)).toBe(false);
  expect(host.surfaces.snapshot().filter(source=>source.id.startsWith('agent-request-'))).toEqual([]);
});

it('retains the current agent-hub opening intent and lets newer navigation win a delayed publication',async()=>{
  const f=await fixture();await f.press('create');const id=(await f.receipts()).find(row=>row.action==='create').result.id;
  await f.host.submit('/agents');const overview='plugin-agent-hub-agents',conversation='plugin-agent-hub-agent-'+id;
  await f.action(overview,'expand:'+id);
  await f.action(overview,'open:'+id);expect(f.layout.snapshot().focused).toBe(conversation);
  await writeFile(join(f.cwd,'focus-gate'),'');
  const opening=f.action(overview,'open:'+id);await expect.poll(async()=>(await f.receipts()).some(row=>row.kind==='focus-pending')).toBe(true);
  f.layout.act({type:'workspace',id:3});await writeFile(join(f.cwd,'focus-release'),'');await opening;
  expect(f.layout.snapshot().workspace).toBe(3);expect(f.layout.snapshot().focused).not.toBe(conversation);
});

it('publishes passive worker completion after the launching UI action has ended',async()=>{
  const f=await fixture();await f.press('create');const id=(await f.receipts()).find(row=>row.action==='create').result.id;
  await f.press('send-model');expect(f.surface('plugin-manager-controls-controls').snapshot().busy).toBe(false);
  f.layout.act({type:'workspace',id:3});f.releaseModel();
  await expect.poll(()=>f.surface('plugin-agent-hub-agent-'+id).snapshot().view?.lines.some(line=>line.text==='Visible worker completion')).toBe(true);
  expect(f.layout.snapshot().workspace).toBe(3);expect(f.layout.snapshot().focused).not.toBe('plugin-agent-hub-agent-'+id);
});
