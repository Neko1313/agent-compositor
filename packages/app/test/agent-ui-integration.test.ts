import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import { AppUI } from "../src/ui.js";
import { buildApp } from "../src/build.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temp() { const root = await mkdtemp(join(tmpdir(), "agent-ui-merge-")); roots.push(root); return root; }
function setup(provider: ScriptedProvider) {
  const ui = new AppUI((onApproval, onAsk) => new AgentCore({ cwd: process.cwd(), provider, onApproval, onAsk }));
  const messages = new Map<string, string>();
  ui.connect(message => {
    if (message.type === "render") messages.set(message.surface, message.grid?.map(row => row.map(cell => cell.ch).join("")).join("\n") ?? "");
  });
  ui.receive(hello("renderer", { surfaces: ["terminal"], sites: [], elements: ["Text", "Layout"], encodings: ["jsonl"] }));
  const input = (data: Extract<WireMessage, { type: "input" }>["data"]) => ui.receive({ type: "input", surface: "input", data });
  return { ui, messages, text: (text: string) => input({ kind: "text", text }), key: (key: string, modifiers?: string[]) => input({ kind: "key", key, modifiers }) };
}

describe("main agent work integrated with the compositor", () => {
  it.each([
    { options: ["staging", "production"], multi: false, reply: "2", expected: "production" },
    { options: ["a", "b", "c"], multi: true, reply: "1,3", expected: ["a", "c"] },
    { options: undefined, multi: false, reply: "custom answer", expected: "custom answer" },
  ])("answers questions in the TUI without submitting answers as prompts ($reply)", async ({ options, multi, reply, expected }) => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "ask_user", args: { question: "Choose a target", options, multi } }] }, { text: "Answer received" }]);
    const { ui, messages, text, key } = setup(provider);
    text("start"); key("enter");
    await vi.waitFor(() => expect(messages.get("input")).toContain("Choose a target"));
    text(reply); key("enter"); await ui.settled();
    const result = ui.core.getMessages().find(m => m.role === "tool");
    expect(JSON.parse(result!.content)).toEqual({ answer: expected });
    expect(ui.core.getMessages().filter(m => m.role === "user").map(m => m.content)).toEqual(["start"]);
    expect(messages.get("session")).toContain("Answer received"); ui.close();
  });

  it("collects a questionnaire atomically through the model tool loop", async () => {
    const provider=new ScriptedProvider([{toolCalls:[{name:'ask_questions',args:{title:'Setup',questions:[{id:'target',question:'Where?',options:[{label:'Stage',recommended:true},{label:'Prod',description:'Public'}]},{id:'checks',question:'Which checks?',multi:true,options:['Unit','Browser']}]}}]},{text:'All answers received'}]);
    const {ui,messages,text,key}=setup(provider);text('start');key('enter');
    await vi.waitFor(()=>expect(messages.get('input')).toContain('Where?'));
    key('down');key('enter');key('space');key('down');key('space');key('enter');
    expect(messages.get('input')).toContain('Review 2 answers');
    expect(ui.core.getMessages().filter(m=>m.role==='tool')).toHaveLength(0);
    key('enter');await ui.settled();
    expect(JSON.parse(ui.core.getMessages().find(m=>m.role==='tool')!.content)).toEqual({answers:[{id:'target',selected:['Prod']},{id:'checks',selected:['Unit','Browser']}]});
    expect(ui.core.getMessages().filter(m=>m.role==='user').map(m=>m.content)).toEqual(['start']);ui.close();
  });
  it("keeps queued approval keys out of a questionnaire draft and preserves the normal prompt",async()=>{
    const {ui,messages,text,key}=setup(new ScriptedProvider([]));text('Unsent prompt');
    const signal=new AbortController();
    const answer=ui.core.host.emit('service.ui.questionnaire',{plugin:'test',title:'Setup',questions:[{id:'note',question:'Instructions?'}],signal:signal.signal});
    await vi.waitFor(()=>expect(messages.get('input')).toContain('Instructions?'));
    // Simulate an unrelated concurrent permission request without running a command.
    const approval=(ui as any).requestApproval({tool:'exec',descriptor:{command:'example'},reason:'Concurrent action'});
    text('y');expect(messages.get('input')).toContain('Your answer: y');
    key('enter');key('enter');await answer;
    expect(messages.get('input')).toContain('Y allow once');text('n');expect(await approval).toMatchObject({allow:false});
    expect(messages.get('input')).toContain('Unsent prompt');ui.close();
  });
  it("aborts a queued questionnaire without cancelling the active question",async()=>{
    const {ui,messages,text,key}=setup(new ScriptedProvider([]));
    const active=ui.core.host.emit('service.ui.ask',{plugin:'test',question:'Active?'});
    const abort=new AbortController();
    const queued=ui.core.host.emit('service.ui.questionnaire',{plugin:'test',questions:[{id:'q',question:'Queued?'}],signal:abort.signal});
    await vi.waitFor(()=>expect(messages.get('input')).toContain('Active?'));const cancelled=expect(queued).rejects.toThrow('Question cancelled');abort.abort();await cancelled;
    expect(messages.get('input')).toContain('Active?');text('Keep');key('enter');expect((await active).value).toEqual({value:{answer:'Keep'}});ui.close();
  });

  it("cancels a pending question and lets the agent recover", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "ask_user", args: { question: "Continue?" } }] }, { text: "Cancelled safely" }]);
    const { ui, messages, text, key } = setup(provider);
    text("start"); key("enter");
    await vi.waitFor(() => expect(messages.get("input")).toContain("Continue?"));
    key("escape"); await ui.settled();
    expect(ui.core.getMessages().find(m => m.role === "tool")?.content).toContain("cancelled");
    expect(messages.get("session")).toContain("Cancelled safely"); ui.close();
  });

  it("shares the TUI ask channel with a child and advertises unique tools", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "task", args: { prompt: "child" } }] },
      { toolCalls: [{ name: "ask_user", args: { question: "Child question?", options: ["yes", "no"] } }] },
      { text: "Child report" }, { text: "Parent report" },
    ]);
    const { ui, messages, text, key } = setup(provider);
    text("delegate"); key("enter");
    await vi.waitFor(() => expect(messages.get("input")).toContain("Child question?"));
    text("1"); key("enter"); await ui.settled();
    const names = provider.requests[1].tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(messages.get("session")).toContain("Parent report");
    expect(messages.get("session")).toContain("Subagent"); ui.close();
  });

  it("parent interruption cancels a running child", async () => {
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "task", args: { prompt: "wait" } }] }, { text: "waiting", hold: true }]);
    const core = new AgentCore({ cwd: process.cwd(), provider });
    const run = core.submit("delegate");
    await vi.waitFor(() => expect(provider.requests).toHaveLength(2));
    core.interrupt(); await run;
    expect(core.getState()).not.toBe("running");
    expect(provider.requests).toHaveLength(2);
  });

  it("reload refreshes plugin tools and the hooks inherited by new children", async () => {
    const root = await temp(), market = join(root, "market"), old = join(market, "old");
    await mkdir(old, { recursive: true });
    await writeFile(join(old, "plugin.json"), JSON.stringify({ name: "old", version: "1.0.0", trust: "trusted" }));
    const tool = (name: string) => `export default [{ name: '${name}', description: 'test', parameters: {}, describe: () => ({tool:'${name}'}), execute: async () => ({ok:true,data:'loaded'}) }];`;
    await writeFile(join(old, "tools.ts"), tool("old_tool"));
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "task", args: { prompt: "child" } }] },
      { toolCalls: [{ name: "new_tool", args: {} }] }, { text: "Child done" }, { text: "Parent done" },
    ]);
    const app = await buildApp({ cwd: root, env: { HOME: root }, provider, pluginDirs: [market] });
    const core = app.createCore(async () => true);
    await rm(old, { recursive: true });
    const updated = join(market, "updated"); await mkdir(updated);
    await writeFile(join(updated, "plugin.json"), JSON.stringify({ name: "updated", version: "1.0.0", trust: "trusted" }));
    await writeFile(join(updated, "tools.ts"), tool("new_tool"));
    await writeFile(join(updated, "hooks.ts"), "export default { 'prompt.submit': e => e.text === 'child' ? {text:'changed child'} : undefined };");
    await app.reloadPlugins(core);
    await core.submit("delegate");
    expect(provider.requests[0].tools.map(t => t.name)).toContain("new_tool");
    expect(provider.requests[0].tools.map(t => t.name)).not.toContain("old_tool");
    expect(provider.requests[1].messages.find(m => m.role === "user")?.content).toBe("changed child");
    expect(provider.requests[1].tools.map(t => t.name)).toContain("new_tool");
  });
});
