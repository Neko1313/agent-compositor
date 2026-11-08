import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/build.js";
import { ScriptedProvider } from "@agent-compositor/core";
const roots: string[] = [],
  apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "storage-network-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("plugin storage and proxy controls", () => {
  it("routes persistent plugin state through hooks, restores scopes and rejects render mutations", async () => {
    const cwd = await temp(),
      home = await temp(),
      app = await buildApp({
        cwd,
        env: { HOME: home },
        provider: new ScriptedProvider([]),
        agentHub: false,
      });
    apps.push(app);
    const core = app.createCore(async () => true);
    let values: any[] = [];
    core.host.registerPlugin(
      { name: "persistent", version: "1.0.0", trust: "trusted" },
      {
        "session.start": async (_e, $) => {
          for (const scope of [
            "project",
            "global",
            "session",
            "cache",
          ] as const)
            await $.storage.set("cursor", { scope }, scope);
          values = await Promise.all(
            (["project", "global", "session", "cache"] as const).map((s) =>
              $.storage.get("cursor", s)
            )
          );
        },
        "ui.render": async (_e, $) => {
          await $.storage.set("illegal", 1);
        },
      }
    );
    await core.start();
    expect(values).toHaveLength(4);
    expect(values.map((v) => v.scope)).toEqual([
      "project",
      "global",
      "session",
      "cache",
    ]);
    const rendered = await core.host.emit("ui.render", {
      site: "status",
      surface: "terminal",
      props: {},
      viewport: { columns: 80, rows: 1 },
    });
    expect(rendered.faults.length).toBeGreaterThan(0);
    await expect(app.storage.read("persistent", "illegal")).rejects.toThrow();
    const other = await temp(),
      next = await buildApp({
        cwd: other,
        env: { HOME: home },
        provider: new ScriptedProvider([]),
        agentHub: false,
      });
    apps.push(next);
    const second = next.createCore(async () => true);
    let global: any, project: any, session: any;
    second.host.registerPlugin(
      { name: "persistent", version: "1.0.0", trust: "trusted" },
      {
        "session.start": async (_e, $) => {
          global = await $.storage.get("cursor", "global");
          project = await $.storage.get("cursor", "project");
          session = await $.storage.get("cursor", "session");
        },
      }
    );
    await second.start();
    expect(global).toEqual({ scope: "global" });
    expect(project).toBeUndefined();
    expect(session).toBeUndefined();
  });
  it("toggles proxy via commands, redacts credentials and fails before model execution on invalid routing", async () => {
    const cwd = await temp(),
      home = await temp();
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(cwd, ".agent-compositor/proxy.json"),
      JSON.stringify({ url: "http://user:private@127.0.0.1:9", enabled: false })
    );
    const provider = new ScriptedProvider([{ text: "must not run" }]);
    const app = await buildApp({
      cwd,
      env: { HOME: home },
      provider,
      agentHub: false,
      pluginDirs: [join(process.cwd(), "plugins/network-proxy")],
    });
    apps.push(app);
    const core = app.createCore(async () => true);
    const texts: string[] = [];
    core.subscribe((e) => {
      if (e.kind === "catalog" && e.event === "ui.surface")
        texts.push(String(e.input.text));
    });
    await core.start();
    await core.submit("/proxy status");
    expect(texts.join("")).toContain('"enabled": false');
    expect(texts.join("")).not.toContain("private");
    await core.submit("/proxy on");
    expect(
      JSON.parse(
        await readFile(join(app.storage.paths.state, "proxy.json"), "utf8")
      ).enabled
    ).toBe(true);
    await core.submit("/proxy off");
    expect(
      JSON.parse(
        await readFile(join(app.storage.paths.state, "proxy.json"), "utf8")
      ).enabled
    ).toBe(false);
    await app.storage.legacyWrite(
      ".agent-compositor/proxy.json",
      JSON.stringify({ enabled: true, url: "socks5://localhost:9" })
    );
    await core.submit("must not bypass proxy");
    expect(provider.requests).toHaveLength(0);
    expect(core.failure).toBeTruthy();
    const result = await core.invokeTool("exec", {
      command: "printf should-not-run",
    });
    expect(result.ok).toBe(false);
  });
  it("shares explicit global memory while keeping project notes private", async () => {
    const home = await temp(),
      cwd = await temp(),
      provider = new ScriptedProvider([{ text: "first" }]);
    const app = await buildApp({
      cwd,
      env: { HOME: home },
      provider,
      agentHub: false,
      pluginDirs: [join(process.cwd(), "plugins/memory")],
    });
    apps.push(app);
    const core = app.createCore(async () => true);
    await core.submit("#global prefer pnpm");
    await core.submit("# private project note");
    expect(provider.requests).toHaveLength(0);
    await core.submit("What do you remember?");
    expect(
      provider.requests[0].messages.some(
        (m) =>
          m.content.includes("prefer pnpm") &&
          m.content.includes("private project note")
      )
    ).toBe(true);
    const nextProvider = new ScriptedProvider([{ text: "second" }]),
      next = await buildApp({
        cwd: await temp(),
        env: { HOME: home },
        provider: nextProvider,
        agentHub: false,
        pluginDirs: [join(process.cwd(), "plugins/memory")],
      });
    apps.push(next);
    const second = next.createCore(async () => true);
    await second.submit("What do you remember?");
    const prompt = nextProvider.requests[0].messages
      .map((m) => m.content)
      .join("\n");
    expect(prompt).toContain("prefer pnpm");
    expect(prompt).not.toContain("private project note");
  });
  it("inherits parent project profiles, MCP and proxy into isolated agent roots while allowing local overrides", async () => {
    const cwd = await temp(),
      home = await temp(),
      childRoot = await temp();
    await mkdir(join(cwd, ".agent-compositor"));
    await mkdir(join(childRoot, ".agent-compositor"));
    await writeFile(
      join(cwd, "agent-compositor.json"),
      JSON.stringify({
        providers: { default: { model: "parent-model" } },
        compaction: { enabled: true },
      })
    );
    await writeFile(
      join(cwd, ".agent-compositor/proxy.json"),
      JSON.stringify({ enabled: true, url: "http://127.0.0.1:9" })
    );
    await writeFile(
      join(cwd, ".agent-compositor/mcp.json"),
      JSON.stringify({ mcpServers: { parent: { command: "node" } } })
    );
    await writeFile(
      join(childRoot, "agent-compositor.json"),
      JSON.stringify({ compaction: { enabled: false } })
    );
    await writeFile(
      join(childRoot, ".agent-compositor/proxy.json"),
      JSON.stringify({ models: false })
    );
    const parent = await buildApp({
      cwd,
      env: { HOME: home },
      provider: new ScriptedProvider([]),
      agentHub: false,
    });
    apps.push(parent);
    const provider = new ScriptedProvider([{ text: "child" }]);
    const child = await buildApp({
      cwd: childRoot,
      env: { HOME: home },
      provider,
      agentHub: false,
      inheritedConfig: parent.config,
      inheritedSettings: (name) => parent.storage.config(name),
      pluginDirs: [join(process.cwd(), "plugins/network-proxy")],
    });
    apps.push(child);
    expect(child.config.config.compaction?.enabled).toBe(false);
    expect(await child.storage.config("proxy.json")).toMatchObject({
      enabled: true,
      models: false,
      url: "http://127.0.0.1:9",
    });
    expect(await child.storage.config("mcp.json")).toMatchObject({
      mcpServers: { parent: { command: "node" } },
    });
    const core = child.createCore(async () => true);
    await core.submit("child task");
    expect(provider.requests[0].model).toBe("parent-model");
    const result = await core.invokeTool("exec", {
      command: 'printf "%s" "$HTTPS_PROXY"',
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.output)).toContain("127.0.0.1:9");
  });
});
