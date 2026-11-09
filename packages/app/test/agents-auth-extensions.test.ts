import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ScriptedProvider } from "@agent-compositor/core";
import { buildApp } from "../src/build.js";
import { extensionManager } from "../src/extensions.js";
const exec = promisify(execFile),
  roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "agent-features-"));
  roots.push(root);
  return root;
}
const dirs = [join(process.cwd(), "plugins")];
describe("independent agents, authentication and extensions", () => {
  it("persists separate agent conversations and restores their windows after restart", async () => {
    const cwd = await temp(),
      provider = new ScriptedProvider([
        { text: "first agent result" },
        { text: "second agent result" },
      ]);
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider,
      pluginDirs: dirs,
    });
    let initialClosed = false;
    try {
      const core = app.createCore(async () => true);
      await core.start();
      const one = await core.invokeTool("agent_control", {
        action: "create",
        name: "one",
        worktree: false,
        maxTokens: 10000,
      });
      const id1 = (one.output as any).id;
      const two = await core.invokeTool("agent_control", {
        action: "create",
        name: "two",
        worktree: false,
        maxTokens: 10000,
      });
      const id2 = (two.output as any).id;
      expect(one.ok && two.ok).toBe(true);
      expect(id1).not.toBe(id2);
      await core.invokeTool("agent_control", {
        action: "send",
        id: id1,
        prompt: "first task",
      });
      await vi.waitFor(async () => {
        const rows: any = (
          await core.host.emit("service.agent.control", { action: "list" })
        ).value;
        expect(rows.value.find((r: any) => r.id === id1).state).toBe("idle");
      }, { timeout: 10000 });
      await core.invokeTool("agent_control", {
        action: "send",
        id: id2,
        prompt: "second task",
      });
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2), { timeout: 10000 });
      await app.close();
      initialClosed = true;
      expect(
        provider.requests[1].messages.some((m) => m.content === "first task")
      ).toBe(false);
      const restart = await buildApp({
        cwd,
        env: { HOME: cwd },
        provider: new ScriptedProvider([]),
        pluginDirs: dirs,
      });
      try {
        const next = restart.createCore(async () => true);
        const views: string[] = [];
        next.subscribe((e) => {
          if (e.kind === "catalog" && e.event === "ui.surface")
            views.push(String(e.input.text));
        });
        await next.start();
        expect(views.join("\n")).toContain("first agent result");
        expect(views.join("\n")).toContain("second agent result");
      } finally {
        await restart.close();
      }
    } finally {
      if (!initialClosed) await app.close();
    }
  }, 30000);
  it("creates a real isolated Git worktree and preserves it on archive", async () => {
    const cwd = await temp();
    await exec("git", ["init", "-b", "main"], { cwd });
    await writeFile(join(cwd, "tracked.txt"), "base");
    await exec("git", ["add", "tracked.txt"], { cwd });
    await exec(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "initial",
      ],
      { cwd }
    );
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider: new ScriptedProvider([]),
      pluginDirs: dirs,
    });
    const core = app.createCore(async () => true);
    await core.start();
    const result = await core.invokeTool("agent_control", {
      action: "create",
      name: "isolated",
    });
    expect(result.ok).toBe(true);
    const record: any = result.output;
    expect(await readFile(join(record.cwd, "tracked.txt"), "utf8")).toBe(
      "base"
    );
    expect(record.branch).toMatch(/^agent\//);
    await writeFile(join(record.cwd, "tracked.txt"), "agent change");
    expect(await readFile(join(cwd, "tracked.txt"), "utf8")).toBe("base");
    expect(
      (
        await core.invokeTool("agent_control", {
          action: "archive",
          id: record.id,
        })
      ).ok
    ).toBe(true);
    expect(await readFile(join(record.cwd, "tracked.txt"), "utf8")).toBe(
      "agent change"
    );
    await app.close();
  });
  it("saves provider credentials with private permissions without putting keys in the transcript", async () => {
    const cwd = await temp(),
      key = "test-private-provider-key";
    const app = await buildApp({
      cwd,
      env: { HOME: cwd, MY_PROVIDER_KEY: key },
      provider: new ScriptedProvider([]),
    });
    const core = app.createCore(async () => false);
    await core.start();
    await core.submit("/login default MY_PROVIDER_KEY");
    const file = join(cwd, ".agent-compositor/credentials.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(core.getMessages())).not.toContain(key);
    expect(JSON.parse(await readFile(file, "utf8")).default.accessToken).toBe(
      key
    );
    await core.submit("/logout default");
    expect(JSON.parse(await readFile(file, "utf8")).default).toBeUndefined();
    await app.close();
  });
  it("installs a catalog extension at a named version and disables it before importing code", async () => {
    const cwd = await temp(),
      home = await temp(),
      repository = await temp();
    await exec("git", ["init", "-b", "main"], { cwd: repository });
    await writeFile(
      join(repository, "plugin.json"),
      '{"name":"sample","version":"1.0.0","trust":"trusted"}'
    );
    await writeFile(
      join(repository, "hooks.ts"),
      'export default {"prompt.submit":()=>undefined};'
    );
    await exec("git", ["add", "."], { cwd: repository });
    await exec(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "plugin",
      ],
      { cwd: repository }
    );
    await exec("git", ["tag", "v1"], { cwd: repository });
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(cwd, ".agent-compositor/extensions.json"),
      JSON.stringify([{ name: "sample", repository, ref: "v1" }])
    );
    const manager = await extensionManager(cwd, home);
    const ctx: any = { signal: new AbortController().signal };
    const install = await manager.tool.execute(ctx, {
      action: "install",
      name: "sample",
    });
    expect(install.ok).toBe(true);
    await manager.tool.execute(ctx, { action: "disable", name: "sample" });
    await writeFile(
      join(home, ".agent-compositor/plugins/sample/hooks.ts"),
      'throw new Error("MUST NOT IMPORT");'
    );
    const app = await buildApp({
      cwd,
      env: { HOME: home },
      provider: new ScriptedProvider([]),
    });
    expect(app.pluginErrors).toEqual([]);
    expect(app.plugins.some((p) => p.manifest.name === "sample")).toBe(false);
    await app.close();
  });
});
