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
 const files=await readdir(join(root,'main-drafts-v3'));expect(files).toHaveLength(2);
 if(process.platform!=='win32')for(const file of files)expect((await stat(join(root,'main-drafts-v3',file))).mode&0o777).toBe(0o600);
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
 const file=join(root,'main-drafts-v3',(await readdir(join(root,'main-drafts-v3')))[0]);await writeFile(file,'{broken');
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
 const directory=join(root,'main-drafts-v3'),files=(await readdir(directory)).map(name=>join(directory,name));
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

it('compacts superseded private versions without deleting an active writer’s later edit',async()=>{
 const {root}=await fixture(),a=MainDraftStore.open(root),b=MainDraftStore.open(root),directory=join(root,'main-drafts-v3');
 await a.save('session',{text:'old private text'});await a.save('session',{text:'base'});
 expect(await b.load('session',[])).toEqual({kind:'draft',text:'base'});await b.save('session',{text:'edited in B'});
 await b.compact('session');
 const files=await readdir(directory);expect(files).toHaveLength(1);
 expect(await readFile(join(directory,files[0]),'utf8')).not.toContain('old private text');
 await a.save('session',{text:'later edit in A'});
 const result=await MainDraftStore.open(root).load('session',[]);if(result?.kind!=='conflict')throw Error('Expected conflict');
 expect(result.variants.map(value=>value.text).sort()).toEqual(['edited in B','later edit in A']);
 await b.compact('session');expect((await readdir(directory))).toHaveLength(2);
});

it('keeps the clearing version while removing earlier private text',async()=>{
 const {root,store}=await fixture(),directory=join(root,'main-drafts-v3');
 await store.save('session',{text:'removed private text'});await store.clear('session');await store.compact('session');
 const files=await readdir(directory);expect(files).toHaveLength(1);
 expect(await readFile(join(directory,files[0]),'utf8')).not.toContain('removed private text');
 expect(await MainDraftStore.open(root).load('session',[])).toBeUndefined();
});

it('refuses compaction if any saved version is malformed',async()=>{
 const {root,store}=await fixture(),directory=join(root,'main-drafts-v3');
 await store.save('session',{text:'older'});await store.save('session',{text:'newer'});
 const files=(await readdir(directory)).sort();await writeFile(join(directory,files[0]),'{broken');
 await expect(store.compact('session')).rejects.toThrow();expect(await readdir(directory)).toHaveLength(2);
});

it('reads legacy drafts, retains them through compaction, and detects a later legacy edit',async()=>{
 const {root}=await fixture(),original=MainDraftStore.open(root);
 await original.save('session',{text:'legacy content'});
 const {mkdir,rename}=await import('node:fs/promises'),v3=join(root,'main-drafts-v3'),v2=join(root,'main-drafts-v2');
 await mkdir(v2);const name=(await readdir(v3))[0],legacy=join(v2,name.replace(/\.1\.json$/,'.json'));
 await rename(join(v3,name),legacy);const originalRecord=JSON.parse(await readFile(legacy,'utf8'));
 const a=MainDraftStore.open(root);expect(await a.load('session',[])).toEqual({kind:'draft',text:'legacy content'});
 await a.save('session',{text:'first edit'});
 const b=MainDraftStore.open(root);expect(await b.load('session',[])).toEqual({kind:'draft',text:'first edit'});
 await b.save('session',{text:'second edit'});await b.compact('session');
 expect(await readFile(legacy,'utf8')).toBe(JSON.stringify(originalRecord));
 expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'second edit'});
 await writeFile(legacy,JSON.stringify({...originalRecord,revision:2,text:'later legacy edit'}));
 const result=await MainDraftStore.open(root).load('session',[]);if(result?.kind!=='conflict')throw Error('Expected legacy conflict');
 expect(result.variants.map(value=>value.text).sort()).toEqual(['later legacy edit','second edit']);
});

it('does not mask a malformed legacy draft',async()=>{
 const {root}=await fixture(),original=MainDraftStore.open(root);await original.save('session',{text:'legacy'});
 const {mkdir,rename}=await import('node:fs/promises'),v3=join(root,'main-drafts-v3'),v2=join(root,'main-drafts-v2');
 await mkdir(v2);const name=(await readdir(v3))[0],legacy=join(v2,name.replace(/\.1\.json$/,'.json'));
 await rename(join(v3,name),legacy);await writeFile(legacy,'{broken');
 const store=MainDraftStore.open(root);await expect(store.load('session',[])).rejects.toThrow();
 await expect(store.save('session',{text:'replacement'})).rejects.toThrow();expect(await readFile(legacy,'utf8')).toBe('{broken');
});

it('retains both concurrent writers through repeated compaction',async()=>{
 const {root}=await fixture(),a=MainDraftStore.open(root),b=MainDraftStore.open(root),cleaner=MainDraftStore.open(root);
 await Promise.all([a.save('session',{text:'A0'}),b.save('session',{text:'B0'})]);
 await Promise.all([
  (async()=>{for(let i=1;i<=30;i++)await a.save('session',{text:'A'+i});})(),
  (async()=>{for(let i=1;i<=30;i++)await b.save('session',{text:'B'+i});})(),
  (async()=>{for(let i=0;i<30;i++)await cleaner.compact('session');})(),
 ]);
 await cleaner.compact('session');const recovered=await MainDraftStore.open(root).load('session',[]);
 if(recovered?.kind!=='conflict')throw Error('Expected both concurrent drafts');
 expect(recovered.variants.map(value=>value.text).sort()).toEqual(['A30','B30']);
});

it('preserves a live process writer while another process compacts',async()=>{
 const {root}=await fixture(),writer=MainDraftStore.open(root),other=MainDraftStore.open(root);
 await writer.save('session',{text:'base'});await other.load('session',[]);await other.save('session',{text:'other'});
 const entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 const script=`import {MainDraftStore} from ${JSON.stringify(entry)}; const store=MainDraftStore.open(${JSON.stringify(root)}); for(let i=0;i<40;i++) await store.compact('session');`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 const exit=new Promise<void>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>code===0?done():fail(Error(`Compactor failed ${code}/${signal}: ${stderr}`)));});
 await Promise.all([(async()=>{for(let i=1;i<=40;i++)await writer.save('session',{text:'writer '+i});})(),exit]);
 const recovery=await MainDraftStore.open(root).load('session',[]);
 if(recovery?.kind!=='conflict')throw Error('Expected concurrent versions');
 expect(recovery.variants.map(value=>value.text).sort()).toEqual(['other','writer 40']);
},15000);

it.each([1,2])('keeps recovery and future edits after compactor dies at deletion %i',async stopAfter=>{
 const {root}=await fixture(),a=MainDraftStore.open(root),b=MainDraftStore.open(root);
 await a.save('session',{text:'older private'});await a.save('session',{text:'base'});
 await b.load('session',[]);await b.save('session',{text:'current'});
 const entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 // Intercept only removal in the child, after the actual unlink, to kill at a
 // reproducible intermediate point without changing production code.
 const script=`import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
 const remove=fs.rm; let count=0; fs.rm=async (...args)=>{await remove(...args); if(++count===${stopAfter}){console.log('DELETED'); await new Promise(()=>{});}};
 syncBuiltinESMExports(); const {MainDraftStore}=await import(${JSON.stringify(entry)});
 await MainDraftStore.open(${JSON.stringify(root)}).compact('session');`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>done({code,signal}));});
 try{
  await new Promise<void>((done,fail)=>{let output='';const timer=setTimeout(()=>fail(Error('Compactor did not reach deletion')),10000);
   child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('DELETED')){clearTimeout(timer);done();}});
   void exited.then(result=>{clearTimeout(timer);fail(Error(`Compactor exited early: ${JSON.stringify(result)} ${stderr}`));});});
  expect(child.kill('SIGKILL')).toBe(true);expect((await exited).signal).toBe('SIGKILL');
  expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'current'});
  await a.save('session',{text:'later from active writer'});
  const recovery=await MainDraftStore.open(root).load('session',[]);
  if(recovery?.kind!=='conflict')throw Error('Expected concurrent versions');
  expect(recovery.variants.map(value=>value.text).sort()).toEqual(['current','later from active writer']);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited.catch(()=>{});}}
},15000);

it.each(['before','after'] as const)('recovers the correct version when a writer dies %s atomic publication',async point=>{
 const {root}=await fixture(),initial=MainDraftStore.open(root);await initial.save('session',{text:'before edit'});
 const entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 const script=`import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
 const move=fs.rename; fs.rename=async (...args)=>{if(${JSON.stringify(point)}==='after')await move(...args); console.log('BOUNDARY'); await new Promise(()=>setInterval(()=>{},1000));};
 syncBuiltinESMExports(); const {MainDraftStore}=await import(${JSON.stringify(entry)});
 const store=MainDraftStore.open(${JSON.stringify(root)}); await store.load('session',[]); await store.save('session',{text:'after edit'});`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>done({code,signal}));});
 try{
  await new Promise<void>((done,fail)=>{let output='';const timer=setTimeout(()=>fail(Error('Writer did not reach publication boundary')),10000);
   child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('BOUNDARY')){clearTimeout(timer);done();}});
   void exited.then(result=>{clearTimeout(timer);fail(Error(`Writer exited early: ${JSON.stringify(result)} ${stderr}`));});});
  expect(child.kill('SIGKILL')).toBe(true);expect((await exited).signal).toBe('SIGKILL');
  expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:point==='before'?'before edit':'after edit'});
  const temporary=(await readdir(join(root,'main-drafts-v3'))).filter(name=>name.endsWith('.tmp'));
  expect(temporary).toHaveLength(point==='before'?1:0);
  if(point==='before')expect(await readFile(join(root,'main-drafts-v3',temporary[0]),'utf8')).toContain('after edit');
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited.catch(()=>{});}}
},15000);

it.skipIf(process.platform!=='linux')('removes only temporary drafts owned by a dead process in the same PID domain',async()=>{
 const {root}=await fixture(),directory=join(root,'main-drafts-v3'),entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 const script=`import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
 fs.rename=async ()=>{console.log('WRITTEN'); await new Promise(()=>setInterval(()=>{},1000));}; syncBuiltinESMExports();
 const {MainDraftStore}=await import(${JSON.stringify(entry)}); await MainDraftStore.open(${JSON.stringify(root)}).save('session',{text:'private in flight'});`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>done({code,signal}));});
 try{
  await new Promise<void>((done,fail)=>{let output='';const timer=setTimeout(()=>fail(Error('Writer did not reach rename')),10000);
   child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('WRITTEN')){clearTimeout(timer);done();}});
   void exited.then(result=>{clearTimeout(timer);fail(Error(`Writer exited early: ${JSON.stringify(result)} ${stderr}`));});});
  const temporary=(await readdir(directory)).find(name=>name.endsWith('.tmp'))!;expect(temporary).toBeTruthy();
  // Old and foreign-domain files cannot be attributed safely and remain intact.
  const legacy=temporary.replace(/\.\d+\.[0-9a-f-]+\.\d+\./,'.unknown.');
  const foreign=temporary.replace(/(\.json\.\d+\.)[0-9a-f-]+\./,'$100000000-0000-0000-0000-000000000000.');
  expect(legacy).not.toBe(temporary);expect(foreign).not.toBe(temporary);
  await writeFile(join(directory,legacy),'legacy');await writeFile(join(directory,foreign),'foreign');
  const cleaner=MainDraftStore.open(root);await cleaner.compact('session');
  expect(await readFile(join(directory,temporary),'utf8')).toContain('private in flight');
  expect(child.kill('SIGKILL')).toBe(true);expect((await exited).signal).toBe('SIGKILL');
  await cleaner.compact('session');const remaining=await readdir(directory);
  expect(remaining).not.toContain(temporary);expect(remaining).toContain(legacy);expect(remaining).toContain(foreign);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited.catch(()=>{});}}
},15000);

it('preserves a legacy writer that changes its draft after a new process compacts',async()=>{
 const {root}=await fixture(),seed=MainDraftStore.open(root);await seed.save('session',{text:'legacy initial'});
 const {mkdir,rename}=await import('node:fs/promises'),v3=join(root,'main-drafts-v3'),v2=join(root,'main-drafts-v2');
 await mkdir(v2);const name=(await readdir(v3))[0],legacy=join(v2,name.replace(/\.1\.json$/,'.json'));await rename(join(v3,name),legacy);
 const script=`import {readFile,writeFile,rename} from 'node:fs/promises'; const file=${JSON.stringify(legacy)},record=JSON.parse(await readFile(file,'utf8'));
 console.log('READY'); process.stdin.once('data',async()=>{await writeFile(file+'.tmp',JSON.stringify({...record,revision:2,text:'legacy later'}));await rename(file+'.tmp',file);console.log('SAVED');});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
 let output='',stderr='';child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 const exited=new Promise<void>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>code===0?done():fail(Error(`Legacy writer failed ${code}/${signal}: ${stderr}`)));});
 try{
  await expect.poll(()=>output).toContain('READY');
  const writer=MainDraftStore.open(root);expect(await writer.load('session',[])).toEqual({kind:'draft',text:'legacy initial'});
  await writer.save('session',{text:'modern'});await writer.compact('session');child.stdin.end('continue\n');await exited;
  const result=await MainDraftStore.open(root).load('session',[]);if(result?.kind!=='conflict')throw Error('Expected legacy conflict');
  expect(result.variants.map(value=>value.text).sort()).toEqual(['legacy later','modern']);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited.catch(()=>{});}}
},15000);

it('does not resurrect a retained legacy ancestor when older records lack direct ancestry',async()=>{
 const {root}=await fixture(),seed=MainDraftStore.open(root);await seed.save('session',{text:'legacy'});
 const {mkdir,rename}=await import('node:fs/promises'),v3=join(root,'main-drafts-v3'),v2=join(root,'main-drafts-v2');
 await mkdir(v2);const name=(await readdir(v3))[0];await rename(join(v3,name),join(v2,name.replace(/\.1\.json$/,'.json')));
 const bridge=MainDraftStore.open(root);await bridge.load('session',[]);await bridge.save('session',{text:'bridge'});
 const bridgeFile=join(v3,(await readdir(v3))[0]),bridgeRecord=JSON.parse(await readFile(bridgeFile,'utf8'));
 const newer=MainDraftStore.open(root);await newer.load('session',[]);await newer.save('session',{text:'current'});
 const leafFile=join(v3,(await readdir(v3)).find(value=>join(v3,value)!==bridgeFile)!);
 const leaf=JSON.parse(await readFile(leafFile,'utf8'));leaf.parents=[`${bridgeRecord.owner}:${bridgeRecord.revision}`];await writeFile(leafFile,JSON.stringify(leaf));
 const reader=MainDraftStore.open(root);expect(await reader.load('session',[])).toEqual({kind:'draft',text:'current'});
 await reader.compact('session');expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'current'});
 // A subsequent edit records the legacy head directly and permits compaction.
 await reader.save('session',{text:'continued'});await reader.compact('session');
 expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'continued'});
 expect(await readdir(v3)).toHaveLength(1);
});

it('automatically bounds ordinary draft versions while preserving concurrent edits',async()=>{
 const {root}=await fixture(),writer=MainDraftStore.open(root),other=MainDraftStore.open(root),directory=join(root,'main-drafts-v3');
 await writer.save('session',{text:'initial private'});await other.load('session',[]);await other.save('session',{text:'other writer'});
 for(let i=0;i<150;i++)await writer.save('session',{text:`typed ${i}`});
 const files=await readdir(directory);expect(files.filter(file=>file.endsWith('.json')).length).toBeLessThanOrEqual(64);
 const result=await MainDraftStore.open(root).load('session',[]);if(result?.kind!=='conflict')throw Error('Expected concurrent drafts');
 expect(result.variants.map(value=>value.text).sort()).toEqual(['other writer','typed 149']);
 expect((await Promise.all(files.map(file=>readFile(join(directory,file),'utf8')))).join('')).not.toContain('initial private');
});

it('does not publish a new draft when automatic cleanup fails',async()=>{
 const {root,store}=await fixture();for(let i=0;i<64;i++)await store.save('session',{text:`previous ${i}`});
 const entry=pathToFileURL(resolve('packages/app/src/main-drafts.ts')).href;
 const script=`import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
 const remove=fs.rm;fs.rm=async (path,...args)=>{if(String(path).endsWith('.json'))throw Object.assign(Error('cleanup denied'),{code:'EACCES'});return remove(path,...args);};
 syncBuiltinESMExports();const {MainDraftStore}=await import(${JSON.stringify(entry)});const store=MainDraftStore.open(${JSON.stringify(root)});
 await store.load('session',[]);try{await store.save('session',{text:'must not publish'});process.exitCode=1;}catch(error){if(error.message!=='cleanup denied')throw error;}`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 await new Promise<void>((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>code===0?done():fail(Error(`Cleanup test failed ${code}/${signal}: ${stderr}`)));});
 expect(await MainDraftStore.open(root).load('session',[])).toEqual({kind:'draft',text:'previous 63'});
});
