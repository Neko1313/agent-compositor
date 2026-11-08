import { z } from "zod";

/**
 * Known top-level keys. Unknown keys pass through (forward compatibility —
 * older cores must tolerate newer config). Values stay loosely typed here;
 * subsystem packages narrow what they read.
 */
export const ConfigSchema = z
  .object({
    model: z.string().optional(),
    small_model: z.string().optional(),
    providers: z.record(z.string(), z.unknown()).optional(),
    permissions: z.record(z.string(), z.unknown()).optional(),
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
