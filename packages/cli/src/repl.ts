import type { Readable, Writable } from "node:stream";
import { AgentCore } from "@agent-compositor/core";
import { decodeKeys, type DecoderState } from "./keys.js";
import { TerminalRenderer } from "./renderer.js";

export interface ReplDeps {
  /** factory so the approval bridge can be injected into core options */
  createCore: (onApproval: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onApproval"]>) => AgentCore;
  stdin: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  stdout: Writable;
  /** single-key source for the approval dialog (raw-mode stdin or test stub) */
  promptKey?: (question: string) => Promise<"y" | "n" | "a">;
}

/**
 * The interactive REPL: raw-mode keystrokes → loop intents. One-directional
 * by design — the renderer owns output, this owns input, the core owns state.
 */
export async function runRepl(deps: ReplDeps): Promise<void> {
  const renderer = new TerminalRenderer(deps.stdout, deps.promptKey);
  const core = deps.createCore((req) => renderer.askApproval(req));
  renderer.attach(core);

  const state: DecoderState = { line: "", running: false };
  core.subscribe((ev) => {
    if (ev.kind === "catalog" && ev.event === "turn.start") state.running = true;
    if (
      ev.kind === "catalog" &&
      (ev.event === "turn.complete" || ev.event === "turn.interrupted" || ev.event === "turn.failed")
    ) {
      state.running = false;
    }
  });

  deps.stdout.write("agent-compositor — Enter submit · Tab steer · Ctrl+C interrupt/exit\n");

  const useRaw = deps.stdin.isTTY === true && typeof deps.stdin.setRawMode === "function";
  if (useRaw) deps.stdin.setRawMode(true);

  await new Promise<void>((resolve) => {
    const finish = async (): Promise<void> => {
    await inflight; // never truncate a mid-flight turn on stdin close
    if (useRaw) deps.stdin.setRawMode!(false);
    resolve();
  };

  let inflight: Promise<void> = Promise.resolve();
  deps.stdin.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const cmd of decodeKeys(text, state)) {
        switch (cmd.type) {
          case "submit":
            inflight = inflight.then(() => core.submit(cmd.text));
            break;
          case "steer":
            void core.steer(cmd.text);
            deps.stdout.write(`\n[steer] ${cmd.text}\n`);
            break;
          case "interrupt":
            void core.interrupt();
            break;
          case "exit":
            deps.stdout.write("\nbye\n");
            void finish();
            break;
          case "char":
            deps.stdout.write(cmd.ch);
            break;
          case "ignore":
            break;
        }
      }
    });
    deps.stdin.on("end", () => void finish());
  });

  // no explicit shutdown: the loop is in-memory + best-effort persisted;
  // stdin closing is the REPL's end-of-life signal.
}
