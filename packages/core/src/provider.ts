/**
 * The streaming model-provider contract. The core only speaks this; adapters
 * for OpenAI-compatible APIs, Anthropic, or test scripts plug in behind it.
 */
export interface ChatToolCall {
  id: string;
  name: string;
  args: unknown;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Host-generated continuation feedback, not a new user task. */
  origin?: "harness";
  content: string;
  images?: { mimeType: string; data: string }[];
  metadata?: Record<string, unknown>;
  toolCallId?: string;
  name?: string;
  toolCalls?: ChatToolCall[];
}

export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
      metadata?: Record<string, unknown>;
    }
  | { type: "metadata"; data: Record<string, unknown> }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteInputTokens?: number;
      estimated?: boolean;
    }
  | {
      type: "finish";
      reason: "stop" | "tool_calls" | "length" | "error";
      error?: string;
    };

export interface CompletionRequest {
  messages: ChatMessage[];
  tools: ToolDecl[];
  signal: AbortSignal;
  model?: string;
  profile?: string;
  maxOutputTokens?: number;
}

export interface ModelCapabilities {
  contextWindow: number; maxOutputTokens?: number;
  source: "configured" | "provider" | "catalog" | "fallback";
}

export interface ModelProvider {
  capabilities?(signal: AbortSignal, profile?: string): Promise<ModelCapabilities>;
  readonly name: string;
  complete(req: CompletionRequest): AsyncIterable<ProviderEvent>;
}

/** One canned step of a scripted conversation. `hold` parks the stream until
 * release() or abort — deterministic hooks for steer/queue/interrupt tests. */
export interface ScriptedStep {
  text?: string;
  toolCalls?: { name: string; args: unknown }[];
  finish?: "stop" | "tool_calls" | "length" | "error";
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  hold?: boolean;
}

/**
 * Deterministic provider for tests and headless demos. Each complete() call
 * consumes one script step; every request is recorded so tests can assert
 * exactly what the loop sent (steer injection, tool-result feedback).
 */
export class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  readonly requests: CompletionRequest[] = [];

  constructor(
    private script: ScriptedStep[],
    private opts: { respectSignal?: boolean } = {}
  ) {}

  async *complete(req: CompletionRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(req);
    const step = this.script.shift();
    if (!step) {
      yield { type: "finish", reason: "stop" };
      return;
    }
    // Register the hold before yielding: consumers may release while handling
    // the first event, before this generator is resumed.
    const parked = step.hold ? this.waitForRelease(req.signal) : undefined;
    try {
      if (step.text) yield { type: "text_delta", text: step.text };
      let n = 0;
      for (const tc of step.toolCalls ?? []) {
        yield { type: "tool_call", id: `call_${this.requests.length}_${n++}`, name: tc.name, args: tc.args };
      }
      if (step.usage) yield { type: "usage", inputTokens: step.usage.inputTokens, outputTokens: step.usage.outputTokens };
      if (parked) {
        await parked.promise;
        if (req.signal.aborted) return;
      } else if (this.opts.respectSignal && req.signal.aborted) return;
      yield { type: "finish", reason: step.finish ?? (step.toolCalls ? "tool_calls" : "stop"), error: step.error };
    } finally { parked?.dispose(); }
  }

  private releases: Array<() => void> = [];

  /** Unblock the earliest active held step, including while its events are consumed. */
  release(): void { this.releases.shift()?.(); }

  private waitForRelease(signal: AbortSignal): {promise:Promise<void>;dispose:()=>void} {
    let finish!: () => void;
    const promise = new Promise<void>(resolve => { finish = resolve; });
    const dispose = () => {
      const index = this.releases.indexOf(release);
      if (index >= 0) this.releases.splice(index, 1);
      signal.removeEventListener('abort', release);
    };
    const release = () => { dispose(); finish(); };
    this.releases.push(release);
    signal.addEventListener('abort', release, {once:true});
    if (signal.aborted) release();
    return {promise,dispose};
  }

  get exhausted(): boolean {
    return this.script.length === 0;
  }
}
