import { describe, expect, it } from "vitest";
import type { WireMessage } from "@agent-compositor/protocol";
import { RendererState } from "../src/state.js";

const declare = (id: string, kind: "pane" | "status-bar" = "pane"): WireMessage => ({
  type: "declare",
  surfaces: [{ id, kind }],
});

describe("RendererState", () => {
  it("declare registers surfaces and focuses the first", () => {
    const s = new RendererState();
    expect(s.apply(declare("session"))).toBe(true);
    s.apply(declare("status", "status-bar"));
    expect(s.surfaceList().map((x) => x.id)).toEqual(["session", "status"]);
    expect(s.focused).toBe("session");
  });

  it("full render installs a grid and can move focus", () => {
    const s = new RendererState();
    s.apply(declare("session"));
    s.apply(declare("status", "status-bar"));
    const changed = s.apply({
      type: "render",
      surface: "status",
      mode: "full",
      flush: true,
      focused: true,
      grid: [[{ ch: "R", bold: true }, { ch: "E", bold: true }, { ch: "A", bold: true }, { ch: "D", bold: true }, { ch: "Y", bold: true }]],
    });
    expect(changed).toBe(true);
    expect(s.focused).toBe("status");
    expect(s.grid("status")!.toLines()).toEqual(["READY"]);
  });

  it("diff renders repaint only on flush", () => {
    const s = new RendererState();
    s.apply(declare("session"));
    s.apply({ type: "render", surface: "session", mode: "full", flush: true, grid: [[{ ch: "a" }]] });
    expect(s.apply({ type: "render", surface: "session", mode: "diff", flush: false, ops: [{ op: "set", row: 0, col: 0, cells: [{ ch: "b" }] }] })).toBe(false);
    expect(s.grid("session")!.toLines()).toEqual(["b"]); // state updated even before flush
    expect(s.apply({ type: "render", surface: "session", mode: "diff", flush: true, ops: [{ op: "set", row: 0, col: 0, cells: [{ ch: "c" }] }] })).toBe(true);
    expect(s.grid("session")!.toLines()).toEqual(["c"]);
  });

  it("focus message switches the focused surface", () => {
    const s = new RendererState();
    s.apply(declare("session"));
    s.apply(declare("status", "status-bar"));
    expect(s.apply({ type: "focus", surface: "status" })).toBe(true);
    expect(s.focused).toBe("status");
    expect(s.apply({ type: "focus", surface: "ghost" })).toBe(false);
  });

  it("rendering an undeclared surface creates an implicit pane", () => {
    const s = new RendererState();
    s.apply({ type: "render", surface: "ad-hoc", mode: "full", flush: true, grid: [[{ ch: "x" }]] });
    expect(s.surfaceList().map((x) => x.id)).toEqual(["ad-hoc"]);
    expect(s.grid("ad-hoc")!.toLines()).toEqual(["x"]);
  });

  it("non-visual messages never dirty the state", () => {
    const s = new RendererState();
    s.apply(declare("session"));
    expect(s.apply({ type: "invalidate", surface: "session" })).toBe(false);
    expect(
      s.apply({ type: "input", surface: "session", data: { kind: "text", text: "x" } }),
    ).toBe(false);
  });
});
