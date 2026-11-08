import { describe, it, expect } from "vitest";
import { resolvePlacement } from "../src/placement.js";
import { WindowManager } from "../src/windows.js";

describe("placement policy", () => {
  it("applies site defaults and later matching user rules over plugin requests", () => {
    expect(resolvePlacement({ sites: { sidebar: { size: .2, focus: false } }, rules: [
      { match: { plugin: "cost" }, site: "sidebar", workspace: 2 },
      { match: { plugin: "cost", surface: "usage" }, size: .35 },
      { match: { plugin: "other" }, workspace: 9 },
    ] }, "cost", "usage", { site: "inspector", size: .6, focus: true })).toEqual({
      site: "sidebar", size: .35, focus: false, workspace: 2,
    });
  });
  it("places background sidebar and inspector relative to session without changing focus", () => {
    const wm = new WindowManager(); wm.focused = "input";
    wm.place("usage", { site: "sidebar", size: .2 });
    expect(wm.focused).toBe("input");
    expect(wm.frames(100, 40).find(f => f.surface === "usage")).toMatchObject({ x: 80, width: 20, height: 40 });
    wm.place("inspect", { site: "inspector", relativeTo: "session", size: .25 });
    const session = wm.frames(100, 40).find(f => f.surface === "session")!;
    expect(wm.frames(100, 40).find(f => f.surface === "inspect")).toMatchObject({ x: session.x, y: 30, width: session.width, height: 10 });
    expect(wm.focused).toBe("input");
  });
  it("places on a hidden workspace and leaves manually moved windows alone", () => {
    const wm = new WindowManager(); wm.focused = "input";
    wm.place("usage", { site: "status-bar", workspace: 2 });
    expect(wm.workspace).toBe(1); expect(wm.ids()).not.toContain("usage");
    wm.switchTo(2); expect(wm.ids()).toEqual(["usage"]);
    wm.focused = "usage"; wm.moveWorkspace(3);
    wm.place("usage", { workspace: 2, site: "sidebar", focus: true });
    expect(wm.workspace).toBe(3); expect(wm.ids()).toEqual(["usage"]);
  });
  it("uses explicit focus to follow a new surface and falls back when anchors are absent", () => {
    const wm = new WindowManager(); wm.place("job", { workspace: 4, focus: true, site: "inspector", relativeTo: "missing" });
    expect(wm.workspace).toBe(4); expect(wm.focused).toBe("job");
    wm.place("bar", { site: "status-bar", size: .25 });
    expect(wm.frames(100, 40).find(f => f.surface === "bar")).toMatchObject({ x: 0, y: 30, width: 100, height: 10 });
  });
});

import { ConfigSchema } from "@agent-compositor/config";
describe("placement validation", () => {
  it("rejects invalid workspace numbers, sizes and sites", () => {
    for (const invalid of [{ workspace: 0 }, { size: 2 }, { site: "arbitrary-position" }]) {
      expect(ConfigSchema.safeParse({ ui: { rules: [{ match: { plugin: "cost" }, ...invalid }] } }).success).toBe(false);
    }
    expect(ConfigSchema.safeParse({ ui: { sites: { sidebar: { size: .3, workspace: 2 } } } }).success).toBe(true);
  });
});
