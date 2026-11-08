import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SubstitutionRecord } from "./schema.js";

export interface SubstituteInput {
  text: string;
  /** config file's directory — relative {file:} refs resolve against it */
  configDir: string;
  source: string;
  env?: NodeJS.ProcessEnv;
}

export interface SubstituteResult {
  text: string;
  substitutions: SubstitutionRecord[];
  warnings: string[];
}

/**
 * Apply {env:VAR} and {file:path} substitutions to raw config text BEFORE
 * JSON parsing (values land pre-escaped inside string literals).
 *
 * Harvested semantics from opencode:
 *  - {file:...} resolves relative to the config file's directory; "~/" expands.
 *  - tokens on comment lines are left alone.
 *  - a missing env var or unreadable file substitutes "" and records a
 *    warning — one stale secret reference must not kill every load.
 *  - values containing quotes/backslashes are JSON-escaped so the result
 *    still parses (Windows paths, PEM bodies).
 */
export async function substitute(input: SubstituteInput): Promise<SubstituteResult> {
  const warnings: string[] = [];
  const substitutions: SubstitutionRecord[] = [];
  let text = input.text;

  text = text.replace(/\{env:([^}]+)\}/g, (token, name: string) => {
    const value = input.env?.[name] ?? process.env[name];
    const missing = value === undefined;
    substitutions.push({ key: keyOf(text, token), path: input.source, kind: "env", reference: name, missing });
    if (missing) warnings.push(`{env:${name}} is unset — substituted empty string (${input.source})`);
    return escapeJsonString(value ?? "");
  });

  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(/\{file:[^}]+\}/g)) {
    const token = match[0];
    const index = match.index;
    out += text.slice(cursor, index);

    // leave tokens in // comments untouched
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const prefix = text.slice(lineStart, index).trimStart();
    if (prefix.startsWith("//")) {
      out += token;
      cursor = index + token.length;
      continue;
    }

    const ref = token.slice("{file:".length, -1);
    const expanded = ref.startsWith("~/") ? path.join(os.homedir(), ref.slice(2)) : ref;
    const resolvedPath = path.isAbsolute(expanded) ? expanded : path.resolve(input.configDir, expanded);

    let content = "";
    let missing = false;
    try {
      content = (await fs.readFile(resolvedPath, "utf8")).trim();
    } catch {
      missing = true;
      warnings.push(`{file:${ref}} unreadable — substituted empty string (${input.source})`);
    }
    substitutions.push({ key: keyOf(text, token), path: input.source, kind: "file", reference: ref, missing });
    out += escapeJsonString(content);
    cursor = index + token.length;
  }
  out += text.slice(cursor);

  return { text: out, substitutions, warnings };
}

function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** best-effort key name assigned nearest before the token (for origin records) */
function keyOf(text: string, token: string): string {
  const index = text.indexOf(token);
  const before = text.slice(0, index);
  const matches = before.matchAll(/"([^"]+)"\s*:/g);
  let last: string | undefined;
  for (const m of matches) last = m[1];
  return last ?? "";
}
