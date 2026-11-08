import { describe, expect, it } from "vitest";
import type { Cell } from "../src/cell.js";
import { SurfaceGrid } from "../src/grid.js";

const row = (text: string, style: Partial<Cell> = {}): Cell[] =>
  [...text].map((ch) => ({ ch, ...style }));

describe("SurfaceGrid", () => {
  it("applies a full grid and reports lines", () => {
    const g = new SurfaceGrid();
    g.applyFull([row("hello"), row("world")]);
    expect(g.height).toBe(2);
    expect(g.toLines()).toEqual(["hello", "world"]);
  });

  it("set op writes cells, padding short rows with blanks", () => {
    const g = new SurfaceGrid();
    g.applyFull([row("abc")]);
    g.applyOps([{ op: "set", row: 0, col: 5, cells: row("xy") }]);
    expect(g.toLines()[0]).toBe("abc  xy");
    expect(g.width).toBe(7);
  });

  it("set op can grow the grid with new rows", () => {
    const g = new SurfaceGrid();
    g.applyOps([{ op: "set", row: 2, col: 1, cells: row("hi") }]);
    expect(g.height).toBe(3);
    expect(g.toLines()).toEqual(["", "", " hi"]);
  });

  it("clear empties the grid and drops the cursor", () => {
    const g = new SurfaceGrid();
    g.applyOps([{ op: "set", row: 0, col: 0, cells: row("x") }, { op: "cursor", row: 0, col: 0 }]);
    g.applyOps([{ op: "clear" }]);
    expect(g.height).toBe(0);
    expect(g.cursor).toBeUndefined();
  });

  it("scroll up shifts content and blanks the tail at grid width", () => {
    const g = new SurfaceGrid();
    g.applyFull([row("aa"), row("bb"), row("cc")]);
    g.applyOps([{ op: "scroll", rows: 1 }]);
    expect(g.toLines()).toEqual(["bb", "cc", ""]);
    expect(g.width).toBe(2);
  });

  it("scroll down prepends blank rows", () => {
    const g = new SurfaceGrid();
    g.applyFull([row("aa")]);
    g.applyOps([{ op: "scroll", rows: -1 }]);
    expect(g.toLines()).toEqual(["", "aa"]);
  });

  it("segments merge consecutive same-style cells", () => {
    const g = new SurfaceGrid();
    g.applyFull([[...row("aa"), ...row("bb", { bold: true }), ...row("cc")]]);
    const segs = g.segments(0);
    expect(segs.map((s) => s.text)).toEqual(["aa", "bb", "cc"]);
    expect(segs[1].style.bold).toBe(true);
    expect(segs[0].style.bold).toBeUndefined();
  });

  it("cursor inversion splits the segment at the cursor column", () => {
    const g = new SurfaceGrid();
    g.applyFull([row("ab")]);
    g.applyOps([{ op: "cursor", row: 0, col: 1 }]);
    const segs = g.segments(0, g.cursor);
    expect(segs.map((s) => s.text)).toEqual(["a", "b"]);
    expect(segs[1].style.inverse).toBe(true);
    expect(segs[0].style.inverse).toBeUndefined();
  });
});
