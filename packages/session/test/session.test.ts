import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/index.js";

let tmp: string;
let cwd: string;
let store: SessionStore;
let clock: number;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-session-"));
  cwd = path.join(tmp, "repo");
  await fs.mkdir(cwd, { recursive: true });
  clock = 1_000_000;
  store = new SessionStore({ sessionsRoot: path.join(cwd, ".agent-compositor", "sessions"), now: () => (clock += 1_000) });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("session store", () => {
  it("create → append → load roundtrip", async () => {
    const meta = await store.create(cwd, { name: "auth refactor" });
    await store.append(meta.id, [
      { type: "prompt.submit", text: "hello" },
      { type: "assistant.text", text: "hi" },
    ]);
    const session = await store.load(meta.id, cwd);
    expect(session.events).toHaveLength(2);
    expect(session.events[0]).toMatchObject({ type: "prompt.submit", text: "hello" });
    expect(session.meta.eventCount).toBe(2);
    expect(session.meta.name).toBe("auth refactor");
  });

  it("list is scoped to the store root and sorted by recency", async () => {
    const a = await store.create(cwd);
    clock += 50_000;
    const b = await store.create(cwd);
    const listed = await store.list(cwd);
    expect(listed.map((m) => m.id)).toEqual([b.id, a.id]);
  });

  it("archived sessions hide from default list, visible on request", async () => {
    const a = await store.create(cwd);
    await store.archive(a.id);
    expect(await store.list(cwd)).toHaveLength(0);
    expect(await store.list(cwd, { includeArchived: true })).toHaveLength(1);
  });

  it("fork copies history up to the cut and records lineage", async () => {
    const a = await store.create(cwd);
    await store.append(a.id, [
      { type: "turn.start", turn: 1 },
      { type: "turn.complete", turn: 1 },
      { type: "turn.start", turn: 2 },
      { type: "turn.complete", turn: 2 },
    ]);
    const fork = await store.fork(a.id, { name: "try another approach", uptoEventIndex: 2 }, cwd);
    expect(fork.parentId).toBe(a.id);
    const session = await store.load(fork.id, cwd);
    expect(session.events.map((e) => e.turn)).toEqual([1, 1]);
    // source untouched
    expect((await store.load(a.id, cwd)).events).toHaveLength(4);
  });

  it("remove deletes roll and sidecar", async () => {
    const a = await store.create(cwd);
    await store.append(a.id, [{ type: "x" }]);
    await store.remove(a.id, cwd);
    expect(await store.list(cwd, { includeArchived: true })).toHaveLength(0);
    await expect(store.load(a.id, cwd)).rejects.toThrow("session not found");
  });

  it("findByPrefix resolves unambiguous prefixes only", async () => {
    const a = await store.create(cwd, { id: "aaa-111" });
    await store.create(cwd, { id: "aab-222" });
    expect((await store.findByPrefix("aaa", cwd))?.id).toBe(a.id);
    expect(await store.findByPrefix("aa", cwd)).toBeUndefined(); // ambiguous
    expect(await store.findByPrefix("zzz", cwd)).toBeUndefined();
  });

  it("a torn JSONL line surfaces as corrupt event, rest survives", async () => {
    const a = await store.create(cwd);
    const roll = path.join(cwd, ".agent-compositor", "sessions", `${a.id}.jsonl`);
    await fs.appendFile(roll, '{"type":"good"}\n{"type":"bro\n{"type":"good2"}\n');
    const session = await store.load(a.id, cwd);
    expect(session.events.map((e) => e.type)).toEqual(["good", "corrupt", "good2"]);
  });
});
