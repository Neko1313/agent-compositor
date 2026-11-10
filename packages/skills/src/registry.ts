import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Compact descriptor — safe to show the model in a system prompt. */
export interface SkillSummary {
  name: string;
  description: string;
  /** where the full body lives */
  location: string;
  /** which source tier provided it */
  source: string;
}

/** Full body, loaded on demand (progressive disclosure). */
export interface SkillDetail extends SkillSummary {
  /** raw markdown after frontmatter */
  body: string;
  /** optional frontmatter fields (allowed-tools, license, metadata…) */
  frontmatter: Record<string, string>;
}

export interface SkillRegistryConfig {
  /**
   * Directories to scan, in priority order. Each may contain
   * `<skill-name>/SKILL.md` entries (or loose `*.md` files).
   * Earlier sources shadow later ones by name (workspace wins).
   */
  sources: { name: string; dir: string }[];
}

interface ParsedSkill {
  summary: SkillSummary;
  detail: SkillDetail;
}

/**
 * Skill registry. Discovery reads ONLY frontmatter (name/description) —
 * full bodies stay on disk until load() asks for them, mirroring the
 * progressive-disclosure pattern: the model sees a compact index, and
 * pulling a full skill is an explicit, observable action.
 */
export class SkillRegistry {
  private cache = new Map<string, ParsedSkill>();

  constructor(private config: SkillRegistryConfig) {}

  /** Scan all sources; returns compact summaries, first-source-wins by name. */
  async list(): Promise<SkillSummary[]> {
    const found = new Map<string, SkillSummary>();
    for (const source of this.config.sources) {
      for (const skill of await this.scanSource(source)) {
        if (!found.has(skill.summary.name)) found.set(skill.summary.name, skill.summary);
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Load the full body; throws if the skill does not exist anywhere. */
  async load(name: string): Promise<SkillDetail> {
    for (const source of this.config.sources) {
      const parsed = await this.scanSource(source);
      const match = parsed.find((p) => p.summary.name === name);
      if (match) return match.detail;
    }
    throw new Error(`skill not found: ${name}`);
  }

  /** Keyword scoring over name+description; poor-man's retrieval. */
  async search(query: string, limit = 5): Promise<SkillSummary[]> {
    const terms = tokenize(query);
    const all = await this.list();
    const scored = all
      .map((s) => {
        const hay = tokenize(`${s.name} ${s.description}`);
        let score = 0;
        for (const t of terms) {
          if (hay.includes(t)) score += s.name.toLowerCase().includes(t) ? 3 : 1;
        }
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
    return scored.slice(0, limit).map((x) => x.s);
  }

  /** Render the compact index for system-prompt injection. */
  async renderIndex(): Promise<string> {
    const all = await this.list();
    if (all.length === 0) return "";
    const lines = all.map((s) => `- ${s.name}: ${s.description}`);
    return `Available skills (load with the skills tool):\n${lines.join("\n")}`;
  }

  private async scanSource(source: { name: string; dir: string }): Promise<ParsedSkill[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(source.dir);
    } catch {
      return []; // missing directory is not an error
    }
    const out: ParsedSkill[] = [];
    for (const entry of entries.sort()) {
      const full = path.join(source.dir, entry);
      const stat = await fs.stat(full).catch(() => undefined);
      if (!stat) continue;
      if (stat.isDirectory()) {
        const skill = await this.readSkillMd(path.join(full, "SKILL.md"), source.name);
        if (skill) out.push(skill);
      } else if (entry.endsWith(".md")) {
        const skill = await this.readSkillMd(full, source.name);
        if (skill) out.push(skill);
      }
    }
    return out;
  }

  private async readSkillMd(file: string, sourceName: string): Promise<ParsedSkill | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return undefined;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    const name = frontmatter.name ?? path.basename(path.dirname(file));
    if (!frontmatter.description) return undefined; // a skill without a description is invisible
    const summary: SkillSummary = { name, description: frontmatter.description, location: file, source: sourceName };
    const detail: SkillDetail = { ...summary, body: body.trim(), frontmatter };
    const parsed = { summary, detail };
    this.cache.set(name, parsed);
    return parsed;
  }
}

export function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const frontmatter: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body: raw.slice(end + 4) };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0430-\u044f\u0451]+/u)
    .filter((t) => t.length > 1);
}
