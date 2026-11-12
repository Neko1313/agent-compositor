import {it,expect} from 'vitest';
import {PassThrough,Writable} from 'node:stream';
import {AgentCore,ScriptedProvider} from '@agent-compositor/core';
import {runRepl} from '../src/repl.js';

function fixture(raw:boolean,question=false){
 const stdin=Object.assign(new PassThrough(),{isTTY:raw,setRawMode:(_value:boolean)=>{}});
 const provider=new ScriptedProvider([{toolCalls:[question?{name:'ask_user',args:{question:'Choose target',options:['Stage','Prod']}}:{name:'guarded',args:{}}]},{text:'DONE'}]);
 let output='',effects=0,core!:AgentCore;
 const run=runRepl({stdin,stdout:new Writable({write(chunk,_encoding,done){output+=chunk.toString();done();}}),createCore:(onApproval,onAsk)=>core=new AgentCore({cwd:process.cwd(),provider,onApproval,onAsk,
  tools:[{name:'guarded',description:'Controlled effect',parameters:{type:'object'},describe:()=>({tool:'guarded'}),execute:async()=>{effects++;return{ok:true,data:'APPLIED'};}}]})});
 return{stdin,provider,run,get core(){return core;},get output(){return output;},get effects(){return effects;}};
}

it.each(['y','n'])('consumes raw approval answer %s without submitting it as a task',async answer=>{
 const f=fixture(true);
 try{
  f.stdin.write('Main task\r');await expect.poll(()=>f.output.includes('Allow?')).toBe(true);
  f.stdin.write(answer+'\r');await expect.poll(()=>f.provider.requests.length).toBe(2);f.stdin.end();await f.run;
  expect(f.effects).toBe(answer==='y'?1:0);expect(f.core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task']);
 }finally{f.stdin.end();await f.run;await f.core.close();}
});

it('keeps a raw questionnaire answer out of the conversation',async()=>{
 const f=fixture(true,true);
 try{
  f.stdin.write('Main task\r');await expect.poll(()=>f.output.includes('answer:')).toBe(true);f.stdin.write('2\r\n');
  await expect.poll(()=>f.provider.requests.length).toBe(2);f.stdin.end();await f.run;
  expect(JSON.parse(f.core.getMessages().find(message=>message.role==='tool')!.content)).toEqual({answer:'Prod'});
  expect(f.core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task']);
 }finally{f.stdin.end();await f.run;await f.core.close();}
});

it.each([false,true])('denies unanswered approval on EOF (raw: %s)',async raw=>{
 const f=fixture(raw);
 try{
  f.stdin.end('Main task\r');await f.run;expect(f.effects).toBe(0);expect(f.provider.requests).toHaveLength(2);
  expect(f.core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Main task']);
 }finally{f.stdin.end();await f.run;await f.core.close();}
});
