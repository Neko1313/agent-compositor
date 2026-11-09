import { describe, it, expect } from "vitest";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import { AppUI } from "../src/ui.js";
import { ApprovalDialog } from "../src/approval.js";
function setup() {
  const ui = new AppUI(
    (onApproval, onAsk) =>
      new AgentCore({
        cwd: process.cwd(),
        provider: new ScriptedProvider([]),
        onApproval,
        onAsk,
      }),
  );
  const renders = new Map<string, string>();
  const titles = new Map<string, string>();
  const grids = new Map<string, any>();
  ui.connect((m) => {
    if (m.type === "render") {
      renders.set(
        m.surface,
        m.grid?.map((row) => row.map((c) => c.ch).join("")).join("\n") ?? "",
      );
      grids.set(m.surface, m.grid);
    }
    if (m.type === "declare")
      for (const s of m.surfaces) titles.set(s.id, s.title ?? "");
  });
  ui.receive(
    hello("renderer", {
      surfaces: ["terminal"],
      sites: [],
      elements: ["Text", "Layout"],
      encodings: ["jsonl"],
    }),
  );
  ui.resize(80, 24);
  const input = (data: Extract<WireMessage, { type: "input" }>["data"]) =>
    ui.receive({ type: "input", surface: "input", data });
  return {
    ui,
    renders,
    titles,
    grids,
    key: (key: string, modifiers?: string[]) =>
      input({ kind: "key", key, modifiers }),
    text: (text: string) => input({ kind: "text", text }),
  };
}
describe("reviewable action approvals", () => {
  it("keeps tool, leading command and choices visible and scrolls every argument", () => {
    const command =
      "first-target " +
      Array.from({ length: 80 }, (_, i) => `argument-${i}`).join(" ") +
      " final-target";
    const d = new ApprovalDialog({
      tool: "exec",
      descriptor: { tool: "exec", command: ["sh", "-c", command] },
      reason: "Review the concrete command",
    });
    const initial = d
      .visible(42, 10)
      .map((r) => r.text)
      .join("\n");
    expect(initial).toContain("Tool: exec");
    expect(initial).toContain("first-target");
    expect(initial).toContain("Y allow once");
    expect(initial).toContain("P allow for project");
    d.handle({ kind: "key", key: "end" });
    const last = d
      .visible(42, 10)
      .map((r) => r.text)
      .join("\n");
    expect(last).toContain("Tool: exec");
    expect(last).toContain("final-target");
    expect(last).toContain("Review the concrete command");
    expect(last).toContain("N deny");
  });
  it("defaults Enter to denial and explicitly distinguishes every approval scope", () => {
    const request = {
      tool: "write",
      descriptor: { tool: "write", path: "file.txt" },
    };
    expect(
      new ApprovalDialog(request).handle({ kind: "key", key: "enter" }),
    ).toEqual({ allow: false, scope: "once" });
    for (const [key, scope] of [
      ["y", "once"],
      ["a", "session"],
      ["p", "project"],
    ] as const)
      expect(
        new ApprovalDialog(request).handle({ kind: "text", text: key }),
      ).toEqual({ allow: true, scope });
    const dialog = new ApprovalDialog(request);
    const rows = dialog.visible(60, 12),
      row = rows.findIndex((r) => r.text.includes("Y allow once"));
    expect(dialog.interactiveRow(row)).toBe(true);
    expect(
      dialog.handle({
        kind: "mouse",
        row,
        col: 2,
        action: "press",
        button: "left",
      }),
    ).toEqual({ allow: true, scope: "once" });
  });
  it("names the active interaction and does not offer queue/steer while waiting", async () => {
    const { ui, renders, titles, key } = setup();
    const answer = (ui as any).requestApproval({
      tool: "exec",
      descriptor: {
        command: [
          "sh",
          "-c",
          "review '**literal**' `exact` " + "more ".repeat(100),
        ],
      },
      reason: "Scope needs approval",
    });
    expect(titles.get("input")).toBe("Approval required");
    expect(renders.get("input")).toContain("Tool: exec");
    expect(renders.get("input")).toContain("'**literal**' `exact`");
    expect(renders.get("status")).toContain("Approval needed");
    expect(renders.get("status")).not.toContain("Enter queue");
    key("escape");
    expect(await answer).toEqual({ allow: false, scope: "once" });
    expect(titles.get("input")).toBe("Message");
    ui.close();
  });
});
describe("plugin action navigation", () => {
  it("reaches offscreen actions once per semantic action and brings focus into view", async () => {
    const { ui, renders, key } = setup();
    const pressed: string[] = [];
    ui.core.host.registerPlugin(
      { name: "actions", version: "1.0.0", trust: "trusted" },
      {
        "ui.press": (e) => {
          pressed.push(e.key);
        },
        "ui.render": (e) =>
          e.site === "plugin:actions/list"
            ? { tree: { lines: e.props.lines } }
            : undefined,
      },
    );
    await ui.core.host.emit("service.ui.view", {
      plugin: "actions",
      id: "list",
      title: "Actions",
      view: {
        lines: Array.from({ length: 18 }, (_, i) => ({
          text: `Action ${i} with a long wrapped label`,
          action: `a${i}`,
        })),
      },
      placement: { site: "sidebar", size: 0.4, focus: true },
    });
    await ui.settled();
    expect(renders.get("status")).toContain("actions");
    expect(renders.get("plugin-actions-list")).toContain("PgUp/PgDn");
    for (let i = 0; i < 18; i++) key("down");
    expect(renders.get("plugin-actions-list")).toContain("Action 17");
    key("enter");
    await ui.settled();
    expect(pressed).toEqual(["a17"]);
    key("up");
    key("enter");
    await ui.settled();
    expect(pressed.at(-1)).toBe("a16");
    ui.close();
  });
  it("does not expose toolbar hitboxes when their labels cannot fit", () => {
    const { ui, renders } = setup();
    ui.resize(24, 24);
    expect(renders.get("status")).not.toContain("[Plugins]");
    ui.receive({
      type: "input",
      surface: "status",
      data: {
        kind: "mouse",
        row: 22,
        col: 16,
        button: "left",
        action: "press",
      },
    });
    expect(renders.has("plugin-placement")).toBe(false);
    ui.close();
  });
  it('keeps the search label and literal characters visible in a narrow plugin pane',async()=>{
    const {ui,renders,text}=setup();ui.resize(60,24);
    await ui.core.host.emit('service.ui.view',{plugin:'search',id:'list',title:'Search',view:{input:{id:'search',value:'',placeholder:'Title, ID or conversation text'},lines:[{text:'Results'}]},placement:{site:'sidebar',size:.75,focus:true}});
    expect(renders.get('plugin-search-list')).toContain('Search: Title, ID');text('**literal**');await ui.settled();expect(renders.get('plugin-search-list')).toContain('Search: **literal**');ui.close();
  });
  it("keeps contextual hints at narrow widths and honors plugin field labels/hints", async () => {
    const { ui, renders, text, key } = setup();
    ui.resize(60, 24);
    await ui.core.host.emit("service.ui.view", {
      plugin: "filter",
      id: "input",
      title: "Filter",
      view: {
        input: { id: "filter", value: "", label: "Find", placeholder: "Items" },
        hint: "Type to filter · Esc leave",
        lines: [{ text: "Choose a result", action: "choose" }],
      },
      placement: { site: "sidebar", size: 0.7, focus: true },
    });
    text("item");
    await ui.settled();
    expect(renders.get("plugin-filter-input")).toContain("Find: item");
    expect(renders.get("status")).toContain("Type to filter");
    key("escape");
    ui.close();
  });
});
