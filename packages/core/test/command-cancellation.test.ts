import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';

const cores:AgentCore[]=[],directories:string[]=[];
afterEach(async()=>{
 for(const core of cores.splice(0))await core.close();
 for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});
});
const wait=(check:()=>boolean|Promise<boolean>)=>expect.poll(check,{timeout:4000}).toBe(true);
const observe=<T>(work:Promise<T>)=>work.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
function alive(pid:number){try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}}
async function worker(){
 const cwd=await mkdtemp(join(tmpdir(),'command-cancellation-'));directories.push(cwd);
 const path=join(cwd,'worker.cjs');
 await writeFile(path,`const fs=require('node:fs');const name=process.argv[2];
process.on('SIGTERM',()=>{fs.writeFileSync(name+'.done','released');process.exit(0);});
fs.writeFileSync(name+'.pid',String(process.pid));setInterval(()=>{},1000);`);
 return{
  cwd,command:(name:string)=>`exec ${quote(process.execPath)} ${quote(path)} ${quote(name)}`,
  async pid(name:string){
   let value=0;await wait(async()=>{try{value=Number(await readFile(join(cwd,name+'.pid'),'utf8'));return value>0;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}});return value;
  },
 };
}
function fixture(cwd:string,handler:(event:any,$:any)=>unknown,options:any={}){
 const provider:ScriptedProvider=options.provider??new ScriptedProvider([{text:'MAIN_WORKING',hold:true}]);
 const events:any[]=[];
 const core=new AgentCore({cwd,provider,userCommands:()=>[{name:'/control',plugin:'control'}],
  rules:['exec','exec_output','exec_kill'].map(tool=>({tool,decision:'allow' as const})),
  plugins:[{manifest:{name:'control',version:'1.0.0',trust:'trusted',hookTimeouts:{'command.invoke':15000}},hooks:{'command.invoke':handler}}],...options});
 cores.push(core);core.subscribe(event=>events.push(event));return{core,provider,events};
}

it('rejects a pre-aborted command before invoking its handler or admitting tool effects',async()=>{
 const task=await worker();let entered=0;
 const f=fixture(task.cwd,async(_event,$)=>{entered++;await $.agent.tool('exec',{command:task.command('forbidden')});});
 const caller=new AbortController();caller.abort(Error('Already cancelled'));
 await expect(f.core.invokeCommand('/control',caller.signal)).rejects.toThrow('Already cancelled');
 expect(entered).toBe(0);expect(f.core.getOperations()).toEqual([]);expect(f.provider.requests).toHaveLength(0);
 expect(f.events.filter(event=>event.kind==='catalog'&&['command.operation','tool.call'].includes(event.event))).toEqual([]);
 await expect(readFile(join(task.cwd,'forbidden.pid'))).rejects.toMatchObject({code:'ENOENT'});
});

it('does not enter the handler if its caller cancels while the start audit is pending',async()=>{
 const task=await worker();let entered=0,started=false,release=()=>{};
 const audit=new Promise<void>(resolve=>{release=resolve;});
 const f=fixture(task.cwd,async()=>{entered++;await writeFile(join(task.cwd,'forbidden.effect'),'effect');},{
  sessions:{create:async()=>{},append:async(_id:string,events:any[])=>{
   if(events.some(event=>event.type==='command.operation'&&event.phase==='started')){started=true;await audit;}
  }},
 });
 const caller=new AbortController(),command=observe(f.core.invokeCommand('/control',caller.signal));
 try{
  await wait(()=>started);caller.abort(Error('Cancelled before handler'));release();
  expect(await command).toMatchObject({ok:false});expect(entered).toBe(0);expect(f.core.getOperations()).toEqual([]);
  await expect(readFile(join(task.cwd,'forbidden.effect'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{release();}
});

it('cancels only one real foreground exec among same-owner commands while Main remains held',async()=>{
 const task=await worker(),results:Record<string,unknown>={};
 const f=fixture(task.cwd,async(event,$)=>{results[event.args]=await $.agent.tool('exec',{command:task.command(event.args),timeoutMs:15000});});
 const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 const transcript=structuredClone(f.core.getMessages()),firstCaller=new AbortController(),secondCaller=new AbortController();
 const first=observe(f.core.invokeCommand('/control first',firstCaller.signal));
 const second=observe(f.core.invokeCommand('/control second',secondCaller.signal));
 const [firstPid,secondPid]=await Promise.all([task.pid('first'),task.pid('second')]);
 expect(f.core.getOperations()).toHaveLength(4);
 firstCaller.abort(Error('Cancel first command'));
 expect(await first).toMatchObject({ok:false,error:expect.objectContaining({message:'Cancel first command'})});
 // A settled command must also have drained its foreground child, not just rejected a UI promise.
 expect(alive(firstPid)).toBe(false);
 expect(f.core.getOperations()).toHaveLength(2);
 expect(f.core.getOperations().every(operation=>operation.owner==='control')).toBe(true);
 expect(alive(secondPid)).toBe(true);expect(secondCaller.signal.aborted).toBe(false);
 expect(f.provider.requests[0].signal.aborted).toBe(false);expect(f.core.getState()).toBe('running');
 expect(f.core.getMessages()).toEqual(transcript);
 process.kill(secondPid,'SIGTERM');expect(await second).toEqual({ok:true,value:true});
 expect(await readFile(join(task.cwd,'second.done'),'utf8')).toBe('released');expect(alive(secondPid)).toBe(false);
 expect(results.second).toMatchObject({ok:true});expect(f.core.getOperations()).toEqual([]);
 expect(f.events.filter(event=>event.kind==='catalog'&&event.event==='command.operation'&&event.input.phase==='completed').map(event=>event.input.ok).sort()).toEqual([false,true]);
 f.provider.release();await main;expect(f.core.failure).toBeUndefined();
});

it('interrupts Main exec independently and drains command exec on exact caller cancellation',async()=>{
 const task=await worker(),provider=new ScriptedProvider([{toolCalls:[{name:'exec',args:{command:task.command('main'),timeoutMs:15000}}]}]);
 const f=fixture(task.cwd,async(_event,$)=>{await $.agent.tool('exec',{command:task.command('separate'),timeoutMs:15000});},{provider});
 const main=f.core.submit('Main task'),mainPid=await task.pid('main');
 const caller=new AbortController(),command=observe(f.core.invokeCommand('/control',caller.signal));
 const pid=await task.pid('separate');f.core.interrupt();await main;
 expect(f.provider.requests[0].signal.aborted).toBe(true);expect(alive(mainPid)).toBe(false);expect(alive(pid)).toBe(true);
 expect(caller.signal.aborted).toBe(false);expect(f.core.hasActiveOperations).toBe(true);
 caller.abort(Error('Cancel separate command'));expect(await command).toMatchObject({ok:false});
 expect(alive(pid)).toBe(false);expect(f.core.getOperations()).toEqual([]);expect(f.core.failure).toBeUndefined();
});

it('uses the effective signal for a real idle builtin tool as well',async()=>{
 const task=await worker(),f=fixture(task.cwd,()=>{}),caller=new AbortController();
 const work=f.core.invokeTool('exec',{command:task.command('idle'),timeoutMs:15000},caller.signal);
 const pid=await task.pid('idle');caller.abort(Error('Cancel idle tool'));
 expect(await work).toMatchObject({output:{exitCode:-1}});expect(alive(pid)).toBe(false);
 expect(f.core.getOperations()).toEqual([]);expect(f.core.getState()).toBe('idle');
});

it('cancels an auxiliary command model without cancelling the held Main request',async()=>{
 const task=await worker();
 const provider=new ScriptedProvider([{text:'MAIN_WORKING',hold:true},{text:'AUX_WORKING',hold:true,usage:{inputTokens:13,outputTokens:7}}]);let completed=false;
 const f=fixture(task.cwd,async(_event,$)=>{const answer=await $.model.complete({messages:[{role:'user',content:'Auxiliary task'}]});await writeFile(join(task.cwd,'auxiliary.done'),String(answer));completed=true;},{provider});
 const provenance:boolean[]=[];
 f.core.host.registerPlugin({name:'model-observer',version:'1.0.0',trust:'trusted'},
  {'service.model.stream':()=>{provenance.push(f.core.isUserInvocation);}});
 const main=f.core.submit('Main task');await wait(()=>provider.requests.length===1);
 const before=f.core.getBudget();
 const caller=new AbortController(),command=observe(f.core.invokeCommand('/control',caller.signal));
 await wait(()=>provider.requests.length===2&&f.core.getOperations().some(operation=>operation.tokens===20));
 expect(provenance).toEqual([false,true]);
 expect(f.core.getBudget().spentTokens-before.spentTokens).toBe(20);
 expect(f.core.getBudget().turnTokens).toBe(before.turnTokens);
 const operation=f.core.getOperations().find(operation=>operation.tool==='/control')!;
 expect(f.events.find(event=>event.kind==='catalog'&&event.event==='model.usage'&&event.input.inputTokens===13)?.input.operationId).toBe(operation.id);
 caller.abort(Error('Cancel auxiliary model'));
 expect(await command).toMatchObject({ok:false});expect(provider.requests[1].signal.aborted).toBe(true);
 expect(completed).toBe(false);expect(provider.requests[0].signal.aborted).toBe(false);
 await expect(readFile(join(task.cwd,'auxiliary.done'))).rejects.toMatchObject({code:'ENOENT'});
 expect(f.core.getOperations()).toEqual([]);expect(f.core.getState()).toBe('running');provider.release();await main;
});

it.each(['unload','close'] as const)('detaches an explicit background model started during an active command until owner %s',async stop=>{
 const provider=new ScriptedProvider([{text:'MAIN_WORKING',hold:true},
  {text:'BACKGROUND_WORKING',hold:true,usage:{inputTokens:13,outputTokens:7}}]);
 let backgroundSignal:AbortSignal|undefined,background:ReturnType<typeof observe>|undefined;
 const f=fixture(process.cwd(),async(_event,$)=>{
  const retained=$.background();backgroundSignal=retained.signal;
  background=observe(retained.model.complete({messages:[{role:'user',content:'Independent task'}]}));
  await new Promise<void>(done=>{if($.signal.aborted)done();else $.signal.addEventListener('abort',()=>done(),{once:true});});
 },{provider});
 const provenance:boolean[]=[];
 f.core.host.registerPlugin({name:'model-observer',version:'1.0.0',trust:'trusted'},
  {'service.model.stream':()=>{provenance.push(f.core.isUserInvocation);}});
 const main=f.core.submit('Main task');await wait(()=>provider.requests.length===1);
 const before=f.core.getBudget(),transcript=structuredClone(f.core.getMessages());
 const caller=new AbortController(),command=observe(f.core.invokeCommand('/control',caller.signal));
 await wait(()=>provider.requests.length===2&&f.core.getBudget().spentTokens===before.spentTokens+20);
 expect(provenance).toEqual([false,false]);
 expect(f.core.getOperations()).toMatchObject([{tool:'/control',tokens:0}]);
 expect(f.core.getBudget().turnTokens-before.turnTokens).toBe(20);
 expect(f.events.find(event=>event.kind==='catalog'&&event.event==='model.usage'&&event.input.inputTokens===13)?.input).not.toHaveProperty('operationId');
 caller.abort(Error('Cancel launching command'));
 expect(await command).toMatchObject({ok:false});expect(f.core.getOperations()).toEqual([]);
 expect(backgroundSignal?.aborted).toBe(false);expect(provider.requests[1].signal.aborted).toBe(false);
 expect(provider.requests[0].signal.aborted).toBe(false);expect(f.core.getState()).toBe('running');
 expect(f.core.getMessages()).toEqual(transcript);
 if(stop==='unload')f.core.host.unregisterPlugin('control');else await f.core.close();
 expect(await background).toMatchObject({ok:false});
 expect(backgroundSignal?.aborted).toBe(true);expect(provider.requests[1].signal.aborted).toBe(true);
 expect(f.core.getOperations()).toEqual([]);
 if(stop==='unload'){expect(provider.requests[0].signal.aborted).toBe(false);provider.release();}
 await main;
});

it.each(['unload','close'] as const)('keeps a retained background-handle foreground exec independent until owner %s',async stop=>{
 const task=await worker();let retainedSignal:AbortSignal|undefined,background:ReturnType<typeof observe>|undefined;
 const f=fixture(task.cwd,async(_event,$)=>{
  const retained=$.background();retainedSignal=retained.signal;
  background=observe(retained.agent.tool('exec',{command:task.command('retained'),timeoutMs:15000}));
  await new Promise<void>(done=>{if($.signal.aborted)done();else $.signal.addEventListener('abort',()=>done(),{once:true});});
 });
 const main=f.core.submit('Main task');await wait(()=>f.provider.requests.length===1);
 const transcript=structuredClone(f.core.getMessages()),caller=new AbortController();
 const command=observe(f.core.invokeCommand('/control',caller.signal)),pid=await task.pid('retained');
 const commandId=f.core.getOperations().find(operation=>operation.tool==='/control')!.id;
 const toolId=f.core.getOperations().find(operation=>operation.tool==='exec')!.id;
 expect(toolId).not.toBe(commandId);
 caller.abort(Error('Cancel launching command'));
 expect(await command).toMatchObject({ok:false});
 expect(f.core.getOperations()).toMatchObject([{id:toolId,tool:'exec',owner:'control'}]);
 expect(retainedSignal?.aborted).toBe(false);expect(alive(pid)).toBe(true);
 expect(f.provider.requests[0].signal.aborted).toBe(false);expect(f.core.getState()).toBe('running');
 expect(f.core.getMessages()).toEqual(transcript);
 f.core.interrupt();await main;
 expect(f.provider.requests[0].signal.aborted).toBe(true);expect(alive(pid)).toBe(true);
 expect(retainedSignal?.aborted).toBe(false);
 if(stop==='unload')f.core.host.unregisterPlugin('control');else await f.core.close();
 expect(await background).toMatchObject({ok:true,value:{ok:false}});
 expect(retainedSignal?.aborted).toBe(true);expect(alive(pid)).toBe(false);
 expect(f.core.getOperations()).toEqual([]);
 expect(f.events.find(event=>event.kind==='catalog'&&event.event==='tool.operation'
  &&event.input.operationId===toolId&&event.input.phase==='completed')?.input.ok).toBe(false);
});

it('preserves ordinary retained model scope when a background service interceptor calls it',async()=>{
 const provider=new ScriptedProvider([{text:'MAIN_WORKING',hold:true},
  {text:'ORDINARY_AUXILIARY',hold:true,usage:{inputTokens:13,outputTokens:7}}]);
 let ordinary:any,nested:ReturnType<typeof observe>|undefined,nestedBackground:boolean|undefined;
 const f=fixture(process.cwd(),async(_event,$)=>{
  ordinary=$;
  await $.background().model.complete({messages:[{role:'user',content:'Background trigger'}]});
  await new Promise<void>(done=>{if($.signal.aborted)done();else $.signal.addEventListener('abort',()=>done(),{once:true});});
 },{provider});
 const provenance:boolean[]=[];
 f.core.host.registerPlugin({name:'model-interceptor',version:'1.0.0',trust:'trusted'},{
  'service.model.complete':event=>{
   if(event.request.messages[0].content==='Background trigger'){
    nested=observe(ordinary.model.complete({messages:[{role:'user',content:'Ordinary nested task'}]}));
    return{value:'Nested request started'};
   }
   nestedBackground=f.core.host.isBackgroundService;
  },
  'service.model.stream':()=>{provenance.push(f.core.isUserInvocation);},
 });
 const main=f.core.submit('Main task');await wait(()=>provider.requests.length===1);
 const before=f.core.getBudget(),caller=new AbortController();
 const command=observe(f.core.invokeCommand('/control',caller.signal));
 await wait(()=>provider.requests.length===2&&f.core.getOperations().some(operation=>operation.tokens===20));
 expect(nestedBackground).toBe(false);expect(provenance).toEqual([false,true]);
 const operation=f.core.getOperations().find(operation=>operation.tool==='/control')!;
 expect(f.core.getBudget().spentTokens-before.spentTokens).toBe(20);
 expect(f.core.getBudget().turnTokens).toBe(before.turnTokens);
 expect(f.events.find(event=>event.kind==='catalog'&&event.event==='model.usage'&&event.input.inputTokens===13)?.input.operationId).toBe(operation.id);
 caller.abort(Error('Cancel ordinary nested model'));
 expect(await command).toMatchObject({ok:false});expect(await nested).toMatchObject({ok:false});
 expect(provider.requests[1].signal.aborted).toBe(true);expect(provider.requests[0].signal.aborted).toBe(false);
 expect(f.core.getOperations()).toEqual([]);provider.release();await main;
});

it.each(['unload','close'] as const)('keeps explicit background model callbacks detached until plugin %s',async(stop)=>{
 const provider=new ScriptedProvider([{text:'DETACHED_OK'},{text:'DETACHED_HELD',hold:true}]);
 let releaseFirst=()=>{},releaseSecond=()=>{},first:ReturnType<typeof observe>|undefined,second:ReturnType<typeof observe>|undefined;
 const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;}),secondGate=new Promise<void>(resolve=>{releaseSecond=resolve;});
 let provenance:boolean|undefined;
 const f=fixture(process.cwd(),(_event,$)=>{
  const background=$.background();
  first=observe(firstGate.then(()=>{provenance=f.core.isUserInvocation;return background.model.complete({messages:[{role:'user',content:'Detached task'}]});}));
  second=observe(secondGate.then(()=>background.model.complete({messages:[{role:'user',content:'Detached held task'}]})));
 },{provider});
 const caller=new AbortController();await f.core.invokeCommand('/control',caller.signal);caller.abort(Error('Completed caller closed'));
 const before=f.core.getBudget();releaseFirst();expect(await first).toEqual({ok:true,value:'DETACHED_OK'});
 expect(provenance).toBe(false);expect(provider.requests[0].signal.aborted).toBe(false);
 expect(f.core.getBudget().spentTokens).toBeGreaterThan(before.spentTokens);
 expect(f.core.getBudget().turnTokens).toBeGreaterThan(before.turnTokens);expect(f.core.getOperations()).toEqual([]);
 releaseSecond();await wait(()=>provider.requests.length===2);expect(provider.requests[1].signal.aborted).toBe(false);
 if(stop==='unload')f.core.host.unregisterPlugin('control');else await f.core.close();
 expect(await second).toMatchObject({ok:false});expect(provider.requests[1].signal.aborted).toBe(true);
 expect(f.core.getOperations()).toEqual([]);
});

it('keeps explicit background exec detached after its command and caller have settled',async()=>{
 const task=await worker();let result:any;
 const f=fixture(task.cwd,async(_event,$)=>{result=await $.agent.tool('exec',{command:task.command('background'),background:true,timeoutMs:15000});},{onApproval:async()=>true});
 const caller=new AbortController();expect(await f.core.invokeCommand('/control',caller.signal)).toBe(true);
 expect(result).toMatchObject({ok:true,output:{started:true,shellId:expect.any(String)}});
 const pid=await task.pid('background');caller.abort(Error('Caller closed after completion'));
 expect(alive(pid)).toBe(true);expect(f.core.getOperations()).toEqual([]);
 const id=result.output.shellId;
 expect(await f.core.invokeTool('exec_output',{id})).toMatchObject({ok:true,output:{done:false}});
 const killed=await f.core.invokeTool('exec_kill',{id});expect(killed.error).toBeUndefined();
 expect(killed).toMatchObject({ok:true,output:{killed:true}});
 expect(alive(pid)).toBe(false);
});

it.each(['ordinary','background'] as const)('preserves deny policy for real builtin exec through a %s handle',async scope=>{
 const task=await worker();let result:any,asked=0;
 const f=fixture(task.cwd,async(_event,$)=>{const api=scope==='background'?$.background():$;result=await api.agent.tool('exec',{command:task.command('denied')});},
  {rules:[{tool:'exec',decision:'deny'}],onApproval:async()=>{asked++;return true;}});
 const caller=new AbortController();expect(await f.core.invokeCommand('/control',caller.signal)).toBe(true);
 expect(result).toMatchObject({ok:false,error:expect.stringMatching(/denied/i)});expect(asked).toBe(0);
 await expect(readFile(join(task.cwd,'denied.pid'))).rejects.toMatchObject({code:'ENOENT'});
 expect(f.core.getOperations()).toEqual([]);expect(f.provider.requests).toHaveLength(0);
});
