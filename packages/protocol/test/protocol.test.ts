import { describe, expect, it } from "vitest";
import { answerHello, decodeLine, decodeStream, encodeMessage, hello, negotiate, parseSemVer } from "../src/index.js";
import type { HelloMessage, WireMessage } from "../src/index.js";

const caps = (surfaces: HelloMessage["capabilities"]["surfaces"] = ["terminal"]): HelloMessage["capabilities"] => ({
  surfaces,
  sites: ["session", "agents", "inspector"],
  elements: ["Box", "Text", "Button"],
  encodings: ["jsonl"],
});

describe("semver", () => {
  it("parses and formats", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer("1.2.3-beta.1")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer("v1")).toBeUndefined();
  });

  it("negotiates by the LSP rule", () => {
    expect(negotiate({ major: 1, minor: 2, patch: 0 }, { major: 1, minor: 5, patch: 3 })).toEqual({
      ok: true,
      version: { major: 1, minor: 2, patch: 0 },
    });
    expect(negotiate({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 0 })).toMatchObject({
      ok: false,
    });
  });
});

describe("handshake", () => {
  it("succeeds with shared surface and negotiates to min minor", () => {
    const core = hello("core", caps(["terminal", "web"]));
    const renderer = hello("renderer", caps(["terminal"]));
    const ack = answerHello(core, renderer);
    expect(ack.ok).toBe(true);
    expect(ack.version).toBe("0.5.0");
  });

  it("fails with no shared surface", () => {
    const core = hello("core", caps(["terminal"]));
    const renderer = hello("renderer", caps(["web"]));
    expect(answerHello(core, renderer).ok).toBe(false);
  });

  it("fails on foreign protocol name", () => {
    const core = hello("core", caps());
    const rogue = { ...hello("renderer", caps()), protocol: "something-else" } as unknown as HelloMessage;
    expect(answerHello(core, rogue).ok).toBe(false);
  });
});

describe("codec", () => {
  it("round-trips every message type", () => {
    const msgs: WireMessage[] = [
      hello("core", caps()),
      { type: "hello-ack", ok: true, version: "0.1.0" },
      {
        type: "declare",
        surfaces: [{ id: "session-pane", kind: "pane", site: "session", title: "Session" }],
      },
      {
        type: "render",
        surface: "session-pane",
        mode: "diff",
        ops: [{ op: "set", row: 0, col: 0, cells: [{ ch: "x" }] }],
        flush: true,
      },
      { type: "input", surface: "session-pane", data: { kind: "key", key: "Enter" } },
      { type: "focus", surface: "session-pane" },
      { type: "invalidate", surface: "session-pane", regions: [{ row: 0, col: 0, rows: 1, cols: 5 }] },
      { type: "bye", reason: "done" },
    ];
    for (const m of msgs) {
      expect(decodeLine(encodeMessage(m))).toEqual(m);
    }
  });

  it("rejects bad JSON and schema mismatch", () => {
    expect(() => decodeLine("{not json")).toThrow(/invalid JSON/);
    expect(() => decodeLine('{"type":"nope"}')).toThrow(/schema mismatch/);
    expect(() => decodeLine("")).toThrow(/empty/);
  });

  it("streams multi-chunk JSONL, including a final line without newline", () => {
    async function* chunks(): AsyncGenerator<string> {
      yield `{"type":"focus","surface":"a"}\n{"type":"focus","surface":"`;
      yield `b"}\n{"type":"bye"}`;
    }
    return (async () => {
      const out: string[] = [];
      for await (const m of decodeStream(chunks())) out.push(JSON.stringify(m));
      expect(out).toEqual([
        '{"type":"focus","surface":"a"}',
        '{"type":"focus","surface":"b"}',
        '{"type":"bye"}',
      ]);
    })();
  });
});
