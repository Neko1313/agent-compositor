import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEvent } from "@agent-compositor/events";
import { Runtime } from "../src/index.js";

const manifest=(name:string,extra={})=>({name,version:"1.0.0",trust:"trusted" as const,...extra});
async function emit(runtime:Runtime,event="tool.call",input:unknown={tool:"read",input:{path:"one"},callId:"c"}) {
  const iterator=runtime.emit(event,input),yields:unknown[]=[];
  while(true){const step=await iterator.next();if(step.done)return {...step.value,yields};yields.push(step.value);}
}

describe("extension composition",()=>{
  it("keeps streaming backpressure and does not replay an action when its consumer closes",async()=>{
    const runtime=new Runtime();let produced=0,executed=0;
    runtime.register(manifest("progress"),{"tool.call":async function*(){
      for(let n=0;n<10;n++){produced++;yield n;}
    }});
    runtime.setResolver("tool.call",()=>{executed++;return{result:"done"};});
    const iterator=runtime.emit("tool.call",{tool:"read",input:{},callId:"c"});
    expect((await iterator.next()).value).toBe(0);expect(produced).toBe(1);
    await iterator.return({value:undefined,faults:[]});
    await new Promise(resolve=>setTimeout(resolve,5));expect(executed).toBe(0);
  });

  it("reports a failed explicitly selected provider without silently executing a different backend",async()=>{
    let calls=0;
    const runtime=new Runtime({providers:{"service.project.query":"selected"}});
    runtime.register(manifest("selected",{provides:["service.project.query"]}),{"service.project.query":()=>{throw Error("offline");}});
    runtime.setResolver("service.project.query",()=>{calls++;return{value:"wrong backend"};});
    await expect(emit(runtime,"service.project.query",{cwd:".",action:"status"})).rejects.toThrow("Selected provider");
    expect(calls).toBe(0);
  });

  it("supports actual before/after middleware and never replays a completed action after a wrapper error",async()=>{
    const runtime=new Runtime(),order:string[]=[];let calls=0;
    runtime.register(manifest("wrapper"),{"tool.call":async(_e,$)=>{
      order.push("before");const result=await $.next() as {result:string};order.push("after");
      return {result:result.result+" wrapped"};
    }});
    runtime.setResolver("tool.call",()=>{calls++;order.push("execute");return{result:"done"};});
    expect((await emit(runtime)).value).toEqual({result:"done wrapped"});
    expect(order).toEqual(["before","execute","after"]);expect(calls).toBe(1);
    runtime.unregister("wrapper");
    runtime.register(manifest("broken-wrapper"),{"tool.call":async(_e,$)=>{await $.next();throw Error("after effect");}});
    const result=await emit(runtime);expect(result.value).toEqual({result:"done"});
    expect(result.faults).toMatchObject([{kind:"error",message:"after effect"}]);expect(calls).toBe(2);
  });

  it("streams downstream generator output while an outer hook awaits next",async()=>{
    const runtime=new Runtime();let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    runtime.register(manifest("outer"),{"turn.step":async(_e,$)=>await $.next()});
    runtime.register(manifest("inner"),{"turn.step":async function*(){yield "first";await gate;yield "second";}});
    const iterator=runtime.emit("turn.step",{turnId:"t"});
    expect(await iterator.next()).toMatchObject({done:false,value:"first"});release();
    expect(await iterator.next()).toMatchObject({done:false,value:"second"});
    expect((await iterator.next()).done).toBe(true);
  });

  it("continues after an async hook that never cooperates with cancellation",async()=>{
    const runtime=new Runtime();let cancelled=false,calls=0;
    runtime.register(manifest("stuck",{hookTimeouts:{"tool.call":15}}),{"tool.call":async(_e,$)=>{
      $.signal.addEventListener("abort",()=>{cancelled=true;});await new Promise(()=>{});
    }});
    runtime.setResolver("tool.call",()=>{calls++;return{result:"fallback"};});
    const result=await emit(runtime);
    expect(cancelled).toBe(true);expect(calls).toBe(1);expect(result.value).toEqual({result:"fallback"});
    expect(result.faults[0]?.kind).toMatch(/budget$/);
  });

  it("validates registration atomically and applies explicit priority within a tier",async()=>{
    const runtime=new Runtime(),order:string[]=[];
    expect(()=>runtime.register(manifest("bad"),{"tool.call":()=>{order.push("orphan");},"unknown.hook":()=>{}})).toThrow();
    runtime.register(manifest("late",{priority:10}),{"tool.call":()=>{order.push("late");}});
    runtime.register(manifest("early",{priority:-10}),{"tool.call":()=>{order.push("early");}});
    await emit(runtime);expect(order).toEqual(["early","late"]);
  });

  it("owns extension event schemas per runtime and removes them on unload",async()=>{
    const event=defineEvent({name:"plugin.example:lookup",since:"1.0.0",version:1,summary:"Lookup",frozen:true,
      input:z.object({key:z.string()}),responses:[{kind:"value",summary:"Result",schema:z.object({value:z.string()})}]});
    const runtime=new Runtime();
    runtime.register(manifest("example"),{[event.name]:e=>({value:e.key})},"user",[event]);
    expect((await emit(runtime,event.name,{key:"ok"})).value).toEqual({value:"ok"});
    await expect(emit(runtime,event.name,{key:42})).rejects.toThrow();
    expect(new Runtime().resolve(event.name)).toBeUndefined();
    runtime.unregister("example");expect(runtime.resolve(event.name)).toBeUndefined();
    expect(()=>runtime.register(manifest("other"),{},"user",[event])).toThrow("event definition");
  });
});
