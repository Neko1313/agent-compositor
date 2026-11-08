import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginsFromDisk } from "../src/index.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-plugins-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makePlugin(dir: string, name: string, manifest: Record<string, unknown> = {}, hooksSrc = "") {
  const pluginDir = path.join(dir, name);
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
  );
  await fs.writeFile(
    path.join(pluginDir, "hooks.ts"),
    hooksSrc ||
      `export default {
        "tool.call": async (event) => ({ next: event }),
      };`,
  );
  return pluginDir;
}

describe("loadPluginsFromDisk", () => {
  it("loads a well-formed plugin: manifest mapped, hooks record validated", async () => {
    const dir = path.join(tmp, "plugins");
    await makePlugin(dir, "hello-plugin", { trust: "trusted", description: "demo" });
    const { plugins, errors } = await loadPluginsFromDisk([dir]);
    expect(errors).toEqual([]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest).toMatchObject({ name: "hello-plugin", version: "1.0.0", trust: "trusted" });
    expect(plugins[0].tier).toBe("user");
    expect(typeof (plugins[0].hooks as Record<string, unknown>)["tool.call"]).toBe("function");
  });

  it("default trust is user; missing entry, bad JSON, non-function hooks are skip-not-throw", async () => {
    const dir = path.join(tmp, "plugins");
    await makePlugin(dir, "good");
    await makePlugin(dir, "no-hooks", {}, ""); // will still write default hooks — remove its entry
    await fs.rm(path.join(dir, "no-hooks", "hooks.ts"));
    const brokenDir = path.join(dir, "broken");
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(path.join(brokenDir, "plugin.json"), "not json{");
    const notFnDir = path.join(dir, "notfn");
    await fs.mkdir(notFnDir, { recursive: true });
    await fs.writeFile(path.join(notFnDir, "plugin.json"), JSON.stringify({ name: "notfn", version: "1.0.0" }));
    await fs.writeFile(path.join(notFnDir, "hooks.ts"), `export default { "tool.call": 42 };`);

    const { plugins, errors } = await loadPluginsFromDisk([dir]);
    expect(plugins.map((p) => p.manifest.name)).toEqual(["good"]);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.error).join("\n")).toMatch(/JSON/i);
    expect(errors.map((e) => e.error).join("\n")).toContain("no entry found");
    expect(errors.map((e) => e.error).join("\n")).toContain("not a function");
  });

  it("invalid names and unknown trust classes are rejected", async () => {
    const dir = path.join(tmp, "plugins");
    await makePlugin(dir, "Bad Name", { name: "Bad Name" });
    await makePlugin(dir, "weirdtrust", { trust: "ultra" as never });
    const { plugins, errors } = await loadPluginsFromDisk([dir]);
    expect(plugins).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("workspace dir shadows global for the same plugin name", async () => {
    const global = path.join(tmp, "global");
    const workspace = path.join(tmp, "workspace");
    await makePlugin(global, "deploy", { version: "1.0.0" });
    await makePlugin(workspace, "deploy", { version: "2.0.0", description: "workspace override" });
    const { plugins } = await loadPluginsFromDisk([global, workspace]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.version).toBe("2.0.0");
    expect(plugins[0].dir).toContain("workspace");
  });

  it("refuses sandboxed modules before importing code", async () => {
    const dir = path.join(tmp, "plugins");
    await makePlugin(dir, "unsafe", { trust: "sandboxed" }, 'throw new Error("must not execute");');
    const result = await loadPluginsFromDisk([dir]);
    expect(result.plugins).toEqual([]);
    expect(result.errors[0].error).toContain("explicit language host");
  });

  it("missing dirs are silently empty (no throw)", async () => {
    const { plugins, errors } = await loadPluginsFromDisk([path.join(tmp, "nope"), path.join(tmp, "nada")]);
    expect(plugins).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("named hooks export works as well as default", async () => {
    const dir = path.join(tmp, "plugins");
    const pluginDir = path.join(dir, "named");
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, "plugin.json"), JSON.stringify({ name: "named", version: "1.0.0" }));
    await fs.writeFile(
      path.join(pluginDir, "hooks.ts"),
      `export const hooks = { "assistant.text": async (e) => e };\n`,
    );
    const { plugins, errors } = await loadPluginsFromDisk([dir]);
    expect(errors).toEqual([]);
    expect(plugins[0].hooks).toHaveProperty("assistant.text");
  });
});
