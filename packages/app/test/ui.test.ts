import { describe, it, expect } from "vitest";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { hello, wireMessage, type WireMessage } from "@agent-compositor/protocol";
import type { PlacementConfig } from "../src/placement.js";
import { AppUI } from "../src/ui.js";

function setup(provider = new ScriptedProvider([{ text: "Hello from agent" }]), commands = () => [] as { name: string; description: string; usage?: string }[], placement: PlacementConfig = {}, panelOptions: ConstructorParameters<typeof AppUI>[5] = {}) {
  const ui = new AppUI(approve => new AgentCore({ cwd: process.cwd(), provider, onApproval: approve }), undefined, [], commands, placement, panelOptions);
  // Existing interaction scenarios exercise a two-pane layout explicitly.
  ui.windows.place("tools", { site: "sidebar", size: .3, focus: false });
  const messages: WireMessage[] = [];
  ui.connect(message => { expect(wireMessage.safeParse(message).success).toBe(true); messages.push(message); });
  ui.receive(hello("renderer", { surfaces: ["terminal"], sites: [], elements: ["Text", "Layout", "Pointer"], encodings: ["jsonl"] }));
  const text = (text: string) => ui.receive({ type: "input", surface: "input", data: { kind: "text", text } });
  const key = (key: string, modifiers?: string[]) => ui.receive({ type: "input", surface: "input", data: { kind: "key", key, modifiers } });
  return { ui, messages, text, key, provider };
}
function rendered(messages: WireMessage[]): string {
  return messages.filter(m => m.type === "render").map(m => m.grid?.map(row => row.map(c => c.ch).join("")).join("\n")).join("\n");
}
describe("app wire UI", () => {
  it("negotiates, edits input, submits and streams model output through valid wire messages", async () => {
    const { ui, messages, text, key, provider } = setup();
    text("hellx"); key("backspace"); text("o"); key("enter");
    await ui.settled();
    expect(provider.requests[0].messages[0].content).toBe("hello");
    expect(rendered(messages)).toContain("Hello from agent");
    expect(messages.some(m => m.type === "focus" && m.surface === "input")).toBe(true);
    ui.close();
  });
  it("Ctrl+C interrupts a busy turn and exits only when idle", async () => {
    const { ui, messages, text, key } = setup(new ScriptedProvider([{ text: "Working", hold: true }]));
    text("work"); key("enter");
    key("c", ["ctrl"]); await ui.settled();
    expect(messages.some(m => m.type === "bye")).toBe(false);
    key("c", ["ctrl"]);
    expect(messages.at(-1)?.type).toBe("bye");
  });
  it("keeps permission decisions in the UI and resumes after denial", async () => {
    const { ui, text, key, messages } = setup(new ScriptedProvider([
      { toolCalls: [{ name: "exec", args: { command: "echo test" } }] }, { text: "Denied safely" },
    ]));
    text("run"); key("enter");
    // Wait for the permission request to reach the wire, without executing a command.
    for (let n = 0; n < 100 && !rendered(messages).includes("Y allow once"); n++) await new Promise(r => setTimeout(r, 1));
    expect(rendered(messages)).toContain("Y allow once");
    text("n"); await ui.settled();
    expect(rendered(messages)).toContain("Denied safely"); ui.close();
  });
});

describe("window input routing", () => {
  it("routes typing only to input, manages splits/workspaces and accepts plugin surfaces", async () => {
    const { ui, key, text, messages, provider } = setup();
    key("l", ["meta"]); text("must not enter the draft");
    key("v", ["meta"]); key("enter", ["meta"]);
    expect(ui.windows.ids()).toHaveLength(3);
    const newWindow = ui.windows.focused;
    key("2", ["meta", "shift"]);
    expect(ui.windows.workspace).toBe(2); expect(ui.windows.ids()).toEqual([newWindow]);
    key("f", ["meta"]); expect(ui.windows.fullscreen).toBe(true);
    key("i", ["meta"]); text("actual message"); key("enter"); await ui.settled();
    expect(provider.requests[0].messages[0].content).toBe("actual message");
    await ui.core.host.emit("service.ui.surface", { plugin: "test", id: "inspector", title: "Inspector", text: "Plugin content" });
    expect(ui.windows.focused).toBe("plugin-test-inspector");
    expect(rendered(messages)).toContain("Plugin content");
    expect(messages.some(m => m.type === "layout" && m.frames.some(f => f.surface === "plugin-test-inspector"))).toBe(true);
    ui.close();
  });
});

describe("mouse focus", () => {
  it("hit tests visible rectangles, ignores status/outside clicks and focuses input", async () => {
    const { ui, text, key, provider } = setup();
    const click = (row: number, col: number) => ui.receive({ type: "input", surface: "input", data: { kind: "mouse", row, col, button: "left" } });
    click(3, 65); expect(ui.windows.focused).toBe("tools");
    text("ignored");
    click(23, 2); expect(ui.windows.focused).toBe("tools");
    click(19, 2); expect(ui.windows.focused).toBe("input");
    text("from click"); key("enter"); await ui.settled();
    expect(provider.requests[0].messages[0].content).toBe("from click");
    ui.close();
  });
});


describe("workspace bar", () => {
  it("clicks workspace labels, restores windows and ignores gaps and unrelated status text", () => {
    const { ui, messages, key } = setup();
    const click = (col: number, row = 22) => ui.receive({ type: "input", surface: "status", data: { kind: "mouse", row, col, button: "left" } });
    click(5); expect(ui.windows.workspace).toBe(2); expect(ui.windows.ids()).toEqual([]);
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames.map(f => f.surface)).toEqual(["input", "status"]);
    key("t", ["meta"]); const second = ui.windows.ids();
    click(1); expect(ui.windows.workspace).toBe(1); expect(ui.windows.ids()).toEqual(["session", "tools"]);
    click(3); expect(ui.windows.workspace).toBe(1); // space between labels
    click(25); expect(ui.windows.workspace).toBe(1);
    click(5); expect(ui.windows.ids()).toEqual(second);
    key("1", ["meta"]); expect(ui.windows.workspace).toBe(1);
    ui.close();
  });
  it("hit tests wrapped workspace labels after terminal resize", () => {
    const { ui, key } = setup();
    key("4", ["meta"]); key("5", ["meta"]); key("9", ["meta"]); ui.resize(16, 12);
    ui.receive({ type: "input", surface: "status", data: { kind: "mouse", row: 11, col: 3, button: "left" } });
    expect(ui.windows.workspace).toBe(5); ui.close();
  });
});

describe("slash completions", () => {
  const commands = () => [
    { name: "/clear", description: "Clear conversation" }, { name: "/compact", description: "Summarize history" },
    { name: "/style", description: "Response style", usage: "/style terse|off" },
  ];
  it("filters by prefix, completes selection without a model request and submits only on the next Enter", async () => {
    const { ui, text, key, messages, provider } = setup(undefined, commands);
    text("/");
    expect(rendered(messages)).toContain("Clear conversation");
    text("c"); key("down"); key("tab");
    expect(provider.requests).toHaveLength(0);
    const latestInput = messages.filter(m => m.type === "render" && m.surface === "input").at(-1);
    expect(JSON.stringify(latestInput)).toContain('"ch":"/"');
    key("enter"); await ui.settled();
    expect(provider.requests[0].messages[0].content).toBe("/compact"); ui.close();
  });
  it("supports click completion and Escape dismissal while leaving normal Tab steering alone", async () => {
    const { ui, text, key, messages, provider } = setup(undefined, commands);
    text("/");
    const dock = messages.filter(m => m.type === "layout").at(-1)!.frames.find(f => f.surface === "input")!;
    ui.receive({ type: "input", surface: "input", data: { kind: "mouse", row: dock.y + 4, col: 3, button: "left" } });
    key("enter"); await ui.settled();
    expect(provider.requests[0].messages[0].content).toBe("/compact");
    text("/"); key("escape");
    const frame = messages.filter(m => m.type === "render" && m.surface === "input").at(-1);
    expect(frame?.type === "render" ? frame.grid : undefined).toHaveLength(1);
    expect(ui.windows.focused).toBe("input"); ui.close();
  });
});

describe("plugin placement integration", () => {
  it("carries placement through the service and applies user overrides without disturbing updates", async () => {
    const { ui, messages } = setup(undefined, () => [], {
      rules: [{ match: { plugin: "cost", surface: "usage" }, site: "sidebar", workspace: 2, focus: false }],
    });
    await ui.core.host.emit("service.ui.surface", { plugin: "cost", id: "usage", title: "Usage", text: "10 tokens",
      placement: { site: "inspector", workspace: 1, focus: true } });
    expect(ui.windows.workspace).toBe(1); expect(ui.windows.focused).toBe("input");
    ui.windows.switchTo(2); expect(ui.windows.ids()).toEqual(["plugin-cost-usage"]);
    ui.windows.focused = "plugin-cost-usage"; ui.windows.moveWorkspace(3);
    ui.windows.switchTo(1);
    await ui.core.host.emit("service.ui.surface", { plugin: "cost", id: "usage", title: "Usage", text: "20 tokens", placement: { focus: true } });
    expect(ui.windows.workspace).toBe(1);
    ui.windows.switchTo(3); ui.resize(80, 24);
    expect(rendered(messages)).toContain("20 tokens"); ui.close();
  });
});

describe("plugin placement panel", () => {
  it("opens with the bar button, applies settings immediately and saves the exact plugin identity", async () => {
    const saved: unknown[] = [];
    const { ui, key, messages } = setup(undefined, () => [], {}, { save: async rule => { saved.push(rule); return "project-config"; } });
    await ui.core.host.emit("service.ui.surface", { plugin: "cost", id: "usage", title: "Usage", text: "10 tokens" });
    ui.receive({ type: "input", surface: "status", data: { kind: "mouse", row: 22, col: 16, button: "left" } });
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames[0].surface).toBe("plugin-placement");
    key("down"); key("right"); // site sidebar
    key("down"); key("right"); // workspace 2
    key("down"); key("right"); // size +5%
    key("down"); key("down"); key("down"); // Apply
    key("enter");
    expect(ui.windows.workspaceOf("plugin-cost-usage")).toBe(2);
    expect(saved).toHaveLength(0);
    key("down"); key("enter"); await ui.settled();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ match: { plugin: "cost", surface: "usage" }, site: "sidebar", workspace: 2 });
    expect(rendered(messages)).toContain("Rule saved");
    key("escape"); expect(messages.filter(m => m.type === "layout").at(-1)?.frames.some(f => f.surface === "plugin-placement")).toBe(false);
    ui.close();
  });
  it("displays save failures without claiming success or moving the window", async () => {
    const { ui, key, messages } = setup(undefined, () => [], {}, { save: async () => { throw new Error("read-only disk"); } });
    await ui.core.host.emit("service.ui.surface", { plugin: "cost", id: "usage", title: "Usage", text: "10 tokens" });
    key("p", ["meta"]); key("down"); key("down"); key("right");
    for (let i = 0; i < 5; i++) key("down");
    key("enter"); await ui.settled();
    expect(rendered(messages)).toContain("Save failed"); expect(ui.windows.workspaceOf("plugin-cost-usage")).toBe(1);
    ui.close();
  });
  it("handles an empty surface list and opens /plugins without calling the model", async () => {
    const { ui, key, text, messages, provider } = setup();
    text("/plugins"); key("enter"); await ui.settled();
    expect(rendered(messages)).toContain("No plugin windows"); expect(provider.requests).toHaveLength(0);
    key("escape"); ui.close();
  });
});

describe("placement panel mouse controls", () => {
  it("selects a plugin surface, edits its fields and saves using clicks only", async () => {
    const saved: unknown[] = [];
    const { ui, key } = setup(undefined, () => [], {}, { save: async rule => { saved.push(rule); return "project-config"; } });
    for (const id of ["first", "second"]) await ui.core.host.emit("service.ui.surface", { plugin: "widgets", id, title: id, text: "content" });
    const click = (row: number, col = 3) => ui.receive({ type: "input", surface: "plugin-placement", data: { kind: "mouse", row, col, button: "left" } });
    click(22, 16); // open panel
    click(2); // choose second surface
    click(3); // sidebar
    click(4); // workspace 2
    click(9); // Save rule + apply
    await ui.settled();
    expect(saved[0]).toMatchObject({ match: { plugin: "widgets", surface: "second" }, site: "sidebar", workspace: 2 });
    expect(ui.windows.workspaceOf("plugin-widgets-first")).toBe(1);
    expect(ui.windows.workspaceOf("plugin-widgets-second")).toBe(2);
    key("escape"); ui.close();
  });
});

describe("mouse window management", () => {
  function mouse(ui: AppUI, action: "press" | "move" | "release", col: number, row: number) {
    ui.receive({ type: "input", surface: "input", data: { kind: "mouse", button: "left", action, col, row } });
  }
  it("previews a drop, swaps at the center and splits at the bottom edge", () => {
    const { ui, messages } = setup();
    mouse(ui, "press", 4, 1); mouse(ui, "move", 68, 8);
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames.find(f => f.surface === "tools")?.drop).toBe("center");
    mouse(ui, "release", 68, 8);
    expect(ui.windows.ids()).toEqual(["tools", "session"]);
    const source = ui.windows.frames(80, 18).find(f => f.surface === "session")!;
    mouse(ui, "press", source.x + 2, 1); mouse(ui, "move", 20, 17); mouse(ui, "release", 20, 17);
    const frames = ui.windows.frames(80, 18);
    expect(frames.find(f => f.surface === "session")).toMatchObject({ x: 0, y: 9, width: 80, height: 9 });
    expect(frames.find(f => f.surface === "tools")).toMatchObject({ x: 0, y: 0, width: 80, height: 9 });
    ui.close();
  });
  it("resizes a separator live, clamps minimum widths and releases capture", () => {
    const { ui } = setup();
    mouse(ui, "press", 55, 8); mouse(ui, "move", 40, 8);
    expect(ui.windows.frames(80, 17)[0].width).toBe(40);
    mouse(ui, "move", 0, 8);
    expect(ui.windows.frames(80, 17)[0].width).toBe(12);
    mouse(ui, "release", 40, 8); mouse(ui, "move", 70, 8);
    expect(ui.windows.frames(80, 17)[0].width).toBe(40); ui.close();
  });
  it("cancels resizing with Escape or terminal resize and treats small gestures as clicks", () => {
    const { ui, key } = setup();
    mouse(ui, "press", 55, 8); mouse(ui, "move", 40, 8); key("escape");
    expect(ui.windows.frames(80, 17)[0].width).toBe(56);
    mouse(ui, "press", 55, 8); mouse(ui, "move", 35, 8); ui.resize(100, 30);
    expect(ui.windows.frames(100, 23)[0].width).toBe(70);
    mouse(ui, "press", 4, 1); mouse(ui, "release", 5, 1);
    expect(ui.windows.ids()).toEqual(["session", "tools"]); ui.close();
  });
  it("moves a title onto a workspace tab and cancels drops outside window targets", () => {
    const { ui } = setup();
    mouse(ui, "press", 4, 1); mouse(ui, "move", 5, 22); mouse(ui, "release", 5, 22);
    expect(ui.windows.workspace).toBe(2); expect(ui.windows.ids()).toEqual(["session"]);
    ui.windows.switchTo(1); expect(ui.windows.ids()).toEqual(["tools"]);
    mouse(ui, "press", 4, 1); mouse(ui, "move", 5, 19); mouse(ui, "release", 5, 19);
    expect(ui.windows.ids()).toEqual(["tools"]); ui.close();
  });
  it("operates title buttons for fullscreen and close without treating them as drags", () => {
    const { ui } = setup();
    mouse(ui, "press", 50, 1); mouse(ui, "release", 50, 1);
    expect(ui.windows.fullscreen).toBe(true);
    mouse(ui, "press", 74, 1); mouse(ui, "release", 74, 1);
    expect(ui.windows.fullscreen).toBe(false);
    mouse(ui, "press", 53, 1); mouse(ui, "release", 53, 1);
    expect(ui.windows.ids()).toEqual(["tools"]); ui.close();
  });
});

describe("hover pointer shapes", () => {
  it("uses distinct pointers for titles, split borders, buttons and text without changing focus", () => {
    const { ui, messages } = setup();
    const hover = (col: number, row: number) => ui.receive({ type: "input", surface: "input", data: { kind: "mouse", button: "other", action: "move", col, row } });
    const shape = () => messages.filter(m => m.type === "pointer").at(-1)?.shape;
    hover(4, 1); expect(shape()).toBe("grab");
    hover(55, 8); expect(shape()).toBe("ew-resize");
    hover(50, 1); expect(shape()).toBe("pointer");
    hover(5, 22); expect(shape()).toBe("pointer");
    hover(4, 19); expect(shape()).toBe("text");
    hover(4, 8); expect(shape()).toBe("default");
    expect(ui.windows.focused).toBe("input");
    const count = messages.length; hover(5, 8); expect(messages).toHaveLength(count);
    ui.close();
  });
  it("keeps the drag cursor while moving and restores hover cursor after release", () => {
    const { ui, messages } = setup();
    const mouse = (action: "press" | "move" | "release", col: number, row: number) => ui.receive({ type: "input", surface: "input", data: { kind: "mouse", button: "left", action, col, row } });
    mouse("press", 4, 1);
    expect(messages.filter(m => m.type === "pointer").at(-1)?.shape).toBe("grabbing");
    mouse("move", 68, 8); mouse("release", 68, 8);
    expect(messages.filter(m => m.type === "pointer").at(-1)?.shape).toBe("default");
    ui.close();
  });
});
