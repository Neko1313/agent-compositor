import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink, copyFile } from "node:fs/promises";
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
  restoreDarkInk,
} from "../../../plugins/mascot/animations.js";
import hooks, { dispose } from "../../../plugins/mascot/hooks.js";
import { viewRows, gridFrom, appearanceFrom } from "../src/presentation.js";
import { uiTextViewSchema } from "@agent-compositor/events";
let tmp: string;
beforeEach(()=>{vi.stubEnv("NO_COLOR",undefined);vi.stubEnv("TERM","xterm-256color");});
afterEach(async () => {
  dispose();
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
          (f) => f.delay === 180 && f.width === 228 && f.height === 228
        )
      ).toBe(true);
      expect(new Set(frames.map((f) => f.rgba)).size).toBeGreaterThan(1);
    }
  });
  it("repairs the supplied transparent line art while retaining source RGB and custom-pack transparency", async () => {
    const raw = await decode(join(defaultPack, 'idle.apng'));
    const restored = await decode(join(defaultPack, 'idle.apng'), true);
    let recovered = 0, rgbChanged = 0, invalidAlphaChange = 0;
    for (let f = 0; f < raw.length; f++) {
      const before = Buffer.from(raw[f].rgba, 'base64'), after = Buffer.from(restored[f].rgba, 'base64');
      for (let p = 0; p < before.length; p += 4) {
        if (!after.subarray(p, p + 3).equals(before.subarray(p, p + 3))) rgbChanged++;
        if (before[p + 3] !== after[p + 3]) {
          if (before[p + 3] !== 0 || after[p + 3] !== 255) invalidAlphaChange++;
          recovered++;
        }
      }
    }
    expect(rgbChanged).toBe(0);
    expect(invalidAlphaChange).toBe(0);
    expect(recovered).toBeGreaterThan(10000);
    tmp = await mkdtemp(join(tmpdir(), 'mascot-ink-'));
    await mkdir(join(tmp, 'pack'));
    await copyFile(join(defaultPack, 'idle.apng'), join(tmp, 'pack/idle.apng'));
    expect((await new AnimationPack(tmp, { pack: 'pack' }).load('idle'))[0].rgba).toBe(raw[0].rgba);
    expect((await new AnimationPack(tmp, { restoreInk: false }).load('idle'))[0].rgba).toBe(raw[0].rgba);
    expect((await new AnimationPack(tmp, {}).load('idle'))[0].rgba).toBe(restored[0].rgba);
    // Completely transparent images have no sprite to outline, even if RGB is black.
    expect(restoreDarkInk(new ArrayBuffer(64), 4, 4)).toEqual(Buffer.alloc(64));
  });
  it("does not postpone animation frames on repeated activity events", async () => {
    const { $, views } = await setup();
    vi.useFakeTimers();
    await hooks['ui.visibility']({ site: 'plugin:mascot/companion', attached: true, visible: true }, $);
    const first = JSON.stringify(views.at(-1).lines);
    await vi.advanceTimersByTimeAsync(100);
    await hooks['tool.result']({ callId: 'unknown' }, $);
    await vi.advanceTimersByTimeAsync(151);
    expect(JSON.stringify(views.at(-1).lines)).not.toBe(first);
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
    expect(views[0].attachment).toMatchObject({site:"composer",width:16,label:"Ready"});
    expect(views[0].raster).toBeUndefined();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(500);
    expect(views).toHaveLength(1);
    await hooks["ui.visibility"](
      { site: "plugin:mascot/companion", attached: true, visible: true },
      $
    );
    const first = JSON.stringify(views.at(-1).lines);
    await vi.advanceTimersByTimeAsync(251);
    expect(JSON.stringify(views.at(-1).lines)).not.toBe(first);
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
  it.each(["compact","no-color","dumb"])("keeps %s motion static while still reporting activity",async mode=>{
    if(mode==="no-color")vi.stubEnv("NO_COLOR","1");
    if(mode==="dumb")vi.stubEnv("TERM","dumb");
    const {$,views}=await setup();vi.useFakeTimers();
    await hooks["ui.visibility"]({site:"plugin:mascot/companion",attached:true,visible:true,rows:mode==="compact"?1:4},$);
    const count=views.length;await vi.advanceTimersByTimeAsync(1000);expect(views.length).toBe(count);
    await hooks["tool.call"]({tool:"grep",callId:"reading"},$);
    expect(views.at(-1).attachment.label).toBe("Searching");
    const updated=views.length;await vi.advanceTimersByTimeAsync(1000);expect(views.length).toBe(updated);
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
  it("reloads saved settings and reports legacy pack configuration", async () => {
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
  it.each([false, true])("allows raster overrides and negotiates native graphics: %s", async native => {
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
        elements: ["Layout", "Text", ...(native ? ["Raster"] : [])],
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
    if (render?.type === 'render') {
      if (native) expect(render.raster).toMatchObject(image);
      else expect(render.raster).toBeUndefined();
    }
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
