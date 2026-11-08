/**
 * Model provider contract — the seam the whole loop hangs on.
 * `service.model.complete` resolves through this; the loop never talks to a
 * vendor SDK directly, so plugins can intercept, rewrite, or fake every call.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** tool result messages carry the call they answer */
  callId?: string;
  name?: string;
  /** assistant messages may carry the tool calls they spawned */
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  name: string;
  input: unknown;
  callId: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ModelProvider {
  readonly id: string;
  complete(request: ChatRequest): Promise<ModelResponse>;
}

/**
 * Deterministic provider for tests and offline demos: replays canned steps in
 * order and records every request so tests can assert on the conversation.
 */
export interface ScriptedStep {
  text?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ScriptedProvider extends ModelProvider {
  readonly requests: ChatRequest[];
}

export function scriptedProvider(steps: ScriptedStep[]): ScriptedProvider {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    id: "scripted",
    requests,
    async complete(request) {
      // snapshot: the loop keeps mutating `messages` after we record the request
      requests.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });
      const step = steps[Math.min(i++, steps.length - 1)] ?? {};
      return {
        text: step.text ?? "",
        toolCalls: step.toolCalls ?? [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

/**
 * OpenAI-compatible provider (chat/completions + streaming tool_calls),
 * driven by fetch. Works against OpenAI, vLLM, llama.cpp, LiteLLM, etc.
 */
export function openAiCompatibleProvider(config: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  id?: string;
}): ModelProvider {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    id: config.id ?? "openai-compatible",
    async complete(request) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: request.messages.map((m) => {
            if (m.role === "tool") {
              return { role: "tool", tool_call_id: m.callId, content: m.content };
            }
            return { role: m.role, content: m.content };
          }),
          tools: request.tools?.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
        }),
        signal: request.signal,
      });
      if (!res.ok || res.body === null) {
        throw new Error(`model request failed: ${res.status} ${await res.text().catch(() => "")}`);
      }

      // SSE fold: text deltas accumulate; tool_call deltas accumulate by index.
      let text = "";
      const toolParts = new Map<number, { name: string; arguments: string; callId: string }>();
      let usage: ModelResponse["usage"];
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          let delta: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
          };
          try {
            delta = JSON.parse(payload);
          } catch {
            continue; // partial JSON line — the buffered reader will not split mid-payload, but be kind anyway
          }
          const d = delta.choices?.[0]?.delta;
          if (d?.content) text += d.content;
          for (const tc of d?.tool_calls ?? []) {
            const part = toolParts.get(tc.index) ?? { name: "", arguments: "", callId: tc.id ?? `call_${tc.index}` };
            if (tc.id) part.callId = tc.id;
            if (tc.function?.name) part.name += tc.function.name;
            if (tc.function?.arguments) part.arguments += tc.function.arguments;
            toolParts.set(tc.index, part);
          }
          if (delta.usage) {
            usage = { inputTokens: delta.usage.prompt_tokens, outputTokens: delta.usage.completion_tokens };
          }
        }
      }

      const toolCalls: ToolCallRequest[] = [...toolParts.entries()].map(([, p]) => ({
        name: p.name,
        callId: p.callId,
        input: safeParseJson(p.arguments),
      }));
      return { text, toolCalls, usage };
    },
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
