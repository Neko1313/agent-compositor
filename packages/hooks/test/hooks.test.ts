import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Runtime } from "@agent-compositor/runtime";
import { attach } from "../src/index.js";
import type { HooksApi, HooksHost } from "../src/index.js";

let dir: string;
let runtime: Runtime;
let host: HooksHost;

const manifest = (name: string, trust: "trusted" | "sandboxed" | "render-only" = "trusted") => ({
  name,
  version: "0.1.0",
  trust,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ac-hooks-"));
  runtime = new Runtime();
  host = attach(runtime, { session: { id: "s1", cwd: dir } });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("HooksHost / $ API", () => {
  it("keeps user UI actions independent of foreground cancellation and revokes them on unload",async()=>{
    const foreground=new AbortController();let press!:HooksApi,change!:HooksApi,nested!:HooksApi;
    host=attach(runtime,{session:{id:'ui-session',cwd:dir},signal:()=>foreground.signal});
    host.registerPlugin(manifest('settings'),{'ui.press':async(_e,$)=>{press=$;await $.emit('service.extension.control',{action:'list'});},'ui.change':(_e,$)=>{change=$;},'service.extension.control':(_e,$)=>{nested=$;return{value:{}};}});
    await host.emit('ui.press',{site:'settings',key:'open'});
    await host.emit('ui.change',{site:'settings',id:'search',value:'test'});
    foreground.abort();
    expect(press.signal.aborted).toBe(false);expect(change.signal.aborted).toBe(false);expect(nested.signal.aborted).toBe(false);
    host.unregisterPlugin('settings');
    expect(press.signal.aborted).toBe(true);expect(change.signal.aborted).toBe(true);expect(nested.signal.aborted).toBe(true);
  });
  it("retains trusted background services across foreground cancellation and revokes them on unload",async()=>{
    const foreground=new AbortController();let normal!:HooksApi,background!:HooksApi,writes=0;
    host=attach(runtime,{session:{id:'origin',cwd:dir},signal:()=>foreground.signal});
    runtime.setResolver('service.fs.write',()=>{writes++;return{value:true};});
    host.registerPlugin(manifest('worker'),{'session.start':(_e,$)=>{normal=$;background=$.background();}});
    await host.emit('session.start',{sessionId:'origin',cwd:dir,plugins:[]});
    foreground.abort(Error('Foreground interrupted'));
    await expect(normal.fs.write('blocked','x')).rejects.toThrow('Foreground interrupted');
    await background.fs.write('allowed','x');expect(writes).toBe(1);
    expect(background.session.id).toBe('origin');expect(background.signal.aborted).toBe(false);
    expect(()=>background.next()).toThrow('cannot continue');
    host.unregisterPlugin('worker');host.registerPlugin(manifest('worker'),{});
    expect(background.signal.aborted).toBe(true);
    await expect(background.fs.write('revoked','x')).rejects.toThrow('unloaded');expect(writes).toBe(1);
  });

  it("does not grant background capabilities to render-only or sandboxed plugins",async()=>{
    for(const trust of ['render-only','sandboxed'] as const){
      host.registerPlugin(manifest(trust,trust),{'ui.press':(_e,$)=>{$.background();}});
    }
    const result=await host.emit('ui.press',{site:'test',key:'background'});expect(result.faults).toHaveLength(2);
  });

  it("revokes retained API handles on unload even if another instance reuses the name",async()=>{
    let retained:HooksApi|undefined,writes=0;
    runtime.setResolver("service.fs.write",()=>{writes++;return{value:true};});
    host.registerPlugin(manifest("replaceable"),{"session.start":(_e,$)=>{retained=$;}});
    await host.emit("session.start",{sessionId:"s",cwd:dir,plugins:[]});
    host.unregisterPlugin("replaceable");host.registerPlugin(manifest("replaceable"),{});
    await expect(retained!.fs.write("old","late")).rejects.toThrow("unloaded");
    expect(retained!.signal.aborted).toBe(true);expect(writes).toBe(0);
  });

  it("blocks render-only file effects and agent mutations through public APIs",async()=>{
    let writes=0,clears=0;
    runtime.setResolver("service.fs.write",()=>{writes++;return{value:true};});
    runtime.setResolver("service.agent.clear",()=>{clears++;return{value:true};});
    for(const [name,operation] of Object.entries({file:($:HooksApi)=>$.fs.write("blocked","x"),clear:($:HooksApi)=>$.agent.clear(),emit:($:HooksApi)=>$.emit("service.agent.clear",{})})) {
      host.registerPlugin(manifest(name,"render-only"),{"ui.render":async(_e,$)=>{await operation($);}});
    }
    const result=await host.emit("ui.render",{site:"s",surface:"terminal",props:{}});
    expect(result.faults).toHaveLength(3);expect(writes).toBe(0);expect(clears).toBe(0);
  });

  it("routes agent controls and awaited authentication status through interceptable services",async()=>{
    const seen:unknown[]=[];
    host.registerPlugin(manifest("services"),{
      "service.agent.clear":()=>({deny:"retained"}),
      "service.auth.status":()=>({value:{loggedIn:true,provider:"replacement"}}),
      "session.start":async(_e,$)=>{
        seen.push($.auth.status().loggedIn,await $.auth.status());
        await expect($.agent.clear()).rejects.toThrow("retained");
      },
    });
    const result=await host.emit("session.start",{sessionId:"s",cwd:dir,plugins:[]});
    expect(result.faults).toEqual([]);expect(seen).toEqual([false,{loggedIn:true,provider:"replacement"}]);
  });

  it("rejects host API effects from a hook after its deadline",async()=>{
    let retained:HooksApi|undefined,writes=0;
    runtime.setResolver("service.fs.write",()=>{writes++;return{value:true};});
    host.registerPlugin({...manifest("late"),hookTimeouts:{"tool.call":10}}, {"tool.call":async(_e,$)=>{retained=$;await new Promise(()=>{});}});
    await host.emit("tool.call",{tool:"read",input:{},callId:"c"});
    await expect(retained!.fs.write("late","x")).rejects.toBeDefined();expect(writes).toBe(0);
  });

  it("hooks receive (event, $); $.next continues the chain; $.plugin identifies the caller", async () => {
    let seen = "";
    host.registerPlugin(manifest("a"), {
      "tool.call": (_e: unknown, $: HooksApi) => {
        seen = $.plugin;
        return $.next();
      },
    });
    const res = await host.emit("tool.call", { tool: "Bash", input: {}, callId: "c" });
    expect(seen).toBe("a");
    expect(res.value).toMatchObject({ callId: "c" });
  });

  it("exposes plugin questions through interceptable services and guards rendering",async()=>{
    runtime.setResolver('service.ui.ask',async args=>({value:{answer:(args as any).options[0].label}}));
    runtime.setResolver('service.ui.questionnaire',async()=>({value:{answers:[{id:'target',selected:['Stage']}]}}));
    const seen:unknown[]=[];
    host.registerPlugin(manifest('questions'),{
      'session.start':async(_e,$)=>{seen.push(await $.ui.ask({question:'Target?',options:[{label:'Stage',recommended:true}]}));seen.push(await $.ui.questionnaire({questions:[{id:'target',question:'Target?',options:['Stage']}]}));},
      'ui.render':async(_e,$)=>$.ui.questionnaire({questions:[{id:'target',question:'Target?'}]}),
    });
    expect((await host.emit('session.start',{sessionId:'s',cwd:dir,plugins:[]})).faults).toEqual([]);
    expect(seen).toEqual(['Stage',{answers:[{id:'target',selected:['Stage']}]}]);
    expect((await host.emit('ui.render',{site:'s',surface:'terminal',props:{}})).faults).toMatchObject([{message:expect.stringContaining('during ui.render')}]);
  });

  it("$.state is per-plugin isolated and survives between emissions", async () => {
    host.registerPlugin(manifest("counter"), {
      "session.start": (_e: unknown, $: HooksApi) => {
        $.state.set("n", (($.state.get<number>("n") ?? 0) + 1));
        return undefined;
      },
    });
    host.registerPlugin(manifest("spy"), {
      "session.start": (_e: unknown, $: HooksApi) => {
        $.state.set("n", 999);
        return undefined;
      },
    });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    let observed = 0;
    host.registerPlugin(manifest("reader"), {
      "session.end": (_e: unknown, $: HooksApi) => {
        observed = $.state.get<number>("n") ?? -1;
        return undefined;
      },
    });
    await host.emit("session.end", { reason: "other" });
    // reader never set n → -1; counter's n stays private
    expect(observed).toBe(-1);
  });

  it("writing state during ui.render is a recorded fault (fail-operational)", async () => {
    host.registerPlugin(manifest("bad-widget", "render-only"), {
      "ui.render": (_e: unknown, $: HooksApi) => {
        $.state.set("x", 1);
        return { tree: null };
      },
    });
    const res = await host.emit("ui.render", { site: "s", surface: "headless", props: {} });
    expect(res.faults).toMatchObject([
      { plugin: "bad-widget", kind: "error", message: expect.stringMatching(/during ui\.render/) },
    ]);
  });

  it("$.fs.write + $.fs.read roundtrip inside the workspace", async () => {
    host.registerPlugin(manifest("fsp"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        await $.fs.write("notes/a.txt", "hello");
        return undefined;
      },
    });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(readFileSync(join(dir, "notes/a.txt"), "utf8")).toBe("hello");
  });

  it("keeps async render read-only without blocking another event's state writes", async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    host.registerPlugin(manifest("async-view"), {
      "ui.render": async (_e, $) => { entered(); await gate; $.state.set("bad", true); },
      "session.start": (_e, $) => { $.state.set("ok", true); },
    });
    const rendering = host.emit("ui.render", { site: "s", surface: "terminal", props: {} });
    await ready;
    const concurrent = await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(concurrent.faults).toEqual([]);
    release();
    expect((await rendering).faults).toMatchObject([{ kind: "error", message: expect.stringContaining("during ui.render") }]);
  });

  it("$.fs escape attempts are recorded faults (fail-operational)", async () => {
    host.registerPlugin(manifest("esc"), {
      "session.start": (_e: unknown, $: HooksApi) => $.fs.read("../../etc/passwd"),
    });
    const res = await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(res.faults).toMatchObject([
      { plugin: "esc", kind: "error", message: expect.stringMatching(/escapes workspace/) },
    ]);
  });

  it("other plugins can intercept $.model.complete with { value }", async () => {
    host.registerPlugin(manifest("fake-model"), {
      "service.model.complete": () => ({ value: { text: "faked" } }),
    });
    let answer: unknown;
    host.registerPlugin(manifest("asker"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        answer = await $.model.complete({ messages: [] });
        return undefined;
      },
    });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(answer).toEqual({ text: "faked" });
  });

  it("a { deny } interception surfaces as PermissionError to the caller", async () => {
    host.registerPlugin(manifest("guard"), {
      "service.fs.write": (_e: unknown, $: HooksApi) => {
        return $.next(); // fall through to default for the real op? no — deny below in guard2
      },
    });
    host.registerPlugin(manifest("guard2"), {
      "service.fs.write": (e: { path: string }) =>
        e.path.endsWith(".secret") ? { deny: "secret files are off limits" } : undefined,
    });
    let err: unknown;
    host.registerPlugin(manifest("writer"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        try {
          await $.fs.write("x.secret", "nope");
        } catch (e) {
          err = e;
        }
        await $.fs.write("x.txt", "fine");
        return undefined;
      },
    });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(String(err)).toMatch(/denied.*secret files/);
    expect(readFileSync(join(dir, "x.txt"), "utf8")).toBe("fine");
  });

  it("without an interceptor, the configured model provider answers", async () => {
    let got: unknown;
    const rt = new Runtime();
    const h = attach(rt, {
      session: { id: "s", cwd: dir },
      model: { complete: async (req: unknown) => ({ echoed: req }) },
    });
    h.registerPlugin(manifest("asker3"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        got = await $.model.complete({ prompt: "hi" });
        return undefined;
      },
    });
    await h.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(got).toEqual({ echoed: { prompt: "hi" } });
  });

  it("$.ui.notify and $.telemetry.log reach configured sinks", async () => {
    const notes: string[] = [];
    const logs: string[] = [];
    const rt = new Runtime();
    const h = attach(rt, {
      session: { id: "s", cwd: dir },
      notify: (m) => notes.push(m),
      telemetry: (e) => logs.push(e),
    });
    h.registerPlugin(manifest("noisy"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        await $.ui.notify("hello world", "warn");
        await $.telemetry.measure("job", async () => 42);
        return undefined;
      },
    });
    await h.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(notes).toEqual(["hello world"]);
    expect(logs).toEqual(["measure"]);
  });

  it("$.auth without a provider fails loudly; with a provider it logs in", async () => {
    let err: unknown;
    host.registerPlugin(manifest("lonely"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        try {
          await $.auth.login();
        } catch (e) {
          err = e;
        }
        return undefined;
      },
    });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(String(err)).toMatch(/no auth provider/);

    const rt = new Runtime();
    const h = attach(rt, {
      session: { id: "s", cwd: dir },
      auth: { login: async () => ({ status: "ok" }), status: () => ({ loggedIn: true }) },
    });
    let status = "";
    h.registerPlugin(manifest("authed"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        status = (await $.auth.login("sso")).status;
        return undefined;
      },
    });
    await h.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(status).toBe("ok");
  });

  it("$.emit runs arbitrary catalog events", async () => {
    let seen = false;
    host.registerPlugin(manifest("direct"), {
      "session.start": async (_e: unknown, $: HooksApi) => {
        await $.emit("tool.call", { tool: "X", input: {}, callId: "y" });
        return undefined;
      },
      "tool.call": () => {
        seen = true;
        return undefined;
      },
    });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(seen).toBe(true);
  });
});

describe('private local settings callbacks',()=>{
  const form={title:'Key',fields:[{id:'token',label:'Token',type:'password' as const}],actions:[{id:'save',label:'Save'}]};
  it('requires interactive attachment and trusted plugins; secrets bypass catalog middleware',async()=>{
    const errors:string[]=[];
    host.registerPlugin(manifest('headless'),{'session.start':async(_,$)=>{try{await $.ui.form(form);}catch(e){errors.push(String(e));}}});
    await host.emit('session.start',{sessionId:'s',cwd:dir,plugins:[]});expect(errors.join()).toContain('interactive UI');host.unregisterPlugin('headless');
    const calls:string[]=[];host.setFormHandler(async(plugin)=>{calls.push(plugin);return{action:'save',values:{token:'private-fake-key'}};});
    host.registerPlugin(manifest('untrusted','sandboxed'),{'session.start':async(_,$)=>{try{await $.ui.form(form);}catch(e){errors.push(String(e));}try{await $.storage.configure('proxy.json',{});}catch(e){errors.push(String(e));}}});
    await host.emit('session.start',{sessionId:'s',cwd:dir,plugins:[]});expect(calls).toEqual([]);expect(errors.join()).toContain('Only trusted plugins');host.unregisterPlugin('untrusted');
    let result:any;host.registerPlugin(manifest('trusted'),{'session.start':async(_,$)=>{result=await $.ui.form(form);}});await host.emit('session.start',{sessionId:'s',cwd:dir,plugins:[]});
    expect(result.values.token).toBe('private-fake-key');expect(calls).toEqual(['trusted']);
  });
});
