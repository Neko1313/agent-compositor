/** Compatibility facade. All discovery/import/trust semantics live in loader. */
import { PluginLoader } from "@agent-compositor/loader";
import { Runtime } from "@agent-compositor/runtime";
import { validateControllers, type HooksHost, type UserHookFn, type UiControllers } from "@agent-compositor/hooks";
import type { PluginManifest, Tier } from "@agent-compositor/runtime";
export type PluginJson = import("@agent-compositor/loader").DiskManifest;
export type PluginTool = import("@agent-compositor/loader").PluginTool;
export interface DiskPlugin {
  controllers?:UiControllers;
  sessionRepository?:import("@agent-compositor/session").SessionRepositoryFactory;
  events?: readonly import("@agent-compositor/events").EventDef[];
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
  disabled: string[] = [],
  enabled?: string[],
  accept?: (plugin:import('@agent-compositor/loader').DiscoveredPlugin)=>boolean,
): Promise<LoadResult> {
  const plugins: DiskPlugin[] = [];
  const validation = new Runtime();
  const host = {
    registerPlugin(
      manifest: PluginManifest,
      hooks: Record<string, UserHookFn>,
      tier: Tier,
      events?: readonly import("@agent-compositor/events").EventDef[],
      controllers?:UiControllers
    ) {
      validateControllers(controllers);
      if(controllers && manifest.trust!=="trusted")throw new Error("Private UI controllers require a trusted plugin");
      validation.register(manifest, Object.fromEntries(Object.keys(hooks).map(name=>[name,()=>undefined])), tier, events);
      plugins.push({ manifest, hooks, events, controllers, tools: [], tier, dir: "" });
    },
  } as unknown as HooksHost;
  const loader = new PluginLoader(host, {
    dirs: [...dirs].reverse(),
    disabled,
    enabled,
    accept,
  });
  const report = await loader.loadAll();
  for (const plugin of plugins) {
    const loaded = report.loaded.find((p) => p.name === plugin.manifest.name)!;
    plugin.mcpServers = loaded.mcpServers;
    plugin.dispose = loaded.dispose;
    plugin.dir = loaded.root;
    plugin.commands = loaded.commands;
    plugin.tools = loaded.tools;
    plugin.sessionRepository=loaded.sessionRepository;
  }
  return {
    plugins,
    errors: report.failed.map((p) => ({ dir: p.path, error: p.reason })),
  };
}
