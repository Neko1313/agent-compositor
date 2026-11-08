import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import { AppUI } from "../src/ui.js";
import { Activity } from "../../../plugins/mascot/activity.js";
import {
  decode,
  states,
  defaultPack,
  AnimationPack,
} from "../../../plugins/mascot/animations.js";
import hooks, { dispose } from "../../../plugins/mascot/hooks.js";
import { viewRows, gridFrom, appearanceFrom } from "../src/presentation.js";
import { uiTextViewSchema } from "@agent-compositor/events";
let tmp: string;
afterEach(async () => {
  dispose();
  vi.useRealTimers();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});
async function setup() {
  tmp = await mkdtemp(join(tmpdir(), "mascot-"));
  const views: any[] = [],
    writes: any[] = [],
    notifications: any[] = [];
  const $ = {
    session: { id: tmp, cwd: tmp },
    ui: {
      view: vi.fn(async (...args: any[]) => {
        views.push(args[2]);
      }),
      remove: vi.fn(async () => {}),
      notify: vi.fn(async (...args: any[]) => {
        notifications.push(args);
      }),
    },
    fs: {
      read: vi.fn(async (): Promise<string> => {
        throw Object.assign(Error("missing"), { code: "ENOENT" });
      }),
      write: vi.fn(async (...args: any[]) => {
        writes.push(args);
      }),
    },
  };
  await hooks["session.start"]({}, $);
  return { $, views, writes, notifications };
}
describe("replaceable mascot", () => {
  it("decodes all supplied APNGs with their original timing and distinct frames", async () => {
    for (const state of states) {
      const frames = await decode(join(defaultPack, `${state}.apng`));
      expect(frames).toHaveLength(6);
      expect(
        frames.every(
          (f) => f.delay === 180 && f.width === 96 && f.height === 96
        )
      ).toBe(true);
      expect(new Set(frames.map((f) => f.rgba)).size).toBeGreaterThan(1);
    }
  });
  it("rejects excessive PNG dimensions before invoking decoder", async () => {
    tmp = await mkdtemp(join(tmpdir(), "mascot-"));
    const bytes = Buffer.alloc(40);
    Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.writeUInt32BE(100000, 16);
    bytes.writeUInt32BE(100000, 20);
    await writeFile(join(tmp, "bad.png"), bytes);
    await expect(decode(join(tmp, "bad.png"))).rejects.toThrow();
  });
  it("prioritizes manual dialogs and handles concurrent actors without losing tools", () => {
    const a = new Activity();
    a.accept("turn.start", { turnId: "a" });
    a.accept("tool.call", { callId: "1", tool: "grep" });
    expect(a.current()).toBe("searching");
    a.accept("agent.activity", {
      agentId: "child",
      event: "tool.call",
      data: { callId: "1", tool: "edit" },
    });
    expect(a.current()).toBe("editing");
    a.accept("ui.reaction", {
      source: "permissions",
      kind: "approval",
      id: "1",
      active: true,
    });
    expect(a.current()).toBe("approval");
    a.accept("ui.reaction", {
      source: "permissions",
      kind: "approval",
      id: "1",
      active: false,
    });
    a.accept("agent.activity", {
      agentId: "child",
      event: "turn.complete",
      data: {},
    });
    expect(a.current()).toBe("searching");
  });
  it("expires transient reactions and supports custom tool and reaction mappings", () => {
    const a = new Activity({
      tools: { custom: "editing" },
      reactions: { "example:wave": "done" },
    });
    a.accept("tool.call", { callId: "1", tool: "custom" }, "main", 0);
    expect(a.current(0)).toBe("editing");
    a.accept("turn.failed", {}, "main", 0);
    expect(a.current(0)).toBe("error");
    expect(a.current(2000)).toBe("idle");
    a.accept("ui.reaction", { source: "example", kind: "wave" }, "main", 3000);
    expect(a.current(3000)).toBe("done");
  });
  it("renders raster colors and transparent pixels while retaining actions in small viewports", () => {
    const view = {
      raster: {
        width: 2,
        height: 2,
        rgba: Buffer.from([
          255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255,
        ]).toString("base64"),
      },
      lines: [{ text: "[Pet]", action: "pet" }],
    };
    expect(uiTextViewSchema.safeParse(view).success).toBe(true);
    const rows = viewRows(view, 8, 3),
      grid = gridFrom(rows, appearanceFrom([]), 8);
    expect(grid[0][3]).toEqual({ ch: "▀", fg: "#ff0000", bg: "#00ff00" });
    expect(grid[0][4]).toEqual({ ch: "▄", fg: "#0000ff" });
    expect(rows.at(-1)?.action).toBe("pet");
    expect(viewRows(view, 8, 1)).toEqual(view.lines);
    expect(
      uiTextViewSchema.safeParse({
        ...view,
        raster: { ...view.raster, rgba: "AAAA" },
      }).success
    ).toBe(false);
  });
  it("is static headless, animates only when visible, pauses, persists and disposes", async () => {
    const { $, views, writes } = await setup();
    expect(views).toHaveLength(1);
    expect(views[0].raster).toBeDefined();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(500);
    expect(views).toHaveLength(1);
    await hooks["ui.visibility"](
      { site: "plugin:mascot/companion", attached: true, visible: true },
      $
    );
    const first = views.at(-1).raster.rgba;
    await vi.advanceTimersByTimeAsync(181);
    expect(views.at(-1).raster.rgba).not.toBe(first);
    await hooks["prompt.submit"]({ text: "/mascot pause" }, $);
    expect(writes.at(-1)[1]).toContain('"paused": true');
    const count = views.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(views).toHaveLength(count);
    await hooks["prompt.submit"]({ text: "/mascot resume" }, $);
    await hooks["ui.visibility"](
      { site: "plugin:mascot/companion", attached: true, visible: false },
      $
    );
    const hidden = views.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(views).toHaveLength(hidden);
    await hooks["prompt.submit"]({ text: "/mascot off" }, $);
    expect($.ui.remove).toHaveBeenCalledWith("companion");
    await hooks["tool.call"]({ tool: "edit", callId: "1" }, $);
    expect(views).toHaveLength(hidden);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("closed panes stay closed until explicitly reopened; unrelated commands do nothing", async () => {
    const { $, views } = await setup();
    await hooks["ui.visibility"](
      { site: "plugin:mascot/companion", attached: false, visible: false },
      $
    );
    const count = views.length;
    await hooks["turn.start"]({ turnId: "a" }, $);
    expect(views).toHaveLength(count);
    expect(await hooks["prompt.submit"]({ text: "/help" }, $)).toBeUndefined();
    await hooks["prompt.submit"]({ text: "/mascot on" }, $);
    expect(views.length).toBeGreaterThan(count);
  });
});

describe("mascot extension contracts", () => {
  it("confines replaceable packs and animation symlinks to project/pack", async () => {
    tmp = await mkdtemp(join(tmpdir(), "mascot-"));
    await mkdir(join(tmp, "pack"));
    await symlink(
      join(defaultPack, "idle.apng"),
      join(tmp, "pack", "idle.apng")
    );
    await expect(
      new AnimationPack(tmp, { pack: "pack" }).load("idle")
    ).rejects.toThrow("inside its pack");
    await expect(
      new AnimationPack(tmp, { pack: defaultPack }).load("idle")
    ).rejects.toThrow("inside the project");
  });
  it("reloads saved settings and degrades missing packs to text", async () => {
    const { $, views, notifications } = await setup();
    $.fs.read.mockImplementation(async () =>
      JSON.stringify({ enabled: false, paused: true })
    );
    await hooks["prompt.submit"]({ text: "/mascot reload" }, $);
    expect($.ui.remove).toHaveBeenCalled();
    const count = views.length;
    await hooks["tool.call"]({ callId: "1", tool: "read" }, $);
    expect(views).toHaveLength(count);
    $.fs.read.mockImplementation(async () =>
      JSON.stringify({ pack: "missing" })
    );
    await hooks["prompt.submit"]({ text: "/mascot reload" }, $);
    expect(views.at(-1).raster).toBeUndefined();
    expect(notifications.length).toBeGreaterThan(0);
  });
  it("allows another plugin to override raster and removes surfaces from every workspace", async () => {
    const messages: WireMessage[] = [];
    const ui = new AppUI(
      (approve) =>
        new AgentCore({
          cwd: process.cwd(),
          provider: new ScriptedProvider([]),
          onApproval: approve,
        })
    );
    ui.connect((m) => messages.push(m));
    ui.receive(
      hello("renderer", {
        surfaces: ["terminal"],
        sites: [],
        elements: ["Layout", "Text"],
        encodings: ["jsonl"],
      })
    );
    const image = {
      width: 1,
      height: 2,
      rgba: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]).toString("base64"),
    };
    ui.core.host.registerPlugin(
      { name: "replacement", version: "1.0.0", trust: "trusted" },
      {
        "ui.render": (e: any) =>
          e.site === "plugin:example/picture"
            ? { tree: { raster: image, lines: [] } }
            : undefined,
      }
    );
    await ui.core.host.emit("service.ui.view", {
      plugin: "example",
      id: "picture",
      title: "Picture",
      view: { lines: [{ text: "Original" }] },
    });
    await ui.settled();
    const render = messages
      .filter(
        (m) => m.type === "render" && m.surface === "plugin-example-picture"
      )
      .at(-1);
    expect(
      render?.type === "render" &&
        render.grid
          ?.flat()
          .some((cell) => cell.fg === "#ff0000" && cell.bg === "#00ff00")
    ).toBe(true);
    ui.windows.switchTo(2);
    await ui.core.host.emit("service.ui.remove", {
      plugin: "example",
      id: "picture",
    });
    expect(ui.windows.has("plugin-example-picture")).toBe(false);
    ui.close();
    await ui.settled();
  });
});
