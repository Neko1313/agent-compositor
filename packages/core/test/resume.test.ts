import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentCore, replayTranscript, ScriptedProvider } from "../src/index.js";
import type { SessionEvent } from "@agent-compositor/session";
import { TokenBudget } from "@agent-compositor/context";

describe("replayTranscript", () => {
  it("rebuilds a full turn: user → assistant(toolCalls) → tool result → assistant text", () => {
    const events: SessionEvent[] = [
      { type: "prompt.submit", text: "run the tests" },
      { type: "turn.start", turnId: "t1" },
      { type: "assistant.text", turnId: "t1", text: "Let me " },
      { type: "assistant.text", turnId: "t1", text: "check." },
      { type: "tool.call", tool: "exec", input: { command: "npm test" }, callId: "c1" },
      { type: "tool.result", callId: "c1", tool: "exec", ok: true, output: { stdout: "42 passed" } },
      { type: "assistant.text", turnId: "t1", text: "All green." },
      { type: "turn.complete", turnId: "t1", text: "All green." },
      { type: "prompt.submit", text: "thanks" },
      { type: "turn.start", turnId: "t2" },
      { type: "assistant.text", turnId: "t2", text: "Anytime." },
      { type: "turn.complete", turnId: "t2", text: "Anytime." },
    ];
    const messages = replayTranscript(events, "SYS");
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages[1]).toEqual({ role: "user", content: "run the tests" });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: "Let me check.",
      toolCalls: [{ id: "c1", name: "exec", args: { command: "npm test" } }],
    });
    expect(messages[3]).toMatchObject({ role: "tool", toolCallId: "c1", name: "exec" });
    expect(String(messages[3].content)).toContain("42 passed");
    expect(messages[4]).toEqual({ role: "assistant", content: "All green.", toolCalls: undefined });
    expect(messages[5]).toEqual({ role: "user", content: "thanks" });
    expect(messages[6]).toEqual({ role: "assistant", content: "Anytime.", toolCalls: undefined });
  });

  it("steer becomes a mid-turn user message", () => {
    const events: SessionEvent[] = [
      { type: "prompt.submit", text: "start" },
      { type: "assistant.text", turnId: "t", text: "a" },
      { type: "prompt.steer", text: "in French" },
      { type: "assistant.text", turnId: "t", text: "b" },
      { type: "turn.complete", turnId: "t", text: "b" },
    ];
    const messages = replayTranscript(events);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[2].content).toBe("in French");
  });

  it("context.compacted is a cut line: fold everything before it into the summary", () => {
    const events: SessionEvent[] = [
      { type: "prompt.submit", text: "old question" },
      { type: "assistant.text", turnId: "t", text: "old answer" },
      { type: "turn.complete", turnId: "t", text: "old answer" },
      { type: "context.compacted", foldedCount: 2, tokensBefore: 9000, tokensAfter: 500, summary: "we discussed auth" },
      { type: "prompt.submit", text: "new question" },
      { type: "assistant.text", turnId: "t2", text: "new answer" },
      { type: "turn.complete", turnId: "t2", text: "new answer" },
    ];
    const messages = replayTranscript(events, "SYS");
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages[1]).toMatchObject({ role: "system" });
    expect(messages[1].content).toContain("we discussed auth");
    expect(messages[2]).toEqual({ role: "user", content: "new question" });
    expect(messages).toHaveLength(4);
  });

  it("partial tail (crash mid-turn) replays without losing deltas", () => {
    const events: SessionEvent[] = [
      { type: "prompt.submit", text: "go" },
      { type: "assistant.text", turnId: "t", text: "partial " },
      { type: "assistant.text", turnId: "t", text: "thinking" },
      // no turn.complete — the process died
    ];
    const messages = replayTranscript(events);
    expect(messages.at(-1)).toEqual({ role: "assistant", content: "partial thinking", toolCalls: undefined });
  });
});

describe("AgentCore.resume + compaction in the loop", () => {
  let tmp: string;
  let cwd: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-resume-"));
    cwd = path.join(tmp, "repo");
    await fs.mkdir(cwd, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("resume() adopts the replayed transcript as its starting messages", async () => {
    const events: SessionEvent[] = [
      { type: "prompt.submit", text: "earlier question" },
      { type: "assistant.text", turnId: "t", text: "earlier answer" },
      { type: "turn.complete", turnId: "t", text: "earlier answer" },
    ];
    const provider = new ScriptedProvider([{ text: "follow-up answer" }]);
    const core = AgentCore.resume({ cwd, provider, systemPrompt: "SYS" }, events);
    await core.submit("follow-up");
    // the resumed model request carries history: earlier exchange + new prompt
    const sent = provider.requests[0].messages;
    expect(sent[0]).toMatchObject({ role: "system", content: "SYS" });
    expect(sent.some((m) => m.content === "earlier question")).toBe(true);
    expect(sent.some((m) => m.content === "earlier answer")).toBe(true);
    expect(sent.at(-1)).toMatchObject({ role: "user", content: "follow-up" });
  });

  it("compaction fires when the budget trips: context.compacted emitted, model sees the summary", async () => {
    // Keep room for built-in schemas while a long replay trips at step 0.
    const budget = new TokenBudget({ contextWindow: 4000, reserveOutput: 100, reserveSystem: 0, highWaterMark: 0.5 });
    const summarize = async (messages: { content: string }[]) =>
      `SUMMARY(${messages.length}): ${messages[0]?.content?.slice(0, 20) ?? ""}`;

    // craft a long replayed history: 6 rounds of user+assistant, each ~3900 chars
    const filler = "lorem ipsum dolor sit amet ".repeat(150); // ~3900 chars ≈ 975 tokens
    const events: SessionEvent[] = [];
    for (let i = 0; i < 6; i++) {
      events.push({ type: "prompt.submit", text: `question ${i} ${filler}` });
      events.push({ type: "assistant.text", turnId: `t${i}`, text: `answer ${i} ${filler}` });
      events.push({ type: "turn.complete", turnId: `t${i}`, text: `answer ${i} ${filler}` });
    }

    const provider = new ScriptedProvider([{ text: "post-compaction answer" }]);
    const core = AgentCore.resume(
      { cwd, provider, tools:[], compaction: { budget, summarize, cooldownMessages: 0 } },
      events,
    );
    const seen: { event: string; input: Record<string, unknown> }[] = [];
    core.subscribe((ev) => {
      if (ev.kind === "catalog") seen.push({ event: ev.event, input: ev.input });
    });
    await core.submit("next question");

    const compacted = seen.find((e) => e.event === "context.compacted");
    expect(compacted).toBeDefined();
    expect(compacted!.input.foldedCount).toBeGreaterThan(0);
    // the model request went out AFTER compaction: summary present,
    // folded content gone
    const sent = provider.requests[0].messages;
    expect(sent.some((m) => m.content.includes("Summary of earlier conversation"))).toBe(true);
    expect(sent.some((m) => m.role === "user" && m.content.startsWith("question 0"))).toBe(false);
    expect(sent.at(-1)).toMatchObject({ role: "user", content: "next question" });
  });

  it("without compaction config the loop never emits context.compacted", async () => {
    const provider = new ScriptedProvider([{ text: "plain" }]);
    const core = new AgentCore({ cwd, provider });
    const events: string[] = [];
    core.subscribe((ev) => {
      if (ev.kind === "catalog") events.push(ev.event);
    });
    await core.submit("hi");
    expect(events).not.toContain("context.compacted");
  });
});
