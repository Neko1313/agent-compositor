import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse, modify, applyEdits, type ParseError } from "jsonc-parser";
import { ConfigSchema, type CompositorConfig } from "./schema.js";

type Rule = NonNullable<NonNullable<CompositorConfig["ui"]>["rules"]>[number];
/** A dedicated project override preserves source config, comments and substitutions. */
export async function savePlacementRule(cwd: string, rule: Rule, effectiveRules: Rule[] = []): Promise<{ path: string; rules: Rule[] }> {
  const validated = ConfigSchema.parse({ ui: { rules: [rule] } }).ui!.rules![0];
  const file = join(cwd, ".agent-compositor", "agent-compositor.jsonc");
  let source = "{}\n";
  let mode = 0o600;
  try { source = await readFile(file, "utf8"); mode = (await stat(file)).mode & 0o777; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const errors: ParseError[] = [];
  const document = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !document || typeof document !== "object" || Array.isArray(document)) throw new Error("Cannot save placement: project override contains invalid JSONC");
  // Preserve existing local rules as well as inherited rules; replace only this exact identity.
  const localRules = ConfigSchema.parse({ ui: document.ui ?? {} }).ui?.rules ?? effectiveRules;
  const rules = localRules.filter(r => r.match.plugin !== rule.match.plugin || r.match.surface !== rule.match.surface);
  rules.push(validated);
  const updated = applyEdits(source, modify(source, ["ui", "rules"], rules, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  await mkdir(join(cwd, ".agent-compositor"), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temp, updated, { flag: "wx", mode }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
  return { path: file, rules };
}
