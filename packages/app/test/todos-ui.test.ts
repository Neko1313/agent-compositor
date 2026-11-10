import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ScriptedProvider } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import {buildAppWithPlugins as buildApp} from "./plugin-fixture.js";
import { AppUI } from "../src/ui.js";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "todos-ui-"));
  await mkdir(join(root, "plugins"));
  for (const name of ["todos", "slash-commands", "ui-theme"]) await cp(resolve(__dirname, `../../../plugins/${name}`), join(root, "plugins", name), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function app(provider = new ScriptedProvider([])) {
  const built = await buildApp({ cwd: root, env: { HOME: root }, provider });
  const ui = new AppUI(built.createCore, built.reloadPlugins, [], built.commands, built.config.config.ui);
  const messages: WireMessage[] = [];
  ui.connect(message => messages.push(message));
  ui.receive(hello("renderer", { surfaces: ["terminal"], sites: [], elements: ["Layout", "Text"], encodings: ["jsonl"] }));
  await ui.core.start();
  return { ui, built, messages };
}
function latestText(messages: WireMessage[]): string {
  const message = messages.filter(m => m.type === "render" && m.surface === "plugin-todos-tasks").at(-1);
  return message?.type === "render" ? message.grid?.map(row => row.map(cell => cell.ch).join("")).join("\n") ?? "" : "";
}
describe("Todos plugin window", () => {
  it("changes theme through a real disk plugin, overrides status and restores after reload and restart", async () => {
    const provider = new ScriptedProvider([]);
    const { ui, built, messages } = await app(provider);
    await ui.core.submit("/theme amber"); await ui.settled();
    expect(provider.requests).toHaveLength(0);
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames[0].chrome).toMatchObject({ accent: "#e5bd85", borderStyle: "round" });
    const status = () => {
      const m = messages.filter(m => m.type === "render" && m.surface === "status").at(-1);
      return m?.type === "render" ? m.grid?.map(r => r.map(c => c.ch).join("")).join("\n") : "";
    };
    expect(status()).toContain("amber ·");
    await built.reloadPlugins(ui.core); await ui.settled();
    expect(status()).toContain("amber ·"); ui.close();
    const restored = await app(); await restored.ui.settled();
    expect(restored.messages.filter(m => m.type === "layout").at(-1)?.frames[0].chrome?.accent).toBe("#e5bd85");
    await restored.ui.core.submit("/theme slate"); await restored.ui.settled();
    expect(restored.messages.filter(m => m.type === "layout").at(-1)?.frames[0].chrome?.borderStyle).toBe("single");
    restored.ui.close();
  });
  it("opens at startup, updates and persists tasks, restores them into both UI and tool on restart", async () => {
    const tasks = [
      { content: "Inspect project", status: "completed" },
      { content: "Build UI", status: "in_progress" },
      { content: "Ship", status: "pending" },
    ];
    const first = await app(new ScriptedProvider([{ toolCalls: [{ name: "todo", args: { todos: tasks } }] }, { text: "ready" }]));
    expect(latestText(first.messages)).toContain("No tasks yet");
    expect(first.ui.windows.focused).toBe("input");
    await first.ui.core.submit("make a plan");
    expect(latestText(first.messages)).toContain("1/3 complete");
    expect(latestText(first.messages)).toContain("[~] Build UI");
    expect(JSON.parse(await readFile(join(first.built.storage.paths.state, "todos.json"), "utf8"))).toEqual(tasks);
    first.ui.close();
    const provider = new ScriptedProvider([{ toolCalls: [{ name: "todo", args: {} }] }, { text: "restored" }]);
    const second = await app(provider);
    expect(latestText(second.messages)).toContain("[x] Inspect project");
    await second.ui.core.submit("read tasks");
    expect(second.ui.core.getMessages().find(m => m.role === "tool")?.content).toContain("Build UI");
    second.ui.close();
  });
  it("obeys placement rules, reopens with /todos and recovers after plugin reload", async () => {
    await writeFile(join(root, "agent-compositor.json"), JSON.stringify({ ui: { rules: [{ match: { plugin: "todos", surface: "tasks" }, workspace: 2, site: "inspector", focus: false }] } }));
    const { ui, built } = await app();
    expect(ui.windows.workspace).toBe(1);
    expect(ui.windows.workspaceOf("plugin-todos-tasks")).toBe(2);
    expect(built.commands().some(c => c.name === "/todos")).toBe(true);
    ui.windows.switchTo(2); ui.windows.focused = "plugin-todos-tasks"; ui.windows.close();
    await ui.core.submit("/todos");
    expect(ui.windows.has("plugin-todos-tasks")).toBe(true);
    expect(ui.core.getMessages()).toHaveLength(0);
    await built.reloadPlugins(ui.core);
    expect(ui.windows.workspaceOf("plugin-todos-tasks")).toBe(2);
    ui.close();
  });
});
