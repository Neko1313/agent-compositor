import type { ChatMessage, ChatToolCall } from "./provider.js";
import type { SessionEvent } from "@agent-compositor/session";
import {modelToolText} from './tool-text.js';
import {toolObservationMetadata} from './compaction-evidence.js';

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
  let submitted:ChatMessage|undefined;
  const unpreparedTurns=new Map<string,ChatMessage>(),deferredSteers=new Map<string,ChatMessage[]>();
  const recordedTurns=new Set(events.filter(e=>e.type==='prompt.submit'&&typeof e.turnId==='string').map(e=>e.turnId as string));
  const seenTurns=new Set<string>();
  const resetPreparation=()=>{submitted=undefined;unpreparedTurns.clear();};

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
        resetPreparation();
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
        const last = (typeof event.turnId==='string'?unpreparedTurns.get(event.turnId):undefined)??submitted??messages[messages.length - 1];
        if (last?.role === "user" && typeof event.text === "string") {
          if(last.origin!=='harness'&&typeof last.userRequest!=='string'&&last.content!==event.text)last.userRequest=last.content;
          last.content = event.text;
          last.images = event.images as ChatMessage["images"];
          if (typeof event.turnId === "string") unpreparedTurns.delete(event.turnId);
          else unpreparedTurns.clear();
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
        const message:ChatMessage={
          role: "user",
          content: typeof event.text === "string" ? event.text : "",
          ...(event.type==='prompt.submit'&&event.origin==='harness'?{origin:'harness' as const}:{}),
        };
        const turnId=typeof event.turnId==='string'?event.turnId:undefined;
        if(event.type==='prompt.submit'){
          // A steer can be journaled while submission hooks are still pending.
          // New host records correlate preparation without changing hook fields.
          if(turnId===undefined){for(const waiting of deferredSteers.values())messages.push(...waiting);deferredSteers.clear();}
          messages.push(message);submitted=message;
          if(turnId!==undefined){seenTurns.add(turnId);unpreparedTurns.set(turnId,message);messages.push(...(deferredSteers.get(turnId)??[]));deferredSteers.delete(turnId);}
        }else if(turnId!==undefined&&recordedTurns.has(turnId)&&!seenTurns.has(turnId)){
          const waiting=deferredSteers.get(turnId)??[];waiting.push(message);deferredSteers.set(turnId,waiting);
        }else messages.push(message);
        break;
      }
      case 'turn.start':
        // A started turn accepted its submission even if a sparse log lacks context.prepared.
        if (typeof event.turnId === "string") unpreparedTurns.delete(event.turnId);
        break;
      case 'turn.complete':
      case 'turn.failed': {
        // A preparation failure leaves an audit record but never adds a live user message.
        const rejected = event.type === 'turn.failed' && typeof event.turnId === 'string' && unpreparedTurns.get(event.turnId);
        if (rejected) messages.splice(messages.lastIndexOf(rejected), 1);
        flushAssistant();
        for(const waiting of deferredSteers.values())messages.push(...waiting);
        deferredSteers.clear();
        resetPreparation();
        break;
      }
      case "assistant.text": {
        if (typeof event.text === "string") pendingText += event.text;
        break;
      }
      case "tool.call": {
        if (batchClosed) flushAssistant(); // post-result text becomes its own assistant message
        const {compositorEditInput:projection,...providerMetadata}=(event.metadata??{}) as Record<string,unknown>;
        let input=event.input;
        // Reconstruct the selector that the model sent from the host's projected call.
        if(input && typeof input==='object' && !Array.isArray(input)){
          const {path,editRef,...rest}=input as Record<string,unknown>;
          const marker=projection as {version?:number;targetField?:string;pathFromReference?:boolean}|undefined;
          if(marker?.version===1 && marker.pathFromReference===true && typeof path==='string' && typeof editRef==='string')
            input={...rest,editRef};
          if(marker?.version===2 && typeof path==='string'){
            if(marker.targetField==='path' && editRef===undefined)input={...rest,target:path};
            if(marker.targetField==='editRef' && typeof editRef==='string')input={...rest,target:editRef};
          }
        }
        pendingCalls.push({
          id:
            typeof event.callId === "string"
              ? event.callId
              : `call_${messages.length}_${pendingCalls.length}`,
          name: typeof event.tool === "string" ? event.tool : "unknown",
          args: input,
          metadata: Object.keys(providerMetadata).length?providerMetadata:undefined,
        });
        break;
      }
      case "tool.result": {
        flushAssistant(); // assistant (text + calls) precedes its tool results
        batchClosed = true;
        const ok = event.ok === true;
        messages.push({
          role: "tool",
          ...(['read','write','edit','exec'].includes(String(event.tool))?{metadata:{compositorToolResult:toolObservationMetadata(String(event.tool),ok,event.output)}}:{}),
          toolCallId:
            typeof event.callId === "string"
              ? event.callId
              : `call_${messages.length}`,
          name: typeof event.tool === "string" ? event.tool : "unknown",
          content: ok
            ? typeof event.modelText==='string'&&event.modelText.length>0?modelToolText(event.output,event.modelText):safeStringify(event.output)
            : `error: ${String(event.error ?? "unknown")}`,
        });
        break;
      }
      case "context.compacted": {
        resetPreparation();
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
  for(const waiting of deferredSteers.values())messages.push(...waiting);
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
