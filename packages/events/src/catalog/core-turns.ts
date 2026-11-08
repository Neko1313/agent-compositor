import { z } from "zod";
import { defineEvent } from "../define.js";

export const promptSteer = defineEvent({
  name: "prompt.steer",
  since: "0.5.0",
  version: 1,
  summary: "A steering message is injected into the running turn (codex Tab semantics).",
  input: z.object({ turnId: z.string(), text: z.string() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const promptQueued = defineEvent({
  name: "prompt.queued",
  since: "0.5.0",
  version: 1,
  summary: "A prompt arrived while the agent was busy; it will start when the turn ends.",
  input: z.object({ text: z.string(), depth: z.number().int() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const assistantText = defineEvent({
  name: "assistant.text",
  since: "0.5.0",
  version: 1,
  summary: "One streamed assistant text delta. Renderers usually subscribe() instead; the chain event exists for plugins that log or rewrite.",
  input: z.object({ turnId: z.string(), text: z.string() }),
  responses: [
    { kind: "next", summary: "pass on", schema: z.unknown() },
    { kind: "text", summary: "rewrite the delta", schema: z.object({ text: z.string() }) },
  ],
  frozen: true,
});

export const toolResult = defineEvent({
  name: "tool.result",
  since: "0.5.0",
  version: 1,
  summary: "A tool call resolved (ok or error). Errors are values — the turn continues.",
  input: z.object({
    callId: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    denied: z.boolean().optional(),
  }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const turnFailed = defineEvent({
  name: "turn.failed",
  since: "0.5.0",
  version: 1,
  summary: "A turn ended in an error (model failure, stream error). Fail-operational: the session stays alive.",
  input: z.object({ turnId: z.string(), error: z.string() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const turnInterrupted = defineEvent({
  name: "turn.interrupted",
  since: "0.5.0",
  version: 1,
  summary: "The user interrupted the turn. In-flight model stream and tools were aborted best-effort.",
  input: z.object({ turnId: z.string() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const turnUsage = defineEvent({
  name: "turn.usage",
  since: "0.5.0",
  version: 1,
  summary: "Token usage of a turn, cumulative across its model steps. Fires before turn.complete/failed so cost plugins can tally.",
  input: z.object({
    turnId: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});
