import { z } from "zod";
import { defineEvent } from "../define.js";

const color = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}|black|red|green|yellow|blue|magenta|cyan|white|gray|grey|blackBright|redBright|greenBright|yellowBright|blueBright|magentaBright|cyanBright|whiteBright)$/
  );
export const uiToneSchema = z.enum([
  "text",
  "muted",
  "accent",
  "success",
  "warning",
  "danger",
]);
export const uiAppearanceSchema = z
  .object({
    colors: z
      .object({
        text: color.optional(),
        muted: color.optional(),
        accent: color.optional(),
        success: color.optional(),
        warning: color.optional(),
        danger: color.optional(),
        border: color.optional(),
        titleBackground: color.optional(),
        selectionBackground: color.optional(),
        selectionText: color.optional(),
      })
      .strict()
      .optional(),
    chrome: z
      .object({
        borderStyle: z.enum(["single", "round", "double"]).optional(),
        controls: z.enum(["always", "focus"]).optional(),
      })
      .strict()
      .optional(),
    presentation: z
      .object({
        userLabel: z.string().max(40).optional(),
        agentLabel: z.string().max(40).optional(),
        welcome: z.string().max(2000).optional(),
        toolDetails: z.boolean().optional(),
        hints: z.boolean().optional(),
        showTools: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UiAppearance = z.infer<typeof uiAppearanceSchema>;

/** Portable text view for ui.render overrides; terminal escapes are never interpreted. */
export const uiTextViewSchema = z
  .object({
    scrollKeys: z.enum(["host", "plugin"]).optional(),
    attachment: z.object({site:z.literal("composer"),width:z.number().int().min(4).max(20),rows:z.number().int().min(1).max(8).optional(),label:z.string().max(60)}).strict().optional(),
    hint: z.string().max(200).optional(),
    input: z.object({label:z.string().max(60).optional(),id:z.string().min(1).max(64),value:z.string().max(4000),placeholder:z.string().max(200).optional()}).strict().optional(),
    raster: z
      .object({
        width: z.number().int().min(1).max(512),
        height: z.number().int().min(1).max(512),
        rgba: z
          .string()
          .max(1398104)
          .regex(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
          ),
        alt: z.string().max(200).optional(),
      })
      .strict()
      .refine(
        (image) =>
          (image.rgba.length / 4) * 3 -
            (image.rgba.endsWith("==")
              ? 2
              : image.rgba.endsWith("=")
              ? 1
              : 0) ===
          image.width * image.height * 4,
        "RGBA length must match dimensions"
      )
      .optional(),
    lines: z
      .array(
        z
          .object({
            text: z.string().max(10000),
            tone: uiToneSchema.optional(),
            bold: z.boolean().optional(),
            selected: z.boolean().optional(),
            action: z.string().min(1).max(64).optional(),
          })
          .strict()
      )
      .max(2000),
  })
  .strict();
export type UiTextView = z.infer<typeof uiTextViewSchema>;
export const uiVisibility = defineEvent({
  name: "ui.visibility",
  since: "0.8.0",
  version: 1,
  summary:
    "Plugin surface attachment and visible viewport changed; lets producers suspend hidden animations.",
  input: z.object({
    site: z.string(),
    visible: z.boolean(),
    attached: z.boolean(),
    columns: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
  }),
  responses: [],
  frozen: true,
});
export const uiReaction = defineEvent({
  name: "ui.reaction",
  since: "0.8.0",
  version: 1,
  summary:
    "Semantic activity signal for optional visual companions. Consumers must not change the operation being observed.",
  input: z.object({
    source: z.string().max(100),
    kind: z.string().max(100),
    id: z.string().max(100).optional(),
    active: z.boolean().optional(),
  }),
  responses: [],
  frozen: true,
});
export const uiRemove = defineEvent({
  name: "service.ui.remove",
  since: "0.8.0",
  version: 1,
  summary: "Remove this plugin surface from all workspaces.",
  input: z.object({
    plugin: z.string(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/),
  }),
  responses: [
    {
      kind: "value",
      summary: "removed",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});
export const agentActivity = defineEvent({
  name: "agent.activity",
  since: "0.8.0",
  version: 1,
  summary:
    "Metadata-only activity of a background agent, for optional UI observers; excludes prompts and tool arguments.",
  input: z.object({
    agentId: z.string(),
    event: z.string(),
    data: z
      .object({
        turnId: z.string().optional(),
        callId: z.string().optional(),
        tool: z.string().optional(),
        ok: z.boolean().optional(),
        source: z.string().optional(),
        kind: z.string().optional(),
        id: z.string().optional(),
        active: z.boolean().optional(),
      })
      .optional(),
  }),
  responses: [],
  frozen: true,
});
export const uiInputTarget = defineEvent({
  name: "service.ui.inputTarget",
  since: "0.8.0",
  version: 1,
  summary:
    "Label the current input destination. Routing remains owned by the plugin.",
  input: z.object({
    plugin: z.string(),
    surface: z.string().nullable(),
    label: z.string().max(100).optional(),
  }),
  responses: [
    {
      kind: "value",
      summary: "accepted",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});

export const uiConfigure = defineEvent({
  name: "service.ui.configure",
  since: "0.7.0",
  version: 1,
  summary:
    "Replace this plugin's appearance contribution. Partial sections inherit defaults; null removes the contribution. User window placements remain authoritative.",
  input: z.object({
    plugin: z.string().optional(),
    appearance: uiAppearanceSchema.nullable(),
  }),
  responses: [
    {
      kind: "value",
      summary: "appearance accepted",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});

export const agentTool = defineEvent({
  name: "service.agent.tool",
  since: "0.8.0",
  version: 1,
  summary:
    "Run a user-invoked plugin tool through the normal permission and tool hook chain, without a model request.",
  input: z.object({
    plugin: z.string().optional(),
    name: z.string().min(1),
    args: z.unknown().optional(),
  }),
  responses: [
    {
      kind: "value",
      summary: "tool outcome",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});

/** Element trees are opaque to the core; validated by the renderer's element table. */
const elementTree = z.unknown();

export const uiRender = defineEvent({
  name: "ui.render",
  since: "0.1.0",
  version: 1,
  summary:
    "A render site is about to be drawn. Return an element tree. Writing plugin state during render is forbidden.",
  input: z.object({
    site: z.string(),
    surface: z.enum(["terminal", "desktop", "web", "headless"]),
    props: z.record(z.string(), z.unknown()),
    viewport: z.object({ columns: z.number(), rows: z.number() }).optional(),
  }),
  responses: [
    { kind: "tree", summary: "the element tree to draw", schema: elementTree },
  ],
  frozen: true,
});

export const uiPress = defineEvent({
  name: "ui.press",
  since: "0.1.0",
  version: 1,
  summary: "A plugin UI action, including a declared UI command, was invoked.",
  input: z.object({ site: z.string(), key: z.string() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const uiChange = defineEvent({
  name:'ui.change',since:'0.16.0',version:1,
  summary:'An editable semantic plugin view field changed; never submits a model prompt.',
  input:z.object({site:z.string(),id:z.string(),value:z.string().max(4000)}),
  responses:[{kind:'next',summary:'proceed',schema:z.unknown()}],frozen:true,
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
      .array(
        z.object({
          row: z.number(),
          col: z.number(),
          rows: z.number(),
          cols: z.number(),
        })
      )
      .optional(),
  }),
  responses: [],
  frozen: true,
});

/** Placement hints are requests; user rules take precedence. Size is a fraction of the target region. */
export const surfacePlacementSchema = z.object({
  site: z.enum(["split", "sidebar", "inspector", "status-bar"]).optional(),
  workspace: z.number().int().min(1).max(9).optional(),
  size: z.number().min(0.1).max(0.8).optional(),
  relativeTo: z.string().min(1).max(64).optional(),
  focus: z.boolean().optional(),
});
export type SurfacePlacement = z.infer<typeof surfacePlacementSchema>;

export const uiView = defineEvent({
  name: "service.ui.view",
  since: "0.8.0",
  version: 1,
  summary:
    "Publish a semantic plugin view. Action rows receive ui.press on click; placement remains user controlled.",
  input: z.object({
    plugin: z.string().optional(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/),
    title: z.string().max(120),
    view: uiTextViewSchema,
    placement: surfacePlacementSchema.optional(),
  }),
  responses: [
    {
      kind: "value",
      summary: "view accepted",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});

/** A plugin publishes a text surface; compositor owns its placement and focus. */
export const uiSurface = defineEvent({
  name: "service.ui.surface",
  since: "0.6.0",
  version: 1,
  summary:
    "Publish or update a plugin window with optional split/sidebar/inspector/status-bar placement hints; user rules control workspace, size and focus.",
  input: z.object({
    plugin: z.string().optional(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/),
    title: z.string().max(120),
    text: z.string().max(100000),
    placement: surfacePlacementSchema.optional(),
  }),
  responses: [
    {
      kind: "value",
      summary: "surface accepted",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});

export const networkConfigure = defineEvent({
  name: "service.network.configure",
  since: "0.9.0",
  version: 1,
  summary:
    "Configure this application network client; preserves protocol and streams, never changes global process environment.",
  input: z.object({
    config: z.object({
      enabled: z.boolean().optional(),
      url: z.string().optional(),
      noProxy: z.array(z.string()).optional(),
      models: z.boolean().optional(),
      tools: z.boolean().optional(),
    }),
  }),
  responses: [
    {
      kind: "value",
      summary: "redacted configuration",
      schema: z.object({ value: z.unknown().optional() }),
    },
  ],
  frozen: true,
});

export const projectChanged = defineEvent({
  name: "project.changed",
  since: "0.9.0",
  version: 1,
  summary:
    "Files or Git state changed; consumers can invalidate and refresh project indexes.",
  input: z.object({
    cwd: z.string(),
    paths: z.array(z.string()),
    reason: z.enum(["tool", "watch", "git"]),
  }),
  responses: [],
  frozen: true,
});
