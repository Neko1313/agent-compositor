import {afterEach,describe,expect,it,vi} from 'vitest';
import {hello,nativeProtocolElements,type NativeStateMessage,type WireMessage} from '@agent-compositor/protocol';

const widget=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('../src/run.js',()=>({runConversationPrototype:widget.run}));
import {runOpenTuiNativeRenderer} from '../src/native-run.js';

function state():NativeStateMessage{return{type:'native-state',epoch:'connection-1',revision:1,state:{
  sessions:[{port:'session-1',id:'journal-1',conversationId:'main',generation:1,paneId:'session',label:'Main',current:true,
    snapshot:{messages:[],running:false}}],windows:[{id:'session',label:'Main',session:'session-1'}],surfaces:[],publicRender:[],immediateCommands:[],
  layout:{revision:1,width:80,height:25,frames:[{surface:'session',x:0,y:0,width:80,height:25}],focused:'session',workspace:1,
    workspaces:[1],locations:{session:1},axis:'horizontal',fullscreen:false,compact:false,pointer:'default'},
}};}
function channel(){
  const items:IteratorResult<WireMessage>[]=[];let wake:((item:IteratorResult<WireMessage>)=>void)|undefined;
  const source={
    [Symbol.asyncIterator](){return this;},
    next:vi.fn(()=>new Promise<IteratorResult<WireMessage>>(done=>{const item=items.shift();if(item)done(item);else wake=done;})),
    // A noncooperative producer must not prevent renderer cleanup.
    return:vi.fn(()=>new Promise<IteratorResult<WireMessage>>(()=>{})),
  };
  const write=(item:IteratorResult<WireMessage>)=>{if(wake){const done=wake;wake=undefined;done(item);}else items.push(item);};
  return{source,push:(value:WireMessage)=>write({done:false,value}),end:()=>write({done:true,value:undefined})};
}
function greet(queue:ReturnType<typeof channel>){queue.push(hello('core',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements],encodings:['jsonl']}));queue.push({type:'hello-ack',ok:true,version:'0.7.0'});queue.push(state());}
function mounted(){
  let stopped=0;
  widget.run.mockImplementation((_sessions,options)=>new Promise<void>(done=>{
    const stop=()=>{stopped++;done();};if(options.signal.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});
  }));return()=>stopped;
}
afterEach(()=>{widget.run.mockReset();});

describe('native protocol runner lifetime',()=>{
  it('cleans up an active widget on normal source EOF',async()=>{
    const queue=channel(),stopped=mounted(),send=vi.fn();greet(queue);
    const renderer=await runOpenTuiNativeRenderer({source:queue.source,send});
    await vi.waitFor(()=>expect(widget.run).toHaveBeenCalledTimes(1));queue.end();await renderer.waitUntilExit;
    expect(stopped()).toBe(1);expect(queue.source.return).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.some(([message])=>message.type==='hello')).toBe(true);
    await renderer.stop();expect(stopped()).toBe(1);
  });

  it('rejects failed capability negotiation without mounting or retaining a blocked producer',async()=>{
    const queue=channel();mounted();queue.push({...hello('core',{surfaces:['terminal'],sites:[],elements:['Text'],encodings:['jsonl']}),version:'0.6.0'});
    const renderer=await runOpenTuiNativeRenderer({source:queue.source,send:vi.fn()});
    await expect(renderer.waitUntilExit).rejects.toThrow('negotiation');expect(widget.run).not.toHaveBeenCalled();expect(queue.source.return).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed source state after negotiation without waiting forever for readiness',async()=>{
    const queue=channel();mounted();
    queue.push(hello('core',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements],encodings:['jsonl']}));
    queue.push({type:'hello-ack',ok:true,version:'0.7.0'});
    // An exported JavaScript source can violate its TypeScript message type.
    queue.push({...state(),revision:-1} as WireMessage);
    const renderer=await runOpenTuiNativeRenderer({source:queue.source,send:vi.fn()});
    await expect(renderer.waitUntilExit).rejects.toThrow('revision');
    expect(widget.run).not.toHaveBeenCalled();expect(queue.source.return).toHaveBeenCalledTimes(1);
    expect(renderer.client.pending()).toBe(false);
  });

  it('propagates a source failure and aborts an already mounted widget exactly once',async()=>{
    let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),stopped=mounted();
    async function* source(){yield hello('core',{surfaces:['terminal'],sites:[],elements:[...nativeProtocolElements],encodings:['jsonl']});yield {type:'hello-ack',ok:true,version:'0.7.0'} as const;yield state();await gate;throw Error('Controlled wire failure');}
    const renderer=await runOpenTuiNativeRenderer({source:source(),send:vi.fn()});await vi.waitFor(()=>expect(widget.run).toHaveBeenCalledTimes(1));
    release();await expect(renderer.waitUntilExit).rejects.toThrow('Controlled wire failure');expect(stopped()).toBe(1);
  });

  it('stops while next and return are both blocked without awaiting producer cooperation',async()=>{
    const queue=channel(),stopped=mounted();greet(queue);const renderer=await runOpenTuiNativeRenderer({source:queue.source,send:vi.fn()});
    await vi.waitFor(()=>expect(widget.run).toHaveBeenCalledTimes(1));await renderer.stop();await renderer.stop();
    expect(stopped()).toBe(1);expect(queue.source.return).toHaveBeenCalledTimes(1);expect(renderer.client.pending()).toBe(false);
  });

  it('settles pending readiness when externally aborted before a first state',async()=>{
    const queue=channel(),signal=new AbortController();mounted();
    const renderer=await runOpenTuiNativeRenderer({source:queue.source,send:vi.fn(),signal:signal.signal});signal.abort();await renderer.waitUntilExit;
    expect(widget.run).not.toHaveBeenCalled();expect(queue.source.return).toHaveBeenCalledTimes(1);
  });

  it('does not leave readiness or source consumption alive when sending hello throws',async()=>{
    const queue=channel();mounted();const renderer=await runOpenTuiNativeRenderer({source:queue.source,send:()=>{throw Error('Controlled send failure');}});
    await expect(renderer.waitUntilExit).rejects.toThrow('Controlled send failure');expect(widget.run).not.toHaveBeenCalled();expect(queue.source.return).toHaveBeenCalledTimes(1);
  });

  it('closes an active widget and blocked source if a later outbound request throws',async()=>{
    const queue=channel(),stopped=mounted();greet(queue);
    const renderer=await runOpenTuiNativeRenderer({source:queue.source,send:message=>{
      if(message.type==='native-input')throw Error('Controlled late send failure');
    }});
    await vi.waitFor(()=>expect(widget.run).toHaveBeenCalledTimes(1));
    await renderer.client.navigation.handle({kind:'key',key:'left'});
    await expect(renderer.waitUntilExit).rejects.toThrow('Controlled late send failure');
    expect(stopped()).toBe(1);expect(queue.source.return).toHaveBeenCalledTimes(1);expect(renderer.client.pending()).toBe(false);
  });
});
