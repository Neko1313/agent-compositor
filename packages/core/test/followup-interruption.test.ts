import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';
import {recoverQueuedInputs} from '../src/resume.js';
const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'followup-interrupt-'));roots.push(cwd);
 const provider=new ScriptedProvider([{text:'User resumed'},{text:'Follow-up reviewed'}]);let starts=0;
 const core=new AgentCore({cwd,provider,plugins:[{manifest:{name:'owner',version:'1.0.0',trust:'trusted'},hooks:{'session.start':()=>{starts++;}}}]});cores.push(core);await core.start();
 const enqueue=(key:string,text=key)=>core.host.emit('service.agent.enqueue',{plugin:'owner',key,text});return{core,provider,enqueue,starts:()=>starts};
}
it('pauses a queued automatic wake before its idle timer starts a model',async()=>{
 const f=await fixture(),notices:string[]=[];f.core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.notification')notices.push(String(event.input.message));});
 expect(await f.enqueue('wake','Accepted automatic work')).toMatchObject({value:{value:{queued:true}}});
 f.core.interrupt();expect(f.core.getState()).toBe('interrupted');expect(notices).toContain('Automatic follow-up paused. Send a message to continue.');
 await new Promise(resolve=>setTimeout(resolve,50));expect(f.provider.requests).toHaveLength(0);
 await f.core.submit('Resume explicitly');expect(f.provider.requests).toHaveLength(2);
 expect(f.provider.requests[1].messages.at(-1)?.content).toBe('Accepted automatic work');
});
it('clears an idle wake timer without disabling wakes in the next conversation',async()=>{
 const f=await fixture();await f.enqueue('old','Discarded by clear');f.core.clear();
 await vi.waitFor(()=>expect(f.starts()).toBe(2));await f.enqueue('new','New conversation work');
 await vi.waitFor(()=>expect(f.provider.requests).toHaveLength(1));
 expect(f.provider.requests[0].messages.at(-1)?.content).toBe('New conversation work');
 expect(f.provider.requests[0].messages.some(message=>message.content==='Discarded by clear')).toBe(false);
});
it('preserves accepted follow-ups until the host plugin-change barrier is released',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'followup-plugin-barrier-'));roots.push(cwd);let blocked=true;
 const provider=new ScriptedProvider([{text:'Follow-up complete'},{text:'Draft complete'}]);
 const core=new AgentCore({cwd,provider,isWorkBlocked:()=>blocked,plugins:[{manifest:{name:'owner',version:'1.0.0',trust:'trusted'},hooks:{}}]});cores.push(core);await core.start();
 const notices:string[]=[];core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='ui.notification')notices.push(String(event.input.message));});
 expect(await core.host.emit('service.agent.enqueue',{plugin:'owner',key:'wake',text:'Keep this work'})).toMatchObject({value:{value:{queued:true}}});
 const input=core.dispatchInput('Keep my draft');expect(await input.admitted).toBe('queued');await input.completion;
 expect(notices.some(message=>message.includes('Apply /reload'))).toBe(true);
 await new Promise<void>(resolve=>setImmediate(resolve));expect(provider.requests).toHaveLength(0);
 blocked=false;core.resumePendingWork();await vi.waitFor(()=>expect(provider.requests).toHaveLength(2));
 expect(provider.requests[0].messages.at(-1)?.content).toBe('Keep this work');
 expect(provider.requests[1].messages.at(-1)?.content).toBe('Keep my draft');
});
it('offers interrupted accepted user messages for review immediately and only retries on request',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queue-recovery-current-'));roots.push(cwd);let blocked=true;
 const journal:any[]=[],provider=new ScriptedProvider([{text:'Recovered'}]);
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{journal.push(...events);}};
 const core=new AgentCore({cwd,provider,sessions,isWorkBlocked:()=>blocked});cores.push(core);
 const queued=core.dispatchInput('Review this message');expect(await queued.admitted).toBe('queued');await queued.completion;
 expect(journal.some(event=>event.type==='prompt.queue.intent'&&event.text==='Review this message')).toBe(true);
 core.interrupt();const recovered=core.getRecoveredInputs();expect(recovered.map(item=>item.text)).toEqual(['Review this message']);
 expect(provider.requests).toHaveLength(0);expect(await core.retryRecoveredInput(recovered[0].id)).toBe('queued');
 expect(core.getRecoveredInputs()).toEqual([]);core.interrupt();expect(core.getRecoveredInputs().map(item=>item.text)).toEqual(['Review this message']);
 blocked=false;expect(await core.retryRecoveredInput(recovered[0].id)).toBe('submitted');expect(provider.requests).toHaveLength(1);
 expect(provider.requests[0].messages.at(-1)?.content).toBe('Review this message');expect(core.getRecoveredInputs()).toEqual([]);
});
it('keeps a message interrupted before queue admission out of the current recovery list',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queue-recovery-unaccepted-'));roots.push(cwd);
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.queue.intent')){entered();await held;}}};
 const core=new AgentCore({cwd,sessions,isWorkBlocked:()=>true});cores.push(core);
 const queued=core.dispatchInput('Unaccepted draft');
 try{await started;core.interrupt();expect(await queued.admitted).toBe(false);expect(core.getRecoveredInputs()).toEqual([]);}
 finally{release();await queued.completion;}
 await new Promise<void>(resolve=>setImmediate(resolve));expect(core.getRecoveredInputs()).toEqual([]);
});
it('preserves distinct cancelled messages and a discard across journal replay',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queue-recovery-discard-'));roots.push(cwd);const journal:any[]=[];
 const core=new AgentCore({cwd,isWorkBlocked:()=>true,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(core);
 for(const text of ['First queued','Second queued']){const input=core.dispatchInput(text);expect(await input.admitted).toBe('queued');await input.completion;}
 core.interrupt();const entries=core.getRecoveredInputs();expect(entries.map(entry=>entry.text)).toEqual(['First queued','Second queued']);
 await core.discardRecoveredInput(entries[0].id);expect(core.getRecoveredInputs().map(entry=>entry.text)).toEqual(['Second queued']);
 expect(recoverQueuedInputs(journal).map(entry=>entry.text)).toEqual(['Second queued']);
});
it.each([true,false])('keeps interrupted steering and queue order across resume (steering first: %s)',async steeringFirst=>{
 const cwd=await mkdtemp(join(tmpdir(),'queue-steer-order-'));roots.push(cwd);const journal:any[]=[];
 const provider=new ScriptedProvider([{text:'Working',hold:true}]);
 const core=new AgentCore({cwd,provider,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});cores.push(core);
 const turn=core.submit('Start');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 try{
  const queue=async()=>{const input=core.dispatchInput('Queued message');expect(await input.admitted).toBe('queued');await input.completion;};
  if(steeringFirst){await core.steer('Steering message');await queue();}else{await queue();await core.steer('Steering message');}
  core.interrupt();await turn;
  const expected=steeringFirst?['Steering message','Queued message']:['Queued message','Steering message'];
  expect(recoverQueuedInputs(journal).map(item=>item.text)).toEqual(expected);
  expect(core.getRecoveredInputs().map(item=>item.text)).toEqual(expected);
 }finally{provider.release();}
});
it('keeps earlier recovered messages ahead of newly interrupted steering',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'recovery-old-before-new-'));roots.push(cwd);
 const journal:any[]=[{type:'prompt.queue.intent',text:'Older queued',recoveryId:'old'}];
 const provider=new ScriptedProvider([{text:'Working',hold:true}]);
 const core=AgentCore.resume({cwd,provider,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}},structuredClone(journal));cores.push(core);
 const turn=core.submit('New task');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 try{
  await core.steer('New steering');core.interrupt();await turn;
  expect(core.getRecoveredInputs().map(item=>item.text)).toEqual(['Older queued','New steering']);
  expect(recoverQueuedInputs(journal).map(item=>item.text)).toEqual(['Older queued','New steering']);
 }finally{provider.release();}
});
it('keeps mixed recovery order when a custom journal acknowledges intents out of order',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'recovery-concurrent-order-'));roots.push(cwd);const journal:any[]=[];
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const provider=new ScriptedProvider([{text:'Working',hold:true}]);
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.steer.intent')){entered();await held;}journal.push(...events);}};
 const core=new AgentCore({cwd,provider,sessions});cores.push(core);const turn=core.submit('Start');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 try{
  const steering=core.steer('First steering');await started;
  const queued=core.dispatchInput('Second queued');expect(await queued.admitted).toBe('queued');await queued.completion;
  release();await steering;core.interrupt();await turn;
  expect(core.getRecoveredInputs().map(item=>item.text)).toEqual(['First steering','Second queued']);
  expect(recoverQueuedInputs(journal).map(item=>item.text)).toEqual(['First steering','Second queued']);
 }finally{release();provider.release();}
});
it('continues recovery ordering after resume while keeping legacy entries first',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'recovery-order-resume-'));roots.push(cwd);
 const journal:any[]=[{type:'prompt.queue.intent',text:'Legacy',recoveryId:'legacy'},
  {type:'prompt.queue.intent',text:'Earlier',recoveryId:'earlier',recoveryOrder:40},
  {type:'prompt.queue.intent',text:'Legacy',recoveryId:'legacy',recoveryOrder:80},
  {type:'prompt.input.intent',text:'Completed',recoveryId:'completed',recoveryOrder:90},
  {type:'prompt.submit',text:'Completed',recoveryId:'completed'}];
 const core=AgentCore.resume({cwd,isWorkBlocked:()=>true,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}},structuredClone(journal));cores.push(core);
 const input=core.dispatchInput('New');expect(await input.admitted).toBe('queued');await input.completion;core.interrupt();
 expect(journal.find(event=>event.type==='prompt.queue.intent'&&event.text==='New').recoveryOrder).toBe(91);
 expect(core.getRecoveredInputs().map(item=>item.text)).toEqual(['Legacy','Earlier','New']);
 expect(recoverQueuedInputs(journal).map(item=>item.text)).toEqual(['Legacy','Earlier','New']);
 expect(await core.retryRecoveredInput('legacy')).toBe('queued');
 expect(journal.filter(event=>event.type==='prompt.queue.intent'&&event.recoveryId==='legacy').at(-1)).not.toHaveProperty('recoveryOrder');
 core.interrupt();expect(core.getRecoveredInputs().map(item=>item.text)).toEqual(['Legacy','Earlier','New']);
 expect(recoverQueuedInputs(journal).map(item=>item.text)).toEqual(['Legacy','Earlier','New']);
});
it('does not expose an already requeued recovery when its earlier cancelled write fails late',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queue-recovery-late-failure-'));roots.push(cwd);
 let entered!:()=>void,release!:()=>void,writes=0;const started=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.queued')&&++writes===1){entered();await held;throw Error('old write failed');}}};
 const core=new AgentCore({cwd,sessions,isWorkBlocked:()=>true});cores.push(core);
 const first=core.dispatchInput('Retry once');expect(await first.admitted).toBe('queued');await started;
 try{
  core.interrupt();const id=core.getRecoveredInputs()[0].id;expect(await core.retryRecoveredInput(id)).toBe('queued');expect(core.getRecoveredInputs()).toEqual([]);
  await first.completion;release();await vi.waitFor(()=>expect((core as any).journalFailure?.message).toContain('Session journal failed'));
  expect(core.getRecoveredInputs()).toEqual([]);
 }finally{release();}
});
it('does not let detached reload callbacks keep tool access after lifecycle completion',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'reload-scope-expiry-'));roots.push(cwd);
 const core=new AgentCore({cwd,isWorkBlocked:()=>true});cores.push(core);let later!:Promise<{ok:boolean;error?:string}>;
 await core.duringPluginReload(async()=>{later=new Promise(resolve=>setImmediate(async()=>resolve(await core.invokeTool('read',{path:'missing'}))));});
 expect(await later).toMatchObject({ok:false,error:expect.stringContaining('Plugin change in progress')});
});

it('does not start a queued prompt while its journal write is unconfirmed',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queued-journal-'));roots.push(cwd);
 let releaseWrite!:()=>void,enteredWrite!:()=>void;
 const held=new Promise<void>(resolve=>{releaseWrite=resolve;}),entered=new Promise<void>(resolve=>{enteredWrite=resolve;});
 const provider=new ScriptedProvider([{text:'First',hold:true},{text:'Second'}]);
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.queued')){enteredWrite();await held;}}};
 const core=new AgentCore({cwd,provider,sessions});cores.push(core);
 const first=core.submit('First prompt');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 const queued=core.dispatchInput('Second prompt');expect(await queued.admitted).toBe('queued');await entered;
 provider.release();await vi.waitFor(()=>expect(core.getState()).not.toBe('running'));
 await new Promise(resolve=>setTimeout(resolve,30));
 try{expect(provider.requests).toHaveLength(1);}finally{releaseWrite();}
 await queued.completion;await first;await vi.waitFor(()=>expect(provider.requests).toHaveLength(2));
});

it('cancels a queued prompt without waiting for its held journal write',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queued-journal-cancel-'));roots.push(cwd);
 let releaseWrite!:()=>void,enteredWrite!:()=>void;
 const held=new Promise<void>(resolve=>{releaseWrite=resolve;}),entered=new Promise<void>(resolve=>{enteredWrite=resolve;});
 const provider=new ScriptedProvider([{text:'First',hold:true},{text:'Should not run'}]);
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.queued')){enteredWrite();await held;}}};
 const core=new AgentCore({cwd,provider,sessions});cores.push(core);
 const first=core.submit('First');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 const queued=core.dispatchInput('Cancelled');await queued.admitted;await entered;provider.release();
 await vi.waitFor(()=>expect(core.getState()).toBe('idle'));core.interrupt();
 try {await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error('interruption blocked on journal')),500))]);
  expect(provider.requests).toHaveLength(1);expect(core.getRecoveredInputs().map(input=>input.text)).toEqual(['Cancelled']);
 }finally{releaseWrite();await queued.completion;}
});

it('does not run queued work when its journal write fails',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queued-journal-failed-'));roots.push(cwd);
 const provider=new ScriptedProvider([{text:'First',hold:true},{text:'Should not run'}]);
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.queued'))throw Error('disk unavailable');}};
 const core=new AgentCore({cwd,provider,sessions});cores.push(core);
 const first=core.submit('First');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 const queued=core.dispatchInput('Must not run');expect(await queued.admitted).toBe('queued');
 await expect(queued.completion).rejects.toThrow('Session journal failed');provider.release();await first;
 expect(provider.requests).toHaveLength(1);expect(core.failure).toContain('Session journal failed');
});

it('pauses an automatic follow-up without waiting for its held journal write',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'queued-agent-journal-'));roots.push(cwd);
 let releaseWrite!:()=>void,enteredWrite!:()=>void;
 const held=new Promise<void>(resolve=>{releaseWrite=resolve;}),entered=new Promise<void>(resolve=>{enteredWrite=resolve;});
 const provider=new ScriptedProvider([{text:'First',hold:true},{text:'Follow-up'}]);
 const sessions={create:async()=>{},append:async(_id:string,events:any[])=>{if(events.some(event=>event.type==='prompt.queued')){enteredWrite();await held;}}};
 const core=new AgentCore({cwd,provider,sessions,plugins:[{manifest:{name:'owner',version:'1.0.0',trust:'trusted'},hooks:{}}]});cores.push(core);
 const first=core.submit('First');await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));
 const queued=core.host.emit('service.agent.enqueue',{plugin:'owner',key:'wake',text:'Follow-up'});await entered;provider.release();
 await vi.waitFor(()=>expect(core.getState()).toBe('idle'));core.interrupt();
 try{await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error('interruption blocked on automatic wake')),500))]);
  expect(provider.requests).toHaveLength(1);
 }finally{releaseWrite();await queued;}
});
