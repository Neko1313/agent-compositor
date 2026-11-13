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
  it.each([{offset:0},{offset:1.5},{limit:0},{limit:10001}])('rejects invalid read pagination before accessing a path: %j',async range=>{
    let accesses=0;const ctx=makeCtx();ctx.resolvePath=async()=>{accesses++;throw Error('unexpected path access');};
    const result=await readTool.execute(ctx,{path:'uninspected.txt',...range});expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toContain('read.');expect(accesses).toBe(0);
    expect((readTool.parameters as any).properties.offset).toMatchObject({type:'integer',minimum:1});expect((readTool.parameters as any).properties.limit).toMatchObject({type:'integer',minimum:1,maximum:10000});
  });
  it('explains missing files and directories without changing the read target',async()=>{
    const missing=await readTool.execute(makeCtx(),{path:'missing.ts'});expect(missing.ok).toBe(false);if(!missing.ok){expect(missing.error).toContain('ENOENT');expect(missing.error).toContain('Discover actual project filenames');}
    const directory=await readTool.execute(makeCtx(),{path:'.'});expect(directory.ok).toBe(false);if(!directory.ok)expect(directory.error).toContain('read expects a file, not a directory');
    const denied=await readTool.execute(makeCtx(async()=>{throw Error('denied by policy');}),{path:'known.ts'});expect(denied).toEqual({ok:false,error:'denied by policy'});
  });
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
  it("reports the completed file action in model JSON while keeping content and undo private", async () => {
    const file = 'quote"\nname.txt';
    const target = path.join(cwd, file);
    const oldText = 'private old '.repeat(1000);
    const newText = 'private new '.repeat(1000);
    const ctx = makeCtx();
    const written = await writeTool.execute(ctx, { path: file, content: oldText });
    if (!written.ok) throw Error(written.error);
    expect(written.data).toEqual({ path: target, bytes: Buffer.byteLength(oldText) });
    expect(JSON.parse(written.modelText!)).toEqual({ fileAction: 'wrote', ...written.data });

    const read = await readTool.execute(ctx, { path: file });
    if (!read.ok || !read.data.edit) throw Error('Expected a guarded read');
    const edited = await editTool.execute(ctx, { ...read.data.edit, oldText, newText });
    if (!edited.ok) throw Error(edited.error);
    expect(edited.data).toEqual({ path: target, replacements: 1, match: 'exact', hashAfter: expect.any(String) });
    expect(JSON.parse(edited.modelText!)).toEqual({ fileAction: 'edited', ...edited.data });
    expect(await fs.readFile(target, 'utf8')).toBe(newText);
  });

  it("leaves a service's own fileAction and nonstandard mutation outcomes intact", async () => {
    const target = path.join(cwd, 'f.txt');
    const custom = { path: target, bytes: 0, fileAction: { provider: 'example' } };
    const noMatch = { path: target, replacements: 0, match: 'exact' };
    const ctx = makeCtx(async (service, _payload, next) => {
      if (service === 'service.file.write') return custom;
      if (service === 'service.file.edit') return noMatch;
      return next();
    });
    expect(await writeTool.execute(ctx, { path: target, content: '' })).toEqual({ ok: true, data: custom });
    expect(await editTool.execute(ctx, { path: target, oldText: 'a', newText: 'b' })).toEqual({ ok: true, data: noMatch });
  });

  it.each([false,true])('rejects exact replacements that leave actual text unchanged, replaceAll=%s',async replaceAll=>{
    await fs.writeFile(path.join(cwd,'f.txt'),'unchanged');const before=await fs.stat(path.join(cwd,'f.txt'),{bigint:true}),ctx=makeCtx();
    const result=await editTool.execute(ctx,{path:'f.txt',oldText:'unchanged',newText:'unchanged',replaceAll});
    expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toContain('unchanged');expect(ctx.undo.size).toBe(0);
    expect(await fs.readFile(path.join(cwd,'f.txt'),'utf8')).toBe('unchanged');expect((await fs.stat(path.join(cwd,'f.txt'),{bigint:true})).mtimeNs).toBe(before.mtimeNs);
  });
  it.each([false,true])('rejects normalized replacements that leave actual text unchanged, replaceAll=%s',async replaceAll=>{
    const original=replaceAll?'a  b;a  b':'a  b';await fs.writeFile(path.join(cwd,'f.txt'),original);
    const before=await fs.stat(path.join(cwd,'f.txt'),{bigint:true}),ctx=makeCtx();
    const result=await editTool.execute(ctx,{path:'f.txt',oldText:'a b',newText:'a  b',replaceAll});
    expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toContain('unchanged');
    expect(await fs.readFile(path.join(cwd,'f.txt'),'utf8')).toBe(original);expect((await fs.stat(path.join(cwd,'f.txt'),{bigint:true})).mtimeNs).toBe(before.mtimeNs);expect(ctx.undo.size).toBe(0);
  });
  it('rejects an unchanged guarded insertion through the default service',async()=>{
    await fs.writeFile(path.join(cwd,'f.txt'),'');const ctx=makeCtx(),read=await readTool.execute(ctx,{path:'f.txt'});if(!read.ok)throw Error(read.error);
    await expect(ctx.request('service.file.edit',{...read.data.edit,oldText:'',newText:'',replaceAll:false})).rejects.toThrow('unchanged');
    expect(ctx.undo.size).toBe(0);expect(await fs.readFile(path.join(cwd,'f.txt'),'utf8')).toBe('');
  });
  it('explains a missing edit target without creating a replacement or undo record',async()=>{
    const ctx=makeCtx(),result=await editTool.execute(ctx,{path:'guessed-file.ts',oldText:'old',newText:'new'});
    expect(result.ok).toBe(false);if(!result.ok){expect(result.error).toContain('ENOENT');expect(result.error).toContain('Inspect actual project filenames');expect(result.error).toContain('Do not create a guessed replacement');}
    expect(ctx.undo.pop()).toBeUndefined();await expect(fs.readFile(path.join(cwd,'guessed-file.ts'))).rejects.toMatchObject({code:'ENOENT'});
  });
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
