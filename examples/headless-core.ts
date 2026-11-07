/**
 * Headless core, end to end: events + runtime + wire protocol in one process.
 *
 *   npm run example:headless
 *
 * stdout: protocol JSONL (hello/hello-ack handshake, declare, render, input echo)
 * stderr: chain trace JSONL (--plugin-trace equivalent)
 */
import { Runtime, jsonlTraceSink } from "@agent-compositor/runtime";
import {
  answerHello,
  declareMessage,
  encodeMessage,
  hello,
  inputMessage,
  renderMessage,
} from "@agent-compositor/protocol";

const trace = jsonlTraceSink(process.stderr);
const runtime = new Runtime({ trace });

/** Consume one emission: collect intermediate yields, return the final result. */
async function emitOne(event: string, input: unknown) {
  const yields: unknown[] = [];
  const gen = runtime.emit(event, input);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const step = await gen.next();
    if (step.done) return { result: step.value, yields };
    yields.push(step.value);
  }
}

// --- plugins ----------------------------------------------------------------

// render-only: a status bar. It only speaks ui.*.
runtime.register(
  { name: "status-bar-demo", version: "0.1.0", trust: "render-only" },
  {
    "ui.render": (e: { site: string; props: { model?: string; turns?: number } }) => ({
      tree: {
        rows: [
          [` ${e.site} `, `model: ${e.props.model ?? "?"}`, ` turns: ${e.props.turns ?? 0}`, " [q]uit "],
        ],
      },
    }),
  },
);

// trusted: a safety rule on tool.check.
runtime.register(
  { name: "safety", version: "1.0.0", trust: "trusted" },
  {
    "tool.check": (e: { tool: string; input?: { command?: string } }, ctx) => {
      if (e.tool === "Bash" && e.input?.command?.includes("rm -rf /")) {
        return { decision: "deny", reason: "refusing to rm -rf /" };
      }
      return ctx.next();
    },
  },
);

// --- handshake: core meets its (in-process) renderer -------------------------

const core = hello("core", {
  surfaces: ["terminal", "headless"],
  sites: ["session", "status"],
  elements: ["Box", "Text"],
  encodings: ["jsonl"],
});
const renderer = hello("renderer", {
  surfaces: ["headless"],
  sites: ["status"],
  elements: ["Text"],
  encodings: ["jsonl"],
});
const ack = answerHello(core, renderer);
if (!ack.ok) throw new Error(ack.reason ?? "handshake failed");

const out = (m: Parameters<typeof encodeMessage>[0]) => process.stdout.write(encodeMessage(m));
out(core);
out(renderer);
out(ack);

// --- session composition -----------------------------------------------------

await emitOne("session.start", {
  sessionId: "demo",
  cwd: process.cwd(),
  plugins: [
    { name: "status-bar-demo", version: "0.1.0", tier: "user" },
    { name: "safety", version: "1.0.0", tier: "append" },
  ],
});

// --- a tool call the safety plugin will deny -----------------------------------

const toolCall = await emitOne("tool.call", {
  tool: "Bash",
  input: { command: "rm -rf /" },
  callId: "call-1",
});
const decision = await emitOne("tool.check", {
  tool: "Bash",
  input: { command: "rm -rf /" },
  callId: "call-1",
  isReadOnly: false,
});
out(renderMessage.parse({ type: "render", surface: "session-pane", mode: "diff", ops: [{ op: "set", row: 0, col: 0, cells: [{ ch: "d" }, { ch: "e" }, { ch: "n" }, { ch: "i" }, { ch: "e" }, { ch: "d" }] }], flush: true }));

// --- declare the status bar surface, render it from the plugin's tree --------

out(declareMessage.parse({ type: "declare", surfaces: [{ id: "status", kind: "status-bar", title: "status" }] }));

const ui = await emitOne("ui.render", {
  site: "status",
  surface: "headless",
  props: { model: "demo-model", turns: 1 },
});
const tree = (ui.result.value as { tree: { rows: string[][] } }).tree;
const grid = tree.rows.map((row) => row.flatMap((text) => text.split("").map((ch) => ({ ch }))));
out(renderMessage.parse({ type: "render", surface: "status", mode: "full", grid, flush: true }));

// echo a keystroke back through the protocol
out(inputMessage.parse({ type: "input", surface: "status", data: { kind: "key", key: "q" } }));

console.error(JSON.stringify({ toolCall: toolCall.result.value, decision: decision.result.value }));
