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

  it("marks bracketed paste as text even for a single command character", () => {
    const store = new RendererStore();
    const onKey = vi.fn();
    const app = render(<RendererApp store={store} onKey={onKey} />);
    declareAndRender(store);
    act(() => {
      app.stdin.write("\x1b[200~q\x1b[201~");
    });
    expect(onKey.mock.calls).toEqual([["session", {kind: "text", text: "q", paste: true}]]);
    app.unmount();
  });
});

it('keeps styled spans in one constrained text row after a narrow layout',()=>{
  const store=new RendererStore();const app=render(<RendererApp store={store} onKey={()=>{}} />);
  act(()=>{
    store.apply({type:'declare',surfaces:[{id:'session',kind:'pane',title:'Conversation'}]});
    store.apply({type:'layout',width:60,height:20,frames:[{surface:'session',x:0,y:0,width:30,height:18}]});
    store.apply({type:'render',surface:'session',mode:'full',flush:true,grid:[Array.from('Markdown verified',ch=>({ch,bold:true,fg:'#8fc7dd'})),[...Array.from('Bold text',ch=>({ch,bold:true})),...Array.from(' and italic',ch=>({ch,italic:true}))]]});
  });
  const frame=app.lastFrame()!.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  expect(frame).toContain('Markdown verified');expect(frame).toContain('Bold text and italic');app.unmount();
});
