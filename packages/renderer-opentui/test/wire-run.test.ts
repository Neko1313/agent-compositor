import {PassThrough,Writable} from 'node:stream';
import {describe,it,expect} from 'vitest';
import {hello,nativeProtocolElements,type WireMessage} from '@agent-compositor/protocol';
import {runOpenTuiWireRenderer} from '../src/wire-run.js';

const peer=()=>hello('core',{surfaces:['headless'],sites:[],elements:['Text'],encodings:['jsonl']});
const full:WireMessage={type:'render',surface:'main',mode:'full',flush:true,grid:[[{ch:'窗'},{ch:'A'}]]};
function io(){let text='';const stdout=new Writable({write(chunk,_encoding,next){text+=String(chunk);next();}}) as NodeJS.WriteStream;return{stdin:new PassThrough() as NodeJS.ReadStream,stdout,text:()=>text};}
function queue(){const values:WireMessage[]=[];let wake:(()=>void)|undefined,ended=false;return{push(value:WireMessage){values.push(value);wake?.();},end(){ended=true;wake?.();},source:{async *[Symbol.asyncIterator](){while(!ended||values.length){if(values.length)yield values.shift()!;else await new Promise<void>(resolve=>{wake=resolve;});}}}};}
const until=async(predicate:()=>boolean)=>{for(let i=0;i<20&&!predicate();i++)await new Promise<void>(resolve=>setImmediate(resolve));expect(predicate()).toBe(true);};
async function* from(...messages:WireMessage[]){yield* messages;}

describe('complete OpenTUI wire lifecycle',()=>{
 it('negotiates, renders a final redirected Unicode frame and completes at EOF',async()=>{
  const streams=io(),sent:WireMessage[]=[],exits:number[]=[];
  const handle=await runOpenTuiWireRenderer({...streams,source:from(peer(),full),send:m=>sent.push(m),exit:code=>exits.push(code)});
  await handle.waitUntilExit;expect(sent.map(m=>m.type)).toEqual(['hello','hello-ack']);
  expect(sent[1]).toMatchObject({type:'hello-ack',ok:true});expect(streams.text()).toContain('窗A');expect(exits).toEqual([0]);
  await handle.stop();expect(exits).toEqual([0]);expect(sent[0]).toMatchObject({capabilities:{elements:['Text','Box','Layout']}});
 });
 it('stops on bye and leaves subsequent source messages unread',async()=>{
  const handle=await runOpenTuiWireRenderer({...io(),source:from(peer(),full,{type:'bye'}, {...full,surface:'after'}),send(){}});
  await handle.waitUntilExit;expect(handle.store.state.grids.has('after')).toBe(false);
 });
 it('honors exitOnBye false until EOF or an explicit stop',async()=>{
  const pending=queue();let closed=false;
  const handle=await runOpenTuiWireRenderer({...io(),source:pending.source,send(){},exitOnBye:false});void handle.waitUntilExit.then(()=>{closed=true;});
  pending.push(peer());pending.push({type:'bye'});pending.push(full);await until(()=>handle.store.state.grids.has('main'));expect(closed).toBe(false);
  pending.end();await handle.waitUntilExit;expect(closed).toBe(true);
 });
 it('reports a negative ACK and cleans up instead of hanging',async()=>{
  const exits:number[]=[],handle=await runOpenTuiWireRenderer({...io(),source:from({type:'hello-ack',ok:false,reason:'denied'}),send(){},exit:code=>exits.push(code)});
  await expect(handle.waitUntilExit).rejects.toThrow('denied');await handle.stop();expect(exits).toEqual([1]);
 });
 it('answers incompatible hello with an exact rejection and reports failure',async()=>{
  const sent:WireMessage[]=[],handle=await runOpenTuiWireRenderer({...io(),source:from({...peer(),version:'9.0.0'}),send:m=>sent.push(m)});
  await expect(handle.waitUntilExit).rejects.toThrow('handshake rejected');expect(sent.at(-1)).toMatchObject({type:'hello-ack',ok:false});
 });
 it('does not advertise native bridge ownership and rejects malformed known-protocol hello',async()=>{
  const sent:WireMessage[]=[],local={...peer(),role:'renderer' as const};local.capabilities.elements.push(...nativeProtocolElements);
  const valid=await runOpenTuiWireRenderer({...io(),source:from(),send:m=>sent.push(m),localHello:local});await valid.waitUntilExit;
  expect(sent[0]).toMatchObject({capabilities:{elements:['Text']}});
  const malformed=await runOpenTuiWireRenderer({...io(),source:from({...peer(),capabilities:undefined} as unknown as WireMessage),send(){}});await expect(malformed.waitUntilExit).rejects.toThrow();
 });
 it('propagates source, malformed message and transport failures',async()=>{
  const broken={async *[Symbol.asyncIterator](){yield peer();throw Error('source broke');}};
  const source=await runOpenTuiWireRenderer({...io(),source:broken,send(){}});await expect(source.waitUntilExit).rejects.toThrow('source broke');
  const malformed=await runOpenTuiWireRenderer({...io(),source:from({type:'focus'} as WireMessage),send(){}});await expect(malformed.waitUntilExit).rejects.toThrow();
  const transport=await runOpenTuiWireRenderer({...io(),source:from(peer()),send(){throw Error('send broke');}});await expect(transport.waitUntilExit).rejects.toThrow('send broke');
 });
 it('does not await a blocked pull or blocked iterator return on stop',async()=>{
  let returns=0;const source={ [Symbol.asyncIterator](){return{next:()=>new Promise<IteratorResult<WireMessage>>(()=>{}),return:()=>{returns++;return new Promise<IteratorResult<WireMessage>>(()=>{});}};}};
  const handle=await runOpenTuiWireRenderer({...io(),source,send(){}});await handle.stop();await handle.waitUntilExit;expect(returns).toBe(1);await handle.stop();expect(returns).toBe(1);
 });
 it('aborts a blocked source and removes its abort subscription',async()=>{
  const controller=new AbortController(),pending=queue(),handle=await runOpenTuiWireRenderer({...io(),source:pending.source,send(){},signal:controller.signal});
  controller.abort();await handle.waitUntilExit;await handle.stop();
 });
 it('supports external work, rejects concurrent suspension and remains stopped afterward',async()=>{
  const pending=queue(),handle=await runOpenTuiWireRenderer({...io(),source:pending.source,send(){}});let release!:()=>void;
  const external=handle.runExternal(()=>new Promise<void>(resolve=>{release=resolve;}));await expect(handle.runExternal(async()=>{})).rejects.toThrow('already suspended');release();await external;
  await expect(handle.runExternal(async()=>{throw Error('external failed');})).rejects.toThrow('external failed');
  await handle.stop();await expect(handle.runExternal(async()=>{})).rejects.toThrow('has stopped');
 });
 it('reports final output and exit hook errors without leaving waitUntilExit pending',async()=>{
  const streams=io();streams.stdout.write=()=>{throw Error('output broke');};
  const output=await runOpenTuiWireRenderer({...streams,source:from(full),send(){}});await expect(output.waitUntilExit).rejects.toThrow('output broke');
  const exit=await runOpenTuiWireRenderer({...io(),source:from(),send(){},exit(){throw Error('exit broke');}});await expect(exit.waitUntilExit).rejects.toThrow('exit broke');
 });
});
