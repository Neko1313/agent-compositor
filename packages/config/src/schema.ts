import { z } from "zod";

/**
 * Known top-level keys. Unknown keys pass through (forward compatibility —
 * older cores must tolerate newer config). Values stay loosely typed here;
 * subsystem packages narrow what they read.
 */
const placement = z.object({
  site: z.enum(["split", "sidebar", "inspector", "status-bar"]).optional(),
  workspace: z.number().int().min(1).max(9).optional(), size: z.number().min(.1).max(.8).optional(),
  relativeTo: z.string().min(1).max(64).optional(), focus: z.boolean().optional(),
});

/** Composition controls fail closed before executable extensions are imported. */
export const compositionSchema = z.object({
  workspacePaths:z.array(z.string().min(1)).optional(),
  sessionProvider:z.string().min(1).optional(),
  ui:z.object({controllers:z.record(z.enum(["editor","approval","question","form","placement","history"]),z.string().min(1)).optional()}).passthrough().optional(),
  enabledPlugins: z.array(z.string().min(1)).optional(),
  toolProviders: z.record(z.string().min(1),z.string().min(1)).optional(),
  agent: z.object({
    builtinTools:z.array(z.string()).optional(),
    controlTools:z.array(z.enum(["task","ask_user","ask_questions","tool_help"])).optional(),
    tools:z.array(z.string()).optional(),
    projectContext:z.boolean().optional(),fileReferences:z.boolean().optional(),skills:z.boolean().optional(),
    instructionsPreset:z.enum(["general","coding"]).optional(),
  }).passthrough().optional(),
}).passthrough();

export const ConfigSchema = z
  .object({
    ui: z.object({
      controllers:z.record(z.enum(["editor","approval","question","form","placement","history"]),z.string().min(1)).optional(),
      sites: z.object({ split: placement.optional(), sidebar: placement.optional(), inspector: placement.optional(), "status-bar": placement.optional() }).optional(),
      rules: z.array(placement.extend({ match: z.object({ plugin: z.string().optional(), surface: z.string().optional() }) })).optional(),
    }).optional(),
    serviceProviders: z.record(z.string(), z.string()).optional(),
    disabledPlugins: z.array(z.string()).optional(),
    enabledPlugins: z.array(z.string()).optional(),
    toolProviders: z.record(z.string(), z.string()).optional(),
    sessionProvider:z.string().optional(),
    workspacePaths:z.array(z.string().min(1)).optional(),
    model: z.string().optional(),
    small_model: z.string().optional(),
    providers: z.record(z.string(), z.unknown()).optional(),
    permissions: z.object({ rules: z.array(z.object({
      readOnly:z.boolean().optional(), tool: z.string().optional(), decision: z.enum(["allow", "ask", "deny"]),
      command: z.string().optional(), executable: z.string().optional(), path: z.string().optional(),
      url: z.string().optional(), reason: z.string().optional(),
    })).optional() }).passthrough().optional(),
    compaction: z.object({ enabled: z.boolean().optional(), contextWindow: z.number().int().min(2048).optional(),
      reserveOutput: z.number().int().positive().optional(), reserveSystem: z.number().int().nonnegative().optional(),
      highWaterMark: z.number().positive().max(1).optional() }).optional(),
    skills: z.array(z.string()).optional(),
    plugins: z.array(z.string()).optional(),
    status_line: z.string().optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    agent: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type CompositorConfig = z.infer<typeof ConfigSchema> & Record<string, unknown>;

/** One discovered config source. `present: false` marks a location that
 *  conventionally could exist but doesn't — recorded for introspection. */
export interface ConfigSource {
  layer: "system" | "global" | "project";
  path: string;
  present: boolean;
  /** distance from cwd: 0 = cwd itself, used only for project sources */
  depth?: number;
}

export interface SubstitutionRecord {
  key: string;
  path: string;
  kind: "env" | "file";
  /** the variable name or file path referenced */
  reference: string;
  /** true when the referenced env/file was missing and "" was substituted */
  missing: boolean;
}

export interface ConfigKeyOrigin {
  key: string;
  source: string;
  layer: ConfigSource["layer"];
  sensitive: boolean;
}

export interface LoadedConfig {
  config: CompositorConfig;
  sources: ConfigSource[];
  /** flat dot-path origins, for /context-style introspection */
  origins: ConfigKeyOrigin[];
  substitutions: SubstitutionRecord[];
  warnings: string[];
}
