import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { marketplaceSchema } from "../../packages/app/src/marketplaces.js";
import {
  diskManifestSchema,
  claudeManifest,
  loadClaudePlugin,
  contained,
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
  try {
    manifest = diskManifestSchema.parse(
      JSON.parse(await readFile(join(directory, "plugin.json"), "utf8"))
    );
  } catch (e) {
    if ((e as any).code !== "ENOENT") throw e;
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
