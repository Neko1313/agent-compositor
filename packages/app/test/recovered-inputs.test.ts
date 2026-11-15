import {expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import type {SessionEvent} from '@agent-compositor/session';
import {recoveryCommand} from '../src/recovered-inputs.js';

it('reports a recovered retry interrupted before its queue intent is accepted',async()=>{
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const journal:SessionEvent[]=[{type:'prompt.queued',text:'Retry this',recoveryId:'retry'}];
 const core=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([]),isWorkBlocked:()=>true,
  sessions:{create:async()=>{},append:async(_id,events)=>{if(events.some(event=>event.type==='prompt.queue.intent')){entered();await gate;}journal.push(...events);}}},structuredClone(journal));
 try{
  const retry=recoveryCommand(core,'/recover retry 1');await started;core.interrupt();
  expect(await retry).toBe('Recovered message was not submitted. Review it with /recover.');
  expect(core.getRecoveredInputs()).toMatchObject([{id:'retry',text:'Retry this'}]);
 }finally{release();await core.close();}
});

it('reports an accepted queued retry without executing it automatically',async()=>{
 const journal:SessionEvent[]=[{type:'prompt.queued',text:'Retry this',recoveryId:'retry'}];
 const provider=new ScriptedProvider([]);
 const core=AgentCore.resume({cwd:process.cwd(),provider,isWorkBlocked:()=>true,
  sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}},structuredClone(journal));
 try{
  expect(await recoveryCommand(core,'/recover retry 1')).toBe('Recovered message submitted or queued.');
  expect(provider.requests).toHaveLength(0);expect(core.getRecoveredInputs()).toEqual([]);
  core.interrupt();expect(core.getRecoveredInputs()).toMatchObject([{id:'retry',text:'Retry this'}]);
 }finally{await core.close();}
});
