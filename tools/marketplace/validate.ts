import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { marketplaceSchema } from "../../packages/app/src/marketplaces.js";
import {
  diskManifestSchema,
  claudeManifest,
  loadClaudePlugin,
  contained,
  readPluginMcp,
} from "@agent-compositor/loader";
const root = resolve(process.argv[2] ?? ".");
const market = marketplaceSchema.parse(
  JSON.parse(
    await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")
  )
);
for (const entry of market.plugins) {
  if (typeof entry.source !== "string") continue;
  const directory = await contained(root, entry.source);
  let manifest;
  const native = await readFile(join(directory, 'plugin.json'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (native !== undefined) {
    manifest = diskManifestSchema.parse(JSON.parse(native));
    const servers = await readPluginMcp(directory, manifest.name, manifest.mcpServers);
    if (manifest.trust === 'render-only' && Object.keys(servers).length)
      throw Error('render-only plugins may not contribute MCP servers');
    for (const resource of manifest.resources ?? []) await contained(directory, resource);
  } else {
    manifest = await claudeManifest(directory);
    await loadClaudePlugin(directory);
  }
  if (manifest.name !== entry.name)
    throw Error(`Manifest identity mismatch: ${entry.name}`);
  if (entry.version && manifest.version !== entry.version)
    throw Error(`Manifest version mismatch: ${entry.name}`);
}
console.log(
  `Validated ${market.name}: ${market.plugins.length} plugin entries; native components require Agent Compositor.`
);
