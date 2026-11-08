import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { NativeProvider } from "../src/index.js";
import type { CompletionRequest, ProviderEvent } from "@agent-compositor/core";
let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
async function fixture(events: any[]) {
  let captured: any;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      captured = { headers: req.headers, path: req.url, body: JSON.parse(raw) };
      res.setHeader("Content-Type", "text/event-stream");
      for (const event of events)
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    captured: () => captured,
  };
}
const request: () => CompletionRequest = () => ({
  signal: new AbortController().signal,
  messages: [
    { role: "system", content: "instructions" },
    { role: "user", content: "inspect" },
  ],
  tools: [
    { name: "read", description: "read file", parameters: { type: "object" } },
  ],
});
async function collect(provider: NativeProvider) {
  const result: ProviderEvent[] = [];
  for await (const event of provider.complete(request())) result.push(event);
  return result;
}
describe("native provider protocols", () => {
  it("uses Anthropic messages, accepts initial tool input and includes cache tokens", async () => {
    const f = await fixture([
      {
        type: "message_start",
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 3 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "a",
          name: "read",
          input: { path: "a.txt" },
        },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        usage: { output_tokens: 4 },
        delta: { stop_reason: "tool_use" },
      },
      { type: "message_stop" },
    ]);
    const events = await collect(
      new NativeProvider({
        type: "anthropic",
        baseUrl: f.url,
        apiKey: "key",
        model: "claude",
      })
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "a",
      name: "read",
      args: { path: "a.txt" },
    });
    expect(events).toContainEqual({
      type: "usage",
      inputTokens: 13,
      outputTokens: 4,
      cachedInputTokens: 3,
    });
    expect(f.captured().headers["x-api-key"]).toBe("key");
    expect(f.captured().body.system).toBe("instructions");
  });
  it("preserves Gemini thought signatures for replay", async () => {
    const f = await fixture([
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { id: "g", name: "read", args: { path: "a" } },
                  thoughtSignature: "signed",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 2,
          cachedContentTokenCount: 4,
        },
      },
    ]);
    const events = await collect(
      new NativeProvider({
        type: "gemini",
        baseUrl: f.url,
        apiKey: "key",
        model: "gemini",
      })
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "g",
      name: "read",
      args: { path: "a" },
      metadata: { thoughtSignature: "signed" },
    });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });
    expect(f.captured().path).toContain("streamGenerateContent");
  });
  it("preserves Responses reasoning and reports incomplete streams as errors", async () => {
    const reasoning = {
      type: "reasoning",
      id: "r",
      encrypted_content: "opaque",
    };
    const f = await fixture([
      { type: "response.output_item.done", item: reasoning },
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "c",
          name: "read",
          arguments: '{"path":"a"}',
        },
      },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 5, output_tokens: 2 } },
      },
    ]);
    const events = await collect(
      new NativeProvider({
        type: "openai-responses",
        baseUrl: f.url,
        apiKey: "key",
        model: "gpt",
      })
    );
    expect(events).toContainEqual({
      type: "metadata",
      data: { reasoning: [reasoning] },
    });
    expect(f.captured().body.store).toBe(false);
  });
  it("does not treat EOF as successful model completion", async () => {
    const f = await fixture([
      { type: "response.output_text.delta", delta: "partial" },
    ]);
    const events = await collect(
      new NativeProvider({
        type: "openai-responses",
        baseUrl: f.url,
        apiKey: "key",
        model: "gpt",
      })
    );
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      reason: "error",
      error: expect.stringContaining("before completion"),
    });
  });
});
