import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifest, TrustClass } from "@agent-compositor/runtime";

export interface DiskPlugin {
  manifest: PluginManifest;
  hooks: Record<string, unknown>;
  /** disk plugins always ride the user tier of the hook chain */
  tier: "user";
  /** absolute path of the plugin directory (for diagnostics) */
  dir: string;
}

export interface LoadResult {
  plugins: DiskPlugin[];
  /** per-plugin load failures; loading never throws as a whole (fail-operational) */
  errors: { dir: string; error: string }[];
}

export interface PluginJson {
  name: string;
  version: string;
  description?: string;
  /** trust class, default "trusted" (disk plugins are user-installed) */
  trust?: TrustClass;
  capabilities?: string[];
  /** hooks module, relative to the plugin dir (default "hooks.ts") */
  entry?: string;
}

/**
 * Discover plugins on disk. Layout:
 *
 *   <pluginsDir>/<plugin-name>/plugin.json     — manifest
 *   <pluginsDir>/<plugin-name>/hooks.ts        — default- or named-export hooks record
 *
 * Hook entries are plain functions `async (event, api) => ...` keyed by
 * catalog event name — the same record HooksHost.registerPlugin accepts.
 * Runs on Node 24 native type-stripping, so hooks.ts must use erasable
 * syntax only (no enums, no namespaces, no parameter properties).
 *
 * Later dirs in the list shadow earlier plugins with the same name — the
 * workspace plugin dir should come after the global one.
 */
export async function loadPluginsFromDisk(dirs: string[]): Promise<LoadResult> {
  const plugins: DiskPlugin[] = [];
  const errors: LoadResult["errors"] = [];
  const seen = new Map<string, string>(); // name → dir

  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue; // dir missing → not an error, just empty
    }
    for (const entry of entries.sort()) {
      const pluginDir = path.join(dir, entry);
      try {
        const plugin = await loadOne(pluginDir);
        const existing = seen.get(plugin.manifest.name);
        if (existing) {
          // shadow: replace the earlier plugin (workspace beats global)
          const idx = plugins.findIndex((p) => p.manifest.name === plugin.manifest.name);
          plugins.splice(idx, 1);
          plugins.push(plugin);
        } else {
          seen.set(plugin.manifest.name, pluginDir);
          plugins.push(plugin);
        }
      } catch (err) {
        errors.push({ dir: pluginDir, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { plugins, errors };
}

async function loadOne(pluginDir: string): Promise<DiskPlugin> {
  const raw = await fs.readFile(path.join(pluginDir, "plugin.json"), "utf8").catch(() => {
    throw new Error("missing plugin.json");
  });
  let manifestJson: PluginJson;
  try {
    manifestJson = JSON.parse(raw) as PluginJson;
  } catch {
    throw new Error("plugin.json is not valid JSON");
  }
  if (!manifestJson.name || !/^[a-z0-9][a-z0-9-]*$/.test(manifestJson.name)) {
    throw new Error(`invalid plugin name: ${String(manifestJson.name)} (lowercase, digits, dashes)`);
  }
  if (!manifestJson.version) {
    throw new Error("plugin.json missing version");
  }
  const trust = manifestJson.trust ?? "trusted";
  if (trust !== "trusted" && trust !== "sandboxed" && trust !== "render-only") {
    throw new Error(`unknown trust class: ${trust}`);
  }

  const entry = manifestJson.entry ?? "hooks.ts";
  const entryPath = path.join(pluginDir, entry);
  await fs.access(entryPath).catch(() => {
    throw new Error(`missing hooks entry: ${entry}`);
  });

  const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
  const hooks = (mod.default ?? mod.hooks) as Record<string, unknown> | undefined;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(`hooks entry must export a record of event-name → hook function (default or named "hooks")`);
  }
  for (const [eventName, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function") {
      throw new Error(`hook for "${eventName}" is not a function`);
    }
  }

  const manifest: PluginManifest = {
    name: manifestJson.name,
    version: manifestJson.version,
    description: manifestJson.description,
    trust,
    capabilities: manifestJson.capabilities,
  };
  return { manifest, hooks, tier: "user" as const, dir: pluginDir };
}
