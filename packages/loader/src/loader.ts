import { claudeManifest, loadClaudePlugin } from "./claude.js";
import { readPluginMcp } from "./mcp.js";
import { contained } from "./paths.js";
import * as nodeModule from "node:module";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import type { HooksHost, UserHookFn } from "@agent-compositor/hooks";
import type { Tier, TrustClass } from "@agent-compositor/runtime";
import { DEFAULT_MAIN_CANDIDATES, diskManifestSchema } from "./manifest.js";
import type { DiskManifest } from "./manifest.js";

export interface DiscoveredPlugin {
  /** absolute path to the plugin directory (contains plugin.json) */
  root: string;
  manifestPath: string;
  manifest: DiskManifest;
  /** which search dir it was found under */
  via: string;
}

export interface LoadedPlugin {
  controllers?:import("@agent-compositor/hooks").UiControllers;
  sessionRepository?:import("@agent-compositor/session").SessionRepositoryFactory;
  events?: readonly import("@agent-compositor/events").EventDef[];
  mcpServers?: Record<string, unknown>;
  dispose?: () => void | Promise<void>;
  name: string;
  version: string;
  trust: TrustClass;
  tier: Tier;
  root: string;
  hookCount: number;
  commands?: DiskManifest["commands"];
  tools: PluginTool[];
}

/** Structural ToolSpec contract: loader does not depend on the agent core. */
export interface PluginTool {
  name: string;
  description: string;
  usage?: {when:string;avoid?:string;examples:{purpose:string;args:Record<string,unknown>}[]};
  parameters: Record<string, unknown>;
  describe(args: unknown): unknown;
  execute(ctx: unknown, args: unknown): Promise<unknown>;
}

export interface LoadIssue {
  /** plugin name, if the manifest parsed far enough to have one */
  name?: string;
  path: string;
  reason: string;
}

export interface LoadReport {
  loaded: LoadedPlugin[];
  /** manifest/import/registration errors — one bad plugin never blocks the rest */
  failed: LoadIssue[];
  /** duplicates, already-loaded, unsupported trust class */
  skipped: LoadIssue[];
}

export interface PluginLoaderOptions {
  /** Application activation policy, evaluated on metadata before import. */
  accept?: (plugin:DiscoveredPlugin)=>boolean;
  /** Exact plugin allowlist, checked before importing executable code. */
  enabled?: string[];
  disabled?: string[];
  /** explicit search dirs; default: project `./plugins`, `./.agent-compositor/plugins`, user config dir */
  dirs?: string[];
  /** defaults to process.cwd() */
  cwd?: string;
}

/** Every plugin subdirectory of `dir`, alphabetical, fail-soft. */
async function listPluginDirs(dir: string): Promise<string[]> {
  try {
    if (
      (await fileExists(join(dir, "plugin.json"))) ||
      (await fileExists(join(dir, ".claude-plugin/plugin.json")))
    )
      return [dir];
    const ents = await readdir(dir, { withFileTypes: true });
    return ents
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return []; // missing dir is normal (user config may not exist yet)
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveEntry(
  root: string,
  manifest: DiskManifest
): Promise<string> {
  const candidates: string[] = [];
  manifest = { ...manifest, main: manifest.main ?? manifest.entry };
  if (manifest.main) {
    candidates.push(
      isAbsolute(manifest.main) ? manifest.main : join(root, manifest.main)
    );
    if (!/\.(ts|js|mjs|cjs)$/.test(manifest.main)) {
      candidates.push(
        join(root, `${manifest.main}.ts`),
        join(root, `${manifest.main}.js`)
      );
    }
  } else {
    for (const name of DEFAULT_MAIN_CANDIDATES)
      candidates.push(join(root, name));
  }
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  throw new Error(
    manifest.main
      ? `entry "${manifest.main}" not found under ${root}`
      : `no entry found (tried ${DEFAULT_MAIN_CANDIDATES.join(
          ", "
        )}) under ${root}`
  );
}

/**
 * Import a hooks module. Two cache-busting layers:
 *  1. `?t=` query on the file URL — ESM cache is keyed by URL, so real Node
 *     always sees fresh code on reload.
 *  2. Some module runners (vitest/vite-node) cache by resolved path and
 *     ignore the query, returning the OLD module object. Detected by identity:
 *     if the import returns the same object as last time, fall back to a
 *     data: URL built from the file's current source (content-keyed, so it
 *     can never be stale). Limitation of the fallback: relative imports
 *     inside the plugin file don't resolve (data: has no base) — single-file
 *     plugins only, and production is unaffected.
 */
async function importModule(
  entryPath: string,
  lastModule?: unknown
): Promise<Record<string, unknown>> {
  const fromSource = async () => {
    const src = await readFile(entryPath, "utf8");
    const code = entryPath.endsWith(".ts")
      ? nodeModule.stripTypeScriptTypes(src)
      : src;
    const url = `data:text/javascript;base64,${Buffer.from(code).toString(
      "base64"
    )}`;
    return (await import(url)) as Record<string, unknown>;
  };
  let mod: Record<string, unknown>;
  try {
    const url = `${
      pathToFileURL(entryPath).href
    }?t=${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mod = (await import(url)) as Record<string, unknown>;
    if (mod === lastModule) mod = await fromSource(); // stale under path-keyed runners
  } catch (original) {
    try {
      mod = await fromSource();
    } catch {
      throw original instanceof Error
        ? original
        : new Error(
            String(
              (original as { message?: string })?.message ??
                JSON.stringify(original)
            )
          );
    }
  }
  return mod;
}

async function importHooks(
  entryPath: string,
  lastModule?: unknown
): Promise<{ hooks: Record<string, UserHookFn>; events?: readonly import("@agent-compositor/events").EventDef[]; module: Record<string,unknown> }> {
  const mod = await importModule(entryPath, lastModule);
  const hooks = (mod.hooks ??
    (mod.default as Record<string, unknown> | undefined)?.hooks ??
    mod.default ?? (mod.controllers || mod.sessionRepository ? {} : undefined)) as Record<string, unknown> | undefined;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    throw new Error(
      `hooks module must export a named "hooks" object (e.g. export const hooks = { "tool.check": ... })`
    );
  }
  for (const [name, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function")
      throw new Error(`hook "${name}" is not a function`);
  }
  if (mod.events !== undefined && !Array.isArray(mod.events)) throw new Error("events must export an array of event definitions");
  return { hooks: hooks as Record<string, UserHookFn>, events: mod.events as import("@agent-compositor/events").EventDef[] | undefined, module: mod };
}

async function importTools(
  entryPath: string,
  lastModule?: unknown
): Promise<{ tools: PluginTool[]; module: unknown }> {
  const mod = await importModule(entryPath, lastModule);
  const tools = mod.default ?? mod.tools;
  if (!Array.isArray(tools))
    throw new Error(
      "tools entry must export an array of tools (default or named tools)"
    );
  const names = new Set<string>();
  for (const [i, tool] of tools.entries()) {
    const t = tool as Partial<PluginTool> | null;
    if (!t || typeof t !== "object")
      throw new Error(`tools[${i}] is not an object`);
    if (typeof t.name !== "string" || !t.name)
      throw new Error(`tools[${i}] missing name`);
    if (names.has(t.name)) throw new Error(`duplicate tool name: ${t.name}`);
    names.add(t.name);
    if (typeof t.description !== "string")
      throw new Error(`tools[${i}] missing description`);
    if (
      !t.parameters ||
      typeof t.parameters !== "object" ||
      Array.isArray(t.parameters)
    )
      throw new Error(`tools[${i}] missing parameters object`);
    if (typeof t.describe !== "function" || typeof t.execute !== "function")
      throw new Error(`tools[${i}] requires describe() and execute()`);
  }
  return { tools: tools as PluginTool[], module: mod };
}

export class PluginLoader {
  private readonly accept?: (plugin:DiscoveredPlugin)=>boolean;
  private readonly optsEnabled?: string[];
  private readonly disabled: string[];
  private readonly dirs: string[];
  private readonly loadedByName = new Map<
    string,
    LoadedPlugin & {
      manifest: DiskManifest;
      entry?: string;
      module?: unknown;
      toolsModule?: unknown;
    }
  >();

  constructor(
    private readonly host: HooksHost,
    opts: PluginLoaderOptions = {}
  ) {
    this.disabled = opts.disabled ?? [];
    this.accept = opts.accept;
    this.optsEnabled = opts.enabled;
    const cwd = opts.cwd ?? process.cwd();
    this.dirs = opts.dirs ?? [
      join(cwd, "plugins"),
      join(cwd, ".agent-compositor", "plugins"),
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "agent-compositor",
        "plugins"
      ),
    ];
  }

  /** Effective search dirs, in precedence order (earlier wins name collisions). */
  searchDirs(): readonly string[] {
    return this.dirs;
  }

  /** The current composition — feed it to session.start / session.reload. */
  composition(): { name: string; version: string; tier: Tier }[] {
    return [...this.loadedByName.values()].map((p) => ({
      name: p.name,
      version: p.version,
      tier: p.tier,
    }));
  }

  /** Currently loaded plugins. */
  loaded(): readonly LoadedPlugin[] {
    return [...this.loadedByName.values()];
  }

  /** Scan search dirs for plugin.json manifests. One corrupt manifest never hides the others. */
  async discover(): Promise<{
    found: DiscoveredPlugin[];
    issues: LoadIssue[];
  }> {
    const found: DiscoveredPlugin[] = [];
    const issues: LoadIssue[] = [];
    for (const dir of this.dirs) {
      for (const root of await listPluginDirs(dir)) {
        const native = await fileExists(join(root, "plugin.json"));
        const manifestPath = native
          ? join(root, "plugin.json")
          : join(root, ".claude-plugin/plugin.json");
        if (!(await fileExists(manifestPath))) continue;
        try {
          const raw = JSON.parse(
            await readFile(manifestPath, "utf8")
          ) as unknown;
          const manifest = native
            ? diskManifestSchema.parse(raw)
            : await claudeManifest(root);
          found.push({ root, manifestPath, manifest, via: dir });
        } catch (err) {
          issues.push({
            path: manifestPath,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return { found, issues };
  }

  /** Discover + register everything. Idempotent: already-loaded names are skipped. */
  async loadAll(): Promise<LoadReport> {
    const report: LoadReport = { loaded: [], failed: [], skipped: [] };
    const { found, issues } = await this.discover();
    report.failed.push(...issues);

    const seen = new Set<string>();
    for (const disc of found) {
      const name = disc.manifest.name;
      if (this.disabled.includes(name) || (this.optsEnabled && !this.optsEnabled.includes(name)) || this.accept?.(disc)===false) {
        report.skipped.push({
          name,
          path: disc.root,
          reason: "disabled before import",
        });
        continue;
      }
      if (seen.has(name)) {
        report.skipped.push({
          name,
          path: disc.root,
          reason: `duplicate name; first hit in search order wins (via ${disc.via})`,
        });
        continue;
      }
      seen.add(name);
      if (this.loadedByName.has(name)) {
        report.skipped.push({
          name,
          path: disc.root,
          reason: "already loaded (reload it instead)",
        });
        continue;
      }
      try {
        report.loaded.push(await this.register(disc));
      } catch (err) {
        report.failed.push({
          name,
          path: disc.root,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return report;
  }

  /**
   * Reload one plugin: reverse teardown (hooks + per-plugin state), re-import
   * with a cache-busted URL, register again. State does not survive a reload —
   * the session.reload event is the documented recovery point.
   */
  async reload(name: string): Promise<LoadedPlugin> {
    const current = this.loadedByName.get(name);
    if (!current) throw new Error(`plugin "${name}" is not loaded`);
    await current.dispose?.();
    const lastModule = current.module; // keep the reference: path-keyed runners
    // return the stale object, and importHooks needs it to detect that
    this.host.unregisterPlugin(name);
    this.loadedByName.delete(name);
    const disc: DiscoveredPlugin = {
      root: current.root,
      manifestPath: join(current.root, "plugin.json"),
      manifest: current.manifest,
      via: current.root,
    };
    // re-read the manifest too: version bumps on disk should apply
    try {
      const raw = JSON.parse(
        await readFile(disc.manifestPath, "utf8")
      ) as unknown;
      disc.manifest = diskManifestSchema.parse(raw);
    } catch {
      disc.manifest = current.manifest; // keep the last known good manifest
    }
    const loaded = await this.register(disc, lastModule, current.toolsModule);
    return loaded;
  }

  /** Unregister without re-registering. */
  async unload(name: string): Promise<boolean> {
    await this.loadedByName.get(name)?.dispose?.();
    this.loadedByName.delete(name);
    return this.host.unregisterPlugin(name);
  }

  private async register(
    disc: DiscoveredPlugin,
    lastModule?: unknown,
    lastToolsModule?: unknown
  ): Promise<LoadedPlugin> {
    const { manifest, root } = disc;
    if(this.disabled.includes(manifest.name)||(this.optsEnabled&&!this.optsEnabled.includes(manifest.name))||this.accept?.(disc)===false)
      throw new Error('Plugin is inactive under the loader activation policy');
    if (manifest.trust === "sandboxed") {
      throw new Error(
        "Sandboxed plugin modules require an explicit language host. Use the configured sandbox service for generated code; trusted TS plugins run on the host."
      );
    }
    if (
      (await fileExists(join(root, ".claude-plugin/plugin.json"))) &&
      !(await fileExists(join(root, "plugin.json")))
    ) {
      const adapted = await loadClaudePlugin(root);
      this.assertMcpNames(manifest.name, adapted.mcpServers);
      const tier = manifest.tier ?? "user";
      this.host.registerPlugin(adapted.manifest, adapted.hooks, tier);
      const loaded = {
        name: manifest.name,
        version: manifest.version,
        trust: manifest.trust,
        tier,
        root,
        hookCount: Object.keys(adapted.hooks).length,
        commands: adapted.manifest.commands,
        tools: [],
        mcpServers: adapted.mcpServers,
      };
      this.loadedByName.set(manifest.name, { ...loaded, manifest });
      return loaded;
    }
    const mcpServers = await readPluginMcp(root, manifest.name, manifest.mcpServers);
    for (const resource of manifest.resources ?? []) await contained(root, resource);
    this.assertMcpNames(manifest.name, mcpServers);
    if (manifest.trust === "render-only" && Object.keys(mcpServers).length)
      throw new Error("render-only plugins may not contribute MCP servers");
    const toolsPath = (await fileExists(join(root, "tools.ts")))
      ? join(root, "tools.ts")
      : join(root, "tools.js");
    const hasTools = await fileExists(toolsPath);
    if (hasTools && manifest.trust === "render-only")
      throw new Error("render-only plugins may not export model-facing tools");
    const entry = await resolveEntry(root, manifest).catch(async (error) => {
      const dataOnly = Object.keys(mcpServers).length > 0 || await fileExists(join(root, "skills"));
      if ((hasTools || dataOnly) && !manifest.main && !manifest.entry) return undefined;
      throw error;
    });
    const { hooks, events, module } = entry
      ? await importHooks(entry, lastModule)
      : { hooks: {}, module: undefined };
    const { tools, module: toolsModule } = hasTools
      ? await importTools(toolsPath, lastToolsModule)
      : { tools: [], module: undefined };
    const hookCount = Object.keys(hooks).length;
    if(manifest.commands?.some(command=>command.execution==='immediate')&&!Object.entries(hooks).some(([name,handler])=>name==='command.invoke'&&typeof handler==='function'))
      throw new Error('Immediate commands require a command.invoke handler');
    const controllers=module?.controllers as import("@agent-compositor/hooks").UiControllers|undefined;
    const sessionRepository=module?.sessionRepository as import("@agent-compositor/session").SessionRepositoryFactory|undefined;
    if(sessionRepository!==undefined && (manifest.trust!=="trusted" || typeof sessionRepository!=="function"))
      throw new Error("Session repository factories require a trusted plugin");
    const tier: Tier = manifest.tier ?? "user";
    this.host.registerPlugin(
      {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        trust: manifest.trust,
        capabilities: manifest.capabilities,
        provides: manifest.provides,
        priority: manifest.priority,
        hookTimeouts: manifest.hookTimeouts,
      },
      hooks,
      tier,
      events,
      controllers
    );
    const loaded: LoadedPlugin = {
      name: manifest.name,
      version: manifest.version,
      trust: manifest.trust,
      tier,
      root,
      hookCount,
      events,
      controllers,
      sessionRepository,
      dispose: async () => {
        for (const item of [module, toolsModule]) {
          const dispose = (item as { dispose?: () => unknown } | undefined)
            ?.dispose;
          if (typeof dispose === "function") await dispose();
        }
      },
      commands: manifest.commands,
      tools,
      mcpServers,
    };
    this.loadedByName.set(manifest.name, {
      ...loaded,
      manifest,
      entry,
      module,
      toolsModule,
    });
    return loaded;
  }

  private assertMcpNames(owner: string, servers: Record<string, unknown>) {
    for (const plugin of this.loadedByName.values())
      for (const name of Object.keys(servers))
        if (plugin.name !== owner && Object.hasOwn(plugin.mcpServers ?? {}, name))
          throw new Error(`MCP server name collision: ${name} from ${owner} and ${plugin.name}; use distinct local server names`);
  }
}

export function createPluginLoader(
  host: HooksHost,
  opts?: PluginLoaderOptions
): PluginLoader {
  return new PluginLoader(host, opts);
}
