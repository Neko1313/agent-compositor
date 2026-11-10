import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {buildAppWithPlugins as buildApp} from "./plugin-fixture.js";
import { AGENT_INSTRUCTIONS, ScriptedProvider } from "@agent-compositor/core";

const roots:string[]=[];
async function fixture(config:unknown={}) {
  const cwd=await mkdtemp("/tmp/ac-ext-core-");roots.push(cwd);
  await writeFile(join(cwd,"agent-compositor.json"),JSON.stringify(config));
  return {cwd,env:{HOME:join(cwd,"home")}};
}
async function plugin(cwd:string,name:string,hooks:string,tools?:string,extra:Record<string,unknown>={}) {
  const dir=join(cwd,"plugins",name);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"plugin.json"),JSON.stringify({name,version:"1.0.0",trust:"trusted",main:"hooks.js",...extra}));
  await writeFile(join(dir,"hooks.js"),hooks);
  if(tools)await writeFile(join(dir,"tools.js"),tools);
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});

describe("external core customization",()=>{
  it("rejects malformed composition settings before importing extensions",async()=>{
    const options=await fixture({enabledPlugins:"not-an-array"});
    const marker=join(options.cwd,"must-not-import");
    await plugin(options.cwd,"candidate",`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export const hooks={};`);
    await expect(buildApp({...options,provider:new ScriptedProvider([])})).rejects.toThrow();
    await expect(readFile(marker)).rejects.toThrow();
  });

  it("loads a selected strategy, private event and replacement tool from disk without coding capabilities; reload and resume keep the composition",async()=>{
    const options=await fixture({enabledPlugins:["extension","agent-harness"],toolProviders:{read:"extension"},
      serviceProviders:{"service.agent.run":"extension"},agent:{builtinTools:[],controlTools:[],tools:["read"],skills:false,projectContext:false,fileReferences:false}});
    await writeFile(join(options.cwd,"AGENTS.md"),"INSTRUCTIONS THAT MUST NOT LOAD");
    const zod=new URL("../../../node_modules/zod/index.js",import.meta.url).href;
    const hooks=`import {z} from ${JSON.stringify(zod)};
      export const events=[{name:'plugin.extension:lookup',since:'1.0.0',version:1,summary:'Lookup',frozen:true,
        input:z.object({id:z.string()}),responses:[{kind:'value',summary:'Result',schema:z.object({value:z.string()})}]}];
      export const hooks={
        'plugin.extension:lookup':e=>({value:'observed '+e.id}),
        'service.agent.run':async(e,$)=>{const ctx=e.context;
          await ctx.execute([{id:'lookup',name:'read',args:{id:'one'}}]);
          const text=ctx.messages().at(-1).content;await ctx.publish(text);return{value:{text}};}
      };`;
    await plugin(options.cwd,"extension",hooks,`export default [{name:'read',description:'Selected structured read',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']},
      describe:()=>({tool:'read'}),execute:async(ctx,args)=>({ok:true,data:await ctx.request('plugin.extension:lookup',args)})}];`,{provides:["service.agent.run"]});
    const fallback=new ScriptedProvider([]),app=await buildApp({...options,provider:fallback});
    try {
      expect(app.pluginErrors).toEqual([]);const core=app.createCore(async()=>false);await core.start();
      await core.submit("Inspect @a-resource");expect(core.failure).toBeUndefined();
      expect(core.getMessages().at(-1)?.content).toBe('"observed one"');expect(fallback.requests).toEqual([]);
      expect(core.getMessages().some(m=>m.content.includes("INSTRUCTIONS THAT MUST NOT LOAD"))).toBe(false);
      expect(await core.invokeTool("exec",{command:"true"})).toMatchObject({ok:false});
      expect(app.commands().some(c=>c.name==="/agents")).toBe(false);
      await app.reloadPlugins(core);
      expect((await core.host.emit("prompt.submit",{text:"/tasks"})).value).toMatchObject({drop:"task plan opened"});
      await core.submit("Again");expect(core.failure).toBeUndefined();
      const resumed=await app.resume(core.sessionId,async()=>false);await resumed.start();await resumed.submit("Resume");
      expect(resumed.failure).toBeUndefined();expect(resumed.getMessages().at(-1)?.content).toBe('"observed one"');
    } finally {await app.close();}
  });

  it("skips excluded executable code before import, isolates a broken hook and advertises no forced tools",async()=>{
    const options=await fixture({enabledPlugins:["broken","agent-harness"],agent:{tools:[],builtinTools:[],controlTools:[],skills:false}});
    const marker=join(options.cwd,"unexpected-import");
    await plugin(options.cwd,"excluded",`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export const hooks={};`);
    await plugin(options.cwd,"broken",`export const hooks={'prompt.submti':()=>{}};`);
    const provider=new ScriptedProvider([{text:"done"}]),app=await buildApp({...options,provider});
    try {
      expect(app.pluginErrors[0]?.error).toContain("unknown hook");
      const core=app.createCore(async()=>false);await core.submit("Help");expect(core.failure).toBeUndefined();
      expect(provider.requests[0].tools).toEqual([]);expect(provider.requests[0].messages[0].content).toBe(AGENT_INSTRUCTIONS);
      await expect(readFile(marker)).rejects.toThrow();
    } finally {await app.close();}
  });

  it("routes the standard login command through a replacement authentication service",async()=>{
    const options=await fixture();
    await plugin(options.cwd,"custom-auth",`export const hooks={'service.auth.login':async(e,$)=>{await $.storage.set('used',true);return{value:{status:'custom login'}};}};`);
    const app=await buildApp({...options,provider:new ScriptedProvider([]),agentHub:false});
    try {
      const core=app.createCore(async()=>false);await core.start();await core.submit("/login");
      expect(core.failure).toBeUndefined();
      expect(await app.storage.read("custom-auth","used","project",core.sessionId)).toBe(true);
    } finally {await app.close();}
  });
});
