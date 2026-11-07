import { z } from "zod";
import { defineEvent } from "../define.js";

/** Element trees are opaque to the core; validated by the renderer's element table. */
const elementTree = z.unknown();

export const uiRender = defineEvent({
  name: "ui.render",
  since: "0.1.0",
  version: 1,
  summary: "A render site is about to be drawn. Return an element tree. Writing plugin state during render is forbidden.",
  input: z.object({
    site: z.string(),
    surface: z.enum(["terminal", "desktop", "web", "headless"]),
    props: z.record(z.unknown()),
    viewport: z.object({ columns: z.number(), rows: z.number() }).optional(),
  }),
  responses: [{ kind: "tree", summary: "the element tree to draw", schema: elementTree }],
  frozen: true,
});

export const uiPress = defineEvent({
  name: "ui.press",
  since: "0.1.0",
  version: 1,
  summary: "A Button the plugin drew was pressed.",
  input: z.object({ site: z.string(), key: z.string() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const uiFocus = defineEvent({
  name: "ui.focus",
  since: "0.1.0",
  version: 1,
  summary: "Focus is about to move to another pane/control.",
  input: z.object({ site: z.string() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const uiInvalidate = defineEvent({
  name: "ui.invalidate",
  since: "0.1.0",
  version: 1,
  summary: "Damage tracking: the plugin marks changed regions of its pane.",
  input: z.object({
    site: z.string(),
    regions: z
      .array(z.object({ row: z.number(), col: z.number(), rows: z.number(), cols: z.number() }))
      .optional(),
  }),
  responses: [],
  frozen: true,
});
