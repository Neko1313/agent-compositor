import type {
  CompletionRequest,
  ModelProvider,
  ProviderEvent,
  ChatMessage,
} from "@agent-compositor/core";
import { readSse } from "./openai-compat.js";
import { postJson, type TransportConfig } from "./transport.js";
export interface NativeConfig extends TransportConfig {
  type: "anthropic" | "gemini" | "openai-responses";
  baseUrl?: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  reasoningEffort?: string;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
  promptCacheOptions?: {mode?:"implicit"|"explicit";ttl?:"30m"|"12h"};
  promptCaching?: false | "prefix" | "conversation";
}
const json = (s: string): unknown => JSON.parse(s);
function imageParts(m: ChatMessage, vendor: NativeConfig["type"]): unknown[] {
  return (m.images ?? []).map((image) =>
    vendor === "anthropic"
      ? {
          type: "image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: image.data,
          },
        }
      : vendor === "gemini"
      ? { inlineData: { mimeType: image.mimeType, data: image.data } }
      : {
          type: "input_image",
          image_url: `data:${image.mimeType};base64,${image.data}`,
        }
  );
}
export class NativeProvider implements ModelProvider {
  readonly name: string;
  constructor(private config: NativeConfig) {
    this.name = config.type;
  }
  async *complete(request: CompletionRequest): AsyncIterable<ProviderEvent> {
    const c = this.config,
      model = request.model ?? c.model;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(c.timeoutMs ?? 120000),
    ]);
    let url: string, body: unknown, headers: Record<string, string>;
    if (c.type === "anthropic") {
      url = `${(c.baseUrl ?? "https://api.anthropic.com/v1").replace(
        /\/$/,
        ""
      )}/messages`;
      headers = {
        "x-api-key": c.apiKey,
        "anthropic-version": "2023-06-01",
        ...c.headers,
      };
      const messages = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content:
            m.role === "tool"
              ? [
                  {
                    type: "tool_result",
                    tool_use_id: m.toolCallId,
                    content: m.content,
                  },
                ]
              : [
                  ...(m.content ? [{ type: "text", text: m.content }] : []),
                  ...imageParts(m, c.type),
                  ...(m.toolCalls ?? []).map((t) => ({
                    type: "tool_use",
                    id: t.id,
                    name: t.name,
                    input: t.args,
                  })),
                ],
        }));
      // Anthropic requires adjacent same-role messages to be one message.
      const merged: typeof messages = [];
      for (const message of messages) {
        const last = merged.at(-1);
        if (last?.role === message.role) last.content.push(...message.content);
        else merged.push(message);
      }
      const caching = c.promptCaching ?? "conversation";
      const system = request.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
      body = {
        model,
        stream: true,
        max_tokens: request.maxOutputTokens ?? c.maxOutputTokens ?? 8192,
        ...(caching === "conversation" ? { cache_control: { type: "ephemeral" } } : {}),
        system: caching && system ? [{type:"text",text:system,cache_control:{type:"ephemeral"}}] : system,
        messages: merged,
        tools: request.tools.map((t, i) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
          ...(caching && i === request.tools.length - 1 ? {cache_control:{type:"ephemeral"}} : {}),
        })),
        ...(c.reasoningEffort
          ? { output_config: { effort: c.reasoningEffort } }
          : {}),
      };
    } else if (c.type === "gemini") {
      url = `${(
        c.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
      ).replace(/\/$/, "")}/models/${encodeURIComponent(
        model
      )}:streamGenerateContent?alt=sse`;
      headers = { "x-goog-api-key": c.apiKey, ...c.headers };
      body = {
        systemInstruction: {
          parts: [
            {
              text: request.messages
                .filter((m) => m.role === "system")
                .map((m) => m.content)
                .join("\n\n"),
            },
          ],
        },
        contents: request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts:
              m.role === "tool"
                ? [
                    {
                      functionResponse: {
                        name: m.name,
                        id: m.toolCallId,
                        response: { result: m.content },
                      },
                    },
                  ]
                : [
                    ...(m.content ? [{ text: m.content }] : []),
                    ...imageParts(m, c.type),
                    ...(m.toolCalls ?? []).map((t) => ({
                      functionCall: { id: t.id, name: t.name, args: t.args },
                      ...t.metadata,
                    })),
                  ],
          })),
        tools: request.tools.length
          ? [
              {
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ]
          : undefined,
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens ?? c.maxOutputTokens ?? 8192,
          ...(c.reasoningEffort
            ? { thinkingConfig: { thinkingLevel: c.reasoningEffort } }
            : {}),
        },
      };
    } else {
      url = `${(c.baseUrl ?? "https://api.openai.com/v1").replace(
        /\/$/,
        ""
      )}/responses`;
      headers = { authorization: `Bearer ${c.apiKey}`, ...c.headers };
      let stableSystemEnd=-1;
      for(let i=0;i<request.messages.length&&request.messages[i].role==="system";i++)stableSystemEnd=i;
      if(c.promptCaching!==false&&c.promptCacheOptions?.mode==="explicit"&&stableSystemEnd<0)throw Error("Explicit prompt caching requires leading stable system instructions");
      body = {
        model,
        stream: true,
        store: false,
        ...(c.promptCaching!==false ? (c.promptCacheOptions ? {prompt_cache_options:c.promptCacheOptions} : c.promptCacheRetention ? {prompt_cache_retention:c.promptCacheRetention}:{}):{}),
        ...(c.promptCacheKey && c.promptCaching !== false ? {prompt_cache_key:c.promptCacheKey} : {}),
        include: ["reasoning.encrypted_content"],
        max_output_tokens: request.maxOutputTokens ?? c.maxOutputTokens ?? 8192,
        ...(c.reasoningEffort
          ? { reasoning: { effort: c.reasoningEffort } }
          : {}),
        input: request.messages.flatMap((m,index) =>
          m.role === "tool"
            ? [
                {
                  type: "function_call_output",
                  call_id: m.toolCallId,
                  output: m.content,
                },
              ]
            : [
                ...((m.metadata?.reasoning as unknown[]) ?? []),
                ...(m.content || m.images?.length
                  ? [
                      {
                        role: m.role,
                        content: [
                          {
                            type:
                              m.role === "assistant"
                                ? "output_text"
                                : "input_text",
                            text: m.content,
                            ...(c.promptCaching!==false&&c.promptCacheOptions&&index===stableSystemEnd ? {prompt_cache_breakpoint:{mode:"explicit"}}:{}),
                          },
                          ...imageParts(m, c.type),
                        ],
                      },
                    ]
                  : []),
                ...(m.toolCalls ?? []).map((t) => ({
                  type: "function_call",
                  call_id: t.id,
                  name: t.name,
                  arguments: JSON.stringify(t.args),
                })),
              ]
        ),
        tools: request.tools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: false,
        })),
      };
    }
    try {
      const response = await postJson(url, body, headers, signal, c);
      if (!response.ok)
        throw new Error(
          `HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`
        );
      if (!response.body) throw new Error("Empty model response");
      let cacheWrite = 0, uncachedInput = 0;
      let input = 0,
        output = 0,
        cached = 0,
        finish: "stop" | "tool_calls" | "length" = "stop";
      const tools = new Map<
          number,
          { id: string; name: string; args: string }
        >(),
        calls = new Set<string>();
      const reasoning: unknown[] = [];
      let completed = false,
        reportedUsage = false;
      for await (const e of readSse<any>(response.body, signal)) {
        if (e.error || e.type === "error")
          throw new Error(
            e.error?.message ?? e.message ?? "Provider stream error"
          );
        if (c.type === "anthropic") {
          if (e.type === "message_start") {
            reportedUsage = !!e.message.usage;
            cached = e.message.usage?.cache_read_input_tokens ?? 0;
            cacheWrite = e.message.usage?.cache_creation_input_tokens ?? 0;
            uncachedInput=e.message.usage?.input_tokens ?? 0;
            input=uncachedInput+cached+cacheWrite;
          }
          if (
            e.type === "content_block_start" &&
            e.content_block.type === "tool_use"
          )
            tools.set(e.index, {
              id: e.content_block.id,
              name: e.content_block.name,
              args: Object.keys(e.content_block.input ?? {}).length
                ? JSON.stringify(e.content_block.input)
                : "",
            });
          if (e.type === "content_block_delta" && e.delta.type === "text_delta")
            yield { type: "text_delta", text: e.delta.text };
          if (
            e.type === "content_block_delta" &&
            e.delta.type === "input_json_delta"
          ) {
            const tool = tools.get(e.index);
            if (tool) tool.args += e.delta.partial_json;
          }
          if (e.type === "content_block_stop") {
            const tool = tools.get(e.index);
            if (tool) {
              yield {
                type: "tool_call",
                id: tool.id,
                name: tool.name,
                args: json(tool.args || "{}"),
              };
              finish = "tool_calls";
            }
          }
          if (e.type === "message_stop") completed = true;
          if (e.type === "message_delta") {
            if(e.usage){
              reportedUsage=true;
              uncachedInput=e.usage.input_tokens??uncachedInput;
              cached=e.usage.cache_read_input_tokens??cached;
              cacheWrite=e.usage.cache_creation_input_tokens??cacheWrite;
              input=uncachedInput+cached+cacheWrite;
            }
            output = e.usage?.output_tokens ?? output;
            if (e.delta?.stop_reason === "max_tokens") finish = "length";
          }
        } else if (c.type === "gemini") {
          const candidate = e.candidates?.[0];
          for (const [index, part] of (
            candidate?.content?.parts ?? []
          ).entries()) {
            if (part.text && !part.thought)
              yield { type: "text_delta", text: part.text };
            if (part.functionCall) {
              const call = part.functionCall,
                id = call.id ?? `gemini-${index}-${calls.size}`;
              const key = JSON.stringify(call);
              if (!calls.has(key)) {
                calls.add(key);
                yield {
                  type: "tool_call",
                  id,
                  name: call.name,
                  args: call.args ?? {},
                  metadata: part.thoughtSignature
                    ? { thoughtSignature: part.thoughtSignature }
                    : undefined,
                };
                finish = "tool_calls";
              }
            }
          }
          if (candidate?.finishReason) completed = true;
          if (candidate?.finishReason === "MAX_TOKENS") finish = "length";
          if (
            candidate?.finishReason &&
            !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)
          )
            throw new Error(`Gemini stopped: ${candidate.finishReason}`);
          if (e.usageMetadata) reportedUsage = true;
          input = e.usageMetadata?.promptTokenCount ?? input;
          output = e.usageMetadata ? (e.usageMetadata.candidatesTokenCount??0)+(e.usageMetadata.thoughtsTokenCount??0) : output;
          cached = e.usageMetadata?.cachedContentTokenCount ?? cached;
        } else {
          if (e.type === "response.output_text.delta")
            yield { type: "text_delta", text: e.delta };
          if (
            e.type === "response.output_item.done" &&
            e.item?.type === "reasoning"
          )
            reasoning.push(e.item);
          if (
            e.type === "response.output_item.done" &&
            e.item?.type === "function_call"
          ) {
            yield {
              type: "tool_call",
              id: e.item.call_id,
              name: e.item.name,
              args: json(e.item.arguments),
            };
            finish = "tool_calls";
          }
          if (
            e.type === "response.completed" ||
            e.type === "response.incomplete"
          ) {
            completed = true;
            if (e.response.usage) reportedUsage = true;
            input = e.response.usage?.input_tokens ?? 0;
            output = e.response.usage?.output_tokens ?? 0;
            cached = e.response.usage?.input_tokens_details?.cached_tokens ?? 0;
            cacheWrite=e.response.usage?.input_tokens_details?.cache_write_tokens??0;
            if (e.type === "response.incomplete") finish = "length";
          }
          if (e.type === "response.failed")
            throw new Error(e.response?.error?.message ?? "Response failed");
        }
      }
      if (reasoning.length) yield { type: "metadata", data: { reasoning } };
      if (reportedUsage)
        yield {
          type: "usage",
          inputTokens: input,
          outputTokens: output,
          cachedInputTokens: cached,
          ...(c.type === "anthropic" || cacheWrite ? {cacheWriteInputTokens:cacheWrite} : {}),
        };
      if (!completed)
        throw new Error("Provider stream ended before completion");
      yield { type: "finish", reason: finish };
    } catch (error) {
      if (!request.signal.aborted)
        yield { type: "finish", reason: "error", error: String(error) };
    }
  }
}
