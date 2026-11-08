import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { RendererStore } from "../src/run.js";
import { RendererApp } from "../src/app.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const declareAndRender = (store: RendererStore) => {
  act(() => {
    store.apply({
      type: "declare",
      surfaces: [
        { id: "session", kind: "pane", title: "session" },
        { id: "status", kind: "status-bar" },
      ],
    });
    store.apply({
      type: "render",
      surface: "session",
      mode: "full",
      flush: true,
      grid: [
        [{ ch: "h" }, { ch: "i" }],
        [{ ch: "o" }, { ch: "k" }],
      ],
    });
    store.apply({
      type: "render",
      surface: "status",
      mode: "full",
      flush: true,
      grid: [[{ ch: "R" }, { ch: "E" }, { ch: "A" }, { ch: "D" }, { ch: "Y" }]],
    });
  });
};

describe("RendererApp", () => {
  it("draws declared surfaces with content", () => {
    const store = new RendererStore();
    const onKey = vi.fn();
    const app = render(<RendererApp store={store} onKey={onKey} />);
    declareAndRender(store);
    const frame = app.lastFrame()!;
    expect(frame).toContain("hi");
    expect(frame).toContain("ok");
    expect(frame).toContain("READY");
    app.unmount();
  });

  it("panes get a border, the status bar does not", () => {
    const store = new RendererStore();
    const app = render(<RendererApp store={store} onKey={() => {}} />);
    declareAndRender(store);
    const frame = app.lastFrame()!;
    expect(frame).toMatch(/[╭┌]/); // rounded/square border on the pane
    const statusLine = frame.split("\n").find((l) => l.includes("READY"))!;
    expect(statusLine).not.toMatch(/[╭┌│]/);
    app.unmount();
  });

  it("diff renders update the frame after flush", () => {
    const store = new RendererStore();
    const app = render(<RendererApp store={store} onKey={() => {}} />);
    declareAndRender(store);
    act(() => {
      store.apply({
        type: "render",
        surface: "session",
        mode: "diff",
        flush: true,
        ops: [{ op: "set", row: 0, col: 0, cells: [{ ch: "b" }, { ch: "y" }, { ch: "e" }] }],
      });
    });
    const frame = app.lastFrame()!;
    expect(frame).toContain("bye");
    expect(frame).not.toContain("hi ");
    app.unmount();
  });

  it("keystrokes on the focused surface become protocol input", () => {
    const store = new RendererStore();
    const onKey = vi.fn();
    const app = render(<RendererApp store={store} onKey={onKey} />);
    declareAndRender(store);
    act(() => {
      app.stdin.write("x");
    });
    expect(onKey).toHaveBeenCalledWith("session", { kind: "text", text: "x" });
    act(() => {
      app.stdin.write("\r");
    });
    expect(onKey).toHaveBeenCalledWith("session", { kind: "key", key: "enter", modifiers: [] });
    app.unmount();
  });

  it("focus message retargets input", () => {
    const store = new RendererStore();
    const onKey = vi.fn();
    const app = render(<RendererApp store={store} onKey={onKey} />);
    declareAndRender(store);
    act(() => {
      store.apply({ type: "focus", surface: "status" });
    });
    act(() => {
      app.stdin.write("q");
    });
    expect(onKey).toHaveBeenCalledWith("status", { kind: "text", text: "q" });
    app.unmount();
  });
});
