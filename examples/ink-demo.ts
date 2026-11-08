/**
 * Ink demo — the compositor loop end to end:
 *   disk plugin → hooks runtime → wire protocol → Ink renderer → keystrokes back.
 *
 * The "core" here is a scripted echo loop (no LLM — step 7 ports the real one):
 * typed text lands in the session pane, the status bar is rendered by the
 * render-only status-line plugin from examples/plugins-disk.
 *
 * Run: npm run example:ink     (interactive; ctrl+c or "q" quits)
 */
import { fileURLToPath } from "node:url";
import { attach } from "@agent-compositor/hooks";
import { PluginLoader } from "@agent-compositor/loader";
import { answerHello, hello } from "@agent-compositor/protocol";
import type { WireMessage } from "@agent-compositor/protocol";
import { runInkRenderer } from "@agent-compositor/renderer-ink";
import { Runtime, jsonlTraceSink } from "@agent-compositor/runtime";

// ---- in-process duplex: core -> renderer is an async queue, renderer -> core is send()

const queue: WireMessage[] = [];
const waiters: (() => void)[] = [];
const push = (m: WireMessage) => {
  queue.push(m);
  waiters.splice(0).forEach((fn) => fn());
};
const source: AsyncIterable<WireMessage> = {
  [Symbol.asyncIterator]() {
    return {
      next(): Promise<IteratorResult<WireMessage>> {
        if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
        return new Promise((resolve) =>
          waiters.push(() => resolve(queue.length ? { value: queue.shift()!, done: false } : { value: undefined, done: true })),
        );
      },
    };
  },
};

// ---- scripted core

const lines: string[] = ["agent-compositor ink demo — type, enter repeats; q quits"];
const turns = { count: 0 };

function sessionGrid() {
  return lines.map((text) => [...text].map((ch) => ({ ch })));
}

function refreshSession() {
  push({ type: "render", surface: "session", mode: "full", flush: true, grid: sessionGrid() });
}

async function main() {
  const runtime = new Runtime({ trace: jsonlTraceSink(process.stderr) });
  const host = attach(runtime, { session: { id: "ink-demo", cwd: process.cwd() } });
  const loader = new PluginLoader(host, { dirs: [fileURLToPath(new URL("./plugins-disk/", import.meta.url))] });
  const report = await loader.loadAll();
  for (const f of report.failed) console.error(`[core] plugin ${f.name} failed: ${f.reason}`);

  await host.emit("session.start", { sessionId: "ink-demo", cwd: process.cwd(), plugins: loader.composition() });

  const coreHello = hello("core", {
    surfaces: ["terminal"],
    sites: ["status"],
    elements: ["Text", "Box"],
    encodings: ["jsonl"],
  });
  let handle: Awaited<ReturnType<typeof runInkRenderer>> | undefined;

  const refreshStatus = async () => {
    const res = await host.emit("ui.render", {
      site: "status",
      surface: "terminal",
      props: { model: "demo-llm", turns: turns.count },
    });
    const tree = (res.value as { tree?: { rows?: string[][] } } | undefined)?.tree;
    const rows = tree?.rows ?? [[" status: plugin did not render"]];
    push({
      type: "render",
      surface: "status",
      mode: "full",
      flush: true,
      grid: rows.map((r: string[]) => r.flatMap((seg) => [...String(seg)].map((ch) => ({ ch })))),
    });
  };

  // handshake + surfaces
  push(coreHello);
  push({
    type: "declare",
    surfaces: [
      { id: "session", kind: "pane", title: "session" },
      { id: "status", kind: "status-bar" },
    ],
  });
  refreshSession();
  await refreshStatus();

  const handleInput = async (m: Extract<WireMessage, { type: "input" }>) => {
    if (m.data.kind === "text" && m.data.text === "q") {
      push({ type: "bye", reason: "user quit" });
      return;
    }
    if (m.data.kind === "text") lines.push(`you typed: ${m.data.text}`);
    else if (m.data.kind === "key" && m.data.key === "enter") lines.push("you pressed enter");
    turns.count += 1;
    refreshSession();
    await refreshStatus(); // serialized: a fast "q" must not outrun pending renders
  };

  // serialize input handling so async renders land before the next input is processed
  let pending = Promise.resolve();
  const handleCoreMessage = (m: WireMessage) => {
    if (m.type === "hello") {
      push(answerHello(coreHello, m));
    } else if (m.type === "input" && m.surface === "session") {
      pending = pending.then(() => handleInput(m));
    } else if (m.type === "bye") {
      void handle?.stop(); // renderer closed the session (ctrl+c path)
    }
  };

  handle = await runInkRenderer({ source, send: handleCoreMessage });

  // piped stdin (no TTY): each line is text input — the demo stays scriptable
  if (!process.stdin.isTTY) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) =>
      handleCoreMessage({ type: "input", surface: "session", data: { kind: "text", text: line } }),
    );
    rl.on("close", () => handleCoreMessage({ type: "input", surface: "session", data: { kind: "text", text: "q" } }));
  }

  await handle.waitUntilExit;
  for (const p of report.loaded) await loader.unload(p.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
