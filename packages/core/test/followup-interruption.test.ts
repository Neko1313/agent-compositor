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
