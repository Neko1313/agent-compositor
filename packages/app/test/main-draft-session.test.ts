import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {MainDraftStore} from '../src/main-drafts.js';
import {MainDraftSession} from '../src/main-draft-session.js';

const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const dispose of cleanup.splice(0).reverse())await dispose();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'draft-session-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const journal:any[]=[],provider=new ScriptedProvider([]),store=MainDraftStore.open(root);
 const core=new AgentCore({cwd:root,provider,isWorkBlocked:()=>true,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});
 cleanup.push(async()=>{core.interrupt();await core.close();});
 const session=MainDraftSession.open(store,core,()=>!core.isClosed,()=>{});await session.load(journal);
 return{root,journal,provider,store,core,session};
}
it('saves edits and correlates accepted input before clearing its draft',async()=>{
 const f=await fixture();expect(await f.session.change('private',f.session.snapshot().revision)).toBe(true);
 const result=await f.session.submit('private','submit',f.session.snapshot().revision);expect(result.admission).toBe('queued');await result.completion;
 expect(f.session.snapshot()).toMatchObject({status:'draft',text:''});
 expect(f.journal.some(event=>event.type==='prompt.queue.intent'&&event.text==='private'&&event.recoveryId)).toBe(true);
 expect(await MainDraftStore.open(f.root).load(f.core.sessionId,f.journal)).toBeUndefined();expect(f.provider.requests).toEqual([]);
});
it('does not turn a clearing failure into a second submission',async()=>{
 const f=await fixture();await f.session.change('review me',f.session.snapshot().revision);
 f.store.clear=async()=>{throw Error('disk unavailable');};
 const result=await f.session.submit('review me','submit',f.session.snapshot().revision);expect(result.admission).toBe('queued');await result.completion;
 expect(f.session.snapshot()).toMatchObject({status:'review',text:'review me'});
 expect(await f.session.submit('review me','submit',f.session.snapshot().revision)).toEqual({admission:false});
 expect(await MainDraftStore.open(f.root).load(f.core.sessionId,f.journal)).toEqual({kind:'journal',text:'review me'});
 expect(f.journal.filter(event=>event.type==='prompt.queue.intent')).toHaveLength(1);
});
it('requires explicit review and never submits on recovery',async()=>{
 const f=await fixture(),id='a1234567-1234-4123-8123-123456789abc';
 await f.store.save(f.core.sessionId,{text:'ambiguous',intentId:id});
 const session=MainDraftSession.open(MainDraftStore.open(f.root),f.core,()=>true,()=>{});await session.load([]);
 expect(session.snapshot()).toMatchObject({status:'review',text:'ambiguous'});
 expect(await session.submit('ambiguous','submit',session.snapshot().revision)).toEqual({admission:false});
 expect(await session.review(session.snapshot().revision)).toBe(true);
 expect(session.snapshot()).toMatchObject({status:'draft',text:'ambiguous'});expect(f.provider.requests).toEqual([]);expect(f.journal).toEqual([]);
});
it('fences stale revisions and independently conflicting versions',async()=>{
 const f=await fixture();expect(await f.session.change('first',0)).toBe(false);
 const other=MainDraftStore.open(f.root);await Promise.all([f.session.change('mine',f.session.snapshot().revision),other.save(f.core.sessionId,{text:'theirs'})]);
 const reader=MainDraftSession.open(MainDraftStore.open(f.root),f.core,()=>true,()=>{});await reader.load([]);
 const state=reader.snapshot();if(state.status!=='conflict')throw Error('Expected conflict');
 expect(await reader.change('overwrite',state.revision)).toBe(false);
 expect(await reader.resolve(state.variants.map(value=>value.id),'chosen',state.revision)).toBe(true);
 expect(reader.snapshot()).toMatchObject({status:'draft',text:'chosen'});expect(f.provider.requests).toEqual([]);
});
it('does not start a prepared input after its session is replaced',async()=>{
 const f=await fixture();await f.session.change('keep',f.session.snapshot().revision);
 const original=f.store.save.bind(f.store);let entered!:()=>void,release!:()=>void;
 const writing=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 f.store.save=async(id,draft)=>{await original(id,draft);if(draft.intentId){entered();await gate;}};
 const submission=f.session.submit('keep','submit',f.session.snapshot().revision);await writing;f.session.close();release();
 expect(await submission).toEqual({admission:false});expect(f.journal).toEqual([]);expect(f.provider.requests).toEqual([]);
 expect(await MainDraftStore.open(f.root).load(f.core.sessionId,[])).toEqual({kind:'review',text:'keep'});
});

it('rejects overlapping edits without discarding the acknowledged version',async()=>{
 const f=await fixture(),revision=f.session.snapshot().revision,save=f.store.save.bind(f.store);
 let entered!:()=>void,release!:()=>void;const writing=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 f.store.save=async(id,draft)=>{entered();await gate;await save(id,draft);};
 const first=f.session.change('first',revision);await writing;
 expect(await f.session.change('second',revision)).toBe(false);release();expect(await first).toBe(true);
 expect(f.session.snapshot()).toMatchObject({status:'draft',text:'first'});
 expect(await f.session.change('second',f.session.snapshot().revision)).toBe(true);
 expect(await MainDraftStore.open(f.root).load(f.core.sessionId,[])).toEqual({kind:'draft',text:'second'});
});

it('refreshes a conflict when another process edits during review',async()=>{
 const f=await fixture(),a=MainDraftStore.open(f.root),b=MainDraftStore.open(f.root);
 await Promise.all([a.save(f.core.sessionId,{text:'A'}),b.save(f.core.sessionId,{text:'B'})]);
 const reader=MainDraftSession.open(MainDraftStore.open(f.root),f.core,()=>true,()=>{});await reader.load([]);
 const before=reader.snapshot();if(before.status!=='conflict')throw Error('Expected conflict');
 await a.save(f.core.sessionId,{text:'A later'});
 expect(await reader.resolve(before.variants.map(value=>value.id),'choice',before.revision)).toBe(false);
 expect(await reader.refreshConflict([])).toBe(true);const current=reader.snapshot();
 if(current.status!=='conflict')throw Error('Expected updated conflict');
 expect(current.variants.map(value=>value.text).sort()).toEqual(['A later','B']);
 expect(await reader.resolve(current.variants.map(value=>value.id),'choice',current.revision)).toBe(true);
});

it('retains an ambiguous marker when interruption races with a late journal write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-session-late-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const journal:any[]=[],provider=new ScriptedProvider([]);let entered!:()=>void,release!:()=>void;
 const writing=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const core=new AgentCore({cwd:root,provider,isWorkBlocked:()=>true,sessions:{create:async()=>{},append:async(_id,events)=>{
  if(events.some(event=>event.type==='prompt.queue.intent')){entered();await gate;}journal.push(...events);
 }}});cleanup.push(async()=>{release();core.interrupt();await core.close();});
 const store=MainDraftStore.open(root),session=MainDraftSession.open(store,core,()=>true,()=>{});await session.load([]);
 await session.change('late journal',session.snapshot().revision);
 const pending=session.submit('late journal','submit',session.snapshot().revision);await writing;core.interrupt();
 const result=await pending;expect(result.admission).toBe(false);expect(session.snapshot()).toMatchObject({status:'review',text:'late journal'});
 expect(await session.submit('late journal','submit',session.snapshot().revision)).toEqual({admission:false});
 release();await result.completion;await expect.poll(()=>journal.some(event=>event.type==='prompt.queue.intent')).toBe(true);
 expect(await MainDraftStore.open(root).load(core.sessionId,journal)).toEqual({kind:'journal',text:'late journal'});expect(provider.requests).toEqual([]);
});

it('can retry loading after a transient storage failure',async()=>{
 const f=await fixture(),store=MainDraftStore.open(f.root),read=store.load.bind(store);let attempts=0;
 store.load=async(...args)=>{if(!attempts++)throw Error('temporary read failure');return read(...args);};
 const session=MainDraftSession.open(store,f.core,()=>true,()=>{});await session.load([]);
 expect(session.snapshot().status).toBe('error');await session.load([]);
 expect(session.snapshot()).toMatchObject({status:'draft',text:''});
});

it('retains an ambiguous host command if cleanup fails after its effect',async()=>{
 const f=await fixture();await f.session.change('/example',f.session.snapshot().revision);let calls=0;
 f.store.clear=async()=>{throw Error('cleanup denied');};
 expect(await f.session.command('/example',f.session.snapshot().revision,async()=>{calls++;return 'command';})).toBe('command');
 expect(f.session.snapshot()).toMatchObject({status:'review',text:'/example'});
 expect(await f.session.command('/example',f.session.snapshot().revision,async()=>{calls++;return 'command';})).toBe(false);
 expect(calls).toBe(1);expect(await MainDraftStore.open(f.root).load(f.core.sessionId,[])).toEqual({kind:'review',text:'/example'});
});

it('keeps an explicitly rejected host command editable',async()=>{
 const f=await fixture();await f.session.change('/invalid arguments',f.session.snapshot().revision);
 expect(await f.session.command('/invalid arguments',f.session.snapshot().revision,async()=>false)).toBe(false);
 expect(f.session.snapshot()).toMatchObject({status:'draft',text:'/invalid arguments'});
 expect(await MainDraftStore.open(f.root).load(f.core.sessionId,[])).toEqual({kind:'draft',text:'/invalid arguments'});
});
