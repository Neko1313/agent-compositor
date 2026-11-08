import { describe, expect, it } from "vitest";
import { MouseDecoder } from "../src/mouse.js";

describe("SGR mouse input", () => {
  it("removes press/release reports and preserves text and keyboard escapes", () => {
    const parser = new MouseDecoder();
    expect(parser.push("hello\x1b[<0;65;4M\x1b[<0;65;4m\x1b[A")).toEqual({
      text: "hello\x1b[A", events: [{ kind: "mouse", col: 64, row: 3, button: "left", action: "press" }, { kind: "mouse", col: 64, row: 3, button: "left", action: "release" }],
    });
  });
  it("buffers fragmented mouse sequences and recognises scrolling", () => {
    const parser = new MouseDecoder();
    expect(parser.push("\x1b[<64;12;")).toEqual({ text: "", events: [] });
    expect(parser.push("3M").events).toEqual([{ kind: "mouse", col: 11, row: 2, button: "wheel-up", action: "press" }]);
    expect(parser.push("\x1b[<65;12;3M").events[0]).toMatchObject({ button: "wheel-down" });
    parser.push("\x1b[<0;"); expect(parser.flush()).toBe("");
    parser.push("\x1b"); expect(parser.flush()).toBe("\x1b");
  });
});

it("reports drag motion and fragmented releases separately from clicks", () => {
  const parser = new MouseDecoder();
  expect(parser.push("\x1b[<32;30;6M").events).toEqual([{ kind: "mouse", col: 29, row: 5, button: "left", action: "move" }]);
  parser.push("\x1b[<0;30;");
  expect(parser.push("6m").events).toEqual([{ kind: "mouse", col: 29, row: 5, button: "left", action: "release" }]);
});

it("decodes hover reports with no button held", () => {
  expect(new MouseDecoder().push("\x1b[<35;30;6M")).toEqual({ text: "", events: [{ kind: "mouse", col: 29, row: 5, button: "other", action: "move" }] });
});
