import { describe, expect, it } from "vitest";
import { Runtime } from "@agent-compositor/runtime";
import { attach, type UserHookFn } from "@agent-compositor/hooks";
import { scriptedProvider, type ScriptedProvider } from "./provider.js";
import { runTurn, type ChatMessage } from "./loop.js";

function stage(provider: ScriptedProvider) {
  const runtime = new Runtime();
  const host = attach(runtime, {
    session: { id: "test", cwd: "/tmp/ac-agent-test" },
    model: provider,
  });
  const seen: string[] = [];
  const record = (name: string): UserHookFn => () => {
    seen.push(name);
  };
  host.registerPlugin(
    { name: "rec", version: "1.0.0", trust: "trusted" },
    {
      "turn.start": record("turn.start"),
      "prompt.submit": record("prompt.submit"),
      "turn.complete": record("turn.complete"),
    },
  );
  return { host, seen, provider: (provider ?? scriptedProvider([])) as ScriptedProvider };
}

const user = (content: string): ChatMessage => ({ role: "user", content });

describe("runTurn", () => {
  it("answers with plain text and fires turn.start/prompt.submit/turn.complete", async () => {
    const provider = scriptedProvider([{ text: "hello back" }]);
    const { host, seen } = stage(provider);
    const result = await runTurn({ host, prompt: user("hi") });

    expect(result.text).toBe("hello back");
    expect(seen).toEqual(["turn.start", "prompt.submit", "turn.complete"]);
    expect(provider.requests[0].messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("runs a tool call end-to-end and feeds the result back", async () => {
    const provider = scriptedProvider([
      { toolCalls: [{ name: "fs_read", input: { path: "/etc/passwd" }, callId: "c1" }] },
      { text: "done" },
    ]);
    const { host } = stage(provider);
    await runTurn({ host, prompt: user("read it") });

    expect(provider.requests).toHaveLength(2);
    const second = provider.requests[1].messages;
    expect(second.some((m) => m.role === "tool" && m.callId === "c1")).toBe(true);
    // confined fs must refuse the escape attempt
    const toolMsg = second.find((m) => m.role === "tool")!;
    expect(String(toolMsg.content)).toMatch(/escapes workspace/);
  });

  it("a plugin can answer a tool.call without executing", async () => {
    const provider = scriptedProvider([
      { toolCalls: [{ name: "fs_read", input: { path: "x" }, callId: "c1" }] },
      { text: "ok" },
    ]);
    const { host } = stage(provider);
    host.registerPlugin(
      { name: "spoof", version: "1.0.0", trust: "trusted" },
      {
        "tool.call": (event: any, $: any) => {
          if (event.tool === "fs_read") return { result: "SPOOFED" };
          return $.next();
        },
      },
    );
    await runTurn({ host, prompt: user("go") });

    const toolMessage = provider.requests[1].messages.find((m) => m.role === "tool");
    expect(String(toolMessage?.content)).toBe("SPOOFED");
  });

  it("stops at maxSteps instead of looping forever", async () => {
    const provider = scriptedProvider([
      { toolCalls: [{ name: "fs_read", input: { path: "x" }, callId: "c1" }] },
    ]);
    const { host } = stage(provider);
    const result = await runTurn({ host, prompt: user("loop"), maxSteps: 3 });
    expect(result.stopReason).toBe("max_steps");
    expect(result.steps).toBe(3);
  });
});
