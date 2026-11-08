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
  }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});
