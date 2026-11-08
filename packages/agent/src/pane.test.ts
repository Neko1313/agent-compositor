import { describe, expect, it } from "vitest";
import type { WireMessage } from "@agent-compositor/protocol";
import { SessionPane } from "./pane.js";

interface DiffRender {
  type: "render";
  mode: "diff";
  ops: Array<Record<string, unknown>>;
}

function capture() {
  const messages: WireMessage[] = [];
  const pane = new SessionPane("session", (m) => messages.push(m));
  pane.declarePane();
  return { pane, messages };
}

const renders = (messages: WireMessage[]): DiffRender[] =>
  messages.filter((m): m is DiffRender => m.type === "render") as DiffRender[];

describe("SessionPane", () => {
  it("declares the surface once, then flushes text as diff ops", () => {
    const { pane, messages } = capture();
    pane.append("hello");
    pane.append(" world");
    pane.flush();

    const [r] = renders(messages);
    expect(r.ops).toEqual([{ op: "set", y: 0, x: 0, text: "hello world" }]);
    expect(messages[0].type).toBe("declare");
  });

  it("appends new lines and rewrites only the partial row", () => {
    const { pane, messages } = capture();
    pane.append("line1\nlin");
    pane.flush();
    pane.append("e2\ndone");
    pane.flush();

    const [r1, r2] = renders(messages);
    expect(r1.ops).toEqual([
      { op: "set", y: 0, x: 0, text: "line1" },
      { op: "set", y: 1, x: 0, text: "lin" },
    ]);
    expect(r2.ops).toEqual([
      { op: "clear", y: 1, x: 0, len: 3 }, // old partial "lin"
      { op: "set", y: 1, x: 0, text: "line2" },
      { op: "set", y: 2, x: 0, text: "done" },
    ]);
  });

  it("no-ops when nothing changed", () => {
    const { pane, messages } = capture();
    pane.flush();
    expect(renders(messages)).toHaveLength(0);
  });
});
