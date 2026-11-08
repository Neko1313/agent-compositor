import type { HooksHost } from "@agent-compositor/hooks";
import type { ChatMessage, ModelProvider, ToolCallRequest, ToolSpec } from "./provider.js";

/**
 * The reference agent loop. Every seam is a catalog event fired through the
 * hooks host, so plugins sit exactly where the design says they should:
 *
 *   prompt → prompt.submit → turn.start → [service.model.complete] →
 *     text → assistant output · tool_calls → tool.call → tool.check →
 *     service.exec.run / service.fs.* (the core's own tools ride the $ API)
 *   → … steps … → turn.complete
 *
 * The loop is a swappable kernel: this implementation is minimal, but any
 * core (e.g. a ported kimi-code loop) honouring the same events drops in
 * without touching plugins or renderers.
 */

export interface TurnOptions {
  host: HooksHost;
  prompt: ChatMessage | string;
  model?: string;
  tools?: ToolSpec[];
  /** emit a catalog event and wait for the chain (plugins + resolvers);
   *  resolves to the chain's terminal response ({deny}|{result}|{value}|rewritten event) */
  emit?: (name: string, input: unknown) => Promise<unknown>;
  /** streaming text sink (deltas, in order) */
  onDelta?: (text: string) => void;
  onToolCall?: (call: ToolCallRequest) => void;
  maxSteps?: number;
}

export interface TurnResult {
  text: string;
  steps: number;
  stopReason: "completed" | "max_steps" | "denied" | "error";
  usage: { inputTokens: number; outputTokens: number };
}

/** Core's builtin tools — implemented through service.* so they are
 *  interceptable like anything else. */
export const CORE_TOOLS: ToolSpec[] = [
  {
    name: "exec",
    description: "Run a workspace-confined subprocess (shell=false, 30 s default timeout).",
    inputSchema: {
      type: "object",
      properties: {
        cmd: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "number" },
      },
      required: ["cmd"],
    },
  },
  {
    name: "fs_read",
    description: "Read a workspace-confined file (max 1 MB).",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "fs_write",
    description: "Write a workspace-confined file (max 10 MB).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
];

export async function runTurn(opts: TurnOptions): Promise<TurnResult> {
  const host = opts.host;
  const emit = opts.emit ?? (async (name: string, input: unknown) => (await host.emit(name, input)).value);
  const turnId = `turn_${Math.random().toString(36).slice(2, 10)}`;
  const messages: ChatMessage[] = [
    typeof opts.prompt === "string" ? { role: "user", content: opts.prompt } : opts.prompt,
  ];
  const tools = opts.tools ?? CORE_TOOLS;
  const maxSteps = opts.maxSteps ?? 32;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let fullText = "";
  let stopReason: TurnResult["stopReason"] = "completed";

  await emit("turn.start", { turnId });
  await emit("prompt.submit", { text: String(messages[0].content ?? "") });

  for (let step = 0; step < maxSteps; step++) {
    // The model call itself is a $ API event: plugins can deny, rewrite, or answer.
    // The resolver behind it is the provider configured on the hooks host.
    const call = await host.emit("service.model.complete", {
      plugin: "core",
      request: {
        model: opts.model ?? "default",
        messages,
        tools,
      },
    });
    const denied = asDeny(call.value);
    if (denied) {
      stopReason = "denied";
      fullText += `model call denied: ${denied}`;
      break;
    }
    // resolvers (and the {value} response form) both answer {value: X} — unwrap once
    const response = (asRecord(call.value)?.value ?? {}) as {
      text?: string;
      toolCalls?: ToolCallRequest[];
      usage?: { inputTokens?: number; outputTokens?: number };
    };
    if (typeof response.text === "string" && response.text.length > 0) {
      fullText += response.text;
      opts.onDelta?.(response.text);
    }
    usage.inputTokens += response.usage?.inputTokens ?? 0;
    usage.outputTokens += response.usage?.outputTokens ?? 0;
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });

    if (!response.toolCalls || response.toolCalls.length === 0) break; // completed

    for (const callReq of response.toolCalls) {
      opts.onToolCall?.(callReq);
      // 1. interception point: plugins may rewrite, refuse, or answer
      const callRes = await emit("tool.call", {
        tool: callReq.name,
        input: callReq.input,
        callId: callReq.callId,
      });
      const callDeny = asDeny(callRes);
      if (callDeny) {
        messages.push({ role: "tool", callId: callReq.callId, name: callReq.name, content: `denied by plugin: ${callDeny}` });
        continue;
      }
      const callAnswer = asRecord(callRes)?.result;
      if (callAnswer !== undefined) {
        messages.push({ role: "tool", callId: callReq.callId, name: callReq.name, content: stringify(callAnswer) });
        continue;
      }

      // 2. decision point: allow / ask / deny (ask resolves to deny outside an interactive host)
      const checkRes = await emit("tool.check", {
        tool: callReq.name,
        input: callReq.input,
        callId: callReq.callId,
        isReadOnly: callReq.name === "fs_read",
      });
      const checkDecision = asRecord(checkRes)?.decision;
      if (checkDecision === "deny" || checkDecision === "ask") {
        messages.push({
          role: "tool",
          callId: callReq.callId,
          name: callReq.name,
          content: checkDecision === "deny" ? `denied: ${asRecord(checkRes)?.reason ?? "policy"}` : "asked, but no interactive host is attached — denied",
        });
        continue;
      }

      // 3. execute through the $ API service events (interception + confinement included)
      messages.push({
        role: "tool",
        callId: callReq.callId,
        name: callReq.name,
        content: await executeCoreTool(host, callReq),
      });
    }
    if (step === maxSteps - 1) stopReason = "max_steps";
  }

  await emit("turn.complete", { turnId, text: fullText || undefined });
  return { text: fullText, steps: countSteps(messages), stopReason, usage };
}

async function executeCoreTool(host: HooksHost, call: ToolCallRequest): Promise<string> {
  const input = (call.input ?? {}) as Record<string, unknown>;
  try {
    if (call.name === "exec") {
      const r = await host.emit("service.exec.run", {
        plugin: "core",
        cmd: String(input.cmd ?? ""),
        args: Array.isArray(input.args) ? input.args.map(String) : undefined,
        timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
      });
      const v = asRecord(r.value)?.value as Record<string, unknown> | undefined;
      return `exit ${v?.exitCode ?? "?"}\n${String(v?.stdout ?? "")}${String(v?.stderr ?? "")}`.trim();
    }
    if (call.name === "fs_read") {
      const r = await host.emit("service.fs.read", { plugin: "core", path: String(input.path ?? "") });
      return String(asRecord(r.value)?.value ?? "");
    }
    if (call.name === "fs_write") {
      await host.emit("service.fs.write", {
        plugin: "core",
        path: String(input.path ?? ""),
        content: String(input.content ?? ""),
      });
      return `wrote ${String(input.path ?? "")}`;
    }
    return `unknown tool: ${call.name}`;
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function countSteps(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "assistant").length;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function asDeny(v: unknown): string | undefined {
  const r = asRecord(v);
  return typeof r?.deny === "string" ? r.deny : undefined;
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}
