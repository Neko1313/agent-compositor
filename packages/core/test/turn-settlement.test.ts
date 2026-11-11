import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';

it.each(['hook','subscriber'] as const)('settles the interrupted turn before resuming from a %s',async source=>{
 const cwd=await mkdtemp(join(tmpdir(),'turn-settlement-'));
 let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),interrupted=new Promise<void>(resolve=>{entered=resolve;});
 let executions=0;
 const provider=new ScriptedProvider([{text:'First turn',hold:true},{toolCalls:[{name:'checkpoint',args:{}}],hold:true},{text:'Steering received'}]);
 const core=new AgentCore({cwd,provider,onApproval:async()=>true,controlTools:[],tools:[{
  name:'checkpoint',description:'Check resumed tool context',parameters:{type:'object',properties:{}},
  describe:()=>({tool:'checkpoint'}),execute:async()=>{executions++;return {ok:true,data:'Resumed tool completed'};},
 }],plugins:[{manifest:{name:'settlement',version:'1.0.0',trust:'trusted'},hooks:{
  'turn.interrupted':async()=>{entered();if(source==='hook')await held;},
 }}]});
 let resumed:Promise<void>|undefined;
 const starts:string[]=[],steers:string[]=[];
 core.subscribe(event=>{
  if(event.kind!=='catalog')return;
  if(event.event==='turn.start')starts.push(String(event.input.turnId));
  if(event.event==='prompt.steer')steers.push(String(event.input.turnId));
  if(event.event==='turn.interrupted'&&source==='subscriber')resumed=core.submit('Resume explicitly');
 });
 try{
  const first=core.submit('Start');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
  core.interrupt();await interrupted;
  if(source==='hook'){
   resumed=core.submit('Resume explicitly');
   expect(core.getState()).toBe('interrupted');
   expect(provider.requests).toHaveLength(1);
   release();
  }
  await first;
  await vi.waitFor(()=>expect(provider.requests).toHaveLength(2));
  expect(core.getState()).toBe('running');
  await core.steer('Keep the new turn');
  expect(steers).toEqual([starts[1]]);
  expect(steers[0]).not.toBe(starts[0]);
  provider.release();await resumed;
  expect(executions).toBe(1);
  expect(provider.requests).toHaveLength(3);
  expect(provider.requests[2].messages.some(message=>message.content==='Keep the new turn')).toBe(true);
  expect(core.getState()).toBe('idle');
 }finally{release();await core.close();await rm(cwd,{recursive:true,force:true});}
});
