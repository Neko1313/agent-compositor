import { z } from "zod";
import { defineEvent } from "../define.js";

const toolRef = z.object({
  tool: z.string(),
  input: z.unknown().optional(),
  callId: z.string(),
  agentId: z.string().optional(),
});

export const toolCall = defineEvent({
  name: "tool.call",
  since: "0.1.0",
  version: 1,
  summary: "A tool is about to run. Return { result } to answer it, { deny } to refuse, or pass the (rewritten) event to next().",
  input: toolRef,
  responses: [
    { kind: "next", summary: "pass on, possibly rewritten", schema: toolRef },
    { kind: "deny", summary: "refuse the call", schema: z.object({ deny: z.string() }) },
    { kind: "result", summary: "answer without running", schema: z.object({ result: z.unknown() }) },
  ],
  aliases: ["classic.PreToolUse"],
  frozen: true,
});

export const toolCheck = defineEvent({
  name: "tool.check",
  since: "0.1.0",
  version: 1,
  summary: "Pre-execution decision, after tool.call and rules. Resolves to the allow/ask/deny decision.",
  input: toolRef.extend({ isReadOnly: z.boolean().optional() }),
  responses: [
    { kind: "next", summary: "accept the decision reached so far", schema: z.unknown() },
    {
      kind: "decision",
      summary: "override the decision",
      schema: z.object({
        decision: z.enum(["allow", "ask", "deny"]),
        reason: z.string().optional(),
      }),
    },
  ],
  frozen: true,
});

export const toolDescribe = defineEvent({
  name: "tool.describe",
  since: "0.1.0",
  version: 1,
  summary: "Once per tool, when its description is first sent to the model.",
  input: z.object({ tool: z.string(), description: z.string() }),
  responses: [
    { kind: "next", summary: "keep the description", schema: z.unknown() },
    {
      kind: "description",
      summary: "replace it; isDeferred puts the tool behind tool search",
      schema: z.object({
        description: z.string(),
        isDeferred: z.boolean().optional(),
      }),
    },
  ],
  frozen: true,
});
