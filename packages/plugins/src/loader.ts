import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifest, TrustClass } from "@agent-compositor/runtime";

export interface DiskPlugin {
  manifest: PluginManifest;
  hooks: Record<string, unknown>;
  /** optional model-facing tools (tools.ts module; appended to the core toolset) */
  tools: PluginTool[];
  /** disk plugins always ride the user tier of the hook chain */
  tier: "user";
  /** absolute path of the plugin directory (for diagnostics) */
  dir: string;
}

/** Structural shape of a model-facing tool a plugin can ship (tools.ts).
 *  Mirrors core's ToolSpec without importing it — the plugin loader stays
 *  dependency-light. */
export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  describe(args: unknown): unknown;
  execute(ctx: unknown, args: unknown): Promise<unknown>;
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
  const toolsPath = path.join(pluginDir, "tools.ts");
  const hasHooks = await fs.access(entryPath).then(() => true, () => false);
  const hasTools = await fs.access(toolsPath).then(() => true, () => false);
  if (!hasHooks && !hasTools) {
    throw new Error(`missing hooks entry: ${entry}`);
  }

  let hooks: Record<string, unknown> = {};
  if (hasHooks) {
    const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
    const loaded = (mod.default ?? mod.hooks) as Record<string, unknown> | undefined;
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      throw new Error(`hooks entry must export a record of event-name → hook function (default or named "hooks")`);
    }
    for (const [eventName, fn] of Object.entries(loaded)) {
      if (typeof fn !== "function") {
        throw new Error(`hook for "${eventName}" is not a function`);
      }
    }
    hooks = loaded;
  }

  const tools = hasTools ? await loadToolsModule(toolsPath) : [];

  const manifest: PluginManifest = {
    name: manifestJson.name,
    version: manifestJson.version,
    description: manifestJson.description,
    trust,
    capabilities: manifestJson.capabilities,
  };
  return { manifest, hooks, tools, tier: "user" as const, dir: pluginDir };
}

async function loadToolsModule(toolsPath: string): Promise<PluginTool[]> {
  const mod = (await import(pathToFileURL(toolsPath).href)) as Record<string, unknown>;
  const tools = (mod.default ?? mod.tools) as unknown;
  if (!Array.isArray(tools)) {
    throw new Error(`tools entry must export an array of tools (default or named "tools")`);
  }
  return tools.map((tool, i) => {
    const t = tool as Partial<PluginTool>;
    if (!t || typeof t !== "object") throw new Error(`tools[${i}] is not an object`);
    if (typeof t.name !== "string" || !t.name) throw new Error(`tools[${i}] missing name`);
    if (typeof t.description !== "string") throw new Error(`tools[${i}] (${t.name}) missing description`);
    if (!t.parameters || typeof t.parameters !== "object" || Array.isArray(t.parameters)) {
      throw new Error(`tools[${i}] (${t.name}) missing parameters object`);
    }
    if (typeof t.describe !== "function") throw new Error(`tools[${i}] (${t.name}) missing describe()`);
    if (typeof t.execute !== "function") throw new Error(`tools[${i}] (${t.name}) missing execute()`);
    return t as PluginTool;
  });
}
