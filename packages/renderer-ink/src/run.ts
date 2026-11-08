import { render } from "ink";
import React from "react";
import { answerHello, hello } from "@agent-compositor/protocol";
import type { HelloMessage, WireMessage } from "@agent-compositor/protocol";
import { RendererApp } from "./app.js";
import { RendererState } from "./state.js";

/** Observable store: the run loop writes, the Ink app subscribes. */
export class RendererStore {
  readonly state = new RendererState();
  private readonly listeners = new Set<() => void>();

  apply(msg: WireMessage): void {
    if (this.state.apply(msg)) this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export interface InkRendererOptions {
  /** messages from the core, in protocol order */
  source: AsyncIterable<WireMessage>;
  /** input/handshake messages back to the core */
  send: (m: WireMessage) => void;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** default true: a bye from the core unmounts the app */
  exitOnBye?: boolean;
  /** override the hello we advertise (capabilities) */
  localHello?: HelloMessage;
  /** exit hook, mostly for tests; default calls process.exit */
  exit?: (code: number) => void;
}

export interface InkRendererHandle {
  store: RendererStore;
  stop: () => Promise<void>;
  waitUntilExit: Promise<void>;
}

/**
 * Run the Ink renderer against a core message source. Handles the handshake
 * (sends our hello, answers the core's hello with hello-ack), applies wire
 * messages to the store, routes keystrokes from the focused surface back
 * through `send`. ctrl+c exits after reporting it as protocol input.
 */
export async function runInkRenderer(opts: InkRendererOptions): Promise<InkRendererHandle> {
  const store = new RendererStore();
  const localHello =
    opts.localHello ??
    hello("renderer", {
      surfaces: ["terminal", "headless"],
      sites: [],
      elements: ["Text", "Box"],
      encodings: ["jsonl"],
    });
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let acked = false;
  let exiting = false;

  /** Unmount, let Ink flush its final frame, then exit. */
  const shutdown = (code: number) => {
    if (exiting) return;
    exiting = true;
    // let any pending React commit land before the final frame is captured
    setTimeout(() => {
      app.unmount();
      void app.waitUntilExit().then(() => exit(code));
    }, 10);
  };

  const app = render(
    React.createElement(RendererApp, {
      store,
      onKey: (surface, data) => {
        if (!acked || exiting) return;
        opts.send({ type: "input", surface, data });
        if (data.kind === "key" && data.key === "c" && data.modifiers?.includes("ctrl")) {
          opts.send({ type: "bye", reason: "ctrl+c" });
          shutdown(0);
        }
      },
    }),
    {
      ...(opts.stdin ? { stdin: opts.stdin } : {}),
      ...(opts.stdout ? { stdout: opts.stdout } : {}),
      ...(opts.stderr ? { stderr: opts.stderr } : {}),
      exitOnCtrlC: false, // ctrl+c is protocol input, not a silent kill
    },
  );

  const consume = (async () => {
    opts.send(localHello);
    for await (const msg of opts.source) {
      if (msg.type === "hello") {
        const ack = answerHello(localHello, msg);
        opts.send(ack);
        acked = ack.ok;
        continue;
      }
      if (msg.type === "hello-ack") {
        acked = msg.ok;
        continue;
      }
      store.apply(msg);
      if (msg.type === "bye" && opts.exitOnBye !== false && !exiting) {
        shutdown(0);
        break;
      }
    }
  })();

  return {
    store,
    waitUntilExit: consume
      .then(() => app.waitUntilExit())
      .then(() => {}),
    stop: async () => {
      exiting = true;
      app.unmount();
      await consume.catch(() => {});
    },
  };
}
