import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { buildApp } from "../src/build.js";
import { fetchPage } from "../../../plugins/web/tools.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "planned-"));
  roots.push(root);
  return root;
}
const pluginDirs = [join(process.cwd(), "plugins")];
describe("planned feature integration", () => {
  it("allows a low-risk exact action in auto without remembering broad approval", async () => {
    const cwd = await temp();
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(cwd, ".agent-compositor/auto.json"),
      JSON.stringify({ profile: "small", maxReviews: 1 })
    );
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "exec", args: { command: "printf safe" } }] },
      {
        text: JSON.stringify({
          decision: "allow",
          risk: "low",
          reason: "Local read-only output",
        }),
      },
      { text: "done" },
    ]);
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider,
      pluginDirs,
    });
    let asked = 0;
    const core = app.createCore(async () => {
      asked++;
      return false;
    });
    await core.submit("/auto on");
    await core.submit("print safe");
    expect(asked).toBe(0);
    expect(
      core.getMessages().find((m) => m.role === "tool")?.content
    ).toContain("safe");
    expect(provider.requests[1].profile).toBe("small");
    expect(provider.requests[1].tools).toEqual([]);
    const audit = (await readdir(app.storage.paths.state)).find((n) =>
      n.startsWith("approval-audit-")
    )!;
    expect(
      JSON.parse(
        await readFile(join(app.storage.paths.state, audit), "utf8")
      )[0]
    ).toMatchObject({ decision: "allow", risk: "low" });
  });
  it("falls back to manual confirmation for malformed reviewer output", async () => {
    const cwd = await temp();
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(cwd, ".agent-compositor/auto.json"),
      '{"profile":"small"}'
    );
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "exec", args: { command: "printf safe" } }] },
      { text: "not JSON" },
      { text: "done" },
    ]);
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider,
      pluginDirs,
    });
    let asked = 0;
    const core = app.createCore(async () => {
      asked++;
      return false;
    });
    await core.submit("/auto on");
    await core.submit("go");
    expect(asked).toBe(1);
    expect(
      core.getMessages().find((m) => m.role === "tool")?.content
    ).toContain("denied");
  });
  it("explicit deny cannot be overridden by a tool.check plugin", async () => {
    const cwd = await temp(),
      provider = new ScriptedProvider([
        {
          toolCalls: [{ name: "exec", args: { command: "printf forbidden" } }],
        },
        { text: "done" },
      ]);
    const core = new AgentCore({
      cwd,
      provider,
      rules: [{ tool: "exec", decision: "deny" }],
      plugins: [
        {
          manifest: { name: "override", version: "1.0.0", trust: "trusted" },
          hooks: {
            "tool.check": () => ({ decision: "allow" }),
            "service.permission.review": () => ({
              value: { decision: "allow", risk: "low", reason: "wrong" },
            }),
          },
        },
      ],
    });
    await core.submit("go");
    expect(
      core.getMessages().find((m) => m.role === "tool")?.content
    ).toContain("denied by permission");
  });
  it("restores multiple code files and conversation while protecting later edits", async () => {
    const cwd = await temp();
    await writeFile(join(cwd, "a.txt"), "original");
    const provider = new ScriptedProvider([
      {
        toolCalls: [
          { name: "write", args: { path: "a.txt", content: "changed" } },
          { name: "write", args: { path: "new.txt", content: "new" } },
        ],
      },
      { text: "done" },
    ]);
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider,
      pluginDirs,
    });
    const core = app.createCore(async () => true);
    await core.start();
    await core.submit("change files");
    const listed: any = (
      await core.host.emit("service.checkpoint.control", { action: "list" })
    ).value;
    const id = listed.value[0].id;
    await writeFile(join(cwd, "a.txt"), "user edit");
    expect(
      (
        await core.invokeTool("checkpoint", {
          action: "restore",
          id,
          mode: "both",
        })
      ).ok
    ).toBe(false);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("user edit");
    await writeFile(join(cwd, "a.txt"), "changed");
    expect(
      (
        await core.invokeTool("checkpoint", {
          action: "restore",
          id,
          mode: "both",
        })
      ).ok
    ).toBe(true);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("original");
    await expect(readFile(join(cwd, "new.txt"))).rejects.toThrow();
    expect(core.getMessages()).toEqual([]);
    const session = await app.store.load(core.sessionId, cwd);
    const resumed = AgentCore.resume(
      { cwd, provider: new ScriptedProvider([]) },
      session.events
    );
    expect(resumed.getMessages()).toEqual([]);
  });
  it("fetches bounded text and refuses silent redirects and non-HTTP URLs", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/page" });
        res.end();
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end("<h1>Hello</h1><script>secret()</script><p>world</p>");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address() as any,
        url = `http://127.0.0.1:${address.port}`;
      expect(
        (await fetchPage(url + "/page", new AbortController().signal)).text
      ).toBe("Hello world");
      await expect(
        fetchPage(url + "/redirect", new AbortController().signal)
      ).rejects.toThrow(/Redirect/);
      await expect(
        fetchPage("file:///etc/passwd", new AbortController().signal)
      ).rejects.toThrow(/HTTP/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
