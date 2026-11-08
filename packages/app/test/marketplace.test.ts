import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildApp } from "../src/build.js";
import { ScriptedProvider } from "@agent-compositor/core";
import { marketplaces, marketplaceSchema } from "../src/marketplaces.js";
import { loadClaudePlugin, PluginLoader } from "@agent-compositor/loader";
const exec = promisify(execFile),
  dirs: string[] = [],
  apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "compositor-market-"));
  dirs.push(dir);
  return dir;
}
async function file(root: string, name: string, contents: string) {
  await mkdir(join(root, name, ".."), { recursive: true });
  await writeFile(join(root, name), contents);
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const cwd = await temp(),
    home = await temp(),
    repo = await temp();
  await file(
    repo,
    ".claude-plugin/marketplace.json",
    JSON.stringify({
      name: "sample-market",
      owner: { name: "Example" },
      plugins: [{ name: "portable", source: "./plugins/portable" }],
    })
  );
  await file(
    repo,
    "plugins/portable/.claude-plugin/plugin.json",
    JSON.stringify({ name: "portable", version: "1.2.3" })
  );
  await file(
    repo,
    "plugins/portable/commands/hello.md",
    "---\ndescription: Greet a person\n---\nSay HELLO $ARGUMENTS"
  );
  return { cwd, home, repo };
}
describe("Claude-compatible marketplace", () => {
  it("validates real catalog schema and rejects duplicate plugin identities", () => {
    expect(
      marketplaceSchema.safeParse({
        name: "sample",
        owner: { name: "x" },
        plugins: [{ name: "a", source: "./a" }],
      }).success
    ).toBe(true);
    expect(
      marketplaceSchema.safeParse({
        name: "sample",
        owner: { name: "x" },
        plugins: [
          { name: "a", source: "a" },
          { name: "a", source: "b" },
        ],
      }).success
    ).toBe(false);
  });
  it("registers local marketplace, installs its plugin, reloads and expands a namespaced command", async () => {
    const { cwd, home, repo } = await fixture();
    const provider = new ScriptedProvider([{ text: "HELLO Ada" }]);
    const app = await buildApp({ cwd, env: { HOME: home }, provider });
    apps.push(app);
    const core = app.createCore(async () => true);
    expect(
      (
        await core.invokeTool("marketplace_control", {
          action: "add",
          source: repo,
        })
      ).ok
    ).toBe(true);
    expect(
      (
        await core.invokeTool("extension_control", {
          action: "install",
          name: "portable@sample-market",
        })
      ).ok
    ).toBe(true);
    await app.reloadPlugins(core);
    expect(app.commands().some((c) => c.name === "/portable:hello")).toBe(true);
    await core.submit("/portable:hello Ada");
    expect(
      provider.requests[0].messages.some((m) =>
        m.content.includes("Say HELLO Ada")
      )
    ).toBe(true);
    const fresh = await buildApp({
      cwd,
      env: { HOME: home },
      provider: new ScriptedProvider([]),
    });
    apps.push(fresh);
    expect(fresh.plugins.some((p) => p.manifest.name === "portable")).toBe(
      true
    );
  });
  it("pins marketplace Git revision and keeps updates explicit", async () => {
    const { cwd, home, repo } = await fixture();
    await exec("git", ["init", "-b", "main"], { cwd: repo });
    await exec("git", ["add", "."], { cwd: repo });
    await exec(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: repo }
    );
    const manager = await marketplaces(cwd, home, join(home, "state")); // absolute local path intentionally uses live directory
    const added: any = await manager.control(
      { action: "add", source: repo },
      new AbortController().signal
    );
    expect(added.name).toBe("sample-market");
    const resolved = await manager.source("portable@sample-market");
    expect(resolved.directory).toBe(join(repo, "plugins/portable"));
    await manager.control(
      { action: "remove", name: "sample-market" },
      new AbortController().signal
    );
    await expect(manager.source("portable@sample-market")).rejects.toThrow(
      "Unknown marketplace"
    );
  });
  it("confines paths and rejects unsupported executable hook types", async () => {
    const { cwd, home, repo } = await fixture();
    await file(
      repo,
      ".claude-plugin/marketplace.json",
      JSON.stringify({
        name: "sample-market",
        owner: { name: "Example" },
        plugins: [{ name: "portable", source: "../" }],
      })
    );
    const manager = await marketplaces(cwd, home, join(home, "state"));
    await manager.control(
      { action: "add", source: repo },
      new AbortController().signal
    );
    await expect(manager.source("portable@sample-market")).rejects.toThrow(
      "escapes"
    );
    await file(
      repo,
      "plugins/portable/hooks/hooks.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "prompt", prompt: "allow" }] }],
        },
      })
    );
    await expect(
      loadClaudePlugin(join(repo, "plugins/portable"))
    ).rejects.toThrow("command hooks");
  });
  it("maps command hooks to deny without granting host policy and exposes bundled MCP", async () => {
    const { cwd, home, repo } = await fixture();
    const root = join(repo, "plugins/portable");
    await file(
      root,
      "deny.cjs",
      `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'fixture guard'}}));});`
    );
    await file(
      root,
      "hooks/hooks.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command: 'node "${CLAUDE_PLUGIN_ROOT}/deny.cjs"',
                },
              ],
            },
          ],
        },
      })
    );
    await file(
      root,
      ".mcp.json",
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: "node",
            args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
          },
        },
      })
    );
    const app = await buildApp({
      cwd,
      env: { HOME: home },
      provider: new ScriptedProvider([]),
      pluginDirs: [root],
    });
    apps.push(app);
    expect(app.pluginErrors).toEqual([]);
    const core = app.createCore(async () => true);
    const result = await core.invokeTool("write", {
      path: "test.txt",
      content: "bad",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("fixture guard");
    expect(await app.storage.config("mcp.json")).toMatchObject({
      mcpServers: { "portable-fixture": { command: "node" } },
    });
  });
  it("installs native API imports outside the host tree and isolates project installs", async () => {
    const { cwd, home, repo } = await fixture();
    const root = join(repo, "plugins/native-example");
    await file(
      root,
      "plugin.json",
      JSON.stringify({
        name: "native-example",
        version: "1.0.0",
        trust: "trusted",
      })
    );
    await file(
      root,
      "hooks.ts",
      "import {storagePaths} from '@agent-compositor/config'; export default {'session.start':async (_e,$)=>{$.state.set('identity',storagePaths($.session.cwd).id);}};"
    );
    await file(
      repo,
      ".claude-plugin/marketplace.json",
      JSON.stringify({
        name: "sample-market",
        owner: { name: "Example" },
        plugins: [
          { name: "native-example", source: "./plugins/native-example" },
          { name: "portable", source: "./plugins/portable" },
        ],
      })
    );
    const app = await buildApp({
      cwd,
      env: { HOME: home },
      provider: new ScriptedProvider([]),
    });
    apps.push(app);
    const core = app.createCore(async () => true);
    expect(
      (
        await core.invokeTool("marketplace_control", {
          action: "add",
          source: repo,
        })
      ).ok
    ).toBe(true);
    expect(
      (
        await core.invokeTool("extension_control", {
          action: "install",
          name: "native-example@sample-market",
        })
      ).ok
    ).toBe(true);
    await app.reloadPlugins(core);
    expect(app.pluginErrors).toEqual([]);
    expect(app.plugins.some((p) => p.manifest.name === "native-example")).toBe(
      true
    );
    expect(
      (
        await core.invokeTool("extension_control", {
          action: "install",
          name: "portable@sample-market",
          scope: "project",
        })
      ).ok
    ).toBe(true);
    const other = await temp(),
      next = await buildApp({
        cwd: other,
        env: { HOME: home },
        provider: new ScriptedProvider([]),
      });
    apps.push(next);
    expect(next.plugins.some((p) => p.manifest.name === "native-example")).toBe(
      true
    );
    expect(next.plugins.some((p) => p.manifest.name === "portable")).toBe(
      false
    );
  });
});
