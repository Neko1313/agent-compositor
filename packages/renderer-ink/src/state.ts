import type { DeclareMessage, WireMessage } from "@agent-compositor/protocol";
import { SurfaceGrid } from "./grid.js";

export type SurfaceDecl = DeclareMessage["surfaces"][number];

/**
 * Renderer-side visual state: declared surfaces, their grids, focus.
 * Pure — no Ink, no I/O. The view subscribes; input is routed by whoever
 * owns the state. The acceptance test from the design docs applies:
 * this state machine plus any other renderer on the same event log must
 * produce identical user-visible output.
 */
export class RendererState {
  constructor(public nativeImages = false) {}
  readonly rasters = new Map<string, NonNullable<Extract<WireMessage, { type: "render" }>["raster"]>>();
  readonly surfaces = new Map<string, SurfaceDecl>();
  readonly grids = new Map<string, SurfaceGrid>();
  focused: string | undefined;
  layout?: Extract<WireMessage, { type: "layout" }>;

  /** Apply one wire message. Returns true when the visual state changed. */
  apply(msg: WireMessage): boolean {
    switch (msg.type) {
      case "layout": this.layout = msg; return true;
      case "declare":
        for (const decl of msg.surfaces) {
          this.surfaces.set(decl.id, decl);
          if (!this.grids.has(decl.id)) this.grids.set(decl.id, new SurfaceGrid());
        }
        if (!this.focused && msg.surfaces.length > 0) this.focused = msg.surfaces[0].id;
        return msg.surfaces.length > 0;
      case "render": {
        const grid = this.grids.get(msg.surface) ?? this.createImplicit(msg.surface);
        if (msg.mode === "full" && msg.grid) {
          if (msg.raster && this.nativeImages) {
            this.rasters.set(msg.surface, msg.raster);
            const image = msg.raster;
            grid.applyFull(msg.grid.map((row, y) => row.map((cell, x) =>
              y >= image.row && y < image.row + image.rows && x >= image.column && x < image.column + image.columns ? { ch: ' ' } : cell)));
          } else { this.rasters.delete(msg.surface); grid.applyFull(msg.grid); }
          if (msg.focused) this.focused = msg.surface;
          return true;
        }
        if (msg.mode === "diff" && msg.ops) {
          grid.applyOps(msg.ops);
          if (msg.focused) this.focused = msg.surface;
          return msg.flush; // batch: repaint only on flush
        }
        return false;
      }
      case "focus":
        if (this.surfaces.has(msg.surface) || this.grids.has(msg.surface)) {
          this.focused = msg.surface;
          return true;
        }
        return false;
      case "invalidate":
        return false; // we repaint panes wholesale; regions are a hint we ignore
      default:
        return false; // hello/hello-ack/input/bye: protocol flow, not visual state
    }
  }

  /** Rendering to an undeclared surface creates an implicit pane (lenient). */
  private createImplicit(id: string): SurfaceGrid {
    this.surfaces.set(id, { id, kind: "pane", title: id });
    const grid = new SurfaceGrid();
    this.grids.set(id, grid);
    return grid;
  }

  /** Declared order — the layout order. */
  surfaceList(): SurfaceDecl[] {
    return [...this.surfaces.values()];
  }

  grid(id: string): SurfaceGrid | undefined {
    return this.grids.get(id);
  }
}
