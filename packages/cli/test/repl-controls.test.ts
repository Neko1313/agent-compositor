import {it,expect} from 'vitest';
import {PassThrough,Writable} from 'node:stream';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {runRepl} from '../src/repl.js';

function fixture(handler:(event:any,$:any)=>unknown){
 const stdin=new PassThrough(),provider=new ScriptedProvider([{text:'MAIN_HELD',hold:true},{text:'FOLLOWUP_DONE'}]);let core!:AgentCore,output='';
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk.toString();done();}});
 const run=runRepl({stdin,stdout,createCore:onApproval=>core=new AgentCore({cwd:process.cwd(),provider,onApproval,
  userCommands:()=>[{name:'/control',plugin:'control'}],plugins:[{manifest:{name:'control',version:'1.0.0',trust:'trusted',hookTimeouts:{'command.invoke':10000}},hooks:{'command.invoke':handler}}]})});
 return{stdin,provider,get core(){return core;},get output(){return output;},run};
}
const wait=async(check:()=>boolean)=>expect.poll(check).toBe(true);

it('dispatches a command pasted after a main prompt before the held model finishes',async()=>{
 let controls=0;const f=fixture(()=>{controls++;});
 try{
  f.stdin.write('Main task\r/control\r');await wait(()=>f.provider.requests.length===1);
  await wait(()=>controls===1);expect(f.core.getState()).toBe('running');expect(f.provider.requests).toHaveLength(1);
 }finally{f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});

it('orders an asynchronous setup control before the following model prompt',async()=>{
 let entered=false,release=()=>{};const f=fixture(async()=>{entered=true;await new Promise<void>(done=>{release=done;});});
 try{
  f.stdin.end('/control\rMain task\r');await wait(()=>entered);expect(f.provider.requests).toHaveLength(0);
  release();await wait(()=>f.provider.requests.length===1);f.provider.release();await f.run;
 }finally{release();f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});

it('lets a later idle control release an earlier one before starting the queued model prompt',async()=>{
 let release=()=>{},controls=0;
 const f=fixture(async(event)=>{if(event.args==='hold')await new Promise<void>(done=>{release=done;});else{controls++;release();}});
 try{
  f.stdin.end('/control hold\r/control release\rMain task\r');await wait(()=>controls===1);await wait(()=>f.provider.requests.length===1);
  f.provider.release();await f.run;expect(f.core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task']);
 }finally{release();f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});

it('reports a command failure and accepts the next prompt without retrying the command through the model',async()=>{
 const f=fixture(()=>{throw Error('CONTROL_FAILURE');});
 try{
  f.stdin.end('/control\rMain task\r');await wait(()=>f.provider.requests.length===1);f.provider.release();await f.run;
  expect(f.output).toContain('CONTROL_FAILURE');expect(f.core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task']);
 }finally{f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});

it('cancels an idle independent command on Ctrl+C without requesting a model response',async()=>{
 let entered=false;const f=fixture(async(_event,$)=>{entered=true;await new Promise((_,reject)=>$.signal.addEventListener('abort',()=>reject($.signal.reason),{once:true}));});
 try{
  f.stdin.write('/control\r');await wait(()=>entered);f.stdin.write('\x03');await wait(()=>!f.core.hasActiveOperations);
  f.stdin.end();await f.run;expect(f.provider.requests).toHaveLength(0);expect(f.output).toContain('cancelled');
 }finally{f.core.cancelOperations();f.stdin.end();await f.run;await f.core.close();}
});

it('cancels pasted input that has not started when Ctrl+C follows in the same chunk',async()=>{
 let controls=0;const f=fixture(()=>{controls++;});
 try{
  f.stdin.end('Main task\r/control\r\x03');await f.run;expect(controls).toBe(0);expect(f.provider.requests).toHaveLength(0);
 }finally{f.provider.release();await f.core.close();}
});

it('retains UTF-8 characters split across stream chunks',async()=>{
 const f=fixture(()=>{}),input=Buffer.from('Inspect 👩🏽‍💻 файлы\r');
 try{
  for(const byte of input)f.stdin.write(Buffer.from([byte]));f.stdin.end();await wait(()=>f.provider.requests.length===1);f.provider.release();await f.run;
  expect(f.core.getMessages().find(message=>message.role==='user')?.content).toBe('Inspect 👩🏽‍💻 файлы');
 }finally{f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});

it('queues Enter follow-ups and reserves Tab for steering',async()=>{
 const f=fixture(()=>{}),events:string[]=[];
 try{
  await wait(()=>!!f.core);f.core.subscribe(event=>{if(event.kind==='catalog')events.push(event.event);});
  f.stdin.write('Main task\r');await wait(()=>f.provider.requests.length===1);
  f.stdin.write('Follow-up task\r');await wait(()=>events.includes('prompt.queued'));
  expect(events).not.toContain('prompt.steer');f.provider.release();f.stdin.end();await f.run;
  expect(f.provider.requests).toHaveLength(2);
  expect(f.core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task','Follow-up task']);
 }finally{f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});

it('waits for an independent command on EOF even after the main turn finishes',async()=>{
 let entered=false,release=()=>{},finished=false;
 const f=fixture(async()=>{entered=true;await new Promise<void>(done=>{release=done;});});
 void f.run.then(()=>{finished=true;});
 try{
  f.stdin.write('Main task\r');await wait(()=>f.provider.requests.length===1);
  f.stdin.write('/control\r');await wait(()=>entered);f.stdin.end();f.provider.release();
  await wait(()=>f.core.getState()==='idle');await new Promise(done=>setImmediate(done));
  expect(finished).toBe(false);release();await f.run;expect(finished).toBe(true);
 }finally{release();f.provider.release();f.stdin.end();await f.run;await f.core.close();}
});
