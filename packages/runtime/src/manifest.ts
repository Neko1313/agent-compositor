import { z } from "zod";
import type { PluginManifest } from "./types.js";

const NAME = /^(@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export const manifestSchema = z.object({
  name: z.string().regex(NAME, "invalid plugin name"),
  version: z.string().regex(SEMVER, "invalid semver"),
  description: z.string().optional(),
  trust: z.enum(["trusted", "sandboxed", "render-only"]),
  capabilities: z.array(z.string()).optional(),
});

export function parseManifest(input: unknown): PluginManifest {
  return manifestSchema.parse(input) as PluginManifest;
}
