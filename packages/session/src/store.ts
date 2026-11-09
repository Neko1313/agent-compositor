import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
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
  /** event count, kept in the sidecar for cheap current-format listings */
  eventCount: number;
  /** Bounded conversation metadata; never includes tool output or instructions. */
  firstPrompt?: string;
  lastPrompt?: string;
  lastResponse?: string;
  messageCount?: number;
  summaryVersion?: number;
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
 * for listing. Legacy previews are enriched read-only; ordinary listings use
 * the sidecar. Full transcript replay is reserved for resume/fork and body search.
 */
export class SessionStore {
  private now: () => number;
  private legacySummaries = new Map<
    string,
    {
      stamp: string;
      summary: Pick<
        SessionMeta,
        "firstPrompt" | "lastPrompt" | "lastResponse" | "messageCount"
      >;
    }
  >();

  constructor(private options: StoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  root(cwd: string): string {
    return (
      this.options.sessionsRoot ??
      path.join(cwd, ".agent-compositor", "sessions")
    );
  }

  async create(
    cwd: string,
    opts: { id?: string; name?: string; parentId?: string } = {},
  ): Promise<SessionMeta> {
    const root = this.root(cwd);
    await fs.mkdir(root, { recursive: true });
    const id = opts.id ?? randomUUID();
    // re-creating an existing session must never truncate its roll — resume
    // and crash-recovery paths re-ensure the same id after a restart
    const existing = await this.readMeta(root, id).catch(() => undefined);
    if (existing) return existing;
    const meta: SessionMeta = {
      id,
      name: opts.name,
      cwd: path.resolve(cwd),
      createdAt: this.now(),
      updatedAt: this.now(),
      archived: false,
      eventCount: 0,
      messageCount: 0,
      summaryVersion: 1,
      parentId: opts.parentId,
    };
    const roll = this.rollPath(root, id);
    try {
      await fs.access(roll);
    } catch {
      await fs.writeFile(roll, "");
    }
    await this.writeMeta(root, meta);
    return meta;
  }

  async append(
    id: string,
    events: SessionEvent[],
    cwd?: string,
  ): Promise<void> {
    const meta = await this.summarized(await this.requireMeta(id, cwd));
    const root = this.root(meta.cwd);
    for (const event of events) summarizeEvent(meta, event);
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

  async list(
    cwd: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<SessionMeta[]> {
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
        const meta = JSON.parse(
          await fs.readFile(path.join(root, file), "utf8"),
        ) as SessionMeta;
        if (!opts.includeArchived && meta.archived) continue;
        metas.push(await this.summarized(meta));
      } catch {
        // a corrupt sidecar never blocks listing the rest
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Stream old conversation bodies only when metadata does not match the query. */
  async search(
    cwd: string,
    query: string,
    opts: { includeArchived?: boolean; signal?: AbortSignal } = {},
  ): Promise<SessionMeta[]> {
    const needle = normalize(query).toLocaleLowerCase();
    const result: SessionMeta[] = [];
    for (const meta of await this.list(cwd, opts)) {
      opts.signal?.throwIfAborted();
      if (
        !needle ||
        normalize(
          [
            meta.id,
            meta.name,
            meta.firstPrompt,
            meta.lastPrompt,
            meta.lastResponse,
          ].join(" "),
        )
          .toLocaleLowerCase()
          .includes(needle)
      ) {
        result.push(meta);
        continue;
      }
      for await (const event of this.rollEvents(meta, opts.signal)) {
        if (
          ["prompt.submit", "turn.complete", "assistant.text"].includes(
            event.type,
          ) &&
          typeof event.text === "string" &&
          normalize(event.text).toLocaleLowerCase().includes(needle)
        ) {
          result.push(meta);
          break;
        }
      }
    }
    return result;
  }
  private async *rollEvents(
    meta: SessionMeta,
    signal?: AbortSignal,
  ): AsyncGenerator<SessionEvent> {
    const stream = createReadStream(
      this.rollPath(this.root(meta.cwd), meta.id),
      { encoding: "utf8", signal },
    );
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        signal?.throwIfAborted();
        try {
          const event = JSON.parse(line);
          if (
            event &&
            typeof event === "object" &&
            typeof event.type === "string"
          )
            yield event as SessionEvent;
        } catch {
          /* Ignore torn legacy records. */
        }
      }
    } catch (error) {
      // A stale sidecar must not block finding other conversations.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  private async summarized(meta: SessionMeta): Promise<SessionMeta> {
    if (meta.summaryVersion === 1) return meta;
    const key = this.metaPath(this.root(meta.cwd), meta.id),
      stamp = `${meta.updatedAt}:${meta.eventCount}`;
    const cached = this.legacySummaries.get(key);
    if (cached?.stamp === stamp)
      return { ...meta, ...cached.summary, summaryVersion: 1 };
    const result = { ...meta, messageCount: 0, summaryVersion: 1 };
    // Read-only legacy enrichment cannot race a writer by replacing its sidecar.
    try {
      for await (const event of this.rollEvents(meta))
        summarizeEvent(result, event);
    } catch {
      /* Missing rolls remain visible. */
    }
    if (this.legacySummaries.size >= 256)
      this.legacySummaries.delete(this.legacySummaries.keys().next().value!);
    const { firstPrompt, lastPrompt, lastResponse, messageCount } = result;
    this.legacySummaries.set(key, {
      stamp,
      summary: { firstPrompt, lastPrompt, lastResponse, messageCount },
    });
    return result;
  }

  /** fork: copy events up to (and including) turn `uptoTurnIndex` into a new session. */
  async fork(
    id: string,
    opts: { name?: string; uptoEventIndex?: number } = {},
    cwd?: string,
  ): Promise<SessionMeta> {
    const source = await this.load(id, cwd);
    const upto = opts.uptoEventIndex ?? source.events.length;
    const meta = await this.create(source.meta.cwd, {
      name: opts.name,
      parentId: id,
    });
    const events = source.events.slice(0, upto);
    if (events.length > 0) await this.append(meta.id, events, source.meta.cwd);
    return { ...meta, eventCount: events.length };
  }

  async archive(id: string, cwd?: string): Promise<SessionMeta> {
    const meta = await this.requireMeta(id, cwd);
    meta.archived = true;
    meta.updatedAt = this.now();
    await this.writeMeta(this.root(meta.cwd), meta);
    return meta;
  }
  async rename(id: string, name: string, cwd: string): Promise<SessionMeta> {
    const meta = await this.requireMeta(id, cwd);
    meta.name = name.trim().slice(0, 200);
    meta.updatedAt = this.now();
    await this.writeMeta(this.root(meta.cwd), meta);
    return meta;
  }
  async unarchive(id: string, cwd: string): Promise<SessionMeta> {
    const meta = await this.requireMeta(id, cwd);
    meta.archived = false;
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
  async findByPrefix(
    prefix: string,
    cwd: string,
  ): Promise<SessionMeta | undefined> {
    const all = await this.list(cwd, { includeArchived: true });
    const matches = all.filter((m) => m.id.startsWith(prefix));
    return matches.length === 1 ? matches[0] : undefined;
  }

  private rollPath(root: string, id: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
      throw new Error("Invalid session id");
    return path.join(root, `${id}.jsonl`);
  }
  private metaPath(root: string, id: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
      throw new Error("Invalid session id");
    return path.join(root, `${id}.meta.json`);
  }

  private async writeMeta(root: string, meta: SessionMeta): Promise<void> {
    await fs.mkdir(root, { recursive: true });
    const tmp = this.metaPath(root, meta.id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2));
    await fs.rename(tmp, this.metaPath(root, meta.id)); // atomic sidecar swap
  }

  private async readMeta(
    root: string,
    id: string,
  ): Promise<SessionMeta | undefined> {
    try {
      return JSON.parse(
        await fs.readFile(this.metaPath(root, id), "utf8"),
      ) as SessionMeta;
    } catch {
      return undefined;
    }
  }

  private async requireMeta(id: string, cwd?: string): Promise<SessionMeta> {
    // explicit roots first: the cwd-scoped root, or the override root
    const roots = [
      ...(cwd ? [this.root(cwd)] : []),
      ...(this.options.sessionsRoot ? [this.options.sessionsRoot] : []),
    ];
    for (const root of roots) {
      const meta = await this.readMeta(root, id);
      if (meta) return meta;
    }
    throw new Error(
      `session not found: ${id}${cwd ? ` (under ${this.root(cwd)})` : ""}`,
    );
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
        const event = JSON.parse(line);
        if (!event || typeof event !== "object" || typeof event.type !== "string")
          throw new Error("Invalid session event");
        events.push(event as SessionEvent);
      } catch {
        events.push({ type: "corrupt", raw: line }); // a torn line never eats the session
      }
    }
    return events;
  }
}

function normalize(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function summarizeEvent(meta: SessionMeta, event: SessionEvent): void {
  if (typeof event.text !== "string") return;
  const text = normalize(event.text);
  if (!text) return;
  if (event.type === "prompt.submit" && !/^\/[a-z][\w-]*(?:\s|$)/i.test(text)) {
    meta.firstPrompt ??= text.slice(0, 200);
    meta.lastPrompt = text.slice(0, 300);
    meta.messageCount = (meta.messageCount ?? 0) + 1;
  }
  if (event.type === "turn.complete") {
    meta.lastResponse = text.slice(0, 300);
    meta.messageCount = (meta.messageCount ?? 0) + 1;
  }
}
