import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Anything JSON-serializable the loop/renderer records. */
export type SessionEvent = Record<string, unknown> & { type: string };

export interface SessionMeta {
  id: string;
  /** human-chosen or generated label, for fuzzy resume ("the auth refactor") */
  name?: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** event count, kept in the sidecar so listing never reads roll files */
  eventCount: number;
  /** fork lineage */
  parentId?: string;
}

export interface Session {
  meta: SessionMeta;
  events: SessionEvent[];
}

export interface StoreOptions {
  /** override sessions root (tests, portable mode). Default: <cwd>/.agent-compositor/sessions */
  sessionsRoot?: string;
  now?: () => number;
}

/**
 * Project-local session storage, codex rollout style: every session is one
 * JSONL roll file (append-only, fsync'd per write) plus a tiny JSON sidecar
 * for listing. Resume/fork/archive/delete all work without parsing bodies.
 */
export class SessionStore {
  private now: () => number;

  constructor(private options: StoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  root(cwd: string): string {
    return this.options.sessionsRoot ?? path.join(cwd, ".agent-compositor", "sessions");
  }

  async create(cwd: string, opts: { id?: string; name?: string; parentId?: string } = {}): Promise<SessionMeta> {
    const root = this.root(cwd);
    await fs.mkdir(root, { recursive: true });
    const meta: SessionMeta = {
      id: opts.id ?? randomUUID(),
      name: opts.name,
      cwd: path.resolve(cwd),
      createdAt: this.now(),
      updatedAt: this.now(),
      archived: false,
      eventCount: 0,
      parentId: opts.parentId,
    };
    await fs.writeFile(this.rollPath(root, meta.id), "");
    await this.writeMeta(root, meta);
    return meta;
  }

  async append(id: string, events: SessionEvent[], cwd?: string): Promise<void> {
    const meta = await this.requireMeta(id, cwd);
    const root = this.root(meta.cwd);
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const fh = await fs.open(this.rollPath(root, id), "a");
    try {
      await fh.write(lines);
      await fh.sync();
    } finally {
      await fh.close();
    }
    meta.eventCount += events.length;
    meta.updatedAt = this.now();
    await this.writeMeta(root, meta);
  }

  /** Full load for resume. */
  async load(id: string, cwd?: string): Promise<Session> {
    const meta = await this.requireMeta(id, cwd);
    const events = await this.readRoll(this.rollPath(this.root(meta.cwd), id));
    return { meta, events };
  }

  async list(cwd: string, opts: { includeArchived?: boolean } = {}): Promise<SessionMeta[]> {
    const root = this.root(cwd);
    let files: string[];
    try {
      files = await fs.readdir(root);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const file of files) {
      if (!file.endsWith(".meta.json")) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as SessionMeta;
        if (!opts.includeArchived && meta.archived) continue;
        metas.push(meta);
      } catch {
        // a corrupt sidecar never blocks listing the rest
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** fork: copy events up to (and including) turn `uptoTurnIndex` into a new session. */
  async fork(id: string, opts: { name?: string; uptoEventIndex?: number } = {}, cwd?: string): Promise<SessionMeta> {
    const source = await this.load(id, cwd);
    const upto = opts.uptoEventIndex ?? source.events.length;
    const meta = await this.create(source.meta.cwd, { name: opts.name, parentId: id });
    const events = source.events.slice(0, upto);
    if (events.length > 0) await this.append(meta.id, events);
    return { ...meta, eventCount: events.length };
  }

  async archive(id: string, cwd?: string): Promise<SessionMeta> {
    const meta = await this.requireMeta(id, cwd);
    meta.archived = true;
    meta.updatedAt = this.now();
    await this.writeMeta(this.root(meta.cwd), meta);
    return meta;
  }

  async remove(id: string, cwd?: string): Promise<void> {
    const meta = await this.requireMeta(id, cwd);
    const root = this.root(meta.cwd);
    await fs.rm(this.rollPath(root, id), { force: true });
    await fs.rm(this.metaPath(root, id), { force: true });
  }

  /** id prefix resolution: "a73" → the single session starting with a73, or undefined if ambiguous/missing */
  async findByPrefix(prefix: string, cwd: string): Promise<SessionMeta | undefined> {
    const all = await this.list(cwd, { includeArchived: true });
    const matches = all.filter((m) => m.id.startsWith(prefix));
    return matches.length === 1 ? matches[0] : undefined;
  }

  private rollPath(root: string, id: string): string {
    return path.join(root, `${id}.jsonl`);
  }
  private metaPath(root: string, id: string): string {
    return path.join(root, `${id}.meta.json`);
  }

  private async writeMeta(root: string, meta: SessionMeta): Promise<void> {
    await fs.mkdir(root, { recursive: true });
    const tmp = this.metaPath(root, meta.id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2));
    await fs.rename(tmp, this.metaPath(root, meta.id)); // atomic sidecar swap
  }

  private async requireMeta(id: string, cwd?: string): Promise<SessionMeta> {
    const roots = cwd ? [this.root(cwd)] : [];
    for (const root of roots) {
      try {
        return JSON.parse(await fs.readFile(this.metaPath(root, id), "utf8")) as SessionMeta;
      } catch {
        // fall through
      }
    }
    // last resort: scan nothing, just fail with a clear error
    throw new Error(`session not found: ${id}${cwd ? ` (under ${this.root(cwd)})` : ""}`);
  }

  private async readRoll(file: string): Promise<SessionEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return [];
    }
    const events: SessionEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as SessionEvent);
      } catch {
        events.push({ type: "corrupt", raw: line }); // a torn line never eats the session
      }
    }
    return events;
  }
}
