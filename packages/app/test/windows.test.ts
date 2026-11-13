import { describe, it, expect } from "vitest";
import { WindowManager, leaves } from "../src/windows.js";

describe("tiling compositor", () => {
  it("orients and swaps the nearest nested split without changing its focused identity", () => {
    const wm = new WindowManager();
    wm.focused = "tools"; wm.open("inspector");
    wm.orient();
    expect(wm.axis).toBe("vertical");
    expect(wm.frames(100, 40).find(f => f.surface === "session")).toMatchObject({width: 70, height: 40});
    expect(wm.frames(100, 40).find(f => f.surface === "inspector")).toMatchObject({x: 70, y: 20, width: 30, height: 20});
    wm.swap();
    expect(wm.focused).toBe("inspector");
    expect(wm.frames(100, 40).find(f => f.surface === "inspector")).toMatchObject({x: 70, y: 0});
    wm.focused = "session"; wm.orient();
    expect(wm.frames(100, 40).find(f => f.surface === "session")).toMatchObject({x: 0, y: 0, width: 100});
  });
  it("restores a selected empty workspace without inventing panes", () => {
    const wm = new WindowManager();
    wm.switchTo(3);
    const restored = new WindowManager();
    restored.restore(wm.snapshot(), new Set(["session", "tools"]));
    expect(restored.workspace).toBe(3);
    expect(restored.frames(100, 40)).toEqual([]);
    expect(restored.focused).toBe("input");
    restored.switchTo(1);
    expect(restored.ids()).toEqual(["session", "tools"]);
  });
  it("keeps the exact tree when moving a pane to its current workspace", () => {
    const wm = new WindowManager();
    wm.focused = "tools"; wm.axis = "vertical"; wm.open("inspector");
    const before = wm.snapshot(), frames = wm.frames(100, 40);
    wm.moveWorkspace(1);
    expect(wm.snapshot()).toEqual(before);
    expect(wm.frames(100, 40)).toEqual(frames);
  });
  it("nests splits, partitions the viewport and collapses closed containers", () => {
    const wm = new WindowManager(); wm.focused = "tools"; wm.axis = "vertical"; wm.open("inspector");
    const frames = wm.frames(100, 40);
    expect(frames.find(f => f.surface === "session")).toMatchObject({ width: 70, height: 40 });
    expect(frames.find(f => f.surface === "tools")).toMatchObject({ x: 70, y: 0, width: 30, height: 20 });
    expect(frames.find(f => f.surface === "inspector")).toMatchObject({ x: 70, y: 20, width: 30, height: 20 });
    expect(frames.reduce((sum, f) => sum + f.width * f.height, 0)).toBe(4000);
    wm.close(); expect(leaves(wm.tree)).toEqual(["session", "tools"]);
    expect(wm.frames(100, 40).find(f => f.surface === "tools")?.height).toBe(40);
  });
  it("focuses and swaps geometrically, resizes nearest split and toggles fullscreen", () => {
    const wm = new WindowManager(); wm.direction("right", 100, 40); expect(wm.focused).toBe("tools");
    wm.direction("left", 100, 40, true); expect(wm.ids()).toEqual(["tools", "session"]);
    wm.resize(.1); expect(wm.frames(100, 40)[0].width).toBe(76);
    wm.fullscreen = true; expect(wm.frames(100, 40)).toEqual([{ surface: "tools", x: 0, y: 0, width: 100, height: 40 }]);
  });
  it("moves windows between independent workspaces and restores their focus", () => {
    const wm = new WindowManager(); wm.focused = "tools"; wm.moveWorkspace(2);
    expect(wm.ids()).toEqual(["tools"]); expect(wm.focused).toBe("tools");
    wm.switchTo(1); expect(wm.ids()).toEqual(["session"]);
    wm.switchTo(2); expect(wm.focused).toBe("tools");
    wm.close(); expect(wm.frames(80, 24)).toEqual([]);
    wm.open("help"); expect(wm.ids()).toEqual(["help"]);
  });
  it("keeps small-terminal frames in bounds", () => {
    const wm = new WindowManager(); wm.open("third");
    for (const frame of wm.frames(16, 5)) {
      expect(frame.width).toBeGreaterThan(0); expect(frame.height).toBeGreaterThan(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(16); expect(frame.y + frame.height).toBeLessThanOrEqual(5);
    }
  });
  it("projects readable panes on resize and restores the exact saved geometry", () => {
    const wm = new WindowManager();
    wm.focused = "tools"; wm.open("inspector");
    const saved = wm.snapshot(), wide = wm.frames(160, 30);
    const narrow = wm.frames(60, 24);
    expect(narrow.map(f => f.surface)).toEqual(["session", "inspector"]);
    expect(narrow[1]).toMatchObject({ x: 36, width: 24, height: 24 });
    expect(wm.snapshot()).toEqual(saved);
    expect(wm.frames(160, 30)).toEqual(wide);
    const restored = new WindowManager();
    restored.restore(saved, new Set(wm.ids()));
    expect(restored.frames(60, 24)).toEqual(narrow);
    expect(restored.frames(160, 30)).toEqual(wide);
  });
  it("reaches collapsed panes through directional focus using their logical positions", () => {
    const wm = new WindowManager();
    wm.focused = "tools"; wm.open("inspector");
    wm.focused = "session";
    expect(wm.frames(60, 24).map(f => f.surface)).toEqual(["session", "tools"]);
    wm.direction("right", 60, 24);
    expect(wm.focused).toBe("tools");
    expect(wm.frames(60, 24).map(f => f.surface)).toEqual(["session", "tools"]);
    wm.direction("right", 60, 24);
    expect(wm.focused).toBe("inspector");
    expect(wm.frames(60, 24).map(f => f.surface)).toEqual(["session", "inspector"]);
    wm.direction("left", 60, 24);
    expect(wm.focused).toBe("tools");
  });
  it("preserves the last content pane when the composer is focused, including fullscreen and restore", () => {
    const wm = new WindowManager();
    wm.focused = "tools"; wm.fullscreen = true; wm.focused = "input";
    expect(wm.frames(100, 30)).toEqual([{ surface: "tools", x: 0, y: 0, width: 100, height: 30 }]);
    const restored = new WindowManager(); restored.restore(wm.snapshot(), new Set(wm.ids()));
    expect(restored.focused).toBe("input");
    expect(restored.frames(100, 30)).toEqual(wm.frames(100, 30));
    wm.fullscreen = false;
    expect(wm.frames(60, 24).map(f => f.surface)).toEqual(["session", "tools"]);
    wm.direction("left", 60, 24);
    expect(wm.focused).toBe("session");
  });
  it("offers separators only for the visible projection, with valid original tree paths", () => {
    const wm = new WindowManager();
    wm.axis = "vertical"; wm.focused = "tools"; wm.open("inspector");
    // Root collapses horizontally; its surviving tools/inspector split still resizes.
    expect(wm.frames(40, 24).map(f => f.surface)).toEqual(["tools", "inspector"]);
    expect(wm.separator(27, 5, 40, 24)).toBeUndefined();
    const handle = wm.separator(20, 12, 40, 24)!;
    expect(handle.path).toEqual([1]);
    expect(wm.dragResize(handle, 20, 15)).toBe(true);
    expect(wm.frames(40, 24)[0].height).toBe(15);
    wm.cancelResize(handle);
    expect(wm.frames(40, 24)[0].height).toBe(12);
    // A four-row vertical child would be unreadable, so it has no separator.
    expect(wm.separator(20, 4, 60, 8)).toBeUndefined();
    wm.fullscreen = true;
    expect(wm.separator(20, 12, 40, 24)).toBeUndefined();
  });

  it("collapses short foreground splits while preserving their height ratio for recovery", () => {
    const wm = new WindowManager();
    wm.axis = "vertical"; wm.focused = "session"; wm.open("review");
    const saved = wm.snapshot(), tall = wm.frames(100, 30);
    expect(wm.frames(100, 10)).toEqual([
      { surface: "review", x: 0, y: 0, width: 70, height: 10 },
      { surface: "tools", x: 70, y: 0, width: 30, height: 10 },
    ]);
    wm.direction("up", 100, 10);
    expect(wm.focused).toBe("session");
    expect(wm.frames(100, 10)[0].surface).toBe("session");
    wm.focused = "review";
    expect(wm.snapshot()).toEqual(saved);
    expect(wm.frames(100, 30)).toEqual(tall);
  });

});
