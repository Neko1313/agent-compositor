import { z } from "zod";

/** Wire message schemas. One direction per message; JSONL-framed. */

export const helloMessage = z.object({
  type: z.literal("hello"),
  /** protocol name, pinned: "agent-compositor" */
  protocol: z.literal("agent-compositor"),
  /** wire protocol version, semver */
  version: z.string(),
  role: z.enum(["core", "renderer"]),
  capabilities: z.object({
    surfaces: z.array(z.enum(["terminal", "desktop", "web", "headless"])),
    sites: z.array(z.string()),
    elements: z.array(z.string()),
    encodings: z.array(z.literal("jsonl")),
  }),
});

export const helloAckMessage = z.object({
  type: z.literal("hello-ack"),
  ok: z.boolean(),
  /** negotiated version (min minor on matching major) */
  version: z.string().optional(),
  reason: z.string().optional(),
});

const surfaceDecl = z.object({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(["pane", "site", "status-bar"]),
  /** which site a pane binds to; status-bar and sites omit it */
  site: z.string().optional(),
  title: z.string().optional(),
  placement: z.enum(["dock", "inline"]).optional(),
});

export const declareMessage = z.object({
  type: z.literal("declare"),
  surfaces: z.array(surfaceDecl),
});

export const cellSchema = z.object({
  ch: z.string().min(1).max(4),
  fg: z.string().optional(),
  bg: z.string().optional(),
  bold: z.boolean().optional(),
  dim: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});

export const diffOp = z.union([
  z.object({ op: z.literal("clear") }),
  z.object({
    op: z.literal("set"),
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    cells: z.array(cellSchema),
  }),
  z.object({ op: z.literal("scroll"), rows: z.number().int() }),
  z.object({ op: z.literal("cursor"), row: z.number().int().nonnegative(), col: z.number().int().nonnegative() }),
]);

/** Bounded native pixels plus a cell rectangle inside a surface's content grid. */
export const rasterMessage = z.object({
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  rgba: z.string().max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  alt: z.string().max(200).optional(),
  column: z.number().int().min(0).max(10000),
  row: z.number().int().min(0).max(10000),
  columns: z.number().int().min(1).max(10000),
  rows: z.number().int().min(1).max(10000),
}).refine(image => image.rgba.length / 4 * 3 - (image.rgba.endsWith('==') ? 2 : image.rgba.endsWith('=') ? 1 : 0) === image.width * image.height * 4, 'RGBA length must match dimensions');

/** Neovim-style grid semantics: either a full grid or batched diff ops ending with flush. */
export const renderMessage = z.object({
  type: z.literal("render"),
  surface: z.string(),
  /** "full": grid carries the entire pane; "diff": ops are applied, then flush redraws */
  mode: z.enum(["full", "diff"]),
  grid: z.array(z.array(cellSchema)).optional(),
  ops: z.array(diffOp).optional(),
  flush: z.boolean(),
  focused: z.boolean().optional(),
  raster: rasterMessage.optional(),
});

export const inputMessage = z.object({
  type: z.literal("input"),
  surface: z.string(),
  data: z.union([
    z.object({ kind: z.literal("key"), key: z.string(), modifiers: z.array(z.string()).optional() }),
    z.object({ kind: z.literal("text"), text: z.string(), paste: z.literal(true).optional() }),
    z.object({ kind: z.literal("mouse"), row: z.number().int().nonnegative(), col: z.number().int().nonnegative(), button: z.string(), action: z.enum(["press", "move", "release"]).optional() }),
  ]),
});

export const focusMessage = z.object({
  type: z.literal("focus"),
  surface: z.string(),
});

/** damage tracking: the renderer may repaint only these regions */
export const invalidateMessage = z.object({
  type: z.literal("invalidate"),
  surface: z.string(),
  regions: z
    .array(z.object({ row: z.number(), col: z.number(), rows: z.number(), cols: z.number() }))
    .optional(),
});

export const byeMessage = z.object({
  type: z.literal("bye"),
  reason: z.string().optional(),
});

/** Compositor-resolved rectangles; dimensions include window chrome. */
export const layoutMessage = z.object({
  type: z.literal("layout"), width: z.number().int().positive(), height: z.number().int().positive(),
  frames: z.array(z.object({ surface: z.string(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
    width: z.number().int().positive(), height: z.number().int().positive(),
    chrome: z.object({ border: z.string(), accent: z.string(), text: z.string(), muted: z.string(),
      titleBackground: z.string(), warning: z.string(), borderStyle: z.enum(["single", "round", "double"]),
      controls: z.enum(["always", "focus"]) }).optional(),
    controls: z.boolean().optional(), hovered: z.boolean().optional(), drop: z.enum(["left", "right", "top", "bottom", "center"]).optional() })),
});

/** Mouse pointer, distinct from the text caret in a surface grid. */
export const pointerMessage = z.object({
  type: z.literal("pointer"), shape: z.enum(["default", "pointer", "text", "grab", "grabbing", "ew-resize", "ns-resize", "not-allowed"]),
});

export const wireMessage = z.discriminatedUnion("type", [
  helloMessage,
  layoutMessage,
  pointerMessage,
  helloAckMessage,
  declareMessage,
  renderMessage,
  inputMessage,
  focusMessage,
  invalidateMessage,
  byeMessage,
]);

export type HelloMessage = z.infer<typeof helloMessage>;
export type HelloAckMessage = z.infer<typeof helloAckMessage>;
export type DeclareMessage = z.infer<typeof declareMessage>;
export type RenderMessage = z.infer<typeof renderMessage>;
export type InputMessage = z.infer<typeof inputMessage>;
export type WireMessage = z.infer<typeof wireMessage>;
