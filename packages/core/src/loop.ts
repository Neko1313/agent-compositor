import { randomUUID } from "node:crypto";
import { Runtime, type PluginManifest, type Tier } from "@agent-compositor/runtime";
import { HooksHost, type UserHookFn } from "@agent-compositor/hooks";
import {
  ApprovalSession,
  compileRules,
  evaluate,
  type PermissionRule,
  type ToolCallDescriptor,
} from "@agent-compositor/permissions";
import { SessionStore } from "@agent-compositor/session";
import {
  builtinTools,
  builtinToolRules,
  registerDefaultResolvers,
  UndoStore,
  type ToolContext,
  type ToolSpec,
} from "@agent-compositor/tools";
import type { ChatMessage, ChatToolCall, ModelProvider, ToolDecl } from "./provider.js";

export interface CorePlugin {
  manifest: PluginManifest;
  hooks: Record<string, UserHookFn>;
  tier?: Tier;
}

export interface AgentCoreOptions {
  cwd: string;
  provider: ModelProvider;
  plugins?: CorePlugin[];
  /** user permission rules; builtin conservative defaults prepend them */
  rules?: PermissionRule[];
  approvals?: ApprovalSession;
  /** renderer hook: ask the human about a tool call; undefined = headless (ask → deny) */
  onApproval?: (req: { tool: string; descriptor: ToolCallDescriptor; reason?: string }) => Promise<boolean>;
  sessions?: SessionStore;
  sessionId?: string;
  systemPrompt?: string;
  maxStepsPerTurn?: number;
  tools?: ToolSpec<unknown, unknown>[];
  notify?: (message: string, level: "info" | "warn" | "error", plugin: string) => void;
}

/** Renderer-facing event stream: catalog emissions plus the raw text fast path. */
export type LoopEvent =
  | { kind: "catalog"; event: string; input: Record<string, unknown> }
  | { kind: "text"; turnId: string; delta: string };

type EmitValue = { value: unknown };

export type CoreState = "idle" | "running" | "interrupted";

/**
 * The greenfield agent core. Every seam is a catalog event fired through the
 * hooks dispatcher:
 *
 *   prompt.submit → turn.start → turn.step → [provider stream:
 *     assistant.text deltas, tool_calls] → tool.call → tool.check →
 *     service.shell.exec / service.file.* (core tools ride the chain; a
 *     plugin can deny/answer any of them) → tool.result → … → turn.complete
 *
 * Steering (codex Tab) injects mid-turn; prompts while busy queue
 * (codex Enter); interrupt aborts the stream best-effort. Fail-operational:
 * tool errors are values, model errors end the turn but not the session.
 */
export class AgentCore {
  readonly runtime: Runtime;
  readonly host: HooksHost;
  readonly sessionId: string;

  private readonly provider: ModelProvider;
  private readonly toolSpecs: ToolSpec<unknown, unknown>[];
  private readonly compiledRules: ReturnType<typeof compileRules>;
  private readonly approvals?: ApprovalSession;
  private readonly onApproval?: AgentCoreOptions["onApproval"];
  private readonly sessions?: SessionStore;
  private readonly maxSteps: number;
  private readonly undo = new UndoStore();

  private messages: ChatMessage[] = [];
  private promptQueue: string[] = [];
  private steerQueue: string[] = [];
  private abort: AbortController = new AbortController();
  private interruptedByUser = false;
  private state: CoreState = "idle";
  private listeners = new Set<(ev: LoopEvent) => void>();

  constructor(private options: AgentCoreOptions) {
    this.provider = options.provider;
    this.sessionId = options.sessionId ?? randomUUID();
    this.maxSteps = options.maxStepsPerTurn ?? 32;
    this.toolSpecs = options.tools ?? builtinTools;
    this.approvals = options.approvals;
    this.onApproval = options.onApproval;
    this.sessions = options.sessions;
    this.compiledRules = compileRules([...builtinToolRules, ...(options.rules ?? [])], "config");

    this.runtime = new Runtime();
    this.host = new HooksHost(this.runtime, {
      session: { id: this.sessionId, cwd: options.cwd },
      workspaceRoot: options.cwd,
      notify: options.notify,
      // $.model.complete rides the configured provider (collected to text)
      model: {
        complete: async (request) => {
          let text = "";
          for await (const ev of this.provider.complete({
            messages: request.messages as ChatMessage[],
            tools: [],
            signal: this.abort.signal,
          })) {
            if (ev.type === "text_delta") text += ev.text;
          }
          return text;
        },
      },
    });

    // core resolvers at the chain end; everything above them can deny/value
    registerDefaultResolvers({
      on: (service, handler) => {
        this.runtime.setResolver(service, async (payload: unknown) => ({ value: await handler(payload) }));
      },
    });

    for (const plugin of options.plugins ?? []) {
      this.host.registerPlugin(plugin.manifest, plugin.hooks, plugin.tier);
    }

    if (options.systemPrompt) this.messages.push({ role: "system", content: options.systemPrompt });
  }

  getState(): CoreState {
    return this.state;
  }

  /** Current message history (for introspection / future resume replay). */
  getMessages(): readonly ChatMessage[] {
    return this.messages;
  }

  get undoLog(): UndoStore {
    return this.undo;
  }

  subscribe(fn: (ev: LoopEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Renderer entry: send a prompt. If busy, it queues (codex Enter). */
  async submit(text: string): Promise<void> {
    if (this.state === "running") {
      this.promptQueue.push(text);
      await this.emit("prompt.queued", { text, depth: this.promptQueue.length });
      return;
    }
    await this.runTurn(text);
    await this.drainQueue();
  }

  /** Renderer entry: steer the running turn (codex Tab). Idles fall back to submit. */
  async steer(text: string): Promise<void> {
    if (this.state !== "running") {
      await this.submit(text);
      return;
    }
    this.steerQueue.push(text);
    await this.emit("prompt.steer", { turnId: this.currentTurnId ?? "", text });
  }

  /** Renderer entry: interrupt the running turn. */
  interrupt(): void {
    if (this.state !== "running") return;
    this.interruptedByUser = true;
    this.abort.abort();
  }

  private currentTurnId: string | undefined;

  // ---- the turn engine -----------------------------------------------------

  private async runTurn(text: string): Promise<void> {
    const turnId = randomUUID();
    this.currentTurnId = turnId;
    this.state = "running";
    this.interruptedByUser = false;
    this.abort = new AbortController();

    const submitted = await this.emit("prompt.submit", { text });
    if (submitted && typeof submitted === "object" && "drop" in submitted) {
      this.state = "idle";
      return;
    }
    const promptText =
      submitted && typeof submitted === "object" && "text" in submitted && typeof (submitted as { text: unknown }).text === "string"
        ? (submitted as { text: string }).text
        : text;
    this.messages.push({ role: "user", content: promptText });
    await this.emit("turn.start", { turnId });

    let fullText = "";
    let failed: string | undefined;

    for (let step = 0; step < this.maxSteps; step++) {
      // steering lands at the natural step boundary
      while (this.steerQueue.length > 0) {
        const steerText = this.steerQueue.shift()!;
        this.messages.push({ role: "user", content: steerText });
      }

      await this.emit("turn.step", { turnId });
      const batch: ChatToolCall[] = [];
      let finish: { reason: string; error?: string } | undefined;

      try {
        for await (const ev of this.provider.complete(this.request())) {
          if (this.abort.signal.aborted) break;
          if (ev.type === "text_delta") {
            const rewritten = await this.emit("assistant.text", { turnId, text: ev.text });
            const delta =
              rewritten && typeof rewritten === "object" && "text" in rewritten && typeof (rewritten as { text: unknown }).text === "string"
                ? (rewritten as { text: string }).text
                : ev.text;
            fullText += delta;
            this.broadcast({ kind: "text", turnId, delta });
          } else if (ev.type === "tool_call") {
            batch.push({ id: ev.id, name: ev.name, args: ev.args });
          } else if (ev.type === "finish") {
            finish = ev;
          }
        }
      } catch (err) {
        if (this.interruptedByUser || this.abort.signal.aborted) break;
        failed = err instanceof Error ? err.message : String(err);
        break;
      }

      if (this.interruptedByUser || this.abort.signal.aborted) break;

      if (batch.length > 0) {
        this.messages.push({ role: "assistant", content: fullText, toolCalls: batch });
        fullText = "";
        await this.runToolBatch(turnId, batch);
        continue;
      }

      if (finish?.reason === "error") {
        failed = finish.error ?? "provider error";
        break;
      }
      if (finish?.reason === "length") {
        failed = "model stopped: context length";
        break;
      }
      break; // stop
    }

    if (this.interruptedByUser) {
      this.state = "interrupted";
      await this.emit("turn.interrupted", { turnId });
    } else if (failed !== undefined) {
      if (fullText) this.messages.push({ role: "assistant", content: fullText });
      await this.emit("turn.failed", { turnId, error: failed });
      this.state = "idle";
    } else {
      if (fullText) this.messages.push({ role: "assistant", content: fullText });
      await this.emit("turn.complete", { turnId, text: fullText });
      this.state = "idle";
    }
    this.currentTurnId = undefined;
  }

  private async drainQueue(): Promise<void> {
    while (this.promptQueue.length > 0 && this.state !== "running") {
      const next = this.promptQueue.shift()!;
      await this.runTurn(next);
    }
  }

  private async runToolBatch(turnId: string, batch: ChatToolCall[]): Promise<void> {
    for (const call of batch) {
      const spec = this.toolSpecs.find((t) => t.name === call.name);
      if (!spec) {
        await this.emit("tool.result", { callId: call.id, tool: call.name, ok: false, error: `unknown tool: ${call.name}` });
        this.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: `unknown tool: ${call.name}` });
        continue;
      }

      const args = call.args ?? {};
      // 1) tool.call: a plugin may answer ({result}) or refuse ({deny})
      const intercepted = await this.emit("tool.call", { tool: call.name, input: args, callId: call.id });
      let result: unknown;
      let denied = false;
      let error: string | undefined;

      const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

      if (isObject(intercepted)) {
        if ("result" in intercepted) {
          result = intercepted.result;
        } else if ("deny" in intercepted) {
          denied = true;
          error = `denied: ${String(intercepted.deny)}`;
        }
      }

      if (error === undefined && !isObject(intercepted)) {
        // 2) permissions via tool.check (chain may override with {decision})
        const descriptor = spec.describe(args);
        let decision = evaluate(descriptor, this.compiledRules, this.approvals);
        const checkRes = await this.emit("tool.check", {
          tool: call.name,
          input: args,
          callId: call.id,
          isReadOnly: call.name === "read",
        });
        if (checkRes && typeof checkRes === "object" && "decision" in checkRes) {
          const override = (checkRes as { decision: "allow" | "ask" | "deny"; reason?: string }).decision;
          decision = { ...decision, decision: override };
        }

        if (decision.decision === "deny") {
          denied = true;
          error = `denied by permission rules${decision.rule?.reason ? `: ${decision.rule.reason}` : ""}`;
        } else if (decision.decision === "ask") {
          const allowed = this.onApproval
            ? await this.onApproval({ tool: call.name, descriptor, reason: decision.rule?.reason })
            : false;
          if (!allowed) {
            denied = true;
            error = "denied: no approval (headless or user declined)";
          }
        }

        // 3) execute through the $ service chain
        if (!denied) {
          const ctx = this.buildToolContext();
          const executed = await spec.execute(ctx, args);
          if (executed.ok) {
            result = executed.data;
          } else {
            error = executed.error;
            denied = executed.denied ?? false;
          }
        }
      }

      await this.emit("tool.result", {
        callId: call.id,
        tool: call.name,
        ok: error === undefined,
        output: error === undefined ? result : undefined,
        error,
        denied: denied || undefined,
      });
      this.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: error ?? JSON.stringify(result, null, 2)?.slice(0, 20_000),
      });
      void turnId;
    }
  }

  private buildToolContext(): ToolContext {
    return {
      cwd: this.options.cwd,
      signal: this.abort.signal,
      undo: this.undo,
      request: async <T = unknown>(service: string, payload: unknown): Promise<T> => {
        const res = await this.host.emit(service, payload);
        const v = (res as EmitValue).value as Record<string, unknown> | undefined;
        if (v && typeof v === "object" && "deny" in v && typeof v.deny === "string") {
          throw new Error(`denied by chain interceptor: ${v.deny}`);
        }
        if (v && typeof v === "object" && "value" in v) return v.value as T;
        return v as T;
      },
    };
  }

  private request(): { messages: ChatMessage[]; tools: ToolDecl[]; signal: AbortSignal } {
    return {
      messages: this.messages.map((m) => ({ ...m })),
      tools: this.toolSpecs.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      signal: this.abort.signal,
    };
  }

  private async emit(event: string, input: Record<string, unknown>): Promise<unknown> {
    this.broadcast({ kind: "catalog", event, input });
    const gen = this.runtime.emit(event, input);
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    const result = step.value as { value?: unknown } | undefined;
    await this.persist(event, input);
    return result?.value;
  }

  private broadcast(ev: LoopEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {
        // a broken renderer must not kill the loop
      }
    }
  }

  private async persist(event: string, input: Record<string, unknown>): Promise<void> {
    if (!this.sessions) return;
    try {
      await this.sessions.append(this.sessionId, [{ type: event, ...input }], this.options.cwd);
    } catch {
      // storage is best-effort; the turn must not die on a full disk
    }
  }
}
