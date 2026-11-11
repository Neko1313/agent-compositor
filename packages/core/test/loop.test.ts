import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentCore } from "../src/loop.js";
import { ScriptedProvider } from "../src/provider.js";
import { SessionStore } from "@agent-compositor/session";
import type { PluginManifest } from "@agent-compositor/runtime";

let tmp: string;
let cwd: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-core-"));
  cwd = path.join(tmp, "repo");
  await fs.mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const manifest = (name: string): PluginManifest => ({
  name,
  version: "0.1.0",
  trust: "sandboxed",
});

const collect = (core: AgentCore) => {
  const events: { event: string; input: Record<string, unknown> }[] = [];
  const text: string[] = [];
  core.subscribe((ev) => {
    if (ev.kind === "catalog") events.push({ event: ev.event, input: ev.input });
    else text.push(ev.delta);
  });
  return { events, text, names: () => events.map((e) => e.event) };
};

describe("turn basics", () => {
  it("runs a scripted text turn end to end", async () => {
    const provider = new ScriptedProvider([{ text: "Hello, Nikita." }]);
    const core = new AgentCore({ cwd, provider });
    await core.submit("hi");

    expect(core.getState()).toBe("idle");
    const seen = collect(core); // subscribe after: replay via events? no — collect() subscribes now
    void seen;
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].messages.at(-1)).toMatchObject({ role: "user", content: "hi" });
  });

  it("streams assistant text to subscribers", async () => {
    const provider = new ScriptedProvider([{ text: "ab", finish: "stop" }]);
    const core = new AgentCore({ cwd, provider });
    const log = collect(core);
    await core.submit("go");
    expect(log.text.join("")).toBe("ab");
    expect(log.names()).toContain("assistant.text");
    expect(log.names().at(-1)).toBe("turn.complete");
  });

  it("tool call executes through the service chain and feeds the result back", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "exec", args: { command: "echo from-tool" } }] },
      { text: "done" },
    ]);
    const core = new AgentCore({ cwd, provider, onApproval: async () => true });
    const log = collect(core);
    await core.submit("run it");

    expect(log.names()).toContain("tool.call");
    expect(log.names()).toContain("tool.check");
    expect(log.names()).toContain("tool.result");
    const result = log.events.find((e) => e.event === "tool.result")!.input;
    expect(result.ok).toBe(true);
    expect((result.output as { stdout: string }).stdout.trim()).toBe("from-tool");
    // second model request carries the tool result
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].messages.at(-1)).toMatchObject({ role: "tool" });
    expect(log.names().at(-1)).toBe("turn.complete");
  });

  it("unknown tool → error result as value, turn continues", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "nope", args: {} }] }, { text: "recovered" }]);
    const core = new AgentCore({ cwd, provider });
    const log = collect(core);
    await core.submit("try");
    const result = log.events.find((e) => e.event === "tool.result")!.input;
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("unknown tool");
    expect(log.names().at(-1)).toBe("turn.complete");
  });

  it('suggests an available action tool without executing an alias or bypassing its permissions',async()=>{
    let executions=0;
    const navigator={name:'navigator',description:'Navigate',parameters:{type:'object',properties:{action:{enum:['read_symbol']}}},
      describe:()=>({tool:'navigator'}),execute:async()=>{executions++;return {ok:true as const,data:'must not run'};}};
    const provider=new ScriptedProvider([
      {toolCalls:[{name:'read_symbol',args:{pattern:'target'}}]},
      {toolCalls:[{name:'navigator',args:{action:'read_symbol',pattern:'target'}}]},
      {text:'The requested operation was denied.'},
    ]);
    const core=new AgentCore({cwd,provider,tools:[navigator],controlTools:[],rules:[{tool:'navigator',decision:'deny'}]});
    const log=collect(core);await core.submit('Inspect target');
    const results=log.events.filter(event=>event.event==='tool.result').map(event=>event.input);
    expect(results[0]).toMatchObject({ok:false,error:expect.stringContaining('navigator with {"action":"read_symbol"}')});
    expect(results[1]).toMatchObject({ok:false,error:expect.stringContaining('denied')});
    expect(executions).toBe(0);
    expect(provider.requests[1].messages.at(-1)?.content).toContain('No action was executed');
  });
});

describe("interception and permissions", () => {
  it("a plugin answers tool.call with {result} — resolver never runs", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "exec", args: { command: "echo x" } }] }, { text: "ok" }]);
    const core = new AgentCore({
      cwd,
      provider,
      onApproval: async () => true,
      plugins: [
        {
          manifest: manifest("mock"),
          hooks: {
            "tool.call": (event) => ({ result: { stdout: "plugin-answered", exitCode: 0, stderr: "", durationMs: 0 } }),
          },
        },
      ],
    });
    const log = collect(core);
    await core.submit("go");
    const result = log.events.find((e) => e.event === "tool.result")!.input;
    expect((result.output as { stdout: string }).stdout).toBe("plugin-answered");
  });

  it("permission deny: rule beats everything, loop continues", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "exec", args: { command: "git push --force" } }] }, { text: "understood" }]);
    const core = new AgentCore({
      cwd,
      provider,
      rules: [
        { decision: "allow", command: "git *" },
        { decision: "deny", command: "git push --force*" },
      ],
    });
    const log = collect(core);
    await core.submit("push");
    const result = log.events.find((e) => e.event === "tool.result")!.input;
    expect(result.ok).toBe(false);
    expect(result.denied).toBe(true);
    expect(log.names().at(-1)).toBe("turn.complete"); // fail-operational
  });

  it("ask routes through onApproval; headless defaults to deny", async () => {
    const script = [{ toolCalls: [{ name: "exec", args: { command: "rm -rf dist" } }] }, { text: "a" }, { toolCalls: [{ name: "exec", args: { command: "rm -rf dist" } }] }, { text: "b" }];
    const provider = new ScriptedProvider(script);
    const asked: string[] = [];
    const core = new AgentCore({
      cwd,
      provider,
      rules: [{ decision: "allow", command: "git *" }], // rm not covered → ask
      onApproval: async ({ tool }) => {
        asked.push(tool);
        return asked.length === 1; // first allowed, second declined
      },
    });
    const log = collect(core);
    await core.submit("one");
    await core.submit("two");
    const results = log.events.filter((e) => e.event === "tool.result").map((e) => e.input);
    expect(results[0].ok).toBe(true); // approved
    expect(results[1].ok).toBe(false); // declined
    expect(asked).toEqual(["exec", "exec"]);
  });

  it("tool.check chain override can deny even when rules allow", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "read", args: { path: "secret.txt" } }] }, { text: "ok" }]);
    const core = new AgentCore({
      cwd,
      provider,
      onApproval: async () => true,
      plugins: [
        {
          manifest: manifest("guard"),
          hooks: {
            "tool.check": (event) => {
              const input = event as { input?: { path?: string } };
              if (input.input?.path?.includes("secret")) return { decision: "deny", reason: "no secrets" };
            },
          },
        },
      ],
    });
    const log = collect(core);
    await core.submit("read it");
    const result = log.events.find((e) => e.event === "tool.result")!.input;
    expect(result.denied).toBe(true);
  });

  it("service event interception: plugin denies service.shell.exec", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "exec", args: { command: "make deploy" } }] }, { text: "ok" }]);
    const core = new AgentCore({
      cwd,
      provider,
      rules: [{ decision: "allow", command: "make *" }], // reach the service chain; the plugin denies there
      plugins: [
        {
          manifest: manifest("sandbox"),
          hooks: {
            "service.shell.exec": (event) => {
              const input = event as { command?: string };
              if (input.command?.includes("deploy")) return { deny: "deploy is forbidden in this session" };
            },
          },
        },
      ],
    });
    const log = collect(core);
    await core.submit("deploy");
    const result = log.events.find((e) => e.event === "tool.result")!.input;
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("deploy is forbidden");
  });
});

describe("steer, queue, interrupt, failure", () => {
  it("steer injects a message into the running turn before the next model request", async () => {
    const provider = new ScriptedProvider([
      { text: "thinking… ", toolCalls: [{ name: "exec", args: { command: "echo x" } }], hold: true },
      { text: "final answer" },
    ]);
    const core = new AgentCore({ cwd, provider, onApproval: async () => true });
    const log = collect(core);

    const submitP = core.submit("start");
    await waitFor(() => provider.requests.length === 1); // first model request parked mid-stream
    await core.steer("actually, answer in French");
    provider.release();
    await submitP;

    expect(provider.requests[1].messages.some((m) => m.content === "actually, answer in French")).toBe(true);
    expect(log.names()).toContain("prompt.steer");
  });

  it("submit while busy queues and drains after the turn", async () => {
    const provider = new ScriptedProvider([{ text: "first", hold: true }, { text: "second" }]);
    const core = new AgentCore({ cwd, provider });
    const log = collect(core);

    const p1 = core.submit("one");
    await waitFor(() => provider.requests.length === 1);
    await core.submit("two"); // queues
    expect(log.names()).toContain("prompt.queued");
    provider.release();
    await p1;

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].messages.filter((m) => m.role === "user").map((m) => m.content)).toContain("two");
  });

  it("interrupt aborts the stream; turn.interrupted fires; session survives", async () => {
    const provider = new ScriptedProvider([{ text: "long ", hold: true }, { text: "never" }]);
    const core = new AgentCore({ cwd, provider });
    const log = collect(core);

    const p = core.submit("go");
    await waitFor(() => provider.requests.length === 1);
    core.interrupt();
    await p;

    expect(core.getState()).toBe("interrupted");
    expect(log.names()).toContain("turn.interrupted");
    expect(log.names()).not.toContain("turn.complete");

    // fail-operational: the core still takes the next prompt
    const provider2 = new ScriptedProvider([{ text: "alive" }]);
    const core2 = new AgentCore({ cwd, provider: provider2 });
    await core2.submit("still there?");
    expect(provider2.requests).toHaveLength(1);
  });

  it("model stream error → turn.failed, state returns to idle", async () => {
    const provider = new ScriptedProvider([{ finish: "error", error: "provider exploded" }]);
    const core = new AgentCore({ cwd, provider });
    const log = collect(core);
    await core.submit("go");
    expect(log.names()).toContain("turn.failed");
    const failed = log.events.find((e) => e.event === "turn.failed")!.input;
    expect(failed.error).toContain("provider exploded");
    expect(core.getState()).toBe("idle");
  });
});

describe("session persistence", () => {
  it("catalog events land in the session store", async () => {
    const store = new SessionStore({ sessionsRoot: path.join(cwd, ".agent-compositor", "sessions") });
    const meta = await store.create(cwd);
    const provider = new ScriptedProvider([{ text: "remember me" }]);
    const core = new AgentCore({ cwd, provider, sessions: store, sessionId: meta.id });
    await core.submit("hi");

    const session = await store.load(meta.id, cwd);
    const types = session.events.map((e) => e.type);
    expect(types).toContain("prompt.submit");
    expect(types).toContain("assistant.text");
    expect(types).toContain("turn.complete");
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setImmediate(r));
  }
}

 describe("journal failure admission", () => {
  for(const phase of ["create","prompt.submit","tool.call","tool.result","turn.complete"]){
    it(`stops and exposes ${phase} storage failure without reporting completion`,async()=>{
      let effects=0;
      const provider=new ScriptedProvider([{toolCalls:[{name:"probe",args:{}}]},{text:"done"}]);
      const core=new AgentCore({cwd,provider,controlTools:[],rules:[{tool:"probe",decision:"allow"}],
        tools:[{name:"probe",description:"probe",parameters:{type:"object"},describe:()=>({tool:"probe"}),execute:async()=>{effects++;return{ok:true,data:"effect completed"};}}],
        sessions:{create:async()=>{if(phase==="create")throw Error("disk full");},append:async(_id,events)=>{if(events[0].type===phase)throw Error("disk full");}},
      });
      const log=collect(core);
      try {
        await core.submit("work");
        expect(core.failure).toContain("Session journal failed");
        expect(core.getState()).toBe("idle");
        expect(log.names()).not.toContain("turn.complete");
        expect(log.names()).toContain("turn.failed");
        expect(effects).toBe(["tool.result","turn.complete"].includes(phase)?1:0);
        const requests=provider.requests.length;
        if(phase==="tool.result")expect(requests).toBe(1);
        await core.submit("try again");
        expect(provider.requests).toHaveLength(requests);
      } finally {await core.close();}
    });
  }
  it("passes detached JSON records to replacement journals while hooks retain live signals",async()=>{
    let preparedSignal:AbortSignal|undefined;
    const records:Record<string,unknown>[]=[];
    const provider=new ScriptedProvider([{text:"Journal accepted the turn"}]);
    const core=new AgentCore({cwd,provider,preparePrompt:async(text,signal)=>{preparedSignal=signal;return text;},
      sessions:{create:async()=>{},append:async(_id,events)=>{
        for(const event of events)expect(event).toStrictEqual(JSON.parse(JSON.stringify(event)));
        records.push(...structuredClone(events));
      }},
    });
    try{
      await core.submit("work");
      expect(core.failure).toBeUndefined();expect(provider.requests).toHaveLength(1);
      expect(preparedSignal).toBeInstanceOf(AbortSignal);
      expect(records.find(event=>event.type==='service.context.prepare')?.signal).toEqual({});
      expect(records.at(-1)?.type).toBe('turn.complete');
    }finally{await core.close();}
  });
  it("fails closed when a replacement journal denies writes",async()=>{
    const provider=new ScriptedProvider([{text:"must not run"}]);
    const core=new AgentCore({cwd,provider,tools:[],controlTools:[],services:{"service.session.append":()=>({deny:"offline"})}});
    try {await core.submit("work");expect(core.failure).toContain("offline");expect(provider.requests).toHaveLength(0);}
    finally {await core.close();}
  });
});
