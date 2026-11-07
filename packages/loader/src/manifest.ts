import { z } from "zod";
import { manifestSchema } from "@agent-compositor/runtime";
import type { Tier } from "@agent-compositor/runtime";

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
  /** entry file relative to the plugin root */
  main: z.string().min(1).optional(),
  /** chain tier for this plugin's hooks; default "user" */
  tier: z.enum(["prepend", "user", "append", "builtin", "core"]).optional(),
});

export type DiskManifest = z.infer<typeof diskManifestSchema> & { tier?: Tier };

export const DEFAULT_MAIN_CANDIDATES = ["index.ts", "index.js", "index.mjs"] as const;
