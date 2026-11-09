import { postJson, type TransportConfig } from "./transport.js";
import type {
  ChatMessage,
  ChatToolCall,
  CompletionRequest,
  ModelProvider,
  ProviderEvent,
  ToolDecl,
} from "@agent-compositor/core";

export interface OpenAICompatConfig extends TransportConfig {
  maxOutputTokens?: number;
  reasoningEffort?: string;
  promptCaching?: false | "prefix" | "conversation";
  /** Optional stable routing key; sent only when explicitly configured. */
  promptCacheKey?: string;
  /** e.g. https://api.openai.com/v1 — the /chat/completions suffix is appended */
  baseUrl: string;
  apiKey: string;
  /** default model when the request doesn't pin one */
  model: string;
  /** per-request timeout; AbortError after this (default 120s) */
  timeoutMs?: number;
  /** extra headers (proxies, gateways) */
  headers?: Record<string, string>;
}

interface StreamChoiceDelta {
  delta?: {
    content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string | null;
}

interface StreamPayload {
  choices?: StreamChoiceDelta[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

/**
 * OpenAI-compatible streaming adapter: POST /chat/completions with
 * stream:true, parse the SSE wire into ProviderEvents. Zero dependencies —
 * the SSE reader is ~40 lines and abort/timeout ride fetch natively.
 *
 * Harvested edge cases that bite naive adapters:
 *  - deltas arrive with tool_calls SPLIT ACROSS CHUNKS (arguments arrive as
 *    partial JSON strings keyed by index) — we reassemble per index
 *  - finish_reason can be null until the last chunk; "length" is distinct
 *    from "stop" and surfaces as its own ProviderEvent
 *  - usage often only arrives WITH the stream-end chunk when
 *    stream_options.include_usage is set
 *  - [DONE] sentinel line terminates the stream (anything after is ignored)
 */
export class OpenAICompatProvider implements ModelProvider {
  readonly name = "openai-compat";

  constructor(private config: OpenAICompatConfig) {}

  async *complete(req: CompletionRequest): AsyncIterable<ProviderEvent> {
    const model = req.model ?? this.config.model;
    const signal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(this.config.timeoutMs ?? 120000),
    ]);
    const response = await this.post({ ...req, signal }, model);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      yield {
        type: "finish",
        reason: "error",
        error: `HTTP ${response.status}: ${body.slice(0, 500)}`,
      };
      return;
    }
    if (!response.body) {
      yield { type: "finish", reason: "error", error: "empty response body" };
      return;
    }

    const toolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    const textParts: string[] = [];
    let finish: ProviderEvent | undefined;

    try {
      for await (const payload of readSse<StreamPayload>(
        response.body,
        signal
      )) {
        if (payload.error) {
          yield {
            type: "finish",
            reason: "error",
            error: payload.error.message ?? "stream error",
          };
          return;
        }
        const choice = payload.choices?.[0];
        const delta = choice?.delta;

        if (delta?.content) {
          textParts.push(delta.content);
          yield { type: "text_delta", text: delta.content };
        }

        for (const tc of delta?.tool_calls ?? []) {
          const slot = toolCalls.get(tc.index) ?? {
            id: tc.id ?? "",
            name: "",
            args: "",
          };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          toolCalls.set(tc.index, slot);
        }

        if (payload.usage) {
          yield {
            type: "usage",
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0,
            cachedInputTokens:
              payload.usage.prompt_tokens_details?.cached_tokens,
          };
        }

        if (choice?.finish_reason) {
          // flush assembled tool calls, then finish IN WIRE ORDER — the
          // usage chunk (stream_options.include_usage) arrives AFTER this
          for (const [, tc] of [...toolCalls.entries()].sort(
            (a, b) => a[0] - b[0]
          )) {
            yield {
              type: "tool_call",
              id: tc.id,
              name: tc.name,
              args: safeParseArgs(tc.args),
            };
          }
          const reason = choice.finish_reason;
          finish = {
            type: "finish",
            reason:
              reason === "length"
                ? "length"
                : reason === "tool_calls"
                ? "tool_calls"
                : "stop",
          };
          yield finish;
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        // caller aborted: vanish quietly, the loop owns the narrative
        return;
      }
      yield {
        type: "finish",
        reason: "error",
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    if (req.signal.aborted) return; // aborted between chunks: no synthetic finish
    if (!finish)
      yield {
        type: "finish",
        reason: "error",
        error: "Provider stream ended before completion",
      };
    void textParts;
  }

  private async post(req: CompletionRequest, model: string): Promise<Response> {
    return postJson(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        model,
        stream: true,
        ...(this.config.promptCacheKey && this.config.promptCaching !== false ? {prompt_cache_key:this.config.promptCacheKey} : {}),
        stream_options: { include_usage: true },
        ...(req.maxOutputTokens ?? this.config.maxOutputTokens
          ? { max_tokens: req.maxOutputTokens ?? this.config.maxOutputTokens }
          : {}),
        messages: req.messages.map(toWire),
        tools: req.tools.length ? req.tools.map(toWireTool) : undefined,
        ...(this.config.reasoningEffort
          ? { reasoning_effort: this.config.reasoningEffort }
          : {}),
      },
      { authorization: `Bearer ${this.config.apiKey}`, ...this.config.headers },
      req.signal,
      this.config
    );
  }
}

function toWire(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((c: ChatToolCall) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      })),
    };
  }
  return {
    role: message.role,
    content: message.images?.length
      ? [
          { type: "text", text: message.content },
          ...message.images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
          })),
        ]
      : message.content,
  };
}

function toWireTool(tool: ToolDecl): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function safeParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    // a model that emits invalid JSON still deserves a tool call with the raw text
    return { _raw: raw };
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Minimal SSE reader: yields parsed JSON payloads from `data:` lines,
 * terminates on `[DONE]`, ignores comments/blank lines and other fields.
 */
export async function* readSse<T>(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trimEnd();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data) as T;
        } catch {
          // partial JSON across line boundaries: keep buffering silently
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
