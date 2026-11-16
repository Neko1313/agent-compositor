import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MainDraftStore} from '../src/main-drafts.js';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'main-drafts-'));roots.push(root);return{root,store:MainDraftStore.open(root)};}
it('keeps private drafts separate by session and serializes saving and clearing',async()=>{
 const {root,store}=await fixture();const first=store.save('session-a',{text:'private draft'}),second=store.save('session-b',{text:'other'});await Promise.all([first,second]);
 expect(await store.load('session-a',[])).toEqual({kind:'draft',text:'private draft'});
 expect(await store.load('session-b',[])).toEqual({kind:'draft',text:'other'});
 const reopened=MainDraftStore.open(root);expect(await reopened.load('session-a',[])).toEqual({kind:'draft',text:'private draft'});
 expect(await reopened.load('session-b',[])).toEqual({kind:'draft',text:'other'});
 const files=await readdir(join(root,'main-drafts-v2'));expect(files).toHaveLength(2);
 if(process.platform!=='win32')for(const file of files)expect((await stat(join(root,'main-drafts-v2',file))).mode&0o777).toBe(0o600);
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
 const file=join(root,'main-drafts-v2',(await readdir(join(root,'main-drafts-v2')))[0]);await writeFile(file,'{broken');
 await expect(store.load('session',[])).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('{broken');
 await expect(store.save('session',{text:'replacement'})).rejects.toThrow();
 await expect(store.clear('session')).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('{broken');
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

it('preserves concurrent writers and requires explicit resolution of the exact reviewed versions',async()=>{
 const {root}=await fixture(),a=MainDraftStore.open(root),b=MainDraftStore.open(root);
 await Promise.all([a.save('session',{text:'first'}),b.save('session',{text:'second'})]);
 const reader=MainDraftStore.open(root),conflict=await reader.load('session',[]);
 expect(conflict?.kind).toBe('conflict');if(conflict?.kind!=='conflict')throw Error('Expected conflict');
 expect(conflict.variants.map(value=>value.text).sort()).toEqual(['first','second']);
 await expect(reader.save('session',{text:'accidental overwrite'})).rejects.toThrow('Resolve conflicting');
 const ids=conflict.variants.map(value=>value.id);await a.save('session',{text:'first newer'});
 await expect(reader.resolve('session',ids,{text:'chosen'})).rejects.toThrow('changed; review again');
 const fresh=await reader.load('session',[]);if(fresh?.kind!=='conflict')throw Error('Expected conflict');
 expect(fresh.variants.map(value=>value.text).sort()).toEqual(['first newer','second']);
 await reader.resolve('session',fresh.variants.map(value=>value.id),{text:'chosen'});
 expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'chosen'});
 await b.save('session',{text:'second newer'});
 const later=await MainDraftStore.open(root).load('session',[]);if(later?.kind!=='conflict')throw Error('Expected later conflict');
 expect(later.variants.map(value=>value.text).sort()).toEqual(['chosen','second newer']);
});

it('retains a concurrent change to a version another instance had loaded',async()=>{
 const {root}=await fixture(),a=MainDraftStore.open(root),b=MainDraftStore.open(root);
 await a.save('session',{text:'base'});expect(await b.load('session',[])).toEqual({kind:'draft',text:'base'});
 await b.save('session',{text:'edit in B'});expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'edit in B'});
 await a.save('session',{text:'edit in A'});
 const result=await MainDraftStore.open(root).load('session',[]);if(result?.kind!=='conflict')throw Error('Expected conflict');
 expect(result.variants.map(value=>value.text).sort()).toEqual(['edit in A','edit in B']);
});

it('serializes an overlapping load and edit within one instance',async()=>{
 const {root}=await fixture(),initial=MainDraftStore.open(root);await initial.save('session',{text:'prior'});
 const store=MainDraftStore.open(root),loading=store.load('session',[]),saving=store.save('session',{text:'new'});
 expect(await loading).toEqual({kind:'draft',text:'prior'});await saving;
 expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'new'});
});

it('rejects a cyclic history without hiding or rewriting its files',async()=>{
 const {root}=await fixture(),a=MainDraftStore.open(root),b=MainDraftStore.open(root);
 await Promise.all([a.save('session',{text:'first'}),b.save('session',{text:'second'})]);
 const directory=join(root,'main-drafts-v2'),files=(await readdir(directory)).map(name=>join(directory,name));
 const records=await Promise.all(files.map(async file=>JSON.parse(await readFile(file,'utf8'))));
 records[0].parents=[`${records[1].owner}:${records[1].revision}`];records[1].parents=[`${records[0].owner}:${records[0].revision}`];
 await Promise.all(files.map((file,index)=>writeFile(file,JSON.stringify(records[index]))));
 const store=MainDraftStore.open(root);await expect(store.load('session',[])).rejects.toThrow('Cyclic Main draft history');
 await expect(store.save('session',{text:'replacement'})).rejects.toThrow('Cyclic Main draft history');
 expect(await Promise.all(files.map(file=>readFile(file,'utf8')))).toEqual(records.map(record=>JSON.stringify(record)));
});

it('retains drafts saved concurrently by separate processes',async()=>{
 const {root}=await fixture(),entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 const child=(text:string)=>new Promise<void>((done,fail)=>{
  const script=`import {MainDraftStore} from ${JSON.stringify(entry)}; await MainDraftStore.open(${JSON.stringify(root)}).save('session',{text:${JSON.stringify(text)}});`;
  const process=spawn(processExec,['--import','tsx','--input-type=module','-e',script],{cwd:processCwd,stdio:['ignore','ignore','pipe']});let error='';
  process.stderr.on('data',chunk=>{error+=chunk;});process.once('error',fail);process.once('exit',(code,signal)=>code===0?done():fail(Error(`Child failed ${code}/${signal}: ${error}`)));
 });
 const processExec=process.execPath,processCwd=process.cwd();await Promise.all([child('process A'),child('process B')]);
 const result=await MainDraftStore.open(root).load('session',[]);if(result?.kind!=='conflict')throw Error('Expected process conflict');
 expect(result.variants.map(value=>value.text).sort()).toEqual(['process A','process B']);
});

it('recovers a saved draft after the writer process is killed',async()=>{
 const {root}=await fixture(),entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 const script=`import {MainDraftStore} from ${JSON.stringify(entry)}; await MainDraftStore.open(${JSON.stringify(root)}).save('session',{text:'survives kill'}); console.log('SAVED'); setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>done({code,signal}));});
 try{
  await new Promise<void>((done,fail)=>{let output='';const timer=setTimeout(()=>fail(Error('Draft writer did not start')),10000);child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('SAVED')){clearTimeout(timer);done();}});void exited.then(result=>{clearTimeout(timer);fail(Error(`Draft writer exited early: ${JSON.stringify(result)} ${stderr}`));});});
  expect(child.kill('SIGKILL')).toBe(true);expect((await exited).signal).toBe('SIGKILL');
  const store=MainDraftStore.open(root);expect(await store.load('session',[])).toEqual({kind:'draft',text:'survives kill'});
  await store.save('session',{text:'continued after restart'});
  expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'continued after restart'});
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited.catch(()=>{});}}
},15000);
