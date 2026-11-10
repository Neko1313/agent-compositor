import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import type { ChatMessage, LoopEvent } from "@agent-compositor/core";
import {buildAppWithPlugins as buildApp} from "./plugin-fixture.js";
import { __mcpShutdown } from "../../../plugins/mcp/tools.js";

const REPO_PLUGINS = path.resolve(__dirname, "../../../plugins");

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-wave2-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.AGENT_MCP_CONFIG;
  __mcpShutdown();
});

function lastToolMessage(core: AgentCore): string {
  const messages = core.getMessages() as ChatMessage[];
  const tool = [...messages].reverse().find((m) => m.role === "tool");
  expect(tool).toBeTruthy();
  return tool!.content;
}

describe("wave 2: subagents (task tool)", () => {
  it("spawns a child core, feeds its report back, emits start/complete", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "task", args: { prompt: "summarize the repo" } }] },
      { text: "child report: everything is fine" },
      { text: "parent done" },
    ]);
    const events: LoopEvent[] = [];
    const core = new AgentCore({ cwd: tmp, provider });
    core.subscribe((ev) => events.push(ev));

    await core.submit("delegate the summary");

    expect(provider.requests).toHaveLength(3); // parent call, child turn, parent follow-up
    const start = events.find(
      (e) => e.kind === "catalog" && e.event === "subagent.start"
    );
    const complete = events.find(
      (e) => e.kind === "catalog" && e.event === "subagent.complete"
    );
    expect(start).toMatchObject({
      input: { prompt: "summarize the repo", depth: 0 },
    });
    expect(complete).toMatchObject({
      input: { ok: true, output: "child report: everything is fine" },
    });
    const result = JSON.parse(lastToolMessage(core));
    expect(result).toMatchObject({
      output: "child report: everything is fine",
    });
    expect(result.agentId).toBe(
      (complete as unknown as { input: { agentId: string } }).input.agentId
    );
  });

  it("child failure is an error value, the parent turn survives", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "task", args: { prompt: "explode" } }] },
      { finish: "error", error: "child model blew up" },
      { text: "recovered without it" },
    ]);
    const core = new AgentCore({ cwd: tmp, provider });
    await core.submit("try the risky delegation");

    const result = lastToolMessage(core);
    expect(result).toContain("child model blew up");
    expect(provider.requests).toHaveLength(3); // parent recovered and finished
    const messages = core.getMessages() as ChatMessage[];
    expect(messages.at(-1)?.role).toBe("assistant");
  });

  it("recursion is depth-guarded: depth 0 allows one level, denies deeper", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "task", args: { prompt: "outer" } }] },
      { toolCalls: [{ name: "task", args: { prompt: "inner" } }] },
      { text: "innermost report" },
      { text: "outer report" },
    ]);
    const core = new AgentCore({ cwd: tmp, provider, maxSubagentDepth: 1 });
    await core.submit("nested delegation");

    // depth 0 → spawn ok; the child (depth 1) is denied by the guard, gets an
    // error value, recovers, and its report still comes back to the parent
    const outerResult = JSON.parse(lastToolMessage(core));
    expect(outerResult.output).toBe("innermost report");
    expect(outerResult.agentId).toBeTruthy();
    expect(provider.requests).toHaveLength(4);
  });

  it("missing prompt is a validation error value", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "task", args: {} }] },
      { text: "ok" },
    ]);
    const core = new AgentCore({ cwd: tmp, provider });
    await core.submit("bad call");
    expect(lastToolMessage(core)).toContain("prompt is required");
  });
});

describe("wave 2: ask_user (AskUserQuestion)", () => {
  it("headless (no onAsk) denies with a fail-closed error value", async () => {
    const provider = new ScriptedProvider([
      {
        toolCalls: [
          {
            name: "ask_user",
            args: { question: "pick a color", options: ["red", "blue"] },
          },
        ],
      },
      { text: "no answer then" },
    ]);
    const core = new AgentCore({ cwd: tmp, provider });
    await core.submit("ask something");

    expect(lastToolMessage(core)).toContain("headless");
    expect(provider.requests).toHaveLength(2);
  });

  it("onAsk answers; single-select resolves to the picked option", async () => {
    const asked: { question: string; options?: string[]; multi?: boolean }[] =
      [];
    const provider = new ScriptedProvider([
      {
        toolCalls: [
          {
            name: "ask_user",
            args: { question: "deploy where?", options: ["staging", "prod"] },
          },
        ],
      },
      { text: "deploying" },
    ]);
    const core = new AgentCore({
      cwd: tmp,
      provider,
      onAsk: async (req) => {
        asked.push(req);
        return "prod";
      },
    });
    await core.submit("ask the user");

    expect(asked).toEqual([
      {
        question: "deploy where?",
        options: ["staging", "prod"],
        multi: false,
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(JSON.parse(lastToolMessage(core))).toEqual({ answer: "prod" });
  });

  it("multi-select can return an array", async () => {
    const provider = new ScriptedProvider([
      {
        toolCalls: [
          {
            name: "ask_user",
            args: {
              question: "which ones?",
              options: ["a", "b", "c"],
              multi: true,
            },
          },
        ],
      },
      { text: "got it" },
    ]);
    const core = new AgentCore({
      cwd: tmp,
      provider,
      onAsk: async () => ["a", "c"],
    });
    await core.submit("multi ask");
    expect(JSON.parse(lastToolMessage(core))).toEqual({ answer: ["a", "c"] });
  });
});

describe("wave 2: plugin tools.ts (loader → extraTools)", () => {
  it("a tools-only plugin loads and its tool executes in the loop", async () => {
    const dir = path.join(tmp, "market", "echoer");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "echoer",
        version: "1.0.0",
        description: "echo tool",
        trust: "trusted",
        capabilities: ["tool"],
      })
    );
    await fs.writeFile(
      path.join(dir, "tools.ts"),
      [
        "const echoTool = {",
        '  name: "echo",',
        '  description: "echo text back",',
        '  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },',
        '  describe: () => ({ tool: "echo" }),',
        "  async execute(_ctx: unknown, args: { text?: string }) {",
        '    if (!args.text) return { ok: false, error: "echo: text is required" };',
        "    return { ok: true, data: { text: `echo: ${args.text}` } };",
        "  },",
        "};",
        "export default [echoTool];",
      ].join("\n")
    );

    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "echo", args: { text: "hi" } }] },
      { text: "heard the echo" },
    ]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider,
      pluginDirs: [path.join(tmp, "market")],
    });
    expect(app.pluginErrors).toEqual([]);
    expect(app.plugins.map((p) => p.manifest.name)).toEqual(["echoer"]);

    const core = app.createCore(() => Promise.resolve(true));
    await core.submit("use the plugin tool");

    expect(JSON.parse(lastToolMessage(core))).toEqual({ text: "echo: hi" });
    expect(provider.requests).toHaveLength(2);
  });

  it("malformed tools.ts lands in pluginErrors, app still builds", async () => {
    const dir = path.join(tmp, "market", "broken");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "broken",
        version: "1.0.0",
        description: "bad",
        trust: "trusted",
        capabilities: [],
      })
    );
    await fs.writeFile(
      path.join(dir, "tools.ts"),
      "export default [{ name: 42 }];\n"
    );

    const provider = new ScriptedProvider([{ text: "unused" }]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider,
      pluginDirs: [path.join(tmp, "market")],
    });
    expect(app.plugins).toEqual([]);
    expect(app.pluginErrors).toHaveLength(1);
    expect(app.pluginErrors[0].dir).toContain("broken");
    expect(app.pluginErrors[0].error).toContain("missing name");
  });
});

describe("wave 2: workflows plugin (run + replay)", () => {
  const CODE =
    'a = await task("count the files")\nb = await task("count the lines")\na + b';

  it("replays only completed steps after a failed child", async () => {
    const first = new ScriptedProvider([
      { toolCalls: [{ name: "workflow", args: { code: CODE } }] },
      { text: "3" },
      { finish: "error", error: "try again" },
      { text: "failed safely" },
    ]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider: first,
      pluginDirs: [REPO_PLUGINS],
    });
    await app.createCore(async () => true).submit("first");
    const second = new ScriptedProvider([
      { toolCalls: [{ name: "workflow", args: { code: CODE } }] },
      { text: "7" },
      { text: "done" },
    ]);
    const retry = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider: second,
      pluginDirs: [REPO_PLUGINS],
    });
    const core = retry.createCore(async () => true);
    await core.submit("retry");
    expect(second.requests).toHaveLength(3);
    expect(JSON.parse(lastToolMessage(core))).toMatchObject({
      output: "37",
      steps: 2,
      replayed: 1,
      ran: 1,
    });
  });

  it("runs subagents per task() call and returns the workflow's value", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "workflow", args: { code: CODE } }] },
      { text: "3" },
      { text: "7" },
      { text: "workflow finished" },
    ]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider,
      pluginDirs: [REPO_PLUGINS],
    });
    const core = app.createCore(() => Promise.resolve(true));
    await core.submit("run the workflow");

    expect(provider.requests).toHaveLength(4);
    const result = JSON.parse(lastToolMessage(core));
    expect(result.output).toBe("37");
    expect(result).toMatchObject({ steps: 2, replayed: 0, ran: 2 });

    const journalDir = path.join(app.storage.paths.state, "workflows");
    const journals = await fs.readdir(journalDir);
    expect(journals).toHaveLength(1);
    const journal = JSON.parse(
      await fs.readFile(
        path.join(journalDir, journals[0], "journal.json"),
        "utf8"
      )
    );
    expect(journal).toHaveLength(2);
    expect(journal[0]).toMatchObject({
      prompt: "count the files",
      result: "3",
    });
  });

  it("identical re-run replays the journal without touching the model", async () => {
    const runProvider = new ScriptedProvider([
      { toolCalls: [{ name: "workflow", args: { code: CODE } }] },
      { text: "3" },
      { text: "7" },
      { text: "done" },
    ]);
    const runApp = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider: runProvider,
      pluginDirs: [REPO_PLUGINS],
    });
    await runApp.createCore(() => Promise.resolve(true)).submit("first run");
    expect(runProvider.requests).toHaveLength(4);

    const replayProvider = new ScriptedProvider([
      { toolCalls: [{ name: "workflow", args: { code: CODE } }] },
      { text: "done" },
    ]);
    const replayApp = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider: replayProvider,
      pluginDirs: [REPO_PLUGINS],
    });
    const replayCore = replayApp.createCore(() => Promise.resolve(true));
    await replayCore.submit("second run");

    expect(replayProvider.requests).toHaveLength(2); // workflow call + parent wrap-up; zero subagent turns
    const result = JSON.parse(lastToolMessage(replayCore));
    expect(result).toMatchObject({
      output: "37",
      steps: 2,
      replayed: 2,
      ran: 0,
    });
  });

  it("structural change (different code) re-runs from scratch", async () => {
    const otherCode = 'a = await task("count the files")\na + "!"';
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "workflow", args: { code: otherCode } }] },
      { text: "3" },
      { text: "done" },
    ]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider,
      pluginDirs: [REPO_PLUGINS],
    });
    const core = app.createCore(() => Promise.resolve(true));
    await core.submit("different workflow");
    const result = JSON.parse(lastToolMessage(core));
    expect(result).toMatchObject({
      output: "3!",
      steps: 1,
      replayed: 0,
      ran: 1,
    });
  });
});

describe("wave 2: mcp plugin (stdio MCP client)", () => {
  it("lists tools and calls one over a real stdio handshake", async () => {
    const serverPath = path.join(tmp, "fake-mcp.cjs");
    await fs.writeFile(
      serverPath,
      [
        'const readline = require("node:readline");',
        "const rl = readline.createInterface({ input: process.stdin });",
        'rl.on("line", (line) => {',
        "  let msg; try { msg = JSON.parse(line); } catch { return; }",
        '  if (msg.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0.0" } } }) + "\\n");',
        '  } else if (msg.method === "tools/list") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "greet", description: "greet someone", inputSchema: { type: "object", properties: { name: { type: "string" } } } }] } }) + "\\n");',
        '  } else if (msg.method === "tools/call") {',
        '    const name = (msg.params.arguments && msg.params.arguments.name) || "world";',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "hello " + name }] } }) + "\\n");',
        "  }",
        "});",
      ].join("\n")
    );
    process.env.AGENT_MCP_CONFIG = JSON.stringify({
      mcpServers: { fake: { command: process.execPath, args: [serverPath] } },
    });

    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "mcp_call", args: { action: "list" } }] },
      {
        toolCalls: [
          {
            name: "mcp_call",
            args: {
              action: "call",
              server: "fake",
              tool: "greet",
              arguments: { name: "nik" },
            },
          },
        ],
      },
      { text: "greeted" },
    ]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider,
      pluginDirs: [REPO_PLUGINS],
    });
    const core = app.createCore(() => Promise.resolve(true));
    await core.submit("use the mcp server");

    const messages = core.getMessages() as ChatMessage[];
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(JSON.parse(toolMessages[0].content).servers[0]).toMatchObject({
      name: "fake",
      tools: [{ name: "greet" }],
    });
    expect(JSON.parse(toolMessages[1].content).content[0].text).toBe(
      "hello nik"
    );
  });

  it("no config is a clean error value, not a crash", async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "mcp_call", args: { action: "list" } }] },
      { text: "never mind" },
    ]);
    const app = await buildApp({
      cwd: tmp,
      env: { HOME: tmp },
      provider,
      pluginDirs: [REPO_PLUGINS],
    });
    const core = app.createCore(() => Promise.resolve(true));
    await core.submit("mcp without config");
    expect(lastToolMessage(core)).toContain("no MCP config");
  });
});
