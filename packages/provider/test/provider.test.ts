import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompletionRequest } from "@agent-compositor/core";
import { OpenAICompatProvider, readSse } from "../src/index.js";

let server: http.Server;
let baseUrl: string;

/** Serve one scripted SSE body, then close. Capture the request for assertions. */
function serve(script: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      script(req, res);
    });
    server.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}/v1`;
      resolve();
    });
  });
}

afterEach(async () => {
  await new Promise((res) => server?.close(() => res(undefined)));
});

const sse = (res: http.ServerResponse, chunks: object[]) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
};

const request = (signal?: AbortSignal): CompletionRequest => ({
  messages: [{ role: "user", content: "hi" }],
  tools: [{ name: "exec", description: "run", parameters: { type: "object" } }],
  signal: signal ?? new AbortController().signal,
});

const collect = async (iter: AsyncIterable<unknown>) => {
  const out: unknown[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
};

describe("OpenAICompatProvider", () => {
  let gotAuth: string | undefined;
  let gotBody: Record<string, unknown> | undefined;

  beforeEach(() => {
    gotAuth = undefined;
    gotBody = undefined;
  });

  it("streams text deltas and finishes with stop", async () => {
    await serve((req, res) => {
      gotAuth = req.headers.authorization;
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        gotBody = JSON.parse(raw);
        sse(res, [
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { usage: { prompt_tokens: 10, completion_tokens: 2 } },
        ]);
      });
    });
    const provider = new OpenAICompatProvider({ baseUrl, apiKey: "sk-test", model: "demo" });
    const events = await collect(provider.complete(request()));

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "stop" },
      { type: "usage", inputTokens: 10, outputTokens: 2 },
    ]);
    expect(gotAuth).toBe("Bearer sk-test");
    expect(gotBody).toMatchObject({ model: "demo", stream: true });
  });

  it("reassembles tool_calls split across chunks (by index)", async () => {
    await serve((_req, res) => {
      sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "exec", arguments: '{"comma' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'nd":"echo hi"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]);
    });
    const provider = new OpenAICompatProvider({ baseUrl, apiKey: "k", model: "m" });
    const events = await collect(provider.complete(request()));

    const call = events.find((e) => (e as { type: string }).type === "tool_call") as { id: string; name: string; args: unknown };
    expect(call).toMatchObject({ id: "call_1", name: "exec" });
    expect(call.args).toEqual({ command: "echo hi" });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });
  });

  it("invalid JSON arguments degrade to {_raw}, never throw", async () => {
    await serve((_req, res) => {
      sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "exec", arguments: "{oops" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]);
    });
    const provider = new OpenAICompatProvider({ baseUrl, apiKey: "k", model: "m" });
    const events = await collect(provider.complete(request()));
    const call = events.find((e) => (e as { type: string }).type === "tool_call") as { args: { _raw: string } };
    expect(call.args._raw).toBe("{oops");
  });

  it("HTTP errors surface as finish:error with the body snippet", async () => {
    await serve((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad key" }));
    });
    const provider = new OpenAICompatProvider({ baseUrl, apiKey: "k", model: "m" });
    const events = await collect(provider.complete(request()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "finish", reason: "error" });
    expect((events[0] as { error: string }).error).toContain("401");
  });

  it("abort mid-stream ends quietly (no error finish)", async () => {
    await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`);
      // never send more; the client will abort
    });
    const controller = new AbortController();
    const provider = new OpenAICompatProvider({ baseUrl, apiKey: "k", model: "m" });
    const iterator = provider.complete(request(controller.signal))[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toEqual({ type: "text_delta", text: "partial" });
    controller.abort();
    const rest = await collect({ [Symbol.asyncIterator]: () => iterator });
    expect(rest).toEqual([]); // aborted: no error event, clean end
  });

  it("length finish_reason maps to its own ProviderEvent", async () => {
    await serve((_req, res) => {
      sse(res, [{ choices: [{ delta: { content: "x" } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }]);
    });
    const provider = new OpenAICompatProvider({ baseUrl, apiKey: "k", model: "m" });
    const events = await collect(provider.complete(request()));
    expect(events.at(-1)).toEqual({ type: "finish", reason: "length" });
  });
});

describe("readSse", () => {
  it("parses data lines, skips comments, stops at [DONE]", async () => {
    const payload = [
      ": comment",
      "",
      'data: {"a":1}',
      'data: {"b":2}',
      "data: [DONE]",
      'data: {"never":true}',
    ].join("\n");
    const stream = new Response(payload).body!;
    const items: unknown[] = [];
    for await (const item of readSse(stream, new AbortController().signal)) items.push(item);
    expect(items).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
