import type { WireMessage } from "@agent-compositor/protocol";

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
  private seq = 0;

  constructor(
    private readonly pane: string,
    private readonly sink: PaneSink,
    private readonly surface = "session",
  ) {}

  /** declare the surface once, before the first render */
  declarePane(columns = 80, rows = 24): void {
    this.sink({
      v: 1,
      type: "declare",
      surfaces: [{ id: this.surface, pane: this.pane, columns, rows, chrome: true }],
    });
  }

  append(delta: string): void {
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
    const ops: Array<Record<string, unknown>> = [];
    if (this.flushedPartial.length > 0) {
      ops.push({ op: "clear", y: this.flushedComplete, x: 0, len: this.flushedPartial.length });
    }
    let y = this.flushedComplete;
    for (let i = this.flushedComplete; i < this.complete.length; i++) {
      ops.push({ op: "set", y: y++, x: 0, text: this.complete[i] });
    }
    if (this.partial.length > 0) {
      ops.push({ op: "set", y, x: 0, text: this.partial });
    }
    if (ops.length > 0) {
      this.sink({
        v: 1,
        type: "render",
        surface: this.surface,
        pane: this.pane,
        seq: ++this.seq,
        mode: "diff",
        ops,
      } as unknown as WireMessage);
    }
    this.flushedComplete = this.complete.length;
    this.flushedPartial = this.partial;
    this.dirty = false;
  }
}
