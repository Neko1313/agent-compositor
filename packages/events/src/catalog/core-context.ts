import { z } from "zod";
import { defineEvent } from "../define.js";

/**
 * Context pressure events: emitted when the live transcript is compacted
 * to fit the token budget. Renderers can show a subtle "context folded"
 * marker; resume replay treats it as a cut line.
 */
export const contextCompacted = defineEvent({
  name: "context.compacted",
  since: "0.5.0",
  version: 1,
  summary:
    "The transcript was compacted: the middle was folded into a summary, system prompt and recent tail kept verbatim.",
  input: z.object({
    foldedCount: z.number().int(),
    tokensBefore: z.number().int(),
    tokensAfter: z.number().int(),
    summary: z.string(),
    messages: z.array(z.unknown()).optional(),
  }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const contextCompacting = defineEvent({
  name: "context.compacting",
  since: "0.9.0",
  version: 1,
  summary: "Before context compaction, allowing observers to save state.",
  input: z.object({ sessionId: z.string() }),
  responses: [],
  frozen: true,
});

export const contextPressure = defineEvent({
  name: 'context.pressure', since: '0.11.0', version: 1,
  summary: 'Current request context budget, model limit source and estimated occupancy.',
  input: z.object({used:z.number(),usable:z.number(),reserve:z.number(),pressure:z.number(),contextWindow:z.number(),source:z.string(),model:z.string().optional()}),
  responses: [], frozen:true,
});
export const modelCapabilities = defineEvent({
  name:'service.model.capabilities',since:'0.11.0',version:1,
  summary:'Resolve effective context/output limits for the selected model. Replaceable by provider plugins.',
  input:z.object({signal:z.unknown().optional()}),
  responses:[{kind:'value',summary:'Effective limits and provenance',schema:z.unknown()},{kind:'deny',summary:'Resolution denied',schema:z.object({deny:z.string()})}], frozen:true,
});
export const agentInstructions = defineEvent({
  name:'service.agent.instructions',since:'0.11.0',version:1,
  summary:'Resolve replaceable base agent behavior and tool guidance before a turn.',
  input:z.object({}), responses:[{kind:'value',summary:'Instruction text',schema:z.object({value:z.string()})}],frozen:true,
});
export const agentFinish = defineEvent({
  name:'service.agent.finish',since:'0.11.0',version:1,
  summary:'Evaluate a proposed final answer; return complete or a concrete continuation instruction.',
  input:z.object({text:z.string(),steps:z.number(),tools:z.array(z.object({name:z.string(),args:z.unknown().optional(),ok:z.boolean(),output:z.unknown().optional()}))}),
  responses:[{kind:'value',summary:'Completion decision',schema:z.unknown()}],frozen:true,
});
