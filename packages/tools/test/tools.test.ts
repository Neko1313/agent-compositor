import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/types.js";
import { editTool } from "../src/tools/edit.js";
import { execTool } from "../src/tools/exec.js";
import { readTool, writeTool } from "../src/tools/fs.js";
import { registerDefaultResolvers, UndoStore } from "../src/index.js";

let tmp: string;
let cwd: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-tools-"));
  cwd = path.join(tmp, "repo");
  await fs.mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** minimal dispatcher: handlers in a map, {deny} support via thrown error */
function makeCtx(extra?: (service: string, payload: unknown, next: () => Promise<unknown>) => Promise<unknown>): ToolContext {
  const handlers = new Map<string, (p: unknown) => Promise<unknown>>();
  registerDefaultResolvers({
    on(service, handler) {
      handlers.set(service, handler);
    },
  });
  const undo = new UndoStore();
  return {
    undo,
    cwd,
    signal: new AbortController().signal,
    async request<T = unknown>(service: string, payload: unknown): Promise<T> {
      const handler = handlers.get(service);
      if (!handler) throw new Error(`no resolver for ${service}`);
      if (!extra) return handler(payload) as Promise<T>;
      return extra(service, payload, () => handler(payload)) as Promise<T>;
    },
  };
}

describe("exec tool", () => {
  it("runs a command through the service event", async () => {
    const result = await execTool.execute(makeCtx(), { command: "echo hello" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.stdout.trim()).toBe("hello");
      expect(result.data.exitCode).toBe(0);
    }
  });

  it("reports failure as a value, not a crash", async () => {
    const result = await execTool.execute(makeCtx(), { command: "exit 3" });
    expect(result.ok).toBe(true); // tool ran fine
    if (result.ok) expect(result.data.exitCode).toBe(3);
  });

  it("a plugin can deny service.shell.exec before the resolver", async () => {
    const ctx = makeCtx(async (service, _payload, next) => {
      if (service === "service.shell.exec") throw new Error("denied by policy plugin");
      return next();
    });
    const result = await execTool.execute(ctx, { command: "echo hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("denied");
  });
});

describe("read/write tools", () => {
  it("write then read roundtrip", async () => {
    const ctx = makeCtx();
    const w = await writeTool.execute(ctx, { path: "a/b.txt", content: "line1\nline2\nline3" });
    expect(w.ok).toBe(true);
    const r = await readTool.execute(ctx, { path: "a/b.txt", offset: 2, limit: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.content).toBe("line2");
      expect(r.data.totalLines).toBe(3);
    }
  });

  it("read missing file → error value", async () => {
    const r = await readTool.execute(makeCtx(), { path: "nope.txt" });
    expect(r.ok).toBe(false);
  });

  it("write pushes undo; inverse restores previous content", async () => {
    const ctx = makeCtx();
    await writeTool.execute(ctx, { path: "f.txt", content: "v1" });
    await writeTool.execute(ctx, { path: "f.txt", content: "v2" });
    const entry = ctx.undo.pop()!;
    expect(entry.inverse).toMatchObject({ op: "write", content: "v1" });
    await writeTool.execute(ctx, { path: "f.txt", content: (entry.inverse as { content: string }).content });
    const r = await readTool.execute(ctx, { path: "f.txt" });
    if (r.ok) expect(r.data.content).toBe("v1");
  });
});

describe("edit tool", () => {
  const seed = async (content: string) => {
    await fs.writeFile(path.join(cwd, "f.txt"), content);
  };

  it("exact unique match", async () => {
    await seed("alpha beta gamma");
    const r = await editTool.execute(makeCtx(), { path: "f.txt", oldText: "beta", newText: "BETA" });
    expect(r.ok && r.data.match === "exact" && r.data.replacements === 1).toBe(true);
    expect(await fs.readFile(path.join(cwd, "f.txt"), "utf8")).toBe("alpha BETA gamma");
  });

  it("ambiguous match without replaceAll → error value", async () => {
    await seed("one two one");
    const r = await editTool.execute(makeCtx(), { path: "f.txt", oldText: "one", newText: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("2 places");
  });

  it("replaceAll handles multiples", async () => {
    await seed("one two one");
    const r = await editTool.execute(makeCtx(), { path: "f.txt", oldText: "one", newText: "1", replaceAll: true });
    expect(r.ok && r.data.replacements === 2).toBe(true);
    expect(await fs.readFile(path.join(cwd, "f.txt"), "utf8")).toBe("1 two 1");
  });

  it("whitespace-normalized fallback matches indentation drift", async () => {
    await seed("if (x) {\n    return 1;\n}");
    const r = await editTool.execute(makeCtx(), {
      path: "f.txt",
      oldText: "if (x) {\n  return 1;\n}",
      newText: "if (x) {\n  return 2;\n}",
    });
    expect(r.ok && r.data.match === "normalized").toBe(true);
    expect(await fs.readFile(path.join(cwd, "f.txt"), "utf8")).toContain("return 2");
  });

  it("no match → error value, file untouched", async () => {
    await seed("alpha");
    const r = await editTool.execute(makeCtx(), { path: "f.txt", oldText: "zzz", newText: "x" });
    expect(r.ok).toBe(false);
    expect(await fs.readFile(path.join(cwd, "f.txt"), "utf8")).toBe("alpha");
  });

  it("successful edit pushes undo entry", async () => {
    await seed("alpha beta");
    const ctx = makeCtx();
    await editTool.execute(ctx, { path: "f.txt", oldText: "beta", newText: "BETA" });
    expect(ctx.undo.size).toBe(1);
    expect(ctx.undo.pop()!.inverse).toMatchObject({ op: "edit", oldText: "BETA", newText: "beta" });
  });
});

describe("permission descriptors", () => {
  it("tools reduce calls to matchable descriptors", async () => {
    expect(execTool.describe({ command: "git push origin main" })).toEqual({ tool: "exec", command: ["git", "push", "origin", "main"] });
    expect(writeTool.describe({ path: "x", content: "" }).path).toBe(path.resolve("x"));
  });
});
