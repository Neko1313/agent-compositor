import { readFile,readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { marketplaceSchema } from "../../packages/app/src/marketplaces.js";
import {publicationGate} from '../plugins/gate.js';
import {checkPlugin} from '../plugins/check.js';
import {
  diskManifestSchema,
  claudeManifest,
  loadClaudePlugin,
  contained,
  readPluginMcp,
  SEMVER,
} from "@agent-compositor/loader";
const root = resolve(process.argv[2] ?? ".");
const firstParty=root===resolve(import.meta.dir,'../..'),checked=new Set<string>();
const market = marketplaceSchema.parse(
  JSON.parse(
    await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")
  )
);
if(market.metadata?.version&&!SEMVER.test(market.metadata.version))throw Error('Marketplace metadata.version must use SemVer');
for (const entry of market.plugins) {
  if(firstParty&&entry.compositor?.format==='native'){await checkPlugin(root,entry.name);checked.add(entry.name);}
  if(firstParty&&typeof entry.source!=='string'&&entry.source.source==='archive'){
    if(!entry.version)throw Error('Certified release version required');
    await publicationGate(root,entry.name,join(root,'.claude-plugin/certification',entry.name,entry.version),entry.source.assets!,entry.version);
  }
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
if(firstParty)for(const entry of await readdir(join(root,'plugins'),{withFileTypes:true})){
  if(entry.isDirectory()&&!checked.has(entry.name)){await checkPlugin(root,entry.name);checked.add(entry.name);}
}
console.log(
  `Validated ${market.name}: ${market.plugins.length} plugin entries; native components require Agent Compositor.`
);
