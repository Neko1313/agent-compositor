import { cellSchema } from "./messages.js";
import type { z } from "zod";

export type Cell = z.infer<typeof cellSchema>;

/** Renderer-side cell: wire cell + local-only styling (cursor inversion). */
export type StyledCell = Cell & { inverse?: boolean };

export const blankCell = (): Cell => ({ ch: " " });

/** Display protocol text literally without interpreting controls or directional overrides. */
export function literalCellText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,
    point => '\\u' + point.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Style identity for a cell, excluding the glyph. */
export function styleKey(c: StyledCell): string {
  return `${c.fg ?? ""}|${c.bg ?? ""}|${c.bold ? 1 : 0}${c.dim ? 1 : 0}${c.italic ? 1 : 0}${c.underline ? 1 : 0}${c.inverse ? 1 : 0}`;
}
