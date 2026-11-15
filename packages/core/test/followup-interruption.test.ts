import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';
const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'followup-interrupt-'));roots.push(cwd);
 const provider=new ScriptedProvider([{text:'User resumed'},{text:'Follow-up reviewed'}]);let starts=0;
 const core=new AgentCore({cwd,provider,plugins:[{manifest:{name:'owner',version:'1.0.0',trust:'trusted'},hooks:{'session.start':()=>{starts++;}}}]});cores.push(core);await core.start();
 const enqueue=(key:string,text=key)=>core.host.emit('service.agent.enqueue',{plugin:'owner',key,text});return{core,provider,enqueue,starts:()=>starts};
}
it('pauses a queued automatic wake before its idle timer starts a model',async()=>{
 const f=await fixture();expect(await f.enqueue('wake','Accepted automatic work')).toMatchObject({value:{value:{queued:true}}});
 f.core.interrupt();expect(f.core.getState()).toBe('interrupted');
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
  expect(provider.requests).toHaveLength(1);
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
