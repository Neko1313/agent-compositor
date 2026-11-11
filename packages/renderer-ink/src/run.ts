import { TerminalGraphics, type GraphicsMode } from "./graphics.js";
import {pointerControl,type PointerMode,type PointerShape} from "./pointer.js";
import { mouseInput } from "./mouse.js";
import { render } from "ink";
import React from "react";
import { answerHello, hello } from "@agent-compositor/protocol";
import type { HelloMessage, WireMessage } from "@agent-compositor/protocol";
import { RendererApp } from "./app.js";
import { RendererState } from "./state.js";

/** Observable store: the run loop writes, the Ink app subscribes. */
export class RendererStore {
  suspend?: (callback: () => Promise<void>) => Promise<void>;
  readonly state = new RendererState();
  private readonly listeners = new Set<() => void>();

  apply(msg: WireMessage): boolean {
    this.state.apply(msg);
    const changed=this.state.textChanged;
    if(changed)this.notify();
    return changed;
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
  /** Let the core decide whether Ctrl+C interrupts or exits. */
  hostControlsExit?: boolean;
  /** override the hello we advertise (capabilities) */
  localHello?: HelloMessage;
  /** exit hook, mostly for tests; default calls process.exit */
  exit?: (code: number) => void;
  graphics?: GraphicsMode;
}

export interface InkRendererHandle {
  runExternal: (callback: () => Promise<void>) => Promise<void>;
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
      elements: ["Text", "Box", "Layout", "Pointer"],
      encodings: ["jsonl"],
    });
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let acked = false;
  let exiting = false;

  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const mouseEnabled = !!(opts.hostControlsExit && (stdin as NodeJS.ReadStream).isTTY && (stdout as NodeJS.WriteStream).isTTY);
  const graphics = new TerminalGraphics(text => stdout.write(text));
  const mouse = mouseEnabled ? mouseInput(stdin, data => {
    if (!acked || exiting) return;
    // Coordinates are terminal-global; compositor performs hit testing.
    opts.send({ type: "input", surface: store.state.focused ?? "input", data });
  }, (control, payload) => {
    const before=`${graphics.cell.width}:${graphics.cell.height}:${graphics.background}`;
    graphics.response(control,payload);
    if(graphics.enabled&&graphics.backend==='sixel'&&before!==`${graphics.cell.width}:${graphics.cell.height}:${graphics.background}`){graphics.beforeUpdate();graphics.paint(store.state);}
  }) : undefined;
  let resizeSync=false;
  const measure=()=>{
    // Ink clears the old frame before its own synchronized resize repaint.
    // Start synchronization before that clear, including the no-repaint case.
    if(mouseEnabled){resizeSync=true;stdout.write('\x1b[?2026h');queueMicrotask(()=>{if(resizeSync){resizeSync=false;stdout.write('\x1b[?2026l');}});}
    if(graphics.enabled&&graphics.backend==='sixel')graphics.measure();
  };
  stdout.prependListener('resize',measure);
  // Absolute full-screen geometry must not scroll when terminal glyph widths
  // differ from layout's Unicode widths (notably ZWJ emoji in VTE).
  if (mouseEnabled) stdout.write("\x1b[?1049h\x1b[?7l\x1b[?1000h\x1b[?1003h\x1b[?1006h");
  const pointerTerminal=pointerControl(process.env,(["on","off","x11"].includes(process.env.AGENT_POINTER??"")?process.env.AGENT_POINTER:"auto") as PointerMode);
  let pointer: PointerShape | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return; cleaned = true;
    process.off("exit", cleanup);
    stdout.off('resize',measure);
    if(resizeSync){resizeSync=false;stdout.write('\x1b[?2026l');}
    graphics.dispose();
    mouse?.dispose();
    if (mouseEnabled) stdout.write(pointerTerminal.sequence("default") + "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?7h\x1b[?1049l");
  };

  if (mouseEnabled) process.once("exit", cleanup);

  /** Unmount, let Ink flush its final frame, then exit. */
  const shutdown = (code: number) => {
    if (exiting) return;
    exiting = true;
    graphics.suspended = true;
    // let any pending React commit land before the final frame is captured
    setTimeout(() => {
      app.unmount();
      void app.waitUntilExit().then(() => { cleanup(); exit(code); });
    }, 10);
  };

  let pendingTextPaint:boolean=false;
  let app: ReturnType<typeof render>;
  try { app = render(
    React.createElement(RendererApp, {
      store,
      onKey: (surface, data) => {
        if (!acked || exiting) return;
        opts.send({ type: "input", surface, data });
        if (!opts.hostControlsExit && data.kind === "key" && data.key === "c" && data.modifiers?.includes("ctrl")) {
          opts.send({ type: "bye", reason: "ctrl+c" });
          shutdown(0);
        }
      },
    }),
    {
      stdin: mouse?.input ?? stdin,
      ...(opts.stdout ? { stdout: opts.stdout } : {}),
      ...(opts.stderr ? { stderr: opts.stderr } : {}),
      onRender: () => {graphics.paint(store.state);pendingTextPaint=false;},
      maxFps: 60,
      incrementalRendering: true,
      exitOnCtrlC: false, // ctrl+c is protocol input, not a silent kill
    },
  ); } catch (error) { cleanup(); throw error; }

  const consume = (async () => {
    const mode = opts.graphics ?? (['kitty','sixel','off'].includes(process.env.AGENT_GRAPHICS ?? '') ? process.env.AGENT_GRAPHICS as GraphicsMode : 'auto');
    // Allow Ink to enter raw mode before the probe response arrives.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (await graphics.detect(mode, mouseEnabled, !!(process.env.TMUX || process.env.STY))) {
      store.state.nativeImages = true;
      localHello.capabilities.elements = [...new Set([...localHello.capabilities.elements, 'Raster'])];
    }
    if(!mouseEnabled||!pointerTerminal.supported)localHello.capabilities.elements=localHello.capabilities.elements.filter(e=>e!=="Pointer");
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
      if (msg.type === "pointer") {
        if (mouseEnabled && pointer !== msg.shape) {
          stdout.write(pointerTerminal.sequence(msg.shape));
          pointer = msg.shape;
        }
        continue;
      }
      if(msg.type==='layout'||msg.type==='render'||msg.type==='bye')graphics.beforeUpdate(msg,store.state);
      const wasPending:boolean=pendingTextPaint;pendingTextPaint=true;
      const changed=store.apply(msg);
      if(!changed)pendingTextPaint=wasPending;
      // Native frame changes do not need Yoga/React or an Ink text repaint.
      // Geometry/text changes still wait for the post-commit image placement.
      if(!changed&&!pendingTextPaint&&msg.type==='render'&&store.state.rasterChanged)graphics.paint(store.state);
      if (msg.type === "bye" && opts.exitOnBye !== false && !exiting) {
        shutdown(0);
        break;
      }
    }
  })();

  return {
    store,
    runExternal: async callback => {
      if (!store.suspend) throw new Error('Terminal suspension is unavailable');
      await store.suspend(async () => {
        graphics.suspended = true;
        graphics.clear();
        mouse?.pause();
        if (mouseEnabled) stdout.write('\x1b[?1000l\x1b[?1003l\x1b[?1006l\x1b[?7h\x1b[?1049l');
        try { await callback(); }
        finally {
          if (mouseEnabled) stdout.write('\x1b[?1049h\x1b[?7l\x1b[?1000h\x1b[?1003h\x1b[?1006h');
          mouse?.resume();
          graphics.suspended = false;
        }
      });
    },
    waitUntilExit: consume
      .then(() => app.waitUntilExit())
      .then(() => { cleanup(); }, error => { app.unmount(); cleanup(); throw error; }),
    stop: async () => {
      exiting = true;
      graphics.suspended = true;
      app.unmount();
      cleanup();
      await consume.catch(() => {});
    },
  };
}
