import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectStorage, storagePaths, readSettings } from "../src/storage.js";
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "compositor-storage-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("project storage", () => {
  it("keeps runtime data under home and isolates same-named projects by canonical path", async () => {
    const home = await temp(),
      a = await temp(),
      b = await temp(),
      env = { HOME: home };
    const sa = new ProjectStorage(a, env),
      sb = new ProjectStorage(b, env);
    await sa.init();
    await sb.init();
    expect(
      sa.paths.state.startsWith(join(home, ".agent-compositor/projects"))
    ).toBe(true);
    expect(sa.paths.state).not.toBe(sb.paths.state);
    await sa.write("test", "value", { answer: 42 });
    await expect(sb.read("test", "value")).rejects.toThrow();
    expect(await sa.read("test", "value")).toEqual({ answer: 42 });
  });
  it("migrates existing sessions/tasks/checkpoints once without deleting source", async () => {
    const home = await temp(),
      cwd = await temp();
    await mkdir(join(cwd, ".agent-compositor/sessions"), { recursive: true });
    await writeFile(join(cwd, ".agent-compositor/todos.json"), "[1]");
    await writeFile(
      join(cwd, ".agent-compositor/sessions/roll.jsonl"),
      "original"
    );
    const storage = new ProjectStorage(cwd, { HOME: home });
    await storage.init();
    expect(
      await readFile(join(storage.paths.state, "todos.json"), "utf8")
    ).toBe("[1]");
    await storage.legacyWrite(".agent-compositor/todos.json", "[2]");
    await new ProjectStorage(cwd, { HOME: home }).init();
    expect(await storage.legacyRead(".agent-compositor/todos.json")).toBe(
      "[2]"
    );
    expect(
      await readFile(join(cwd, ".agent-compositor/todos.json"), "utf8")
    ).toBe("[1]");
  });
  it("layers global, project, local preferences and isolates plugin/session namespaces", async () => {
    const home = await temp(),
      cwd = await temp(),
      storage = new ProjectStorage(cwd, { HOME: home });
    await storage.init();
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(home, ".agent-compositor/mcp.json"),
      JSON.stringify({ mcpServers: { global: { command: "g" } }, flag: 1 })
    );
    await writeFile(
      join(cwd, ".agent-compositor/mcp.json"),
      JSON.stringify({ mcpServers: { local: { command: "l" } }, flag: 2 })
    );
    await storage.legacyWrite(
      ".agent-compositor/mcp.json",
      JSON.stringify({ flag: 3 })
    );
    expect(await storage.config("mcp.json")).toMatchObject({
      flag: 3,
      mcpServers: { global: { command: "g" }, local: { command: "l" } },
    });
    await storage.write("a", "key", 1, "session", "one");
    await expect(storage.read("a", "key", "session", "two")).rejects.toThrow();
    await expect(storage.read("b", "key", "session", "one")).rejects.toThrow();
  });
  it("rejects traversal/symlink escape and supports explicit portable mode", async () => {
    const home = await temp(),
      cwd = await temp(),
      outside = await temp(),
      storage = new ProjectStorage(cwd, { HOME: home });
    await storage.init();
    await expect(storage.write("test", "../escape", 1)).rejects.toThrow();
    const root = storage.scope("test");
    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, "escape"));
    await expect(storage.write("test", "escape/key", 1)).rejects.toThrow();
    expect(
      storagePaths(cwd, { HOME: home, AGENT_STORAGE_MODE: "project" }).state
    ).toBe(join(cwd, ".agent-compositor"));
  });
  it("rejects malformed layered settings and initializes explicit portable storage", async () => {
    const home = await temp(),
      cwd = await temp(),
      storage = new ProjectStorage(cwd, { HOME: home });
    await storage.init();
    await writeFile(join(storage.paths.home, "bad.json"), "[]");
    await expect(storage.config("bad.json")).rejects.toThrow(
      "Settings must be an object"
    );
    await expect(storage.config("../bad.json")).rejects.toThrow(
      "Invalid settings filename"
    );
    await expect(storage.read("invalid/name", "key")).rejects.toThrow(
      "Invalid storage scope"
    );
    await expect(
      storage.read("valid", "key", "session", "invalid/id")
    ).rejects.toThrow("Invalid session id");
    const portable = new ProjectStorage(cwd, {
      HOME: home,
      AGENT_STORAGE_MODE: "project",
    });
    await portable.init();
    await portable.legacyWrite(".agent-compositor/value.json", "42");
    expect(await portable.legacyRead(".agent-compositor/value.json")).toBe(
      "42"
    );
  });
});
