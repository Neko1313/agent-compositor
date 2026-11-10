import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { ScriptedProvider } from "@agent-compositor/core";
import { runRepl } from "@agent-compositor/cli";
import {buildAppWithPlugins as buildApp} from "./plugin-fixture.js";
import slashCommands from "../../../plugins/slash-commands/hooks.js";
import memory from "../../../plugins/memory/hooks.js";
import guardSecrets from "../../../plugins/guard-secrets/hooks.js";
import guardScope from "../../../plugins/guard-scope/hooks.js";
import turnLog from "../../../plugins/turn-log/hooks.js";
import cost from "../../../plugins/cost/hooks.js";
import planMode from "../../../plugins/plan-mode/hooks.js";
import todosPlugin from "../../../plugins/todos/hooks.js";
import checkpoints from "../../../plugins/checkpoints/hooks.js";
import btw from "../../../plugins/btw/hooks.js";
import exportPlugin from "../../../plugins/export/hooks.js";
import doctor from "../../../plugins/doctor/hooks.js";
import outputStyle from "../../../plugins/output-style/hooks.js";
import sessionCtl from "../../../plugins/session-ctl/hooks.js";

const REPO_PLUGINS = path.resolve(__dirname, "../../../plugins");

/** fake $ API over a tmp dir: fs backed by disk, notify/state captured */
async function fake$(tmp: string) {
  const notifications: { message: string; level: string }[] = [];
  const state = new Map<string, unknown>();
  const modelCalls: unknown[] = [];
  const agentCalls: string[] = [];
  return {
    notifications,
    modelCalls,
    agentCalls,
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
        surface: async () => {},
        notify: async (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
      emit: async () => undefined,
      model: {
        complete: async (request: unknown) => {
          modelCalls.push(request);
          return "mock model answer";
        },
      },
      agent: {
        compact: async () => void agentCalls.push("compact"),
        clear: async () => void agentCalls.push("clear"),
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
    const hooks = slashCommands as unknown as Record<string, (e: any, $: any) => any>;
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
    const hooks = memory as unknown as Record<string, (e: any, $: any) => any>;
    expect(await hooks["prompt.submit"]({ text: "# prefer pnpm" }, $)).toEqual({ drop: expect.any(String) });
    expect(await fs.readFile(path.join(tmp,"COMPOSITOR.md"), "utf8")).toContain("prefer pnpm");

    const rewritten = (await hooks["prompt.submit"]({ text: "install deps" }, $)) as { text: string };
    expect(rewritten.text).toContain("<memory>");
    expect(rewritten.text).toContain("prefer pnpm");
    expect(rewritten.text.endsWith("install deps")).toBe(true);
  });

  it("memory: prompts pass untouched when no memory file exists", async () => {
    const { $ } = await fake$(tmp);
    const hooks = memory as unknown as Record<string, (e: any, $: any) => any>;
    expect(await hooks["prompt.submit"]({ text: "hello" }, $)).toBeUndefined();
  });

  it("guard-secrets: AWS key in prompt drops the turn; in tool args denies the call", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = guardSecrets as unknown as Record<string, (e: any, $: any) => any>;
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
    const hooks = turnLog as unknown as Record<string, (e: any, $: any) => any>;
    await hooks["prompt.submit"]({ text: "do the thing" }, $);
    await hooks["turn.complete"]({}, $);
    const log = await fs.readFile(path.join(tmp, ".agent-compositor/turn-log.jsonl"), "utf8");
    const line = JSON.parse(log.trim());
    expect(line).toMatchObject({ session: "test-session", prompt: "do the thing", ok: true });
  });

  it("cost: turn.usage tallies; /cost reports without a model call", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = cost as unknown as Record<string, (e: any, $: any) => any>;
    await hooks["turn.usage"]({ turnId: "t1", inputTokens: 100, outputTokens: 40 }, $);
    await hooks["turn.usage"]({ turnId: "t2", inputTokens: 50, outputTokens: 10 }, $);
    const drop = await hooks["prompt.submit"]({ text: "/cost" }, $);
    expect(drop).toEqual({ drop: expect.any(String) });
    expect(notifications.at(-1)!.message).toContain("150 input");
    expect(notifications.at(-1)!.message).toContain("2 turns");
    expect(await hooks["prompt.submit"]({ text: "real work" }, $)).toBeUndefined();
  });

  it("plan-mode: /plan toggles; writes denied while planning; prompts get a reminder", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = planMode as unknown as Record<string, (e: any, $: any) => any>;
    expect(await hooks["prompt.submit"]({ text: "/plan" }, $)).toEqual({ drop: expect.any(String) });
    expect(notifications.at(-1)!.message).toContain("ON");

    const denied = await hooks["tool.check"]({ tool: "write", input: { path: "x" } }, $);
    expect(denied).toMatchObject({ decision: "deny" });
    expect(await hooks["tool.check"]({ tool: "read", input: { path: "x" } }, $)).toBeUndefined();

    const rewritten = (await hooks["prompt.submit"]({ text: "sketch the refactor" }, $)) as { text: string };
    expect(rewritten.text).toContain("[plan mode is ON");

    await hooks["prompt.submit"]({ text: "/plan" }, $); // off again
    expect(await hooks["tool.check"]({ tool: "write", input: { path: "x" } }, $)).toBeUndefined();
    expect(await hooks["prompt.submit"]({ text: "now do it" }, $)).toBeUndefined();
  });

  it("todos: todo tool results persist to .agent-compositor/todos.json", async () => {
    const { $ } = await fake$(tmp);
    const hooks = todosPlugin as unknown as Record<string, (e: any, $: any) => any>;
    await hooks["tool.result"]({ tool: "todo", ok: true, output: { todos: [{ content: "ship it", status: "in_progress" }] } }, $);
    const saved = JSON.parse(await fs.readFile(path.join(tmp, ".agent-compositor/todos.json"), "utf8"));
    expect(saved).toEqual([{ content: "ship it", status: "in_progress" }]);
  });

  it("checkpoints: pre-write snapshot; /rewind restores the previous content", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = checkpoints as unknown as Record<string, (e: any, $: any) => any>;
    await fs.writeFile(path.join(tmp, "app.ts"), "original");
    await hooks["tool.call"]({ tool: "write", input: { path: "app.ts" } }, $);
    await fs.writeFile(path.join(tmp, "app.ts"), "mutated");
    const drop = await hooks["prompt.submit"]({ text: "/rewind" }, $);
    expect(drop).toEqual({ drop: expect.any(String) });
    expect(await fs.readFile(path.join(tmp, "app.ts"), "utf8")).toBe("original");
    expect(notifications.at(-1)!.message).toContain("restored");

    // journal drained: second /rewind finds nothing
    await hooks["prompt.submit"]({ text: "/rewind" }, $);
    expect(notifications.at(-1)!.level).toBe("warn");
  });

  it("checkpoints: new files (no previous content) snapshot nothing", async () => {
    const { $ } = await fake$(tmp);
    const hooks = checkpoints as unknown as Record<string, (e: any, $: any) => any>;
    await hooks["tool.call"]({ tool: "write", input: { path: "fresh.ts" } }, $);
    await expect(fs.readFile(path.join(tmp, ".agent-compositor/checkpoints.json"), "utf8")).rejects.toThrow();
  });

  it("btw: side question is answered off-conversation via $.model.complete", async () => {
    const { $, notifications, modelCalls } = await fake$(tmp);
    const hooks = btw as unknown as Record<string, (e: any, $: any) => any>;
    const drop = await hooks["prompt.submit"]({ text: "/btw what is 2+2" }, $);
    expect(drop).toEqual({ drop: expect.any(String) });
    expect(modelCalls).toHaveLength(1);
    expect(notifications.at(-1)!.message).toBe("mock model answer");
  });

  it("export: /export writes the captured transcript to markdown", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = exportPlugin as unknown as Record<string, (e: any, $: any) => any>;
    await hooks["prompt.submit"]({ text: "first question" }, $);
    await hooks["assistant.text"]({ turnId: "t1", text: "partial " }, $);
    await hooks["assistant.text"]({ turnId: "t1", text: "answer" }, $);
    const drop = await hooks["prompt.submit"]({ text: "/export" }, $);
    expect(drop).toEqual({ drop: expect.any(String) });
    const md = await fs.readFile(path.join(tmp, ".agent-compositor/session-test-session.md"), "utf8");
    expect(md).toContain("first question");
    expect(md).toContain("partial answer");
    expect(notifications.at(-1)!.message).toContain("export:");
  });

  it("doctor: /doctor reports env vars and the provider ping", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = doctor as unknown as Record<string, (e: any, $: any) => any>;
    const drop = await hooks["prompt.submit"]({ text: "/doctor" }, $);
    expect(drop).toEqual({ drop: expect.any(String) });
    const report = notifications.at(-1)!.message;
    expect(report).toContain("AGENT_BASE_URL");
    expect(report).toContain("provider ping: OK");
  });

  it("output-style: /style terse strips filler openers from assistant deltas", async () => {
    const { $, notifications } = await fake$(tmp);
    const hooks = outputStyle as unknown as Record<string, (e: any, $: any) => any>;
    expect(await hooks["assistant.text"]({ turnId: "t", text: "Sure! Here it is" }, $)).toBeUndefined(); // off by default
    await hooks["prompt.submit"]({ text: "/style terse" }, $);
    expect(notifications.at(-1)!.message).toContain("terse");
    const rewritten = await hooks["assistant.text"]({ turnId: "t", text: "Sure! Here it is" }, $);
    expect(rewritten).toEqual({ text: "Here it is" });
    expect(await hooks["assistant.text"]({ turnId: "t", text: "plain delta" }, $)).toBeUndefined();
  });

  it("session-ctl: /compact and /clear call $.agent without touching the model", async () => {
    const { $, notifications, agentCalls } = await fake$(tmp);
    const hooks = sessionCtl as unknown as Record<string, (e: any, $: any) => any>;
    expect(await hooks["prompt.submit"]({ text: "/compact" }, $)).toEqual({ drop: expect.any(String) });
    expect(await hooks["prompt.submit"]({ text: "/clear" }, $)).toEqual({ drop: expect.any(String) });
    expect(await hooks["prompt.submit"]({ text: "normal prompt" }, $)).toBeUndefined();
    expect(agentCalls).toEqual(["compact", "clear"]);
    expect(notifications.at(-1)!.message).toContain("cleared");
  });
});

describe("default market: end-to-end through the assembled app", () => {
  it("explicitly opted-in first-party plugins load with valid manifests", async () => {
    const provider = new ScriptedProvider([{ text: "unused" }]);
    const app = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider, pluginDirs: [REPO_PLUGINS] });
    expect(app.pluginErrors).toEqual([]);
    expect(app.plugins.map((p) => p.manifest.name).sort()).toEqual([
      "auto-approve",
      "btw",
      "callix",
      "checkpoint-history",
      "checkpoints",
      "cost",
      "doctor",
      "export",
      "guard-scope",
      "guard-secrets",
      "mascot",
      "mcp",
      "memory",
      "monty",
      "network-proxy",
      "notify-done",
      "output-style",
      "plan-mode",
      "plugin-author",
      "session-ctl",
      "slash-commands",
      "todos",
      "turn-log",
      "ui-theme",
      "web",
      "workflows",
    ]);
  });

  it("/help burns no model call; secret prompt is dropped; memory note persists", async () => {
    const provider = new ScriptedProvider([{ text: "unused" }]);
    const app = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider, pluginDirs: [REPO_PLUGINS] });

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
    await expect(fs.readFile(path.join(app.storage.paths.state, "memory.md"), "utf8")).resolves.toContain("prefers vitest");
  });

  it("real turn emits usage; /cost reports it; /export dumps the transcript — all without extra model calls", async () => {
    const provider = new ScriptedProvider([{ text: "Sure! done", usage: { inputTokens: 100, outputTokens: 40 } }]);
    const app = await buildApp({ cwd: tmp, env: { HOME: tmp }, provider, pluginDirs: [REPO_PLUGINS] });

    const outText: string[] = [];
    const stdout = new Writable({ write(c, _e, cb) { outText.push((c as Buffer).toString()); cb(); } });
    const stdin = new Readable({
      read() {
        this.push("do the thing\r");
        this.push("/cost\r");
        this.push("/export\r");
        this.push(null);
      },
    });
    await runRepl({ createCore: app.createCore, stdin: stdin as never, stdout: stdout as never });

    expect(provider.requests).toHaveLength(1); // one real turn; both commands answered from plugin state
    const md = await fs.readdir(app.storage.paths.state);
    expect(md.find((f) => f.startsWith("session-") && f.endsWith(".md"))).toBeTruthy();
    const transcript = await fs.readFile(
      path.join(app.storage.paths.state, md.find((f) => f.startsWith("session-"))!),
      "utf8",
    );
    expect(transcript).toContain("do the thing");
    expect(transcript).toContain("done");
    // notifications don't render into a raw Writable; unit tests cover the /cost report text
    expect(outText.join("")).toContain("done");
  });
});
