import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { discover, type DiscoveryOptions } from "./discovery.js";
import { substitute } from "./variable.js";
import { ConfigSchema, type CompositorConfig, type ConfigKeyOrigin, type LoadedConfig, type SubstitutionRecord } from "./schema.js";

export interface LoadOptions extends DiscoveryOptions {}

/**
 * Load and merge configuration: parse each discovered source (JSONC, with
 * substitutions), deep-merge farthest→closest so the closest layer wins per
 * key, and record per-key origins for introspection.
 */
export async function loadConfig(options: LoadOptions = {}): Promise<LoadedConfig> {
  const sources = await discover(options);
  const warnings: string[] = [];
  const origins: ConfigKeyOrigin[] = [];
  const substitutions: SubstitutionRecord[] = [];
  const merged: Record<string, unknown> = {};

  for (const source of sources) {
    if (!source.present) continue;
    const file = source.layer === "project" ? source.path : path.join(source.path, "agent-compositor.json");
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      warnings.push(`config file unreadable: ${file}`);
      continue;
    }

    const sub = await substitute({ text: raw, configDir: path.dirname(file), source: file, env: options.env });
    warnings.push(...sub.warnings);
    substitutions.push(...sub.substitutions);

    const errors: ParseError[] = [];
    const parsed: unknown = parse(sub.text, errors, { allowTrailingComma: true });
    if (errors.length > 0 || parsed === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      warnings.push(`config file rejected (malformed JSON/JSONC): ${file} — ${describeErrors(errors)}`);
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const sensitiveKeys = new Set(sub.substitutions.filter((s) => !s.missing).map((s) => s.key));
    mergeInto(merged, record, file, source.layer, origins, sensitiveKeys);
  }

  const check = ConfigSchema.safeParse(merged);
  const config = (check.success ? check.data : merged) as CompositorConfig;
  if (!check.success) warnings.push(`config schema validation failed: ${check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);

  return { config, sources, origins, substitutions, warnings };
}

/** deep-merge `src` into `dst`; arrays and scalars are replaced, objects merge.
 *  Records each leaf key's origin (file + layer + whether it came via a substitution). */
function mergeInto(
  dst: Record<string, unknown>,
  src: Record<string, unknown>,
  file: string,
  layer: ConfigKeyOrigin["layer"],
  origins: ConfigKeyOrigin[],
  sensitiveKeys: Set<string>,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(src)) {
    const dot = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && isPlainObject(dst[key])) {
      mergeInto(dst[key] as Record<string, unknown>, value, file, layer, origins, sensitiveKeys, dot);
      continue;
    }
    if (isPlainObject(value)) {
      const nested: Record<string, unknown> = {};
      mergeInto(nested, value, file, layer, origins, sensitiveKeys, dot);
      dst[key] = nested;
    } else {
      dst[key] = value;
    }
    origins.push({ key: dot, source: file, layer, sensitive: sensitiveKeys.has(key) || sensitiveKeys.has(dot) });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describeErrors(errors: ParseError[]): string {
  return errors.slice(0, 3).map((e) => `${e.error} at offset ${e.offset}`).join(", ");
}
