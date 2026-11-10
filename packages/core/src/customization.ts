import type { ChatMessage, ChatToolCall, CompletionRequest, ProviderEvent, ToolDecl } from "./provider.js";
import type { SessionEvent } from "@agent-compositor/session";

/** Storage implementations need not inherit the on-disk SessionStore class. */
export interface SessionJournal {
  create(cwd: string, options: {id:string}): Promise<unknown>;
  append(id: string, events: SessionEvent[], cwd: string): Promise<unknown>;
}

export interface TurnOutcome {
  text: string;
  error?: string;
  metadata?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AgentToolBatchContext {
  readonly signal: AbortSignal;
  withSignal(signal: AbortSignal): AgentToolBatchContext;
  execute(call: ChatToolCall): Promise<void>;
}

/** Invocation-scoped capabilities shared by built-in and extension strategies.
 * They are host objects, not serializable event-log or renderer payloads. */
export interface AgentTurnContext {
  readonly turnId: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly maxSteps: number;
  withSignal(signal: AbortSignal): AgentTurnContext;
  messages(): readonly ChatMessage[];
  tools(): readonly ToolDecl[];
  append(message: ChatMessage): void;
  replace(messages: ChatMessage[]): Promise<void>;
  request(): CompletionRequest;
  stream(request?: CompletionRequest): AsyncIterable<ProviderEvent>;
  execute(calls: ChatToolCall[]): Promise<void>;
  publish(text: string): Promise<string>;
  manageContext(): Promise<void>;
  compact(reason?: string): Promise<void>;
}
