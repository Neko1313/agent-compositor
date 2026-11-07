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
  name: string;
  version: string;
  trust: TrustClass;
  tier: Tier;
  root: string;
  hookCount: number;
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
  /** explicit search dirs; default: project `./plugins`, `./.agent-compositor/plugins`, user config dir */
  dirs?: string[];
  /** defaults to process.cwd() */
  cwd?: string;
}

/** Every plugin subdirectory of `dir`, alphabetical, fail-soft. */
async function listPluginDirs(dir: string): Promise<string[]> {
  try {
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

async function resolveEntry(root: string, manifest: DiskManifest): Promise<string> {
  const candidates: string[] = [];
  if (manifest.main) {
    candidates.push(isAbsolute(manifest.main) ? manifest.main : join(root, manifest.main));
    if (!/\.(ts|js|mjs|cjs)$/.test(manifest.main)) {
      candidates.push(join(root, `${manifest.main}.ts`), join(root, `${manifest.main}.js`));
    }
  } else {
    for (const name of DEFAULT_MAIN_CANDIDATES) candidates.push(join(root, name));
  }
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  throw new Error(
    manifest.main
      ? `entry "${manifest.main}" not found under ${root}`
      : `no entry found (tried ${DEFAULT_MAIN_CANDIDATES.join(", ")}) under ${root}`,
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
async function importHooks(
  entryPath: string,
  lastModule?: unknown,
): Promise<{ hooks: Record<string, UserHookFn>; module: unknown }> {
  const fromSource = async () => {
    const src = await readFile(entryPath, "utf8");
    const url = `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`;
    return (await import(url)) as Record<string, unknown>;
  };
  let mod: Record<string, unknown>;
  try {
    const url = `${pathToFileURL(entryPath).href}?t=${Date.now()}`;
    mod = (await import(url)) as Record<string, unknown>;
    if (mod === lastModule) mod = await fromSource(); // stale under path-keyed runners
  } catch {
    mod = await fromSource();
  }
  const hooks = (mod.hooks ?? (mod.default as Record<string, unknown> | undefined)?.hooks) as
    | Record<string, unknown>
    | undefined;
  if (typeof hooks !== "object" || hooks === null) {
    throw new Error(`hooks module must export a named "hooks" object (e.g. export const hooks = { "tool.check": ... })`);
  }
  for (const [name, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function") throw new Error(`hook "${name}" is not a function`);
  }
  return { hooks: hooks as Record<string, UserHookFn>, module: mod };
}

export class PluginLoader {
  private readonly dirs: string[];
  private readonly loadedByName = new Map<
    string,
    LoadedPlugin & { manifest: DiskManifest; entry: string; module?: unknown }
  >();

  constructor(
    private readonly host: HooksHost,
    opts: PluginLoaderOptions = {},
  ) {
    const cwd = opts.cwd ?? process.cwd();
    this.dirs = opts.dirs ?? [
      join(cwd, "plugins"),
      join(cwd, ".agent-compositor", "plugins"),
      join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "agent-compositor", "plugins"),
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
  async discover(): Promise<{ found: DiscoveredPlugin[]; issues: LoadIssue[] }> {
    const found: DiscoveredPlugin[] = [];
    const issues: LoadIssue[] = [];
    for (const dir of this.dirs) {
      for (const root of await listPluginDirs(dir)) {
        const manifestPath = join(root, "plugin.json");
        if (!(await fileExists(manifestPath))) continue;
        try {
          const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
          const manifest = diskManifestSchema.parse(raw);
          found.push({ root, manifestPath, manifest, via: dir });
        } catch (err) {
          issues.push({ path: manifestPath, reason: err instanceof Error ? err.message : String(err) });
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
      if (seen.has(name)) {
        report.skipped.push({ name, path: disc.root, reason: `duplicate name; first hit in search order wins (via ${disc.via})` });
        continue;
      }
      seen.add(name);
      if (this.loadedByName.has(name)) {
        report.skipped.push({ name, path: disc.root, reason: "already loaded (reload it instead)" });
        continue;
      }
      try {
        report.loaded.push(await this.register(disc));
      } catch (err) {
        report.failed.push({ name, path: disc.root, reason: err instanceof Error ? err.message : String(err) });
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
      const raw = JSON.parse(await readFile(disc.manifestPath, "utf8")) as unknown;
      disc.manifest = diskManifestSchema.parse(raw);
    } catch {
      disc.manifest = current.manifest; // keep the last known good manifest
    }
    const loaded = await this.register(disc, lastModule);
    return loaded;
  }

  /** Unregister without re-registering. */
  async unload(name: string): Promise<boolean> {
    this.loadedByName.delete(name);
    return this.host.unregisterPlugin(name);
  }

  private async register(disc: DiscoveredPlugin, lastModule?: unknown): Promise<LoadedPlugin> {
    const { manifest, root } = disc;
    if (manifest.trust === "sandboxed") {
      throw new Error(
        'trust "sandboxed" requires the QuickJS host, which is not linked into this runtime yet ' +
          "(workflows/generated code). Load it as \"trusted\" only if you wrote it yourself.",
      );
    }
    const entry = await resolveEntry(root, manifest);
    const { hooks, module } = await importHooks(entry, lastModule);
    const hookCount = Object.keys(hooks).length;
    const tier: Tier = manifest.tier ?? "user";
    this.host.registerPlugin(
      { name: manifest.name, version: manifest.version, description: manifest.description, trust: manifest.trust, capabilities: manifest.capabilities },
      hooks,
      tier,
    );
    const loaded: LoadedPlugin = {
      name: manifest.name,
      version: manifest.version,
      trust: manifest.trust,
      tier,
      root,
      hookCount,
    };
    this.loadedByName.set(manifest.name, { ...loaded, manifest, entry, module });
    return loaded;
  }
}

export function createPluginLoader(host: HooksHost, opts?: PluginLoaderOptions): PluginLoader {
  return new PluginLoader(host, opts);
}
