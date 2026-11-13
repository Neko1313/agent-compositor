import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Runtime } from "@agent-compositor/runtime";
import { attach } from "@agent-compositor/hooks";
import type { HooksHost } from "@agent-compositor/hooks";
import { PluginLoader } from "../src/index.js";

let dir: string;
let runtime: Runtime;
let host: HooksHost;

const pluginDir = (root: string, name: string) => {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  return p;
};

const writePlugin = (
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  hooksTs: string,
  entry = "index.ts",
) => {
  const p = pluginDir(root, name);
  writeFileSync(join(p, "plugin.json"), JSON.stringify({ name, version: "0.1.0", ...manifest }));
  writeFileSync(join(p, entry), hooksTs);
  return p;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ac-loader-"));
  runtime = new Runtime();
  host = attach(runtime, { session: { id: "s1", cwd: dir } });
});

it('rejects immediate command metadata without an executable owner handler',async()=>{
  writePlugin(dir,'control',{trust:'trusted',commands:[{name:'/control',description:'Control',execution:'immediate'}]},'export default {};');
  const report=await new PluginLoader(host,{dirs:[dir]}).loadAll();
  expect(report.loaded).toHaveLength(0);expect(report.failed[0].reason).toContain('command.invoke handler');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("PluginLoader / disk discovery", () => {
  it.each(["tools.ts", "tools.js"])("loads and reloads a tools-only plugin from %s", async toolsEntry => {
    const root = pluginDir(dir, "toolbox");
    writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "toolbox", version: "1.0.0", trust: "trusted" }));
    const source = (value: number) => `export const tools = [{ name:'echo', description:'echo', parameters:{}, describe:()=>({tool:'echo'}), execute:async()=>({ok:true,data:${value}}) }];`;
    writeFileSync(join(root, toolsEntry), source(1));
    const loader = new PluginLoader(host, { dirs: [dir] });
    const report = await loader.loadAll();
    expect(report.failed).toEqual([]);
    expect(await report.loaded[0].tools[0].execute({}, {})).toEqual({ ok: true, data: 1 });
    writeFileSync(join(root, toolsEntry), source(2));
    const reloaded = await loader.reload("toolbox");
    expect(await reloaded.tools[0].execute({}, {})).toEqual({ ok: true, data: 2 });
  });

  it('preserves optional argument validators when loading and reloading disk tools',async()=>{
    const root=pluginDir(dir,'validated');writeFileSync(join(root,'plugin.json'),JSON.stringify({name:'validated',version:'0.1.0',trust:'trusted'}));
    const source=(value:number)=>`export default [{name:'validated',description:'Validated tool',parameters:{},validate:args=>args.value===${value}?undefined:'validated.value must be ${value}',describe:()=>({tool:'validated'}),execute:async()=>({ok:true,data:${value}})}];`;
    writeFileSync(join(root,'tools.ts'),source(1));
    const loader=new PluginLoader(host,{dirs:[root]}),loaded=await loader.loadAll();expect(loaded.failed).toEqual([]);
    expect(loaded.loaded[0].tools[0].validate?.({value:0})).toBe('validated.value must be 1');
    writeFileSync(join(root,'tools.ts'),source(2));const next=await loader.reload('validated');
    expect(next.tools[0].validate?.({value:1})).toBe('validated.value must be 2');expect(next.tools[0].validate?.({value:2})).toBeUndefined();
  });
  it.each(['null','false','"not a function"','{}'])('rejects malformed disk validators at load time: %s',async value=>{
    const root=pluginDir(dir,'invalid-validator');writeFileSync(join(root,'plugin.json'),JSON.stringify({name:'invalid-validator',version:'0.1.0',trust:'trusted'}));
    writeFileSync(join(root,'tools.ts'),`export default [{name:'bad',description:'Bad validator',parameters:{},validate:${value},describe:()=>({tool:'bad'}),execute:async()=>({ok:true,data:1})}];`);
    const report=await new PluginLoader(host,{dirs:[root]}).loadAll();expect(report.loaded).toEqual([]);expect(report.failed[0].reason).toContain('validate must be a function');
  });
  it("rejects tools from render-only plugins before importing executable code", async () => {
    const root = pluginDir(dir, "view");
    writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "view", version: "1.0.0", trust: "render-only" }));
    writeFileSync(join(root, "tools.ts"), "throw new Error('must not import');");
    const report = await new PluginLoader(host, { dirs: [dir] }).loadAll();
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].reason).toContain("render-only");
  });
  it("discovers plugins in immediate subdirectories with plugin.json", async () => {
    mkdirSync(join(dir, "empty-plugin")); // no plugin.json → ignored
    writePlugin(dir, "alpha", { trust: "trusted" }, `export const hooks = {};`);
    writePlugin(dir, "beta", { trust: "render-only" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    const { found, issues } = await loader.discover();
    expect(issues).toEqual([]);
    expect(found.map((f) => f.manifest.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("reports a corrupt manifest as an issue without hiding other plugins", async () => {
    const bad = pluginDir(dir, "broken");
    writeFileSync(join(bad, "plugin.json"), "{ not json");
    writePlugin(dir, "good", { trust: "trusted" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    const { found, issues } = await loader.discover();
    expect(found).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toContain("broken");
  });

  it("name collisions resolve by search order: first dir wins, later skipped", async () => {
    const other = mkdtempSync(join(tmpdir(), "ac-loader-other-"));
    try {
      writePlugin(dir, "dup", { trust: "trusted" }, `export const hooks = {};`);
      writePlugin(other, "dup", { trust: "trusted" }, `export const hooks = {};`);
      const loader = new PluginLoader(host, { dirs: [dir, other] });
      const report = await loader.loadAll();
      expect(report.loaded).toHaveLength(1);
      expect(report.loaded[0].root).toBe(join(dir, "dup"));
      expect(report.skipped).toHaveLength(1);
      expect(report.skipped[0].reason).toMatch(/duplicate/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("PluginLoader / loading", () => {
  it("loads hooks that actually run in the chain (tool.check deny)", async () => {
    writePlugin(
      dir,
      "safety",
      { trust: "trusted", tier: "append" },
      `export const hooks = {
        "tool.check": (e) =>
          e.tool === "Bash" && e.input?.command?.includes("rm -rf /")
            ? { decision: "deny", reason: "nope" }
            : undefined,
      };`,
    );
    const loader = new PluginLoader(host, { dirs: [dir] });
    const report = await loader.loadAll();
    expect(report.failed).toEqual([]);
    expect(report.loaded[0]).toMatchObject({ name: "safety", tier: "append", hookCount: 1 });

    const denied = await host.emit("tool.check", { tool: "Bash", input: { command: "rm -rf /" }, callId: "c1" });
    expect(denied.value).toMatchObject({ decision: "deny", reason: "nope" });
    const allowed = await host.emit("tool.check", { tool: "Bash", input: { command: "ls" }, callId: "c2" });
    expect(allowed.value).toMatchObject({ tool: "Bash" }); // fell through the chain
  });

  it("loaded plugins get the $ API (notify sink sees $.ui.notify)", async () => {
    const seen: unknown[] = [];
    const hostWithSink = attach(runtime, {
      session: { id: "s1", cwd: dir },
      notify: (message, level, plugin) => seen.push({ message, level, plugin }),
    });
    writePlugin(
      dir,
      "greeter",
      { trust: "trusted" },
      `export const hooks = {
        "session.start": async (_e, $) => {
          await $.ui.notify("hello from disk", "info");
          return undefined;
        },
      };`,
    );
    const loader = new PluginLoader(hostWithSink, { dirs: [dir] });
    await loader.loadAll();
    await hostWithSink.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(seen).toEqual([{ message: "hello from disk", level: "info", plugin: "greeter" }]);
  });

  it("a throwing hooks module fails that plugin only (fail-operational)", async () => {
    writePlugin(dir, "boom", { trust: "trusted" }, `throw new Error("import-time explosion");`);
    writePlugin(dir, "fine", { trust: "trusted" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    const report = await loader.loadAll();
    expect(report.loaded.map((p) => p.name)).toEqual(["fine"]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ name: "boom" });
    expect(report.failed[0].reason).toMatch(/explosion/);
  });

  it("unknown hook names and render-only violations are registration failures", async () => {
    writePlugin(dir, "ghost", { trust: "trusted" }, `export const hooks = { "not.an.event": () => {} };`);
    writePlugin(dir, "sneaky", { trust: "render-only" }, `export const hooks = { "tool.call": () => ({}) };`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    const report = await loader.loadAll();
    expect(report.loaded).toEqual([]);
    expect(report.failed.map((f) => f.name).sort()).toEqual(["ghost", "sneaky"]);
    expect(report.failed.find((f) => f.name === "sneaky")?.reason).toMatch(/render-only/);
  });

  it("sandboxed TS plugins require an explicit language host", async () => {
    writePlugin(dir, "gen", { trust: "sandboxed" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    const report = await loader.loadAll();
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].reason).toMatch(/explicit language host/);
  });

  it("loadAll is idempotent: already-loaded names are skipped", async () => {
    writePlugin(dir, "once", { trust: "trusted" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    const first = await loader.loadAll();
    expect(first.loaded).toHaveLength(1);
    const second = await loader.loadAll();
    expect(second.loaded).toEqual([]);
    expect(second.skipped[0].reason).toMatch(/already loaded/);
  });

  it("composition() feeds session.start / session.reload", async () => {
    writePlugin(dir, "a", { trust: "trusted" }, `export const hooks = {};`);
    writePlugin(dir, "b", { trust: "trusted", tier: "append" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    await loader.loadAll();
    expect(loader.composition()).toEqual([
      { name: "a", version: "0.1.0", tier: "user" },
      { name: "b", version: "0.1.0", tier: "append" },
    ]);
  });
});

describe("PluginLoader / reload", () => {
  it("loads new entry code and shared relative modules across fresh Bun loaders", () => {
    const plugin = writePlugin(dir, "bun-reload", {trust: "trusted"},
      `import {counter} from './counter.ts'; export default {'session.start': () => ++counter.value};`);
    writeFileSync(join(plugin, "tools.ts"), `import {counter} from './counter.ts';
      export default [{name:'count',description:'Read the counter',parameters:{},describe:()=>({}),execute:()=>counter.value}];`);
    writeFileSync(join(plugin, "counter.ts"), "export const counter = { value: 1 };");
    // The production Bun app constructs a fresh loader for each replacement.
    // Node/Vitest has a different module cache and cannot verify this behavior.
    const run = `
      import {writeFileSync} from 'node:fs';
      import {join} from 'node:path';
      import {PluginLoader} from '@agent-compositor/loader';
      const root=process.argv[1];
      async function load() {
        let hooks;
        const host={registerPlugin(_manifest, value) { hooks=value; }};
        const report=await new PluginLoader(host, {dirs:[root]}).loadAll();
        if (report.failed.length) throw Error(JSON.stringify(report.failed));
        hooks['session.start']();
        return report.loaded[0].tools[0].execute({}, {});
      }
      const first=await load();
      writeFileSync(join(root,'counter.ts'), 'export const counter = { value: 10 };');
      writeFileSync(join(root,'index.ts'), "import {counter} from './counter.ts'; export default {'session.start': () => counter.value += 2};");
      console.log(JSON.stringify([first,await load()]));
    `;
    expect(JSON.parse(execFileSync("bun", ["-e", run, plugin], {encoding: "utf8"}))).toEqual([2, 12]);
  });

  it("reload sees new code (cache-busted import)", async () => {
    const p = writePlugin(
      dir,
      "mut",
      { trust: "trusted" },
      `export const hooks = { "session.start": () => undefined };`,
    );
    const loader = new PluginLoader(host, { dirs: [dir] });
    await loader.loadAll();

    writeFileSync(
      join(p, "index.ts"),
      `export const hooks = {
        "session.start": (_e, $) => {
          $.state.set("fresh", true);
          return undefined;
        },
        "session.end": (_e, $) => ({ next: $.state.get("fresh") }),
      };`,
    );
    // NOTE: "session.end" is not in the first version — this also proves the
    // old hooks table is fully replaced, not merged. { next } is the only
    // response form of session.end.
    await loader.reload("mut");
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    const res = await host.emit("session.end", { reason: "other" });
    expect(res.value).toEqual({ next: true });
  });

  it("reload wipes per-plugin state (reverse teardown; session.reload is the recovery point)", async () => {
    const p = writePlugin(
      dir,
      "stateful",
      { trust: "trusted" },
      `export const hooks = {
        "session.start": (_e, $) => {
          $.state.set("n", ($.state.get("n") ?? 0) + 1);
          return undefined;
        },
        "session.end": (_e, $) => ({ next: $.state.get("n") ?? "unset" }),
      };`,
    );
    const loader = new PluginLoader(host, { dirs: [dir] });
    await loader.loadAll();
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    await host.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    let res = await host.emit("session.end", { reason: "other" });
    expect(res.value).toEqual({ next: 2 });

    // touch the file so the re-import URL is guaranteed fresh, then reload
    writeFileSync(
      join(p, "index.ts"),
      `export const hooks = {
        "session.start": (_e, $) => {
          $.state.set("n", ($.state.get("n") ?? 0) + 1);
          return undefined;
        },
        "session.end": (_e, $) => ({ next: $.state.get("n") ?? "unset" }),
      };`,
    );
    await loader.reload("stateful");
    res = await host.emit("session.end", { reason: "other" });
    expect(res.value).toEqual({ next: "unset" }); // state recreated empty
  });

  it("reload picks up manifest changes (version bump)", async () => {
    const p = writePlugin(dir, "ver", { trust: "trusted", version: "1.0.0" }, `export const hooks = {};`);
    const loader = new PluginLoader(host, { dirs: [dir] });
    await loader.loadAll();
    writeFileSync(
      join(p, "plugin.json"),
      JSON.stringify({ name: "ver", version: "1.1.0", trust: "trusted" }),
    );
    const reloaded = await loader.reload("ver");
    expect(reloaded.version).toBe("1.1.0");
  });

  it("reload of an unknown plugin throws", async () => {
    const loader = new PluginLoader(host, { dirs: [dir] });
    await expect(loader.reload("nope")).rejects.toThrow(/not loaded/);
  });

  it("unload removes hooks and state", async () => {
    const seen: string[] = [];
    const hostWithSink = attach(runtime, {
      session: { id: "s1", cwd: dir },
      notify: (message) => seen.push(message),
    });
    writePlugin(
      dir,
      "temp",
      { trust: "trusted" },
      `export const hooks = {
        "session.start": async (_e, $) => {
          await $.ui.notify("ran");
          return undefined;
        },
      };`,
    );
    const loader = new PluginLoader(hostWithSink, { dirs: [dir] });
    await loader.loadAll();
    await hostWithSink.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(seen).toEqual(["ran"]);

    expect(await loader.unload("temp")).toBe(true);
    expect(loader.loaded()).toHaveLength(0);
    await hostWithSink.emit("session.start", { sessionId: "s", cwd: dir, plugins: [] });
    expect(seen).toEqual(["ran"]); // hook is gone, sink not called again
  });
});
