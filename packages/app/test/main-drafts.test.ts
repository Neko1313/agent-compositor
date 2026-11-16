import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MainDraftStore} from '../src/main-drafts.js';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'main-drafts-'));roots.push(root);return{root,store:MainDraftStore.open(root)};}
it('keeps private drafts separate by session and serializes saving and clearing',async()=>{
 const {root,store}=await fixture();const first=store.save('session-a',{text:'private draft'}),second=store.save('session-b',{text:'other'});await Promise.all([first,second]);
 expect(await store.load('session-a',[])).toEqual({kind:'draft',text:'private draft'});
 expect(await store.load('session-b',[])).toEqual({kind:'draft',text:'other'});
 const reopened=MainDraftStore.open(root);expect(await reopened.load('session-a',[])).toEqual({kind:'draft',text:'private draft'});
 expect(await reopened.load('session-b',[])).toEqual({kind:'draft',text:'other'});
 const files=await readdir(join(root,'main-drafts'));expect(files).toHaveLength(2);
 if(process.platform!=='win32')for(const file of files)expect((await stat(join(root,'main-drafts',file))).mode&0o777).toBe(0o600);
 const clear=store.clear('session-a'),newer=store.save('session-a',{text:'new draft'});await Promise.all([clear,newer]);
 expect(await store.load('session-a',[])).toEqual({kind:'draft',text:'new draft'});
});
it('distinguishes an unstarted input from an input correlated with an actual journal intent',async()=>{
 const {store}=await fixture(),id='a1234567-1234-4123-8123-123456789abc';await store.save('session',{text:'same',intentId:id});
 expect(await store.load('session',[])).toEqual({kind:'review',text:'same'});
 expect(await store.load('session',[{type:'unrelated',recoveryId:id}])).toEqual({kind:'review',text:'same'});
 expect(await store.load('session',[{type:'prompt.queue.intent',recoveryId:id,text:'different'}])).toEqual({kind:'review',text:'same'});
 expect(await store.load('session',[{type:'prompt.queue.intent',recoveryId:id,text:'same'}])).toEqual({kind:'journal',text:'same'});
 expect(await store.load('session',[{type:'prompt.input.intent',recoveryId:'b1234567-1234-4123-8123-123456789abc'}])).toEqual({kind:'review',text:'same'});
});
it('reports malformed data without modifying it',async()=>{
 const {root,store}=await fixture();await store.save('session',{text:'before'});
 const file=join(root,'main-drafts',(await readdir(join(root,'main-drafts')))[0]);await writeFile(file,'{broken');
 await expect(store.load('session',[])).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('{broken');
 await expect(store.save('session',{text:'replacement'})).rejects.toThrow('Cannot overwrite');
 await expect(store.clear('session')).rejects.toThrow('Cannot remove');expect(await readFile(file,'utf8')).toBe('{broken');
 const restarted=MainDraftStore.open(root);await expect(restarted.save('session',{text:'replacement'})).rejects.toThrow();
 expect(await readFile(file,'utf8')).toBe('{broken');
});

it('rejects oversized drafts without changing the previously saved text',async()=>{
 const {store}=await fixture();await store.save('session',{text:'keep me'});
 await expect(store.save('session',{text:'x'.repeat(64001)})).rejects.toThrow('64000');
 expect(await store.load('session',[])).toEqual({kind:'draft',text:'keep me'});
});

it('correlates a saved submission with its exact core intent without sending on recovery',async()=>{
 const {root,store}=await fixture(),journal:any[]=[],provider=new ScriptedProvider([]);
 const core=new AgentCore({cwd:root,provider,isWorkBlocked:()=>true,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}}});
 try{
  const prepared=core.prepareInput('same message');await store.save(core.sessionId,{text:'same message',intentId:prepared.id});
  expect(await store.load(core.sessionId,journal)).toEqual({kind:'review',text:'same message'});
  const receipt=prepared.start();expect(await receipt.admitted).toBe('queued');await receipt.completion;
  expect(await store.load(core.sessionId,journal)).toEqual({kind:'journal',text:'same message'});
  core.interrupt();expect(core.getRecoveredInputs()).toEqual([{id:prepared.id,text:'same message'}]);
  const resumed=AgentCore.resume({cwd:root,provider:new ScriptedProvider([])},structuredClone(journal));
  try{expect(resumed.getRecoveredInputs()).toEqual([{id:prepared.id,text:'same message'}]);expect(provider.requests).toHaveLength(0);}
  finally{await resumed.close();}
 }finally{await core.close();}
});
