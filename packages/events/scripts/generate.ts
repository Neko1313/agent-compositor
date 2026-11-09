/**
 * Codegen from the catalog (Neovim api-metadata pattern):
 *   docs/events.md   — human-readable contract
 *   schema/events.json — machine-readable contract
 * Both are committed; CI fails if they drift from the source of truth.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CATALOG_VERSION, byName, catalog } from "../src/index.js";
import { namespaceOf } from "../src/define.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function jsonSchema(schema: z.ZodType): unknown {
  // Catalog schemas describe incoming payloads: stripped object extras remain
  // accepted inputs. Non-JSON values stay unconstrained; Zod remains the runtime
  // authority for refinements that JSON Schema cannot express.
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

// ---------- markdown ----------

function md(): string {
  const lines: string[] = [];
  lines.push("# Event catalog");
  lines.push("");
  lines.push(`> Generated from \`packages/events/src/catalog/\`. Do not edit by hand — run \`npm run gen\`.`);
  lines.push(`> Catalog version: **${CATALOG_VERSION}**. "Don't break plugins": frozen shapes change only via new event versions.`);
  lines.push("");
  lines.push("| Event | Since | V | Fires when | Response forms | Aliases |");
  lines.push("|---|---|---|---|---|---|");
  for (const e of catalog) {
    const forms = e.responses.map((r) => `\`${r.kind}\``).join(", ") || "—";
    const aliases = (e.aliases ?? []).map((a) => `\`${a}\``).join(", ") || "—";
    lines.push(`| \`${e.name}\` | ${e.since} | ${e.version} | ${e.summary} | ${forms} | ${aliases} |`);
  }
  lines.push("");
  lines.push("## Domains");
  lines.push("");
  const domains = new Map<string, string[]>();
  for (const e of catalog) {
    const ns = namespaceOf(e.name);
    if (!domains.has(ns)) domains.set(ns, []);
    domains.get(ns)!.push(e.name);
  }
  for (const [ns, names] of domains) {
    lines.push(`- **${ns}**: ${names.map((n) => `\`${n}\``).join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------- json ----------

function json(): string {
  const out = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "agent-compositor event catalog",
    version: CATALOG_VERSION,
    events: Object.fromEntries(
      catalog.map((e) => [
        e.name,
        {
          since: e.since,
          version: e.version,
          summary: e.summary,
          namespace: namespaceOf(e.name),
          generator: e.generator ?? false,
          aliases: e.aliases ?? [],
          frozen: e.frozen,
          input: jsonSchema(e.input),
          responses: Object.fromEntries(e.responses.map((r) => [r.kind, { summary: r.summary, schema: jsonSchema(r.schema) }])),
        },
      ]),
    ),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

// ---------- write ----------

const targets = [
  { path: join(repoRoot, "docs/events.md"), content: md() },
  { path: join(repoRoot, "schema/events.json"), content: json() },
];
for (const t of targets) {
  mkdirSync(dirname(t.path), { recursive: true });
  writeFileSync(t.path, t.content);
  console.log(`generated ${t.path} (${t.content.length} bytes, ${catalog.length} events, ${byName.size} canonical)`);
}
