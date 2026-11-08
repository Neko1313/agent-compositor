import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { ScriptedProvider } from "@agent-compositor/core";
import { runRepl } from "@agent-compositor/cli";
import { buildApp } from "../src/build.js";
import slashCommands from "../../../plugins/slash-commands/hooks.js";
import memory from "../../../plugins/memory/hooks.js";
import guardSecrets from "../../../plugins/guard-secrets/hooks.js";
import guardScope from "../../../plugins/guard-scope/hooks.js";
import turnLog from "../../../plugins/turn-log/hooks.js";

const REPO_PLUGINS = path.resolve(__dirname, "../../../plugins");

/** fake $ API over a tmp dir: fs backed by disk, notify/state captured */
async function fake$(tmp: string) {
  const notifications: { message: string; level: string }[] = [];
  const state = new Map<string, unknown>();
  return {
    notifications,
    $: {
      plugin: "test",
      session: { id: "test-session", cwd: tmp },
      state: {
        get: (k: string) => state.get(k),
        set: (k: string, v: unknown) => void state.set(k, v),
        delete: (k: string) => state.delete(k),
        keys: () => [...state.keys()],
      },
      fs: {
        read: (p: string) => fs.readFile(path.resolve(tmp, p), "utf8"),
        write: (p: string, content: string) =>
          fs.mkdir(path.dirname(path.resolve(tmp, p)), { recursive: true }).then(() => fs.writeFile(path.resolve(tmp, p), content)),
      },
      ui: {
        notify: async (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
    },
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-defaults-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("default market: unit", () => {
  it("slash-commands: /help is dropped and answered via notify; plain prompts pass", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = slashCommands as Record<string, (e: unknown, $: unknown) => Promise<unknown>>;
    const drop = await hooks["prompt.submit"]({ text: "/help" }, $);
    expect(drop).toEqual({ drop: expect.any(String) });
    expect(notifications.at(-1)!.message).toContain("/status");
    expect(await hooks["prompt.submit"]({ text: "real question" }, $)).toBeUndefined();
    await hooks["turn.start"]({}, $);
    const status = await hooks["prompt.submit"]({ text: "/status" }, $);
    expect(status).toEqual({ drop: expect.any(String) });
    expect(notifications.at(-1)!.message).toContain("turns 1");
  });

  it("memory: # appends to COMPOSITOR.md; next prompt gets a memory header", async () => {
    const { $ } = await fake$(tmp);
    const hooks = memory as Record<string, (e: unknown, $: unknown) => Promise<unknown>>;
    expect(await hooks["prompt.submit"]({ text: "# prefer pnpm" }, $)).toEqual({ drop: expect.any(String) });
    expect(await fs.readFile(path.join(tmp, "COMPOSITOR.md"), "utf8")).toContain("prefer pnpm");

    const rewritten = (await hooks["prompt.submit"]({ text: "install deps" }, $)) as { text: string };
    expect(rewritten.text).toContain("<memory>");
    expect(rewritten.text).toContain("prefer pnpm");
    expect(rewritten.text.endsWith("install deps")).toBe(true);
  });

  it("memory: prompts pass untouched when no memory file exists", async () => {
    const { $ } = await fake$(tmp);
    const hooks = memory as Record<string, (e: unknown, $: unknown) => Promise<unknown>>;
    expect(await hooks["prompt.submit"]({ text: "hello" }, $)).toBeUndefined();
  });

  it("guard-secrets: AWS key in prompt drops the turn; in tool args denies the call", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = guardSecrets as Record<string, (e: unknown, $: unknown) => Promise<unknown>>;
    expect(await hooks["prompt.submit"]({ text: "my key is AKIAIOSFODNN7EXAMPLE ok?" }, $)).toEqual({ drop: expect.any(String) });
    expect(notifications.at(-1)!.level).toBe("error");
    expect(await hooks["prompt.submit"]({ text: "innocent" }, $)).toBeUndefined();

    const denied = await hooks["tool.call"]({ tool: "exec", input: { command: ["echo", "ghp_" + "a".repeat(40)] } }, $);
    expect(denied).toMatchObject({ deny: expect.stringContaining("GitHub token") });
  });

  it("guard-scope: write outside cwd is denied, inside passes", async () => {
    const hooks = guardScope as Record<string, (e: unknown) => Promise<unknown>>;
    const deny = await hooks["tool.check"]({ tool: "write", input: { path: "../../etc/passwd" } });
    expect(deny).toMatchObject({ decision: "deny" });
    expect(await hooks["tool.check"]({ tool: "write", input: { path: "src/index.ts" } })).toBeUndefined();
    expect(await hooks["tool.check"]({ tool: "exec", input: { command: ["ls"] } })).toBeUndefined();
  });

  it("turn-log: completes append JSONL lines", async () => {
    const { $ } = await fake$(tmp);
    const hooks = turnLog as Record<string, (e: unknown, $: unknown) => Promise<unknown>>;
    await hooks["prompt.submit"]({ text: "do the thing" }, $);
    await hooks["turn.complete"]({}, $);
    const log = await fs.readFile(path.join(tmp, ".agent-compositor/turn-log.jsonl"), "utf8");
    const line = JSON.parse(log.trim());
    expect(line).toMatchObject({ session: "test-session", prompt: "do the thing", ok: true });
  });
});

describe("default market: end-to-end through the assembled app", () => {
  it("/help burns no model call; secret prompt is dropped; memory note persists", async () => {
    const provider = new ScriptedProvider([{ text: "unused" }]);
    const app = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider, pluginDirs: [REPO_PLUGINS] });
    expect(app.plugins.map((p) => p.manifest.name).sort()).toEqual([
      "guard-scope",
      "guard-secrets",
      "memory",
      "notify-done",
      "slash-commands",
      "turn-log",
    ]);

    const outText: string[] = [];
    const stdout = new Writable({ write(c, _e, cb) { outText.push((c as Buffer).toString()); cb(); } });
    const stdin = new Readable({
      read() {
        this.push("/help\r");
        this.push("# prefers vitest\r");
        this.push("AKIAIOSFODNN7EXAMPLE\r");
        this.push(null);
      },
    });
    await runRepl({ createCore: app.createCore, stdin: stdin as never, stdout: stdout as never });

    expect(provider.requests).toHaveLength(0); // every prompt consumed by plugins, zero model round-trips
    await expect(fs.readFile(path.join(tmp, "COMPOSITOR.md"), "utf8")).resolves.toContain("prefers vitest");
  });
});
