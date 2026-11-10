import { z } from "zod";
import { manifestSchema } from "@agent-compositor/runtime";
import type { Tier } from "@agent-compositor/runtime";
import { pluginMcpSourcesSchema } from "./mcp.js";
import {pluginStandardSchema} from './standard.js';

/**
 * The on-disk manifest: the runtime manifest plus loader fields.
 *
 *   plugins/<name>/plugin.json
 *   {
 *     "name": "safety",
 *     "version": "0.1.0",
 *     "trust": "trusted",           // trusted | sandboxed | render-only
 *     "tier": "append",             // optional, default "user"
 *     "main": "./index.ts",         // optional, default: index.ts → index.js → index.mjs
 *     "capabilities": ["tool"]
 *   }
 */
export const diskManifestSchema = manifestSchema.extend({
  compositor:pluginStandardSchema.optional(),
  trust: z.enum(["trusted", "sandboxed", "render-only"]).default("trusted"),
  commands: z
    .array(
      z.object({
        name: z.string().regex(/^\/[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9_-]*)?$/),
        description: z.string(),
        usage: z.string().optional(),
      })
    )
    .optional(),
  /** entry file relative to the plugin root */
  main: z.string().min(1).optional(),
  entry: z.string().min(1).optional(),
  /** Inline stdio servers or package-relative configuration paths. */
  mcpServers: pluginMcpSourcesSchema.optional(),
  /** Additional package-relative runtime resources retained in compiled bundles. */
  resources: z.array(z.string().min(1)).optional(),
  /** chain tier for this plugin's hooks; default "user" */
  tier: z.enum(["prepend", "user", "append", "builtin", "core"]).optional(),
});

export type DiskManifest = z.infer<typeof diskManifestSchema> & { tier?: Tier };

export const DEFAULT_MAIN_CANDIDATES = [
  "hooks.ts",
  "index.ts",
  "index.js",
  "index.mjs",
] as const;
