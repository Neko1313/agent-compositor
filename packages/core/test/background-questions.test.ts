import {afterEach,expect,it} from 'vitest';
import type {UserQuestionAnswer,UserQuestionRequest} from '@agent-compositor/events';
import type {HooksApi,HooksServiceScope} from '@agent-compositor/hooks';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';

const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
const wait=(check:()=>boolean)=>expect.poll(check,{timeout:3000}).toBe(true);
const observe=<T>(work:Promise<T>)=>work.then(value=>({ok:true as const,value}),error=>({ok:false as const,error:String(error)}));
const question={question:'Independent choice',options:['Continue'],allowOther:false};
const questionnaire={title:'Independent choices',questions:[{id:'choice',...question}]};
const response={answers:[{id:'choice',selected:['Continue']}]};
type Kind='ask'|'questionnaire';
const ask=(api:HooksApi,kind:Kind):Promise<UserQuestionAnswer>=>kind==='ask'?api.ui.ask(question):api.ui.questionnaire(questionnaire);
const answer=(kind:Kind):UserQuestionAnswer=>kind==='ask'?'Continue':response;

function fixture(handler:(event:any,$:HooksApi)=>unknown,provider=new ScriptedProvider([{text:'MAIN',hold:true}])){
 const captures:{request:UserQuestionRequest;scope?:HooksServiceScope;explicit:boolean;user:boolean;operations:ReturnType<AgentCore['getOperations']>;respond(value:UserQuestionAnswer):void}[]=[];
 const events:any[]=[];let startup!:HooksApi,core!:AgentCore;
 core=new AgentCore({cwd:process.cwd(),provider,userCommands:()=>[{name:'/control',plugin:'launcher'}],
  plugins:[{manifest:{name:'launcher',version:'1.0.0',trust:'trusted'},hooks:{
   'session.start':(_event,$)=>{startup=$.background();},'command.invoke':handler,
  }}],
  onAsk:request=>new Promise((resolve,reject)=>{
   const abort=()=>{request.signal?.removeEventListener('abort',abort);reject(Error('Question cancelled'));};
   captures.push({request,scope:core.host.currentServiceScope,explicit:core.host.isBackgroundService,user:core.isUserInvocation,
    operations:core.getOperations(),respond:value=>{request.signal?.removeEventListener('abort',abort);resolve(value);}});
   request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();
  }),
 });
 core.subscribe(event=>events.push(event));cores.push(core);
 return{core,provider,captures,events,startup:()=>startup};
}

it.each((['ask','questionnaire'] as const).flatMap(kind=>(['active','settled','startup'] as const).map(phase=>({kind,phase}))))(
 'keeps retained $kind independent with a $phase launching command and a cancelled Main',async({kind,phase})=>{
  let release=()=>{},background:ReturnType<typeof observe>|undefined;
  const gate=new Promise<void>(done=>{release=done;});
  const f=fixture(async(_event,$)=>{
   const retained=$.background();background=observe(gate.then(()=>ask(retained,kind)));
   if(phase==='active')await new Promise<void>(done=>{if($.signal.aborted)done();else $.signal.addEventListener('abort',()=>done(),{once:true});});
  });
  await f.core.start();const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
  const caller=new AbortController();let command:ReturnType<typeof observe>|undefined;
  try{
   if(phase==='startup')background=observe(ask(f.startup(),kind));
   else{
    command=observe(f.core.invokeCommand('/control',caller.signal));
    if(phase==='settled'){expect(await command).toEqual({ok:true,value:true});caller.abort(Error('Launcher finished'));}
    release();
   }
   await wait(()=>f.captures.length===1);
   const capture=f.captures[0];expect(capture.scope).toMatchObject({plugin:'launcher',background:true});
   expect(capture.explicit).toBe(true);expect(capture.user).toBe(false);
   expect(capture.request.signal?.aborted).toBe(false);
   if(phase==='active'){caller.abort(Error('Cancel launcher'));expect(await command).toMatchObject({ok:false});}
   expect(capture.request.signal?.aborted).toBe(false);
   f.core.interrupt();await main;
   expect(f.provider.requests[0].signal.aborted).toBe(true);expect(capture.request.signal?.aborted).toBe(false);
   expect(capture.scope!.lifetime.aborted).toBe(false);expect(f.core.getOperations()).toEqual([]);
   capture.respond(answer(kind));expect(await background).toEqual({ok:true,value:answer(kind)});
   expect(f.events.filter(event=>event.kind==='catalog'&&event.event==='ui.reaction').every(event=>event.input.operationId===undefined)).toBe(true);
   expect(f.provider.requests).toHaveLength(1);expect(JSON.stringify(f.core.getMessages())).not.toContain('Independent choice');
  }finally{release();caller.abort();f.core.interrupt();await main;await f.core.close();await background;}
 });

it.each(['ask','questionnaire'] as const)('cancels ordinary command %s with its exact caller while Main stays active',async kind=>{
 const f=fixture(async(_event,$)=>{await ask($,kind);});
 const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 const caller=new AbortController(),command=observe(f.core.invokeCommand('/control',caller.signal));
 await wait(()=>f.captures.length===1);
 const capture=f.captures[0],operation=f.core.getOperations().find(operation=>operation.tool==='/control')!;
 expect(capture.scope?.background).toBe(false);expect(capture.user).toBe(true);
 expect(f.events.find(event=>event.kind==='catalog'&&event.event==='ui.reaction')?.input.operationId).toBe(operation.id);
 caller.abort(Error('Cancel command question'));expect(await command).toMatchObject({ok:false});
 expect(capture.request.signal?.aborted).toBe(true);expect(f.provider.requests[0].signal.aborted).toBe(false);
 expect(f.core.getState()).toBe('running');expect(f.core.getOperations()).toEqual([]);f.provider.release();await main;
});

it.each(['ask','questionnaire'] as const)('keeps a new ordinary API inside a retained background tool on that tool ledger for %s',async kind=>{
 let background:ReturnType<typeof observe>|undefined;
 const tool=kind==='ask'?'ask_user':'ask_questions',service=kind==='ask'?'service.ui.ask':'service.ui.questionnaire';
 const original=kind==='ask'?{...question,question:'Tool request'}:{...questionnaire,title:'Tool request'};
 const f=fixture(async(_event,$)=>{
  background=observe($.background().agent.tool(tool,original));
  await new Promise<void>(done=>{if($.signal.aborted)done();else $.signal.addEventListener('abort',()=>done(),{once:true});});
 });
 f.core.host.registerPlugin({name:'question-interceptor',version:'1.0.0',trust:'trusted'},{
  [service]:async(event,$)=>{
   if((kind==='ask'?event.question:event.title)!=='Tool request')return;
   const value=await ask($,kind);return kind==='ask'?{answer:value}:{value};
  },
 });
 const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 const caller=new AbortController(),command=observe(f.core.invokeCommand('/control',caller.signal));
 await wait(()=>f.captures.length===1);
 const capture=f.captures[0],operation=f.core.getOperations().find(operation=>operation.tool===tool)!;
 expect(capture.scope).toMatchObject({plugin:'question-interceptor',background:true});
 expect(capture.explicit).toBe(false);expect(capture.user).toBe(true);
 expect(capture.operations).toContainEqual(expect.objectContaining({id:operation.id,tool}));
 expect(f.events.find(event=>event.kind==='catalog'&&event.event==='ui.reaction')?.input.operationId).toBe(operation.id);
 caller.abort(Error('Cancel launcher'));expect(await command).toMatchObject({ok:false});
 f.core.interrupt();await main;expect(capture.request.signal?.aborted).toBe(false);
 capture.respond(answer(kind));expect(await background).toMatchObject({ok:true,value:{ok:true}});
 expect(f.core.getOperations()).toEqual([]);expect(f.provider.requests).toHaveLength(1);
 const result=f.events.find(event=>event.kind==='catalog'&&event.event==='tool.result'&&event.input.tool===tool)!;
 expect(result.input.operationId).toBe(operation.id);expect(result.input.ok).toBe(true);
 expect(JSON.stringify(f.core.getMessages())).not.toContain('Independent choice');
});

it.each(['ask','questionnaire'] as const)('cancels a Main model %s through its foreground signal',async kind=>{
 const tool=kind==='ask'?'ask_user':'ask_questions',args=kind==='ask'?question:questionnaire;
 const provider=new ScriptedProvider([{toolCalls:[{name:tool,args}]}]);
 const f=fixture(()=>{},provider),main=f.core.submit('Ask Main');
 await wait(()=>f.captures.length===1);const capture=f.captures[0];
 expect(capture.scope).toBeUndefined();expect(capture.user).toBe(false);
 f.core.interrupt();await main;expect(capture.request.signal?.aborted).toBe(true);
 expect(f.core.getState()).toBe('interrupted');expect(provider.requests).toHaveLength(1);
});

it.each(['ask','questionnaire'] as const)('does not reuse a settled background tool ledger for its retained ordinary %s API',async kind=>{
 let release=()=>{},background:ReturnType<typeof observe>|undefined,later:ReturnType<typeof observe>|undefined;
 const gate=new Promise<void>(done=>{release=done;});
 const tool=kind==='ask'?'ask_user':'ask_questions',service=kind==='ask'?'service.ui.ask':'service.ui.questionnaire';
 const original=kind==='ask'?{...question,question:'Retain only'}:{...questionnaire,title:'Retain only'};
 const f=fixture((_event,$)=>{background=observe($.background().agent.tool(tool,original));});
 f.core.host.registerPlugin({name:'question-interceptor',version:'1.0.0',trust:'trusted'},{
  [service]:(event,$)=>{
   if((kind==='ask'?event.question:event.title)!=='Retain only')return;
   later=observe(gate.then(()=>ask($,kind)));
   return kind==='ask'?{answer:'Continue'}:{value:response};
  },
 });
 const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 const caller=new AbortController();
 try{
  expect(await f.core.invokeCommand('/control',caller.signal)).toBe(true);
  expect(await background).toMatchObject({ok:true,value:{ok:true}});expect(f.core.getOperations()).toEqual([]);
  caller.abort(Error('Launching command settled'));release();await wait(()=>f.captures.length===1);
  const capture=f.captures[0];expect(capture.scope).toMatchObject({plugin:'question-interceptor',background:true});
  expect(capture.explicit).toBe(false);expect(capture.user).toBe(false);
  f.core.interrupt();await main;expect(capture.request.signal?.aborted).toBe(false);
  capture.respond(answer(kind));expect(await later).toEqual({ok:true,value:answer(kind)});
  const reactions=f.events.filter(event=>event.kind==='catalog'&&event.event==='ui.reaction');
  expect(reactions).toHaveLength(2);expect(reactions.every(event=>event.input.operationId===undefined)).toBe(true);
 }finally{release();caller.abort();f.core.interrupt();await main;await f.core.close();await later;}
});

it.each((['ask','questionnaire'] as const).flatMap(kind=>(['unload','close'] as const).map(end=>({kind,end}))))(
 'cancels retained $kind on exact owner $end without cancelling Main',async({kind,end})=>{
  const f=fixture(()=>{});await f.core.start();
  const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
  const retained=f.startup(),pending=observe(ask(retained,kind));await wait(()=>f.captures.length===1);
  if(end==='unload')f.core.host.unregisterPlugin('launcher');else await f.core.close();
  expect(await pending).toMatchObject({ok:false});expect(f.captures[0].request.signal?.aborted).toBe(true);
  expect(f.captures[0].scope!.lifetime).toBe(retained.signal);expect(retained.signal.aborted).toBe(true);
  if(end==='unload'){
   expect(f.provider.requests[0].signal.aborted).toBe(false);expect(f.core.getState()).toBe('running');
   f.provider.release();
  }
  await main;
 });
