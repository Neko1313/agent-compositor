export { PluginLoader, createPluginLoader } from "./loader.js";
export type {
  DiscoveredPlugin,
  LoadedPlugin,
  LoadIssue,
  LoadReport,
  PluginLoaderOptions,
  PluginTool,
} from "./loader.js";
export { diskManifestSchema, DEFAULT_MAIN_CANDIDATES } from "./manifest.js";
export type { DiskManifest } from "./manifest.js";

export { claudeManifest, loadClaudePlugin, contained } from "./claude.js";
export { readPluginMcp, mcpServerSchema, mcpServerMapSchema, pluginMcpSourcesSchema } from "./mcp.js";
export type { PluginMcpSources, PluginMcpServer } from "./mcp.js";
