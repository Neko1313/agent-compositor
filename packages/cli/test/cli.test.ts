import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { Readable } from "node:stream";
import { ScriptedProvider, AgentCore } from "@agent-compositor/core";
import { decodeKeys, type DecoderState } from "../src/keys.js";
import { TerminalRenderer } from "../src/renderer.js";

const buffer = () => {
  let text = "";
  const out = new Writable({ write(_c, _e, cb) { text += (_c as Buffer).toString(); cb(); } });
  return { out, get: () => text };
};

describe("decodeKeys", () => {
  it("idle: characters buffer, Enter submits and clears the line", () => {
    const state: DecoderState = { line: "", running: false };
    expect(decodeKeys("he", state).map((c) => c.type)).toEqual(["char", "char"]);
    expect(state.line).toBe("he");
    const cmds = decodeKeys("llo\r", state);
    expect(cmds.at(-1)).toEqual({ type: "submit", text: "hello" });
    expect(state.line).toBe("");
  });

  it("running: Enter steers with the buffered text", () => {
    const state: DecoderState = { line: "in french", running: true };
    const cmds = decodeKeys("\r", state);
    expect(cmds).toEqual([{ type: "steer", text: "in french" }]);
    expect(state.line).toBe("");
  });

  it("running: Tab steers; idle: Tab is ignored", () => {
    const running: DecoderState = { line: "faster", running: true };
    expect(decodeKeys("\t", running)).toEqual([{ type: "steer", text: "faster" }]);
    const idle: DecoderState = { line: "", running: false };
    expect(decodeKeys("\t", idle)).toEqual([{ type: "ignore" }]);
  });

  it("Ctrl+C: interrupt while running, exit while idle", () => {
    const running: DecoderState = { line: "", running: true };
    expect(decodeKeys("\x03", running)).toEqual([{ type: "interrupt" }]);
    const idle: DecoderState = { line: "", running: false };
    expect(decodeKeys("\x03", idle)).toEqual([{ type: "exit" }]);
  });

  it("Esc interrupts a running turn; backspace edits the buffer", () => {
    const state: DecoderState = { line: "abc", running: true };
    const cmds = decodeKeys("\x7f\x1b", state);
    expect(cmds).toEqual([{ type: "ignore" }, { type: "interrupt" }]);
    expect(state.line).toBe("ab");
  });
});

describe("TerminalRenderer", () => {
  it("streams text deltas verbatim; turn.complete closes with a newline", () => {
    const { out, get } = buffer();
    const r = new TerminalRenderer(out, async () => "n");
    r.handleEvent({ kind: "text", turnId: "t", delta: "Hel" });
    r.handleEvent({ kind: "text", turnId: "t", delta: "lo" });
    r.handleEvent({ kind: "catalog", event: "turn.complete", input: { turnId: "t" } });
    expect(get()).toBe("Hello\n");
  });

  it("tool calls render as compact one-liners; failures get a ✗ line", () => {
    const { out, get } = buffer();
    const r = new TerminalRenderer(out, async () => "n");
    r.handleEvent({ kind: "catalog", event: "tool.call", input: { tool: "exec", input: { command: "npm test" }, callId: "c1" } });
    r.handleEvent({ kind: "catalog", event: "tool.result", input: { callId: "c1", tool: "exec", ok: true, output: { stdout: "ok" } } });
    r.handleEvent({ kind: "catalog", event: "tool.call", input: { tool: "exec", input: { command: "rm -rf /" }, callId: "c2" } });
    r.handleEvent({ kind: "catalog", event: "tool.result", input: { callId: "c2", tool: "exec", ok: false, error: "permission denied" } });
    const text = get();
    expect(text).toContain("⚙ exec");
    expect(text).toContain("npm test");
    expect(text).not.toContain("stdout"); // ok results stay silent
    expect(text).toContain("✗ exec: permission denied");
  });

  it("interrupted / failed / compaction / queued render as bracketed markers", () => {
    const { out, get } = buffer();
    const r = new TerminalRenderer(out, async () => "n");
    r.handleEvent({ kind: "catalog", event: "turn.interrupted", input: { turnId: "t" } });
    r.handleEvent({ kind: "catalog", event: "turn.failed", input: { turnId: "t", error: "model exploded" } });
    r.handleEvent({ kind: "catalog", event: "context.compacted", input: { foldedCount: 12 } });
    r.handleEvent({ kind: "catalog", event: "prompt.queued", input: { text: "x", depth: 1 } });
    const text = get();
    expect(text).toContain("[interrupted]");
    expect(text).toContain("[turn error: model exploded]");
    expect(text).toContain("12 messages folded");
    expect(text).toContain("[queued]");
  });

  it("askApproval renders the dialog and maps keys to booleans", async () => {
    const { out, get } = buffer();
    const r = new TerminalRenderer(out, async () => "y");
    expect(await r.askApproval({ tool: "exec", args: { command: "git push" }, reason: "network egress" })).toBe(true);
    expect(get()).toContain("[permission] exec");
    expect(get()).toContain("network egress");
    const denyBuf = buffer();
    const deny = new TerminalRenderer(denyBuf.out, async () => "n");
    expect(await deny.askApproval({ tool: "exec", args: {} })).toBe(false);
  });
});

describe("REPL integration (headless streams)", () => {
  it("type → Enter → streamed answer renders end to end", async () => {
    const provider = new ScriptedProvider([{ text: "Hi there." }]);
    const outText: string[] = [];
    const stdin = new Readable({
      read() {
        this.push("hello\r");
        this.push(null);
      },
    });
    const stdout = new Writable({ write(c, _e, cb) { outText.push((c as Buffer).toString()); cb(); } });

    const { runRepl } = await import("../src/repl.js");
    await runRepl({
      createCore: (onApproval) => new AgentCore({ cwd: process.cwd(), provider, onApproval }),
      stdin: stdin as never,
      stdout,
    });
    expect(outText.join("")).toContain("Hi there.");
  });
});
