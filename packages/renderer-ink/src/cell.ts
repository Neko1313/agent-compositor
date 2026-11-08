import { cellSchema } from "@agent-compositor/protocol";
import type { z } from "zod";

export type Cell = z.infer<typeof cellSchema>;

/** Renderer-side cell: wire cell + local-only styling (cursor inversion). */
export type StyledCell = Cell & { inverse?: boolean };

export const blankCell = (): Cell => ({ ch: " " });

/** Style identity for a cell, excluding the glyph. */
export function styleKey(c: StyledCell): string {
  return `${c.fg ?? ""}|${c.bg ?? ""}|${c.bold ? 1 : 0}${c.dim ? 1 : 0}${c.italic ? 1 : 0}${c.underline ? 1 : 0}${c.inverse ? 1 : 0}`;
}
