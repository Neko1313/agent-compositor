import type { ChatMessage, ChatToolCall } from "./provider.js";
import type { SessionEvent } from "@agent-compositor/session";

/**
 * Replay a persisted session's event roll back into a model-ready message
 * list. The persisted stream is append-only and loss-tolerant, so this
 * reconstructor is deliberately conservative:
 *
 *  - `prompt.submit` / `prompt.steer` open a new user message
 *  - `assistant.text` deltas aggregate into one assistant message; the
 *    following `tool.call` attaches toolCalls to it; each `tool.result`
 *    closes the assistant message and lands a tool message after it
 *  - `context.compacted` is a cut line: everything before it (except the
 *    system prompt) is dropped, the summary becomes a system message
 *  - partial tails (crash mid-turn) still replay: trailing deltas flush as
 *    an assistant message
 *
 * Events carrying no transcript meaning (turn.step, tool.check, ui.*,
 * prompt.queued) are ignored.
 */
export function replayTranscript(
  events: SessionEvent[],
  systemPrompt?: string
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  let pendingText = "";
  let pendingCalls: ChatToolCall[] = [];
  let pendingMetadata: Record<string, unknown> | undefined;
  /** an assistant message with toolCalls was emitted and its results landed —
   * the next tool.call belongs to a NEW assistant message */
  let batchClosed = false;

  const flushAssistant = () => {
    if (pendingText || pendingCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: pendingText,
        toolCalls: pendingCalls.length > 0 ? pendingCalls : undefined,
        metadata: pendingMetadata,
      });
      pendingText = "";
      pendingCalls = [];
      pendingMetadata = undefined;
    }
  };

  for (const event of events) {
    if(typeof event.operationId==='string' && ['tool.call','tool.result'].includes(event.type))continue;
    switch (event.type) {
      case "context.restored": {
        if (Array.isArray(event.messages))
          messages.splice(
            0,
            messages.length,
            ...(event.messages as ChatMessage[])
          );
        pendingText = "";
        pendingCalls = [];
        pendingMetadata = undefined;
        batchClosed = false;
        break;
      }
      case "context.prepared": {
        const last = messages[messages.length - 1];
        if (last?.role === "user" && typeof event.text === "string") {
          last.content = event.text;
          last.images = event.images as ChatMessage["images"];
        }
        break;
      }
      case "assistant.metadata":
        pendingMetadata = event.metadata as Record<string, unknown>;
        break;
      case "prompt.submit":
      case "prompt.steer": {
        flushAssistant();
        batchClosed = false;
        messages.push({
          role: "user",
          content: typeof event.text === "string" ? event.text : "",
        });
        break;
      }
      case "assistant.text": {
        if (typeof event.text === "string") pendingText += event.text;
        break;
      }
      case "tool.call": {
        if (batchClosed) flushAssistant(); // post-result text becomes its own assistant message
        pendingCalls.push({
          id:
            typeof event.callId === "string"
              ? event.callId
              : `call_${messages.length}_${pendingCalls.length}`,
          name: typeof event.tool === "string" ? event.tool : "unknown",
          args: event.input,
          metadata: event.metadata as Record<string, unknown> | undefined,
        });
        break;
      }
      case "tool.result": {
        flushAssistant(); // assistant (text + calls) precedes its tool results
        batchClosed = true;
        const ok = event.ok === true;
        messages.push({
          role: "tool",
          toolCallId:
            typeof event.callId === "string"
              ? event.callId
              : `call_${messages.length}`,
          name: typeof event.tool === "string" ? event.tool : "unknown",
          content: ok
            ? safeStringify(event.output)
            : `error: ${String(event.error ?? "unknown")}`,
        });
        break;
      }
      case "context.compacted": {
        if (Array.isArray(event.messages)) {
          messages.splice(
            0,
            messages.length,
            ...(event.messages as ChatMessage[])
          );
          pendingText = "";
          pendingCalls = [];
          batchClosed = false;
          break;
        }
        const head =
          messages.length > 0 && messages[0].role === "system"
            ? [messages[0]]
            : [];
        const summary = typeof event.summary === "string" ? event.summary : "";
        messages.length = 0;
        messages.push(...head);
        if (summary)
          messages.push({
            role: "system",
            content: `Summary of earlier conversation:\n${summary}`,
          });
        pendingText = "";
        pendingCalls = [];
        batchClosed = false;
        break;
      }
      default:
        break;
    }
  }
  flushAssistant();
  // Close every exchange before another user/assistant message. A crash may
  // follow tool admission or only some results of a parallel batch. Never
  // replay an unknown effect merely to reconstruct a valid provider request.
  const repaired: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    repaired.push(message);
    if (!message.toolCalls?.length) continue;
    const results = new Set<string>();
    while (messages[i + 1]?.role === "tool") {
      const result = messages[++i];
      repaired.push(result);
      if (result.toolCallId) results.add(result.toolCallId);
    }
    for (const call of message.toolCalls) {
      if (results.has(call.id)) continue;
      repaired.push({role:"tool", toolCallId:call.id, name:call.name,
        content:"Interrupted before a result was saved. The action may have completed; its outcome is unknown. Inspect its state before retrying. This recovery record did not execute the action."});
    }
  }
  return repaired;
}

function safeStringify(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2)?.slice(0, 20_000) ?? "";
  } catch {
    return String(output);
  }
}
