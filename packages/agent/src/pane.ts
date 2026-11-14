import {declareMessage, type RenderMessage, type WireMessage} from "@agent-compositor/protocol";

const MAX_PANE_DIMENSION = 10000;

/**
 * SessionPane — accumulates a turn's visible text and flushes it to a wire
 * sink as diff renders. Deltas arrive in order; the pane keeps the buffer, so
 * the renderer (neovim-grid reference or any other) sees only grid ops.
 *
 * Layout: completed lines occupy rows 0..n-1, the in-flight partial line
 * sits at row n. A flush redraws the partial row and appends new full rows.
 */

export interface PaneSink {
  (message: WireMessage): void;
}

export class SessionPane {
  private complete: string[] = [];
  private partial = "";
  private flushedComplete = 0;
  private flushedPartial = "";
  private dirty = false;

  constructor(
    private readonly pane: string,
    private readonly sink: PaneSink,
    private readonly surface = "session",
  ) {}

  /** Declare a pane and initialize its grid; later calls preserve its text. */
  declarePane(columns = 80, rows = 24): void {
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > MAX_PANE_DIMENSION ||
        !Number.isSafeInteger(rows) || rows < 1 || rows > MAX_PANE_DIMENSION)
      throw new RangeError("Pane dimensions must be integers from 1 to 10000");
    this.sink(declareMessage.parse({
      type: "declare",
      surfaces: [{ id: this.surface, kind: "pane", site: this.pane, title: this.pane }],
    }));
    const lines = [...this.complete, this.partial];
    // Ragged rows are valid grid data. Only one blank row needs the requested
    // width, so the allocation is O(columns + rows + text), not their product.
    const grid = Array.from({length: Math.max(rows, lines.length)}, (_, row) => {
      const cells = this.cells(lines[row] ?? "");
      if (row === 0) while (cells.length < columns) cells.push({ch: " "});
      return cells;
    });
    this.sink({type: "render", surface: this.surface, mode: "full", grid, flush: true});
    this.sink({type: "render", surface: this.surface, mode: "diff", ops: [this.cursor()], flush: true});
    this.flushedComplete = this.complete.length;
    this.flushedPartial = this.partial;
    this.dirty = false;
  }

  append(delta: string): void {
    if (!delta) return;
    const parts = delta.split("\n");
    this.partial += parts[0];
    for (let i = 1; i < parts.length; i++) {
      this.complete.push(this.partial);
      this.partial = parts[i];
    }
    this.dirty = true;
  }

  toolLine(text: string): void {
    this.append(`  [tool] ${text}\n`);
  }

  /** flush pending text as a diff render (no-op when nothing changed) */
  flush(): void {
    if (!this.dirty) return;
    const ops: NonNullable<RenderMessage["ops"]> = [];
    let row = this.flushedComplete;
    for (let i = this.flushedComplete; i < this.complete.length; i++) {
      ops.push({ op: "set", row: row++, col: 0, cells: this.cells(this.complete[i]) });
    }
    if (this.partial.length > 0 && (row !== this.flushedComplete || this.partial !== this.flushedPartial)) {
      ops.push({ op: "set", row, col: 0, cells: this.cells(this.partial) });
    }
    ops.push(this.cursor());
    this.sink({type: "render", surface: this.surface, mode: "diff", ops, flush: true});
    this.flushedComplete = this.complete.length;
    this.flushedPartial = this.partial;
    this.dirty = false;
  }

  private cells(text: string): NonNullable<RenderMessage["grid"]>[number] {
    return Array.from(text, ch => ({ch}));
  }

  private cursor(): Extract<NonNullable<RenderMessage["ops"]>[number], {op: "cursor"}> {
    return {op: "cursor", row: this.complete.length, col: Array.from(this.partial).length};
  }
}
