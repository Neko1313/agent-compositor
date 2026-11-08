import { z } from "zod";
import { defineEvent } from "../define.js";

export const turnStart = defineEvent({
  name: "turn.start",
  since: "0.1.0",
  version: 1,
  summary: "A turn begins.",
  input: z.object({ turnId: z.string(), interactiveTool: z.boolean().optional() }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  aliases: ["turn.started"],
  frozen: true,
});

export const turnStep = defineEvent({
  name: "turn.step",
  since: "0.1.0",
  version: 1,
  summary: "One request is about to go to the model. Async-generator hook: may yield intermediate values.",
  input: z.object({
    turnId: z.string(),
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
  responses: [
    { kind: "next", summary: "pass on; may change model/effort", schema: z.unknown() },
  ],
  aliases: ["turn.step.started"],
  generator: true,
  frozen: true,
});

export const turnComplete = defineEvent({
  name: "turn.complete",
  since: "0.1.0",
  version: 1,
  summary: "A turn ended. May show a line under the answer.",
  input: z.object({ turnId: z.string(), text: z.string().optional() }),
  responses: [
    { kind: "next", summary: "proceed", schema: z.unknown() },
    { kind: "text", summary: "append a status line", schema: z.object({ text: z.string() }) },
  ],
  aliases: ["classic.Stop", "turn.completed"],
  frozen: true,
});

export const agentOffer = defineEvent({
  name: "agent.offer",
  since: "0.1.0",
  version: 1,
  summary: "A subagent type is offered to the model.",
  input: z.object({ type: z.string() }),
  responses: [
    { kind: "next", summary: "offer it", schema: z.unknown() },
    { kind: "withhold", summary: "do not offer", schema: z.object({ isOffered: z.literal(false) }) },
  ],
  frozen: true,
});

export const agentSpawn = defineEvent({
  name: "agent.spawn",
  since: "0.1.0",
  version: 1,
  summary: "A subagent or teammate is about to start (or resume). May pick its model or deny.",
  input: z.object({
    type: z.string(),
    isTeammate: z.boolean().optional(),
    resume: z.object({ agentId: z.string() }).optional(),
    model: z.string().optional(),
  }),
  responses: [
    { kind: "next", summary: "pass on, possibly with a different model", schema: z.unknown() },
    { kind: "deny", summary: "refuse to start", schema: z.object({ deny: z.string() }) },
  ],
  frozen: true,
});
