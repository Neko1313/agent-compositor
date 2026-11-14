import {afterEach,expect,it} from 'vitest';
import {Runtime} from '../src/index.js';
import type {HookContext} from '../src/index.js';

const releases:(()=>void)[]=[];
afterEach(()=>{for(const release of releases.splice(0))release();});
function gate(){let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});releases.push(release);return{promise,release};}
async function drain(iterator:AsyncGenerator<unknown,unknown>){while(true){const row=await iterator.next();if(row.done)return row.value;}}
async function bounded(work:Promise<unknown>){let timer:ReturnType<typeof setTimeout>;return Promise.race([work,new Promise(done=>{timer=setTimeout(()=>done('still pending'),300);})]).finally(()=>clearTimeout(timer));}
const manifest={name:'abort-owner',version:'1.0.0',trust:'trusted' as const};

it('rejects an already-aborted emission before any hook or resolver',async()=>{
  const runtime=new Runtime(),abort=new AbortController(),reason=Error('Caller stopped');let hooks=0,effects=0;
  runtime.register(manifest,{'ui.press':()=>{hooks++;}});runtime.setResolver('ui.press',()=>{effects++;});abort.abort(reason);
  const value=await drain(runtime.emit('ui.press',{site:'unit',key:'start'},abort.signal)).catch(error=>error);
  expect(value).toBe(reason);expect(hooks).toBe(0);expect(effects).toBe(0);
});

it('cancels an ignored hook promise, revokes its continuation and preserves a concurrent emission',async()=>{
  const runtime=new Runtime(),a=gate(),b=gate(),abort=new AbortController(),reason=Error('Cancel only A');
  const contexts=new Map<string,HookContext>(),effects:string[]=[];
  runtime.register(manifest,{'ui.press':async(event,context)=>{contexts.set(event.key,context);await(event.key==='A'?a:b).promise;return context.next();}});
  runtime.setResolver('ui.press',event=>{effects.push(event.key);return event.key;});
  const first=drain(runtime.emit('ui.press',{site:'unit',key:'A'},abort.signal)).catch(error=>error);
  let otherDone=false;const other=drain(runtime.emit('ui.press',{site:'unit',key:'B'})).then(value=>{otherDone=true;return value;});
  await expect.poll(()=>contexts.size).toBe(2);abort.abort(reason);
  expect(await bounded(first)).toBe(reason);expect(contexts.get('A')!.signal.reason).toBe(reason);expect(otherDone).toBe(false);
  await expect(Promise.resolve(contexts.get('A')!.next())).rejects.toBe(reason);
  a.release();b.release();expect(await other).toMatchObject({value:'B',faults:[]});expect(effects).toEqual(['B']);
});

it('unregisters a pending hook without waiting its budget or replaying a replacement provider',async()=>{
  const runtime=new Runtime(),pause=gate();let context!:HookContext,effects=0;
  runtime.register(manifest,{'ui.press':async(_event,current)=>{context=current;await pause.promise;return current.next();}});
  runtime.setResolver('ui.press',()=>{effects++;});
  const pending=drain(runtime.emit('ui.press',{site:'unit',key:'hold'})).catch(error=>error);
  await expect.poll(()=>context).toBeDefined();runtime.unregister(manifest.name);
  const value=await bounded(pending);expect(value).toBeInstanceOf(Error);expect(context.signal.aborted).toBe(true);
  runtime.register(manifest,{'ui.press':()=>{effects+=10;}});pause.release();
  await expect(Promise.resolve(context.next())).rejects.toBe(value);expect(effects).toBe(0);
});

it('stops waiting an ignored resolver promise and retains the exact caller reason',async()=>{
  const runtime=new Runtime(),pause=gate(),abort=new AbortController(),reason={cancel:'opaque caller reason'};let started=0;
  runtime.setResolver('ui.press',async()=>{started++;await pause.promise;return 'late result';});
  const pending=drain(runtime.emit('ui.press',{site:'unit',key:'hold'},abort.signal)).catch(error=>error);
  await expect.poll(()=>started).toBe(1);abort.abort(reason);expect(await bounded(pending)).toBe(reason);pause.release();
});

it('joins an explicitly owned resolver cleanup before exposing cancellation',async()=>{
  const runtime=new Runtime(),pause=gate(),abort=new AbortController(),reason=Error('Stop owned work');let started=false,settled=false;
  runtime.setResolver('ui.press',async()=>{started=true;await pause.promise;return 'resource closed';},{settleOnCancel:true});
  const pending=drain(runtime.emit('ui.press',{site:'unit',key:'hold'},abort.signal)).catch(error=>{settled=true;return error;});
  await expect.poll(()=>started).toBe(true);abort.abort(reason);await new Promise<void>(done=>setImmediate(done));expect(settled).toBe(false);
  pause.release();expect(await pending).toBe(reason);
});

it.each(['caller','interceptor'] as const)('preserves an explicitly owned %s cancellation receipt only after its cleanup settles',async source=>{
  const runtime=new Runtime(),pause=gate(),abort=new AbortController();let started=false;
  if(source==='interceptor')runtime.register(manifest,{'service.agent.tool':(_event,context)=>context.next()});
  runtime.setResolver('service.agent.tool',async()=>{started=true;await pause.promise;return{value:{ok:false,error:'Cancelled after close'}};},
    {settleOnCancel:true,preserveResultOnCancel:true});
  let settled=false;const pending=drain(runtime.emit('service.agent.tool',{name:'owned'},abort.signal)).then(value=>{settled=true;return value;});
  await expect.poll(()=>started).toBe(true);if(source==='caller')abort.abort(Error('Cancel'));else runtime.unregister(manifest.name);
  await new Promise<void>(done=>setImmediate(done));expect(settled).toBe(false);
  pause.release();expect(await pending).toMatchObject({value:{value:{ok:false,error:'Cancelled after close'}},faults:[]});
});

it('permits a cooperative retired hook receipt without starting its fallback or granting a continuation',async()=>{
  const runtime=new Runtime(),pause=gate();let context!:HookContext,effects=0;
  runtime.register(manifest,{'service.fs.read':async(_event,current)=>{context=current;await pause.promise;return{value:'cancelled'};}});
  runtime.setResolver('service.fs.read',()=>{effects++;return{value:'unsafe fallback'};});
  const pending=drain(runtime.emit('service.fs.read',{plugin:manifest.name,path:'probe'},undefined,{retirementGraceMs:100}));
  await expect.poll(()=>context).toBeDefined();runtime.unregister(manifest.name);pause.release();
  expect(await pending).toMatchObject({value:{value:'cancelled'},faults:[]});expect(effects).toBe(0);
  await expect(Promise.resolve(context.next())).rejects.toBeInstanceOf(Error);
});

it('cancels a streaming hook without publishing its late yield or a fallback effect',async()=>{
  const runtime=new Runtime(),pause=gate(),abort=new AbortController(),reason=Error('Stop stream');let context!:HookContext,effects=0;
  runtime.register(manifest,{'ui.press':async function*(_event,current){context=current;yield 'first';await pause.promise;yield 'late';}});
  runtime.setResolver('ui.press',()=>{effects++;});const iterator=runtime.emit('ui.press',{site:'unit',key:'stream'},abort.signal);
  expect(await iterator.next()).toMatchObject({done:false,value:'first'});abort.abort(reason);
  expect(await bounded(iterator.next().catch(error=>error))).toBe(reason);expect(context.signal.reason).toBe(reason);
  pause.release();expect(effects).toBe(0);
});

it('never publishes a retired generator yield during cooperative settlement grace',async()=>{
  const runtime=new Runtime(),pause=gate();let effects=0;
  runtime.register(manifest,{'ui.press':async function*(){yield 'first';await pause.promise;yield 'retired output';}});
  runtime.setResolver('ui.press',()=>{effects++;});
  const iterator=runtime.emit('ui.press',{site:'unit',key:'stream'},undefined,{retirementGraceMs:100});
  expect(await iterator.next()).toMatchObject({done:false,value:'first'});runtime.unregister(manifest.name);pause.release();
  const result=await iterator.next().catch(error=>error);expect(result).toBeInstanceOf(Error);expect(effects).toBe(0);
});
