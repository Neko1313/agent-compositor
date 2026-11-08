/** Compatibility facade. All discovery/import/trust semantics live in loader. */
import { PluginLoader } from "@agent-compositor/loader";
import type { HooksHost, UserHookFn } from "@agent-compositor/hooks";
import type { PluginManifest, Tier } from "@agent-compositor/runtime";
export type PluginJson = import("@agent-compositor/loader").DiskManifest;
export type PluginTool = import("@agent-compositor/loader").PluginTool;
export interface DiskPlugin {
  mcpServers?: Record<string, unknown>;
  dispose?: () => void | Promise<void>;
  manifest: PluginManifest;
  hooks: Record<string, UserHookFn>;
  tools: PluginTool[];
  tier: Tier;
  dir: string;
  commands?: PluginJson["commands"];
}
export interface LoadResult {
  plugins: DiskPlugin[];
  errors: { dir: string; error: string }[];
}
export async function loadPluginsFromDisk(
  dirs: string[],
  disabled: string[] = []
): Promise<LoadResult> {
  const plugins: DiskPlugin[] = [];
  const host = {
    registerPlugin(
      manifest: PluginManifest,
      hooks: Record<string, UserHookFn>,
      tier: Tier
    ) {
      plugins.push({ manifest, hooks, tools: [], tier, dir: "" });
    },
  } as unknown as HooksHost;
  const loader = new PluginLoader(host, {
    dirs: [...dirs].reverse(),
    disabled,
  });
  const report = await loader.loadAll();
  for (const plugin of plugins) {
    const loaded = report.loaded.find((p) => p.name === plugin.manifest.name)!;
    plugin.mcpServers = loaded.mcpServers;
    plugin.dispose = loaded.dispose;
    plugin.dir = loaded.root;
    plugin.commands = loaded.commands;
    plugin.tools = loaded.tools;
  }
  return {
    plugins,
    errors: report.failed.map((p) => ({ dir: p.path, error: p.reason })),
  };
}
