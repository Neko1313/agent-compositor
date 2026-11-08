import { describe, it, expect } from "vitest";
import { WindowManager, leaves } from "../src/windows.js";

describe("tiling compositor", () => {
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
    wm.resize(.1); expect(wm.frames(100, 40)[0].width).toBe(80);
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
});
