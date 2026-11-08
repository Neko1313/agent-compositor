import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Writable, Readable } from "node:stream";
import { ScriptedProvider } from "@agent-compositor/core";
import { runRepl } from "@agent-compositor/cli";
import { buildApp } from "../src/build.js";
import { main } from "../src/main.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-app-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makePlugin(dir: string, name: string, hooksSrc: string) {
  const pluginDir = path.join(dir, name);
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, "plugin.json"), JSON.stringify({ name, version: "1.0.0", trust: "trusted" }));
  await fs.writeFile(path.join(pluginDir, "hooks.ts"), hooksSrc);
}

describe("buildApp — the sway assembly", () => {
  it("loads config + disk plugins and the plugin intercepts tool.call end to end", async () => {
    await fs.writeFile(
      path.join(tmp, "agent-compositor.json"),
      JSON.stringify({ model: "test-model", plugins: ["extra-plugins"] }),
    );
    await makePlugin(
      path.join(tmp, "plugins"),
      "echoer",
      `export default {
        "tool.call": async (event) =>
          event.tool === "exec"
            ? { result: { stdout: "PLUGIN ECHO: " + (event.input.command ?? []).join(" "), exitCode: 0 } }
            : undefined,
      };`,
    );
    const provider = new ScriptedProvider([
      { text: "calling exec", toolCalls: [{ name: "exec", args: { command: ["npm", "test"] } }] },
      { text: "done" },
    ]);

    const app = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider });
    expect(app.pluginErrors).toEqual([]);
    expect(app.plugins.map((p) => p.manifest.name)).toEqual(["echoer"]);

    const outText: string[] = [];
    const stdout = new Writable({ write(c, _e, cb) { outText.push((c as Buffer).toString()); cb(); } });
    const stdin = new Readable({
      read() {
        this.push("run tests\r");
        this.push(null);
      },
    });
    await runRepl({ createCore: app.createCore, stdin: stdin as never, stdout: stdout as never });

    const all = outText.join("");
    expect(all).toContain("⚙ exec"); // call rendered
    expect(all).toContain("done");
    // the plugin's echo went to the MODEL as the tool result (silent-ok render),
    // and the builtin exec never spawned a subprocess:
    const lastRequest = provider.requests.at(-1)!;
    const toolMsg = lastRequest.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("PLUGIN ECHO");
  });

  it("resume: events replayed from the roll, second run continues the same session", async () => {
    await makePlugin(
      path.join(tmp, "plugins"),
      "noop",
      `export default { "assistant.text": async (e) => e };`,
    );
    const provider = new ScriptedProvider([{ text: "first answer" }]);
    const app = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider });
    const core = app.createCore(async () => true);
    await core.submit("hello");
    const sessionId = core.sessionId;

    // "restart": rebuild the app with --resume against the same cwd
    const provider2 = new ScriptedProvider([{ text: "second answer" }]);
    const app2 = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider: provider2, resumeSessionId: sessionId });
    expect(app2.resumedEvents.length).toBeGreaterThan(0);
    const core2 = app2.createCore(async () => true);
    expect(core2.getMessages().length).toBeGreaterThan(1); // system + user + assistant replayed
    await core2.submit("continue");
    const userMsgs = core2.getMessages().filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(2); // resumed "hello" + new "continue"
  });
});

describe("main — the compositor binary", () => {
  it("reports plugin load errors without dying, then runs the REPL", async () => {
    const badDir = path.join(tmp, "plugins", "broken");
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, "plugin.json"), "{nope");
    const provider = new ScriptedProvider([{ text: "alive" }]);
    const outText: string[] = [];
    const stdout = new Writable({ write(c, _e, cb) { outText.push((c as Buffer).toString()); cb(); } }) as never;
    const stdin = new Readable({
      read() {
        this.push("hi\r");
        this.push(null);
      },
    }) as never;

    const code = await main({
      cwd: tmp,
      env: { HOME: tmp },
      argv: ["--plugins", path.join(tmp, "plugins")],
      stdin,
      stdout,
      provider,
    });
    expect(code).toBe(0);
    const all = outText.join("");
    expect(all).toContain("plugin load errors");
    expect(all).toContain("alive");
  });

  it("unknown flag exits 2 with usage", async () => {
    const outText: string[] = [];
    const stdout = new Writable({ write(c, _e, cb) { outText.push((c as Buffer).toString()); cb(); } }) as never;
    const code = await main({ cwd: tmp, env: { HOME: tmp }, argv: ["--frobnicate"], stdout });
    expect(code).toBe(2);
    expect(outText.join("")).toContain("usage:");
  });
});
