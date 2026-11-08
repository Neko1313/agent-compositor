import type { RenderMessage } from "@agent-compositor/protocol";
import type { Cell, StyledCell } from "./cell.js";
import { blankCell, styleKey } from "./cell.js";

type DiffOp = NonNullable<RenderMessage["ops"]>[number];

export interface Segment {
  text: string;
  style: Omit<StyledCell, "ch">;
}

export interface Cursor {
  row: number;
  col: number;
}

/**
 * A surface's virtual cell grid. Neovim-style semantics: a full render
 * replaces everything; diff ops mutate in place and a flush repaints.
 * The grid grows to fit ops; rows are ragged only until a full render
 * or a wide op regularizes them.
 */
export class SurfaceGrid {
  private rows: Cell[][] = [];
  cursor: Cursor | undefined;

  get width(): number {
    let w = 0;
    for (const row of this.rows) w = Math.max(w, row.length);
    return w;
  }

  get height(): number {
    return this.rows.length;
  }

  applyFull(grid: Cell[][]): void {
    this.rows = grid.map((row) => row.map((c) => ({ ...c })));
  }

  applyOps(ops: DiffOp[]): void {
    for (const op of ops) {
      switch (op.op) {
        case "clear":
          this.rows = [];
          this.cursor = undefined;
          break;
        case "set":
          this.set(op.row, op.col, op.cells);
          break;
        case "scroll":
          this.scroll(op.rows);
          break;
        case "cursor":
          this.cursor = { row: op.row, col: op.col };
          break;
      }
    }
  }

  private ensureRow(row: number): Cell[] {
    while (this.rows.length <= row) this.rows.push([]);
    return this.rows[row];
  }

  private set(row: number, col: number, cells: Cell[]): void {
    const target = this.ensureRow(row);
    while (target.length < col) target.push(blankCell());
    for (let i = 0; i < cells.length; i++) {
      target[col + i] = { ...cells[i] };
    }
  }

  /** Positive n scrolls content up n rows; negative scrolls down. Blank rows fill the gap. */
  private scroll(n: number): void {
    const width = this.width;
    if (n > 0) {
      this.rows = this.rows.slice(n);
      for (let i = 0; i < n; i++) this.rows.push(Array.from({ length: width }, blankCell));
    } else if (n < 0) {
      this.rows = Array.from({ length: -n }, () => Array.from({ length: width }, blankCell)).concat(this.rows);
    }
  }

  /** Row content as styled segments, consecutive same-style cells merged. */
  segments(row: number, inverseAt?: Cursor): Segment[] {
    const cells: StyledCell[] = (this.rows[row] ?? []).map((c, i) =>
      inverseAt && inverseAt.row === row && inverseAt.col === i ? { ...c, inverse: true } : c,
    );
    if (cells.length === 0) return [];
    const out: Segment[] = [];
    let cur: StyledCell = cells[0];
    let text = cur.ch;
    const push = (c: StyledCell) => {
      const { ch: _ch, ...style } = c;
      out.push({ text, style });
    };
    for (let i = 1; i < cells.length; i++) {
      const c = cells[i];
      if (styleKey(c) === styleKey(cur)) {
        text += c.ch;
      } else {
        push(cur);
        cur = c;
        text = c.ch;
      }
    }
    push(cur);
    return out;
  }

  /** Plain-text lines (styles dropped) — handy for tests, snapshots, headless mode. */
  toLines(): string[] {
    return this.rows.map((row) => row.map((c) => c.ch).join("").replace(/\s+$/, ""));
  }
}
