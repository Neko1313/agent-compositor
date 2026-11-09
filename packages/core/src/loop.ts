import {
  optionLabel, questionSchema, questionnaireSchema, validateQuestionnaireResult,
  type UserQuestionRequest, type UserQuestionAnswer,
} from "@agent-compositor/events";
import { resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";
import {
  Runtime,
  type PluginManifest,
  type Tier,
} from "@agent-compositor/runtime";
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
  compactTranscript,
  TokenBudget,
  estimateMessageTokens,
  estimateTokens,
  type Summarizer,
} from "@agent-compositor/context";
import {
  builtinTools,
  createToolHelp,
  execTool,
  isReadOnlyShell,
  builtinToolRules,
  registerDefaultResolvers,
  UndoStore,
  type ToolContext,
  type ToolSpec,
} from "@agent-compositor/tools";
import { replayTranscript } from "./resume.js";
import { askTool, askQuestionsTool, taskTool, SUBAGENT_SYSTEM_PROMPT } from "./tools/index.js";
import type {
  ChatMessage,
  ChatToolCall,
  ModelProvider,
  ToolDecl,
  CompletionRequest,
  ProviderEvent,
} from "./provider.js";

export interface CorePlugin {
  manifest: PluginManifest;
  hooks: Record<string, UserHookFn>;
  tier?: Tier;
}

export interface AgentCoreOptions {
  /** Internal host fallback, inherited by ephemeral children. */
  permissionReview?: (input:Record<string,unknown>)=>Promise<unknown>;
  /** Ancestor budget guard for ephemeral/background children. */
  remainingTokens?: ()=>number;
  maxTokensPerTurn?: number;
  maxTokensPerSession?: number;
  auth?: ConstructorParameters<typeof HooksHost>[1]["auth"];
  serviceProviders?: Record<string, string>;
  preparePrompt?: (
    text: string
  ) => Promise<string | { text: string; images?: ChatMessage["images"] }>;
  initialImages?: ChatMessage["images"];
  model?: () => string;
  modelProfile?: string;
  /** Host service resolvers are inherited by children (e.g. the skill registry). */
  services?: Record<string, (payload: any) => unknown | Promise<unknown>>;
  storage?: ConstructorParameters<typeof HooksHost>[1]["storage"];
  toolEnv?: () => Record<string, string>;
  fetch?: typeof fetch;
  cwd: string;
  provider: ModelProvider;
  plugins?: CorePlugin[];
  /** user permission rules; builtin conservative defaults prepend them */
  rules?: PermissionRule[];
  approvals?: ApprovalSession;
  /** renderer hook: ask the human about a tool call; undefined = headless (ask → deny) */
  onApproval?: (req: {
    tool: string;
    descriptor: ToolCallDescriptor;
    reason?: string;
    signal?: AbortSignal;
  }) => Promise<
    boolean | { allow: boolean; scope?: "once" | "session" | "project" }
  >;
  persistApprovals?: (
    approvals: readonly import("@agent-compositor/permissions").Approval[]
  ) => Promise<void>;
  sessions?: SessionStore;
  sessionId?: string;
  systemPrompt?: string;
  maxStepsPerTurn?: number;
  maxConsecutiveToolFailures?:number;
  /** replace the builtin toolset wholesale (tests, embedders) */
  tools?: ToolSpec<unknown, unknown>[];
  /** append model-facing tools (e.g. plugin-provided tools.ts) on top of the builtins */
  extraTools?: ToolSpec<unknown, unknown>[];
  /** AskUserQuestion channel; undefined = headless, questions are denied (fail closed) */
  onAsk?: (req:UserQuestionRequest)=>Promise<UserQuestionAnswer>;
  /** recursion guard for the task tool / service.agent.spawn (default 2 deep) */
  subagentDepth?: number;
  maxSubagentDepth?: number;
  notify?: (
    message: string,
    level: "info" | "warn" | "error",
    plugin: string
  ) => void;
  /** wire context pressure management into the loop: trip the budget → compact */
  compaction?: {
    budget: TokenBudget;
    summarize: Summarizer;
    /** Rebind auxiliary model calls when creating an isolated child. */
    fork?: (stream:(request:CompletionRequest)=>AsyncIterable<ProviderEvent>,window:()=>number)=>Summarizer;
    /** minimum messages between compactions (default 8) */
    cooldownMessages?: number;
    limits?: () => Partial<import("@agent-compositor/context").BudgetConfig>;
  };
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
  private toolSpecs: ToolSpec<unknown, unknown>[];
  private readonly compiledRules: ReturnType<typeof compileRules>;
  private readonly approvals?: ApprovalSession;
  private readonly onApproval?: AgentCoreOptions["onApproval"];
  private readonly sessions?: SessionStore;
  private readonly maxSteps: number;
  private readonly undo = new UndoStore();

  private messages: ChatMessage[] = [];
  private baseInstructions = "";
  private turnToolRecords:Array<{name:string;args:unknown;ok:boolean;output?:unknown}>=[];
  private contextSource = "fallback";
  private contextWindow = 32768;
  private outputLimit?:number;
  private promptQueue: string[] = [];
  private steerQueue: string[] = [];
  private abort: AbortController = new AbortController();
  private interruptedByUser = false;
  private state: CoreState = "idle";
  private listeners = new Set<(ev: LoopEvent) => void>();
  private inPromptHook = false;
  private invokingTool = false;

  constructor(private options: AgentCoreOptions) {
    for (const value of [
      options.maxTokensPerTurn,
      options.maxTokensPerSession,
      options.maxStepsPerTurn,
      options.maxConsecutiveToolFailures,
    ])
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
        throw new Error("Agent budgets must be positive integers");
    this.provider = options.provider;
    this.sessionId = options.sessionId ?? randomUUID();
    this.maxSteps = options.maxStepsPerTurn ?? 32;
    this.toolSpecs = this.composeTools(options.extraTools ?? []);
    this.approvals = options.approvals;
    this.onApproval = options.onApproval;
    this.sessions = options.sessions;
    this.compiledRules = compileRules(
      [
        ...builtinToolRules,
        {
          decision: "allow",
          tool: "task",
          reason: "subagents run under the same permission gate",
        },
        {
          decision: "allow",
          tool: "ask_user",
          reason: "asking the user is not a side effect",
        },
        {decision:"allow",tool:"ask_questions",reason:"human questionnaire is not an execution approval"},
        ...(options.rules ?? []),
      ],
      "config"
    );

    this.runtime = new Runtime({ providers: options.serviceProviders });
    this.host = new HooksHost(this.runtime, {
      session: { id: this.sessionId, cwd: options.cwd },
      workspaceRoot: options.cwd,
      storage: options.storage,
      execEnvironment: options.toolEnv,
      auth: options.auth,
      signal: () => this.abort.signal,
      onPluginRemoved: (plugin) =>
        this.broadcast({
          kind: "catalog",
          event: "ui.pluginRemoved",
          input: { plugin },
        }),
      notify: (message, level, plugin) => {
        options.notify?.(message, level, plugin);
        this.broadcast({
          kind: "catalog",
          event: "ui.notification",
          input: { message, level, plugin },
        });
      },
      // $.model.complete rides the configured provider (collected to text)
      model: {
        complete: async (request) => {
          let text = "";
          for await (const ev of this.streamModel({
            messages: request.messages as ChatMessage[],
            tools: [],
            profile:
              typeof request.profile === "string" ? request.profile : undefined,
            maxOutputTokens:
              typeof request.maxOutputTokens === "number" &&
              Number.isFinite(request.maxOutputTokens) &&
              request.maxOutputTokens > 0
                ? Math.floor(request.maxOutputTokens)
                : undefined,
            signal:
              request.signal instanceof AbortSignal
                ? AbortSignal.any([this.abort.signal, request.signal])
                : this.abort.signal,
          })) {
            if (ev.type === "text_delta") text += ev.text;
            if (text.length > 64000)
              throw new Error("Plugin model response exceeds limit");
            if (ev.type === "finish" && ev.reason !== "stop")
              throw new Error(
                ev.error ?? `Incomplete model response: ${ev.reason}`
              );
          }
          return text;
        },
      },
      agent: {
        compact: (reason) => this.compactNow(),
        clear: () => this.clear(),
      },
    });

    this.runtime.setResolver(
      "service.ui.configure",
      (input: {
        plugin?: string;
        appearance: import("@agent-compositor/events").UiAppearance | null;
      }) => {
        this.broadcast({ kind: "catalog", event: "ui.appearance", input });
        return { value: true };
      }
    );
    this.runtime.setResolver("service.ui.inputTarget", (input: any) => {
      this.broadcast({ kind: "catalog", event: "ui.inputTarget", input });
      return { value: true };
    });
    this.runtime.setResolver(
      "ui.invalidate",
      (input: Record<string, unknown>) => {
        this.broadcast({ kind: "catalog", event: "ui.invalidate", input });
      }
    );
    this.runtime.setResolver(
      "service.ui.surface",
      (input: {
        id: string;
        title: string;
        text: string;
        plugin?: string;
        placement?: import("@agent-compositor/events").SurfacePlacement;
      }) => {
        this.broadcast({
          kind: "catalog",
          event: "ui.surface",
          input: {
            ...input,
            surface: input.id,
            id: `plugin-${input.plugin ?? "custom"}-${input.id}`
              .replace(/[^A-Za-z0-9_-]/g, "_")
              .slice(0, 64),
          },
        });
        return { value: true };
      }
    );
    this.runtime.setResolver(
      "service.ui.view",
      (input: {
        id: string;
        title: string;
        plugin?: string;
        view: import("@agent-compositor/events").UiTextView;
      }) => {
        this.broadcast({
          kind: "catalog",
          event: "ui.surface",
          input: {
            ...input,
            text: input.view.lines.map((row) => row.text).join("\n"),
            surface: input.id,
            id: `plugin-${input.plugin ?? "custom"}-${input.id}`
              .replace(/[^A-Za-z0-9_-]/g, "_")
              .slice(0, 64),
          },
        });
        return { value: true };
      }
    );
    this.runtime.setResolver(
      "service.ui.remove",
      (input: { plugin: string; id: string }) => {
        this.broadcast({
          kind: "catalog",
          event: "ui.surfaceRemoved",
          input: {
            id: `plugin-${input.plugin}-${input.id}`
              .replace(/[^A-Za-z0-9_-]/g, "_")
              .slice(0, 64),
          },
        });
        return { value: true };
      }
    );
    this.runtime.setResolver(
      "service.agent.tool",
      async ({ name, args }: { name: string; args: unknown }) => ({
        value: await this.invokeTool(name, args),
      })
    );

    // core resolvers at the chain end; everything above them can deny/value
    registerDefaultResolvers(
      {
        on: (service, handler) => {
          this.runtime.setResolver(service, async (payload: unknown) => ({
            value: await handler(payload),
          }));
        },
      },
      {
        root: options.cwd,
        signal: () => this.abort.signal,
        env: options.toolEnv,
        onFilesChanged: async (path: string) => {
          await this.emit("project.changed", {
            cwd: options.cwd,
            paths: [path],
            reason: "tool",
          });
        },
      }
    );
    this.runtime.setResolver(
      "service.model.stream",
      ({ request }: { request: CompletionRequest }) => ({
        value: this.provider.complete(request),
      })
    );
    this.runtime.setResolver("service.model.capabilities", async (e:any) => ({value: await (this.provider.capabilities?.(e.signal ?? this.abort.signal) ?? Promise.resolve(null))}));
    this.runtime.setResolver("service.agent.instructions", () => ({value:""}));
    this.runtime.setResolver("service.agent.finish", () => ({value:{complete:true}}));
    this.runtime.setResolver("service.permission.review", async (input:Record<string,unknown>) =>
      options.permissionReview ? await options.permissionReview(input) : {value:{decision:"ask"}});
    this.runtime.setResolver(
      "service.context.control",
      async (input: {
        action: string;
        beforeTurn?: boolean;
        messages?: ChatMessage[];
      }) => {
        if (input.action === "snapshot")
          return {
            value: {
              sessionId: this.sessionId,
              canRestore: this.controlsReady || this.invokingTool,
              messages: structuredClone(
                input.beforeTurn && this.messages.at(-1)?.role === "user"
                  ? this.messages.slice(0, -1)
                  : this.messages
              ),
            },
          };
        if (!this.controlsReady && !this.invokingTool)
          return {
            deny: "Restore context from interactive controls after the turn finishes",
          };
        if (
          !Array.isArray(input.messages) ||
          !input.messages.every(
            (m) =>
              m &&
              ["system", "user", "assistant", "tool"].includes(m.role) &&
              typeof m.content === "string"
          )
        )
          return { deny: "Invalid conversation snapshot" };
        if (this.invokingTool)
          this.pendingContextRestore = structuredClone(input.messages);
        else {
          this.messages = structuredClone(input.messages);
          await this.emit("context.restored", { messages: this.messages });
        }
        return { value: true };
      }
    );
    for (const [name, resolver] of Object.entries(options.services ?? {}))
      this.runtime.setResolver(name, resolver);

    // subagent spawns ride the service chain (plugins can deny them); the
    // ask channel is fail-closed — no onAsk, no answers
    this.runtime.setResolver(
      "service.agent.spawn",
      async (payload: unknown) => {
        const args = payload as {
          prompt?: string;
          systemPrompt?: string;
          agentId?: string;
          signal?: unknown;
          detached?: boolean;
          maxTokens?:number;maxSteps?:number;
          profile?: string;
        };
        if (!args.prompt || typeof args.prompt !== "string")
          return { deny: "spawn: prompt is required" };
        try {
          return {
            value: await this.runSubagent({
              prompt: args.prompt,
              systemPrompt: args.systemPrompt,
              agentId: args.agentId,
              detached: args.detached,
              maxTokens:args.maxTokens,maxSteps:args.maxSteps,
              profile: args.profile,
              signal:
                args.signal instanceof AbortSignal ? args.signal : undefined,
            }),
          };
        } catch (err) {
          return { deny: err instanceof Error ? err.message : String(err) };
        }
      }
    );
    this.runtime.setResolver("service.ui.ask", async (payload: unknown) => {
      const onAsk = this.options.onAsk;
      if (!onAsk) return { deny: "headless: no user channel for questions" };
      const parsed=questionSchema.safeParse({...(payload as object),id:"answer"});
      if(!parsed.success)return {deny:"ask: invalid question or options"};
      const args=parsed.data;
      const callerSignal=(payload as any).signal;
      const reaction = {
        source: "questions",
        kind: "question",
        id: randomUUID(),
      };
      await this.emit("ui.reaction", { ...reaction, active: true });
      let answer: Awaited<ReturnType<typeof onAsk>>;
      try {
        answer = await onAsk({
          signal: callerSignal instanceof AbortSignal ? AbortSignal.any([callerSignal,...(this.state==="running"?[this.abort.signal]:[])]) : this.state === "running" ? this.abort.signal : undefined,
          question: args.question,
          options:args.options?.map(optionLabel),
          ...(args.options?.some(o=>typeof o!=="string")?{optionDetails:args.options.map(o=>typeof o==="string"?{label:o}:o)}:{}),
          ...(args.allowOther!==undefined?{allowOther:args.allowOther}:{}),
          multi: args.multi === true,
        });
      } finally {
        await this.emit("ui.reaction", { ...reaction, active: false });
      }
      if(typeof answer!=="string"&&!Array.isArray(answer))throw Error("Single question requires a text/choice answer");
      return { value: { answer } };
    });

    this.runtime.setResolver("service.ui.questionnaire", async (payload: any) => {
      if (!this.options.onAsk) return { deny: "headless: no user channel for questions" };
      const form = questionnaireSchema.parse(payload);
      const reaction = { source: "questions", kind: "question", id: randomUUID() };
      const signals = [
        ...(this.state === "running" ? [this.abort.signal] : []),
        ...(payload.signal instanceof AbortSignal ? [payload.signal] : []),
      ];
      await this.emit("ui.reaction", { ...reaction, active: true });
      try {
        const result = await this.options.onAsk({
          question: form.title ?? "Questionnaire",
          questions: form.questions,
          ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
        });
        return { value: validateQuestionnaireResult(form, result) };
      } finally {
        await this.emit("ui.reaction", { ...reaction, active: false });
      }
    });

    for (const plugin of options.plugins ?? []) {
      this.host.registerPlugin(plugin.manifest, plugin.hooks, plugin.tier);
    }

    if (options.systemPrompt)
      this.messages.push({ role: "system", content: options.systemPrompt });
  }

  getContextWindow(): number { return this.contextWindow; }

  getState(): CoreState {
    return this.state;
  }
  get failure(): string | undefined {
    return this.lastTurnError;
  }
  getBudget() {
    return {
      spentTokens: this.spentTokens,
      turnTokens: this.turnTokens,
      maxTokensPerTurn: this.options.maxTokensPerTurn,
      maxTokensPerSession: this.options.maxTokensPerSession,
      maxStepsPerTurn: this.maxSteps,
    };
  }
  private pendingContextRestore?: ChatMessage[];
  private spentTokens = 0;
  private turnTokens = 0;
  get controlsReady(): boolean {
    return this.state !== "running" || this.inPromptHook;
  }
  async *streamModel(request: CompletionRequest): AsyncIterable<ProviderEvent> {
    if(!request.profile && this.options.modelProfile) request={...request,profile:this.options.modelProfile};
    const remaining = Math.min(
      (this.options.maxTokensPerSession ?? Infinity) - this.spentTokens,
      (this.options.maxTokensPerTurn ?? Infinity) - this.turnTokens,
      this.options.remainingTokens?.() ?? Infinity
    );
    if (remaining <= 0) throw new Error("Token budget exhausted");
    if (Number.isFinite(remaining)) {
      const inputEstimate=request.messages.reduce((n,m)=>n+estimateMessageTokens(m),0)+estimateTokens(JSON.stringify(request.tools));
      if(inputEstimate >= remaining) throw new Error("Token budget insufficient for estimated request input; no model request sent");
      request = {
        ...request,
        maxOutputTokens: Math.max(
          1,
          Math.floor(Math.min(request.maxOutputTokens ?? 8192, remaining - inputEstimate))
        ),
      };
    }
    const result = (await this.host.emit("service.model.stream", { request }))
      .value as { value?: AsyncIterable<ProviderEvent>; deny?: string };
    if (result?.deny) throw new Error(result.deny);
    if (
      !result?.value ||
      typeof result.value[Symbol.asyncIterator] !== "function"
    )
      throw new Error(
        "Model stream hook must return an AsyncIterable in {value}"
      );
    let reported = false,
      outputText = "";
    const account = async (
      event: Extract<ProviderEvent, { type: "usage" }>
    ) => {
      this.spentTokens += event.inputTokens + event.outputTokens;
      this.turnTokens += event.inputTokens + event.outputTokens;
      await this.emit("model.usage", {
        model: request.model ?? this.options.model?.(),
        profile: request.profile,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cachedInputTokens: event.cachedInputTokens,
        cacheWriteInputTokens: event.cacheWriteInputTokens,
        estimated: event.estimated,
      });
    };
    for await (const event of result.value) {
      if (event.type === "text_delta") outputText += event.text;
      if (event.type === "tool_call") outputText += JSON.stringify(event.args);
      if (event.type === "usage") {
        reported = true;
        await account(event);
      }
      yield event;
      if (
        (this.options.maxTokensPerTurn &&
          this.turnTokens >= this.options.maxTokensPerTurn) ||
        (this.options.maxTokensPerSession &&
          this.spentTokens >= this.options.maxTokensPerSession)
      )
        throw new Error("Token budget exhausted");
    }
    if (!reported && !request.signal.aborted) {
      const event = {
        type: "usage" as const,
        inputTokens:
          request.messages.reduce(
            (sum, m) => sum + estimateMessageTokens(m),
            0
          ) + estimateTokens(JSON.stringify(request.tools)),
        outputTokens: estimateTokens(outputText),
        estimated: true,
      };
      await account(event);
      yield event;
      if (
        (this.options.maxTokensPerTurn &&
          this.turnTokens >= this.options.maxTokensPerTurn) ||
        (this.options.maxTokensPerSession &&
          this.spentTokens >= this.options.maxTokensPerSession)
      )
        throw new Error("Token budget exhausted");
    }
  }

  async invokeTool(
    name: string,
    args: unknown
  ): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    if (this.invokingTool || (this.state === "running" && !this.inPromptHook))
      return {
        ok: false,
        error: "Agent is busy; retry after the current turn",
      };
    const previous = this.state,
      turnId = randomUUID(),
      callId = randomUUID();
    this.invokingTool = true;
    this.state = "running";
    this.turnTokens = 0;
    this.abort = new AbortController();
    let outcome: { ok: boolean; output?: unknown; error?: string } = {
      ok: false,
      error: "Tool produced no result",
    };
    const unsubscribe = this.subscribe((event) => {
      if (
        event.kind === "catalog" &&
        event.event === "tool.result" &&
        event.input.callId === callId
      )
        outcome = {
          ok: event.input.ok === true,
          output: event.input.output,
          error: event.input.error as string | undefined,
        };
    });
    try {
      await this.emit("turn.start", { turnId, interactiveTool: true });
      this.messages.push({
        role: "assistant",
        content: "",
        toolCalls: [{ id: callId, name, args }],
      });
      await this.runToolBatch(turnId, [{ id: callId, name, args }]);
      if (this.pendingContextRestore) {
        this.messages = this.pendingContextRestore;
        this.pendingContextRestore = undefined;
        await this.emit("context.restored", { messages: this.messages });
      }
      await this.emit("turn.complete", { turnId, text: "" });
      return outcome;
    } catch (error) {
      return { ok: false, error: String(error) };
    } finally {
      unsubscribe();
      this.invokingTool = false;
      this.state = previous;
    }
  }

  private latestUserTask():string|undefined {
    for(let i=this.messages.length-1;i>=0;i--)if(this.messages[i].role==="user")return this.messages[i].content.slice(0,2000);
    return undefined;
  }

  private composeTools(
    extraTools: ToolSpec<unknown, unknown>[]
  ): ToolSpec<unknown, unknown>[] {
    const tools = [
      ...(this.options.tools ?? builtinTools).filter(t=>t.name!=="tool_help"),
      createToolHelp(()=>this.toolSpecs),
      taskTool,
      askTool,
      askQuestionsTool,
      ...extraTools,
    ];
    // Children inherit the effective toolset; do not advertise task/ask twice.
    return tools.filter(
      (tool, index) =>
        tools.findIndex((other) => other.name === tool.name) === index
    );
  }

  /** Idle-only composition update: hooks, tools and future children stay in sync. */
  replacePlugins(
    plugins: CorePlugin[],
    extraTools: ToolSpec<unknown, unknown>[]
  ): void {
    if (this.state === "running")
      throw new Error("Cannot reload plugins during a running turn");
    for (const plugin of this.options.plugins ?? [])
      this.host.unregisterPlugin(plugin.manifest.name);
    for (const plugin of plugins)
      this.host.registerPlugin(plugin.manifest, plugin.hooks, plugin.tier);
    this.options.plugins = plugins;
    this.options.extraTools = extraTools;
    this.toolSpecs = this.composeTools(extraTools);
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

  private started?: Promise<void>;
  /** Called after UI subscribes so startup plugin surfaces are observable. */
  start(): Promise<void> {
    this.started ??= this.emit("session.start", {
      sessionId: this.sessionId,
      cwd: this.options.cwd,
      plugins: (this.options.plugins ?? []).map((p) => ({
        name: p.manifest.name,
        version: p.manifest.version,
        tier: p.tier ?? "user",
      })),
    }).then(() => {});
    return this.started;
  }

  /** Renderer entry: send a prompt. If busy, it queues (codex Enter). */
  async submit(text: string): Promise<void> {
    if (this.state === "running") {
      this.promptQueue.push(text);
      await this.emit("prompt.queued", {
        text,
        depth: this.promptQueue.length,
      });
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
    this.promptQueue = [];
    this.steerQueue = [];
    if (this.state !== "running") return;
    this.interruptedByUser = true;
    this.abort.abort();
  }

  private currentTurnId: string | undefined;
  /** set when the last turn ended in turn.failed (subagent runner reads it) */
  private lastTurnError: string | undefined;
  private messagesSinceCompaction = 0;

  /** Resume factory: adopt a replayed transcript instead of starting fresh. */
  static resume(
    opts: AgentCoreOptions,
    events: import("@agent-compositor/session").SessionEvent[]
  ): AgentCore {
    const core = new AgentCore(opts);
    core.spentTokens = events
      .filter((e) => e.type === "model.usage")
      .reduce(
        (sum, e) =>
          sum + Number(e.inputTokens ?? 0) + Number(e.outputTokens ?? 0),
        0
      );
    core.messages = replayTranscript(events, opts.systemPrompt);
    return core;
  }

  // ---- the turn engine -----------------------------------------------------

  private async runTurn(text: string): Promise<void> {
    try {
      await this.runTurnUnchecked(text);
    } catch (error) {
      this.lastTurnError = String(error);
      await this.emit("turn.failed", {
        turnId: this.currentTurnId ?? randomUUID(),
        error: this.lastTurnError,
      });
      this.state = "idle";
      this.currentTurnId = undefined;
    }
  }
  private async runTurnUnchecked(text: string): Promise<void> {
    const turnId = randomUUID();
    this.currentTurnId = turnId;
    this.lastTurnError = undefined;
    this.turnTokens = 0;
    this.state = "running";
    this.interruptedByUser = false;
    this.abort = new AbortController();
    const usage = { inputTokens: 0, outputTokens: 0 };

    this.inPromptHook = true;
    let submitted: unknown;
    try {
      submitted = await this.emit("prompt.submit", { text });
    } finally {
      this.inPromptHook = false;
    }
    if (submitted && typeof submitted === "object" && "drop" in submitted) {
      this.state = "idle";
      return;
    }
    let promptText =
      submitted &&
      typeof submitted === "object" &&
      "text" in submitted &&
      typeof (submitted as { text: unknown }).text === "string"
        ? (submitted as { text: string }).text
        : text;
    if (this.options.preparePrompt) {
      const prepared = await this.options.preparePrompt(promptText);
      if (typeof prepared === "string") promptText = prepared;
      else {
        promptText = prepared.text;
        this.options.initialImages = [
          ...(this.options.initialImages ?? []),
          ...(prepared.images ?? []),
        ];
      }
      await this.emit("context.prepared", {
        text: promptText,
        images: this.options.initialImages,
      });
    }
    const behavior = (await this.emit("service.agent.instructions", {})) as {value?:string};
    this.baseInstructions = typeof behavior?.value === "string" ? behavior.value : "";
    this.turnToolRecords=[];
    this.messages.push({
      role: "user",
      content: promptText,
      ...(this.options.initialImages?.length
        ? { images: this.options.initialImages }
        : {}),
    });
    this.options.initialImages = undefined;
    await this.emit("turn.start", { turnId });

    let fullText = "";
    let metadata: Record<string, unknown> | undefined;
    let failed: string | undefined;

    let recoveryAttempted=false, finishChecks=0;
    for (let step = 0; step < this.maxSteps; step++) {
      if (this.abort.signal.aborted) break;
      // steering lands at the natural step boundary
      while (this.steerQueue.length > 0) {
        const steerText = this.steerQueue.shift()!;
        this.messages.push({ role: "user", content: steerText });
      }

      // steering landed at the natural step boundary; now check context
      // pressure before paying for another model request
      await this.maybeCompact();
      if (this.abort.signal.aborted) break;

      await this.emit("turn.step", { turnId });
      const batch: ChatToolCall[] = [];
      let finish: { reason: string; error?: string } | undefined;

      try {
        for await (const ev of this.streamModel(this.request())) {
          if (this.abort.signal.aborted) break;
          if (ev.type === "text_delta") {
            const rewritten = await this.emit("assistant.text", {
              turnId,
              text: ev.text,
            });
            const delta =
              rewritten &&
              typeof rewritten === "object" &&
              "text" in rewritten &&
              typeof (rewritten as { text: unknown }).text === "string"
                ? (rewritten as { text: string }).text
                : ev.text;
            fullText += delta;
            this.broadcast({ kind: "text", turnId, delta });
          } else if (ev.type === "tool_call") {
            batch.push({
              id: ev.id,
              name: ev.name,
              args: ev.args,
              metadata: ev.metadata,
            });
          } else if (ev.type === "metadata") {
            metadata = ev.data;
            await this.emit("assistant.metadata", { turnId, metadata });
          } else if (ev.type === "usage") {
            usage.inputTokens += ev.inputTokens;
            usage.outputTokens += ev.outputTokens;
          } else if (ev.type === "finish") {
            finish = ev;
          }
        }
      } catch (err) {
        if (this.interruptedByUser || this.abort.signal.aborted) break;
        const error = err instanceof Error ? err.message : String(err);
        if(!recoveryAttempted && /context.{0,30}(length|window|limit)|too many tokens|prompt.{0,20}too (long|large)/i.test(error)){
          recoveryAttempted=true;const before=this.messages;await this.compactNow();if(this.messages!==before){fullText="";metadata=undefined;step--;continue;}
        }
        failed = error;
        break;
      }

      if (this.interruptedByUser || this.abort.signal.aborted) break;

      if(finish?.reason==="error"&&!recoveryAttempted&&/context.{0,30}(length|window|limit)|too many tokens|prompt.{0,20}too (long|large)/i.test(finish.error??"")){
        recoveryAttempted=true;const before=this.messages;await this.compactNow();if(this.messages!==before){fullText="";metadata=undefined;step--;continue;}
      }
      if (finish?.reason === "error" || finish?.reason === "length") {
        failed =
          finish.reason === "error"
            ? finish.error ?? "provider error"
            : "model response exceeded output/context limit";
        break;
      }
      if (batch.length > 0) {
        this.messages.push({
          role: "assistant",
          content: fullText,
          metadata,
          toolCalls: batch,
        });
        fullText = "";
        metadata = undefined;
        await this.runToolBatch(turnId, batch);
        let failures=0;for(const r of [...this.turnToolRecords].reverse()){if(r.ok)break;failures++;}
        if(failures>=(this.options.maxConsecutiveToolFailures??6)){failed="Repeated tool failures without progress. Resolve the reported permission/configuration error before continuing; progress is saved.";break;}
        if(failures>=3)this.messages.push({role:"user",content:"Harness recovery: repeated tool failures produced no progress. Inspect the errors and available tool schemas. Do not repeat denied actions or bypass policy. Use permitted read-only tools for authorized investigation, or report a concrete blocker."});
        if (step === this.maxSteps - 1) {
          failed = `Step limit (${this.maxSteps}) reached; progress saved. Continue this session to resume.`;
          break;
        }
        continue;
      }

      const tools=this.turnToolRecords;
      const decision=await this.emit("service.agent.finish",{text:fullText,steps:step+1,tools}) as {value?:{complete?:boolean;continue?:string}};
      if(decision?.value?.continue && finishChecks++<2){
        if(fullText)this.messages.push({role:"assistant",content:fullText,metadata});
        this.messages.push({role:"user",content:"Harness verification: "+decision.value.continue});fullText="";metadata=undefined;
        if(step===this.maxSteps-1)failed=`Step limit (${this.maxSteps}) reached; progress saved. Continue this session to resume.`;
        continue;
      }
      if(decision?.value?.complete===false)failed="Completion checks remain unsatisfied; progress saved. Continue this session to resolve them.";
      break; // stop
    }

    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      await this.emit("turn.usage", { turnId, ...usage });
    }

    if (this.interruptedByUser) {
      this.state = "interrupted";
      await this.emit("turn.interrupted", { turnId });
    } else if (failed !== undefined) {
      if (fullText)
        this.messages.push({ role: "assistant", content: fullText, metadata });
      await this.emit("turn.failed", { turnId, error: failed });
      this.lastTurnError = failed;
      this.state = "idle";
    } else {
      if (fullText)
        this.messages.push({ role: "assistant", content: fullText, metadata });
      await this.emit("turn.complete", { turnId, text: fullText });
      this.state = "idle";
    }
    this.currentTurnId = undefined;
  }

  private async maybeCompact(): Promise<void> {
    const compaction = this.options.compaction;
    if (!compaction) return;
    const response = await this.emit('service.model.capabilities',{signal:this.abort.signal}) as {value?:import('./provider.js').ModelCapabilities};
    const caps=response?.value;
    if(compaction.limits?.().contextWindow)this.contextSource="configured";
    if(caps && Number.isSafeInteger(caps.contextWindow) && caps.contextWindow>=256){
      const limits=compaction.limits?.()??{};
      this.outputLimit=limits.reserveOutput??Math.min(caps.maxOutputTokens??8192,Math.floor((limits.contextWindow??caps.contextWindow)/4));
      compaction.budget.configure({contextWindow:caps.contextWindow,reserveOutput:this.outputLimit,...limits});
      this.contextWindow=limits.contextWindow??caps.contextWindow;this.contextSource=limits.contextWindow?'configured':caps.source;
    }
    this.contextWindow=compaction.budget.windowSize;
    compaction.budget.setMessages([...this.messages,...(this.baseInstructions?[{role:'system',content:this.baseInstructions}]:[])]);
    compaction.budget.setOverhead(estimateTokens(JSON.stringify(this.toolSpecs.map(t=>({name:t.name,description:t.description,parameters:t.parameters})))));
    const breakdown=compaction.budget.breakdown();
    await this.emit('context.pressure',{...breakdown,contextWindow:this.contextWindow,source:this.contextSource,model:this.options.model?.()});
    const cooldown = compaction.cooldownMessages ?? 8;
    if (!compaction.budget.shouldCompact()) return;
    if(breakdown.remaining>0 && this.messages.length-this.messagesSinceCompaction<cooldown)return;
    await this.compactNow();
    compaction.budget.setMessages([...this.messages,...(this.baseInstructions?[{role:"system",content:this.baseInstructions}]:[])]);
    if(compaction.budget.breakdown().remaining<=0)throw Error("Context remains too large after compaction. Reduce oversized tool output, tool schemas or instructions; progress is preserved.");
  }

  /** Force a compaction pass regardless of cooldown/budget gates (Claude's /compact). */
  async compactNow(): Promise<void> {
    const compaction = this.options.compaction;
    if (!compaction) return;
    await this.emit("context.compacting", { sessionId: this.sessionId });
    const target=Math.max(64,compaction.budget.usable-estimateTokens(this.baseInstructions)-estimateTokens(JSON.stringify(this.request().tools)));
    let tail=0,tailTokens=0;for(let i=this.messages.length-1;i>=0&&tail<6;i--){const n=estimateMessageTokens(this.messages[i]);if(tail>0&&tailTokens+n>target/2)break;tail++;tailTokens+=n;}
    const result = await compactTranscript(
      this.messages,
      compaction.summarize,
      {
        signal: this.abort.signal,
        keepTail:Math.max(1,tail),
      }
    );
    if (result.foldedCount === 0) return;
    this.messages = [...(result.messages as ChatMessage[])];
    this.messagesSinceCompaction = this.messages.length;
    compaction.budget.setMessages([...this.messages,...(this.baseInstructions?[{role:"system",content:this.baseInstructions}]:[])]);
    await this.emit("context.pressure",{...compaction.budget.breakdown(),contextWindow:this.contextWindow,source:this.contextSource,model:this.options.model?.()});
    await this.emit("context.compacted", {
      foldedCount: result.foldedCount,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      summary: result.summary,
      messages: this.messages,
    });
  }

  /** Drop the conversation, keep the system head (Claude's /clear). */
  clear(): void {
    this.messages = this.messages.filter((m) => m.role === "system");
    this.messagesSinceCompaction = this.messages.length;
  }

  // ---- subagents (the task tool / service.agent.spawn) --------------------

  /** A fresh AgentCore: shared provider, permissions, plugins, ask channel —
   *  isolated transcript, no persistence, recursion depth-guarded. */
  private async runSubagent(args: {
    prompt: string;
    systemPrompt?: string;
    agentId?: string;
    detached?: boolean;
    maxTokens?:number;maxSteps?:number;
    profile?: string;
    signal?: AbortSignal;
  }): Promise<{ agentId: string; output: string; tokens:number }> {
    const depth = this.options.subagentDepth ?? 0;
    const maxDepth = this.options.maxSubagentDepth ?? 2;
    if (depth >= maxDepth)
      throw new Error(`subagent depth limit (${maxDepth}) reached`);
    const agentId =
      args.agentId && typeof args.agentId === "string"
        ? args.agentId
        : randomUUID();
    await this.emit("subagent.start", { agentId, prompt: args.prompt, depth });

    const parentTask=this.latestUserTask();
    const child: AgentCore = new AgentCore({
      ...this.options,
      sessionId: randomUUID(),
      permissionReview: async input => await this.emit("service.permission.review", {...input,context:{...(input.context&&typeof input.context==="object"?input.context:{}),parentTask}}),
      remainingTokens:()=>Math.min((this.options.maxTokensPerSession??Infinity)-this.spentTokens,this.state==="running"?(this.options.maxTokensPerTurn??Infinity)-this.turnTokens:Infinity,this.options.remainingTokens?.()??Infinity),
      modelProfile: args.profile ?? this.options.modelProfile,
      model: args.profile ? undefined : this.options.model,
      maxTokensPerTurn:args.maxTokens?Math.min(args.maxTokens,this.options.maxTokensPerTurn??Infinity):this.options.maxTokensPerTurn,
      maxStepsPerTurn:args.maxSteps?Math.min(args.maxSteps,this.options.maxStepsPerTurn??Infinity):this.options.maxStepsPerTurn,
      tools: this.toolSpecs.filter(t=>t.name!=="workflow_run"),
      extraTools: undefined,
      initialImages: undefined,
      sessions: undefined, // subagents are ephemeral: no session persistence
      provider: args.profile ? {name:this.provider.name,complete:(request)=>this.provider.complete({...request,profile:request.profile??args.profile}),capabilities:this.provider.capabilities ? (signal,profile)=>this.provider.capabilities!(signal,profile??args.profile) : undefined} : this.provider,
      compaction: this.options.compaction ? {...this.options.compaction,budget:new TokenBudget({contextWindow:this.contextWindow}),summarize:this.options.compaction.fork ? ((...args)=>this.options.compaction!.fork!(request=>child.streamModel(request),()=>child.getContextWindow())(...args)) : this.options.compaction.summarize} : undefined,
      systemPrompt:
        typeof args.systemPrompt === "string"
          ? args.systemPrompt
          : [this.options.systemPrompt,SUBAGENT_SYSTEM_PROMPT].filter(Boolean).join("\n\n"),
      subagentDepth: depth + 1,
    });
    const usageWrites: Promise<unknown>[]=[];
    const unsubscribeReaction = child.subscribe((event) => {
      if(event.kind==="catalog" && event.event==="model.usage"){
        const tokens=Number(event.input.inputTokens??0)+Number(event.input.outputTokens??0);
        this.spentTokens+=tokens;
        if(this.state==="running")this.turnTokens+=tokens;
        const write=this.emit("model.usage", event.input);
        void write.catch(()=>{});
        usageWrites.push(write);
      }
      if (event.kind === "catalog" && ["ui.reaction","turn.step","tool.call","tool.result"].includes(event.event))
        void this.host
          .emit("agent.activity", {
            agentId,
            event: event.event,
            data: event.event==='ui.reaction'?event.input:{tool:typeof event.input.tool==='string'?event.input.tool:undefined,ok:typeof event.input.ok==='boolean'?event.input.ok:undefined},
          })
          .catch(() => {});
    });
    const interruptChild = () => child.interrupt();
    const parentSignal = args.detached ? (args.signal ?? new AbortController().signal) : args.signal
      ? AbortSignal.any([this.abort.signal, args.signal])
      : this.abort.signal;
    parentSignal.addEventListener("abort", interruptChild, { once: true });
    try {
      if (parentSignal.aborted) throw new Error("Interrupted");
      await child.submit(args.prompt);
      if (child.getState() === "interrupted") throw new Error("Interrupted");
      if (child.lastTurnError) throw new Error(child.lastTurnError);
      const lastAssistant = [...child.getMessages()]
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" &&
            typeof m.content === "string" &&
            m.content.trim().length > 0
        );
      const output = lastAssistant?.content?.trim() ?? "";
      await this.emit("subagent.complete", { agentId, ok: true, output });
      return { agentId, output, tokens:child.getBudget().spentTokens };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.emit("subagent.complete", { agentId, ok: false, error });
      throw new Error(`subagent failed: ${error}`);
    } finally {
      unsubscribeReaction();
      await Promise.all(usageWrites);
      parentSignal.removeEventListener("abort", interruptChild);
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.promptQueue.length > 0 && this.state !== "running") {
      const next = this.promptQueue.shift()!;
      await this.runTurn(next);
    }
  }

  private async runToolBatch(
    turnId: string,
    batch: ChatToolCall[]
  ): Promise<void> {
    for (const call of batch) {
      const spec = this.toolSpecs.find((t) => t.name === call.name);
      if (!spec) {
        this.turnToolRecords.push({name:call.name,args:call.args,ok:false});
        await this.emit("tool.result", {
          callId: call.id,
          tool: call.name,
          ok: false,
          error: `unknown tool: ${call.name}`,
        });
        this.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: `unknown tool: ${call.name}`,
        });
        continue;
      }

      const args = call.args ?? {};
      // 1) tool.call: a plugin may answer ({result}) or refuse ({deny})
      const intercepted = await this.emit("tool.call", {
        tool: call.name,
        input: args,
        callId: call.id,
        metadata: call.metadata,
      });
      let result: unknown;
      let denied = false;
      let error: string | undefined;

      const isObject = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null;
      const interceptedResult =
        isObject(intercepted) && "result" in intercepted
          ? intercepted.result
          : undefined;

      if (
        error === undefined &&
        isObject(intercepted) &&
        "deny" in intercepted
      ) {
        denied = true;
        error = `denied: ${String(intercepted.deny)}`;
      }

      if (
        error === undefined &&
        !(isObject(intercepted) && "result" in intercepted)
      ) {
        // 2) permissions via tool.check (chain may override with {decision})
        const descriptor = spec.describe(args);
        if (descriptor.path && typeof (args as any).path === "string")
          descriptor.path = resolvePath(this.options.cwd, (args as any).path);
        if(spec===execTool)descriptor.readOnly=!(args as any).env&&!(args as any).background&&await isReadOnlyShell((args as any).command,(args as any).cwd??this.options.cwd,this.options.cwd,{...process.env,...this.options.toolEnv?.()});
        let decision = evaluate(descriptor, this.compiledRules, this.approvals);
        let overrideReason: string | undefined;
        const checkRes = await this.emit("tool.check", {
          tool: call.name,
          input: args,
          callId: call.id,
          isReadOnly: call.name === "read" || descriptor.readOnly === true,
        });
        if (
          checkRes &&
          typeof checkRes === "object" &&
          "decision" in (checkRes as object)
        ) {
          const override = (
            checkRes as { decision: "allow" | "ask" | "deny"; reason?: string }
          ).decision;
          if (decision.decision !== "deny") {
            decision = { ...decision, decision: override };
            overrideReason =
              typeof (checkRes as any).reason === "string"
                ? (checkRes as any).reason
                : undefined;
          }
        }

        if (decision.decision === "deny") {
          denied = true;
          error = `denied by permission rules${
            overrideReason ?? decision.rule?.reason
              ? `: ${overrideReason ?? decision.rule?.reason}`
              : ""
          }`;
        } else if (decision.decision === "ask") {
          let automatic = false;
          let reviewReason: string | undefined;
          try {
            const review = await this.emit("service.permission.review", {
              tool: call.name,
              callId: call.id,
              input: args,
              descriptor,
              description:spec.description.slice(0,3000),
              parameters:spec.parameters,
              context:{cwd:this.options.cwd,task:this.latestUserTask()},
            });
            const verdict = (
              review as {
                value?: { decision?: string; risk?: string; reason?: string };
              }
            )?.value;
            reviewReason=typeof verdict?.reason === "string" ? verdict.reason : undefined;
            automatic =
              verdict?.decision === "allow" &&
              verdict.risk === "low" &&
              typeof verdict.reason === "string" &&
              verdict.reason.length > 0;
          } catch {
            /* reviewer failure returns control to manual approval */
          }
          const answer = automatic
            ? true
            : this.onApproval
            ? await (async () => {
                const reaction = {
                  source: "permissions",
                  kind: "approval",
                  id: call.id,
                };
                await this.emit("ui.reaction", { ...reaction, active: true });
                try {
                  return await this.onApproval!({
                    tool: call.name,
                    descriptor,
                    reason: reviewReason ?? decision.rule?.reason,
                    signal: this.abort.signal,
                  });
                } finally {
                  await this.emit("ui.reaction", {
                    ...reaction,
                    active: false,
                  });
                }
              })()
            : false;
          const allowed = typeof answer === "boolean" ? answer : answer.allow;
          if (
            allowed &&
            typeof answer === "object" &&
            answer.scope &&
            answer.scope !== "once"
          ) {
            this.approvals?.approve(descriptor, answer.scope);
            if (answer.scope === "project" && this.approvals)
              await this.options.persistApprovals?.(
                this.approvals
                  .list()
                  .filter((approval) => approval.note === "project")
              );
          }
          if (!allowed) {
            denied = true;
            error = "denied: no approval (headless or user declined)";
          }
        }

        // 3) execute through the $ service chain
        if (!denied) {
          const ctx = this.buildToolContext();
          try {
            const executed = await spec.execute(ctx, args);
            if (executed.ok) result = executed.data;
            else {
              error = executed.error;
              denied = executed.denied ?? false;
            }
          } catch (caught) {
            error = String(caught);
          }
        }
      } else if (error === undefined) {
        result = interceptedResult;
      }

      this.turnToolRecords.push({name:call.name,args,ok:error===undefined&&(call.name!=="exec"||(result as any)?.exitCode===0),output:result});
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
        content: error ? error + (denied ? "\nPermission denied: do not retry equivalent effects through another tool. Report the blocker or continue unrelated authorized work." : "") : this.toolResultText(result),
      });
      void turnId;
    }
  }

  private toolResultText(value:unknown):string {
    const text=JSON.stringify(value)??"null";
    if(Buffer.byteLength(text,"utf8")<=128*1024)return text;
    return JSON.stringify({truncated:true,originalBytes:Buffer.byteLength(text,"utf8"),preview:text.slice(0,16000),hint:"Tool result exceeded 128 KiB. Query a smaller page/range; this preview is not a complete edit source."});
  }

  private buildToolContext(): ToolContext {
    return {
      cwd: this.options.cwd,
      stateDir: this.options.storage?.paths.state,
      sessionId: this.sessionId,
      env: this.options.toolEnv?.(),
      fetch: this.options.fetch,
      settings: (name: string) =>
        this.options.storage?.config(name) ?? Promise.resolve({}),
      signal: this.abort.signal,
      undo: this.undo,
      request: async <T = unknown>(
        service: string,
        payload: unknown
      ): Promise<T> => {
        const res = await this.host.emit(service, payload);
        const v = (res as EmitValue).value as
          | Record<string, unknown>
          | undefined;
        if (
          v &&
          typeof v === "object" &&
          "deny" in v &&
          typeof v.deny === "string"
        ) {
          throw new Error(`denied by chain interceptor: ${v.deny}`);
        }
        if (v && typeof v === "object" && "value" in v) return v.value as T;
        return v as T;
      },
    };
  }

  private request(): CompletionRequest {
    const messages: ChatMessage[] = this.baseInstructions ? [{role:"system",content:this.baseInstructions}] : [];
    let pending = new Map<string, string>();
    const close = () => {
      for (const [id, name] of pending)
        messages.push({
          role: "tool",
          toolCallId: id,
          name,
          content: "error: interrupted before a tool result was recorded",
        });
      pending.clear();
    };
    for (const message of this.messages) {
      if (message.role === "tool") {
        if (message.toolCallId && pending.has(message.toolCallId)) {
          messages.push({ ...message });
          pending.delete(message.toolCallId);
        }
        continue;
      }
      close();
      messages.push({ ...message });
      for (const call of message.toolCalls ?? [])
        pending.set(call.id, call.name);
    }
    close();
    return {
      messages,
      tools: [...this.toolSpecs].sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      signal: this.abort.signal,
      model: this.options.model?.(),
      maxOutputTokens:this.outputLimit,
    };
  }

  private async emit(
    event: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
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

  private sessionEnsured: Promise<unknown> | undefined;

  private async persist(
    event: string,
    input: Record<string, unknown>
  ): Promise<void> {
    if (!this.sessions) return;
    // the store requires a created session before append; ensure exactly once
    // (create is idempotent-ish: a second create for the same id is a no-op
    // error we swallow — the roll/meta may already exist from a prior run)
    this.sessionEnsured ??= this.sessions
      .create(this.options.cwd, { id: this.sessionId })
      .catch(() => undefined);
    try {
      await this.sessionEnsured;
      await this.sessions.append(
        this.sessionId,
        [{ type: event, ...input }],
        this.options.cwd
      );
    } catch {
      // storage is best-effort; the turn must not die on a full disk
    }
  }
}
