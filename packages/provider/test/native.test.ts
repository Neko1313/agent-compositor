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
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 3, cache_creation_input_tokens:7 } },
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
      inputTokens: 20,
      outputTokens: 4,
      cachedInputTokens: 3,
      cacheWriteInputTokens:7,
    });
    expect(f.captured().headers["x-api-key"]).toBe("key");
    expect(f.captured().body.system).toEqual([{type:"text",text:"instructions",cache_control:{type:"ephemeral"}}]);
    expect(f.captured().body.cache_control).toEqual({type:"ephemeral"});
    expect(f.captured().body.tools[0].cache_control).toEqual({type:"ephemeral"});
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

describe("cache wire contracts",()=>{
  it("keeps shared tool/system prefixes stable across changing task suffixes and supports opt-out",async()=>{
    const f=await fixture([{type:"message_stop"}]);
    const provider=new NativeProvider({type:"anthropic",baseUrl:f.url,apiKey:"fixture",model:"claude"});
    const run=async(p:NativeProvider,r:CompletionRequest)=>{for await(const _ of p.complete(r)){}return structuredClone(f.captured().body);};
    const first=await run(provider,request());const next=request();next.messages.push({role:"assistant",content:"inspect result"},{role:"user",content:"a different task"});
    const second=await run(provider,next);
    expect(second.system).toEqual(first.system);expect(second.tools).toEqual(first.tools);expect(second.messages.slice(0,1)).toEqual(first.messages);
    expect(next.messages.some(m=>(m as any).cache_control)).toBe(false);
    const prefix=await run(new NativeProvider({type:"anthropic",baseUrl:f.url,apiKey:"fixture",model:"claude",promptCaching:"prefix"}),request());
    expect(prefix.cache_control).toBeUndefined();expect(prefix.system[0].cache_control).toBeDefined();
    const off=await run(new NativeProvider({type:"anthropic",baseUrl:f.url,apiKey:"fixture",model:"claude",promptCaching:false}),request());
    expect(off.system).toBe("instructions");expect(JSON.stringify(off)).not.toContain('cache_control');
  });
  it("routes Responses cache keys only when explicitly configured",async()=>{
    const f=await fixture([{type:"response.completed",response:{usage:{input_tokens:100,output_tokens:1,input_tokens_details:{cached_tokens:80}}}}]);
    const provider=new NativeProvider({type:"openai-responses",baseUrl:f.url,apiKey:"fixture",model:"test",promptCacheKey:"stable-project-prefix"});
    const events=await collect(provider);expect(f.captured().body.prompt_cache_key).toBe("stable-project-prefix");expect(events).toContainEqual({type:"usage",inputTokens:100,outputTokens:1,cachedInputTokens:80});
  });
});
