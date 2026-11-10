import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { AgentCore, ScriptedProvider, type AgentTurnContext } from "../src/index.js";
import type { ToolSpec } from "@agent-compositor/tools";

const roots:string[]=[];
async function root(){const dir=await mkdtemp('/tmp/ac-core-custom-');roots.push(dir);return dir;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
const manifest=(name:string)=>({name,version:"1.0.0",trust:"trusted" as const});

describe("replaceable core strategies",()=>{
  it("replaces sequential tool scheduling with parallel execution through the same permission gate",async()=>{
    const cwd=await root();let started=0,release!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const tools:ToolSpec[]=["first","second"].map(name=>({name,description:name,parameters:{type:"object"},describe:()=>({tool:name}),execute:async()=>{
      if(++started===2)release();await barrier;return{ok:true,data:name};
    }}));
    const provider=new ScriptedProvider([{toolCalls:tools.map(t=>({name:t.name,args:{}}))},{text:"joined"}]);
    const core=new AgentCore({cwd,provider,tools,controlTools:[],rules:tools.map(t=>({tool:t.name,decision:"allow" as const})),plugins:[{
      manifest:manifest("parallel"),hooks:{"service.agent.batch":async e=>{
        await Promise.all(e.calls.map((call:any)=>e.context.execute(call)));return{value:true};
      }},
    }]});
    await core.submit("Inspect both");expect(core.failure).toBeUndefined();expect(started).toBe(2);
    expect(provider.requests[1].messages.filter(m=>m.role==="tool").map(m=>m.name).sort()).toEqual(["first","second"]);
  });

  it("inherits a custom strategy and exact selected capabilities in delegated sessions without a mandatory fallback model",async()=>{
    const cwd=await root(),observed:string[][]=[];
    const core=new AgentCore({cwd,tools:[],controlTools:["task"],toolNames:["task"],plugins:[{
      manifest:manifest("delegation"),hooks:{"service.agent.run":async e=>{
        const ctx=e.context as AgentTurnContext;observed.push(ctx.tools().map(tool=>tool.name));
        const prompt=ctx.messages().at(-1)?.content;
        if(prompt==="child")return{value:{text:"child result"}};
        await ctx.execute([{id:"delegate",name:"task",args:{prompt:"child"}}]);
        return{value:{text:ctx.messages().at(-1)!.content}};
      }},
    }]});
    await core.submit("parent");expect(core.failure).toBeUndefined();
    expect(core.getMessages().at(-1)?.content).toContain("child result");
    expect(observed).toEqual([["task"],["task"]]);
  });

  it("replaces the turn algorithm through a plugin while preserving permissions, events, accounting and transcript",async()=>{
    const cwd=await root(),provider=new ScriptedProvider([{text:"charged stream",usage:{inputTokens:10,outputTokens:3}}]);
    let saved:AgentTurnContext|undefined,executed=0;
    const tool:ToolSpec={name:"inspect",description:"Inspect",parameters:{type:"object"},describe:()=>({tool:"inspect"}),execute:async()=>{executed++;return{ok:true,data:"observed"};}};
    const core=new AgentCore({cwd,provider,tools:[tool],controlTools:[],rules:[{tool:"inspect",decision:"allow"}],plugins:[{
      manifest:manifest("strategy"),hooks:{"service.agent.run":async(e)=>{
        const ctx=e.context as AgentTurnContext;saved=ctx;
        expect(ctx.messages().at(-1)?.content).toBe("Inspect the service");
        await ctx.execute([{id:"inspect-1",name:"inspect",args:{}}]);
        let text="";for await(const event of ctx.stream())if(event.type==="text_delta")text+=event.text;
        text=await ctx.publish(text);return{value:{text}};
      },"assistant.text":e=>({text:e.text.toUpperCase()})},
    }]});
    const events:string[]=[],usage:unknown[]=[];core.subscribe(e=>{if(e.kind==="catalog"){events.push(e.event);if(e.event==="turn.usage")usage.push(e.input);}});
    await core.submit("Inspect the service");
    expect(core.failure).toBeUndefined();expect(executed).toBe(1);
    expect(core.getMessages().at(-1)?.content).toBe("CHARGED STREAM");
    expect(core.getMessages().some(m=>m.role==="tool"&&m.toolCallId==="inspect-1")).toBe(true);
    expect(core.getBudget().spentTokens).toBe(13);
    expect(usage).toMatchObject([{inputTokens:10,outputTokens:3}]);
    expect(events).toEqual(expect.arrayContaining(["turn.start","tool.check","tool.result","turn.complete"]));
    expect(()=>saved!.append({role:"user",content:"late"})).toThrow("expired");
  });

  it("passes transformed tool arguments to both permissions and execution",async()=>{
    const cwd=await root();let permissionPath:string|undefined;
    const provider=new ScriptedProvider([{toolCalls:[{name:"write",args:{path:"old.txt",content:"old"}}]},{text:"done"}]);
    const core=new AgentCore({cwd,provider,onApproval:async e=>{permissionPath=e.descriptor.path;return true;},plugins:[{
      manifest:manifest("rewrite"),hooks:{"tool.call":(e,$)=>$.next({...e,input:{path:"new.txt",content:"changed"}})},
    }]});
    await core.submit("Write");expect(core.failure).toBeUndefined();
    expect(permissionPath).toBe(cwd+"/new.txt");expect(await readFile(cwd+"/new.txt","utf8")).toBe("changed");
    await expect(readFile(cwd+"/old.txt")).rejects.toThrow();
  });

  it("can remove every automatic tool and replace a built-in schema and handler explicitly",async()=>{
    const cwd=await root();await writeFile(cwd+"/file","builtin");
    const empty=new AgentCore({cwd,provider:new ScriptedProvider([]),tools:[],controlTools:[]});
    expect(await empty.invokeTool("read",{path:"file"})).toMatchObject({ok:false});
    const read:ToolSpec={name:"read",description:"Selected API read",parameters:{type:"object",properties:{id:{type:"string"}},required:["id"]},describe:()=>({tool:"read"}),execute:async(_ctx,args:any)=>({ok:true,data:args.id})};
    const provider=new ScriptedProvider([{toolCalls:[{name:"read",args:{id:"resource"}}]},{text:"done"}]);
    const core=new AgentCore({cwd,provider,toolNames:["read"],toolOverrides:[read]});await core.submit("Read");
    expect(provider.requests[0].tools).toEqual([{name:"read",description:read.description,parameters:read.parameters}]);
    expect(core.getMessages().find(m=>m.role==="tool")?.content).toBe('"resource"');
    expect(await core.invokeTool("exec",{command:"true"})).toMatchObject({ok:false});
  });

  it("replaces input preparation, context strategy, compaction and journal writes",async()=>{
    const writes:any[]=[],cwd=await root();let managed=0;
    const provider=new ScriptedProvider([{text:"done"}]);
    const core=new AgentCore({cwd,provider,tools:[],controlTools:[],plugins:[{manifest:manifest("context"),hooks:{
      "service.context.prepare":e=>({value:"Prepared: "+e.text}),
      "service.context.manage":()=>{managed++;return{value:true};},
      "service.context.compact":async e=>{await(e.context as AgentTurnContext).replace([{role:"user",content:"summary"}]);return{value:true};},
      "service.session.append":e=>{writes.push(e);return{value:true};},
    }}]});
    await core.submit("input");expect(managed).toBe(1);
    expect(provider.requests[0].messages[0].content).toBe("Prepared: input");
    expect(writes.some(e=>e.event==="turn.complete")).toBe(true);
    expect(writes.some(e=>e.event==="service.agent.run")).toBe(false);
    await core.compactNow();expect(core.getMessages()).toEqual([{role:"user",content:"summary"}]);
  });

  it("revokes a timed-out strategy context before running the default strategy",async()=>{
    const cwd=await root();let saved:AgentTurnContext|undefined;
    const core=new AgentCore({cwd,provider:new ScriptedProvider([{text:"fallback"}]),plugins:[{
      manifest:{...manifest("stuck"),hookTimeouts:{"service.agent.run":15}},hooks:{"service.agent.run":async e=>{
        saved=e.context;await new Promise(()=>{});
      }},
    }]});
    await core.submit("Continue");expect(core.failure).toBeUndefined();
    expect(core.getMessages().at(-1)?.content).toBe("fallback");
    expect(()=>saved!.append({role:"user",content:"late"})).toThrow();
  });
});
