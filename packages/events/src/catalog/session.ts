import { z } from "zod";
import { defineEvent } from "../define.js";

const pluginRef = z.object({
  name: z.string(),
  version: z.string(),
  tier: z.enum(["prepend", "user", "append", "builtin", "core"]),
});

export const sessionStart = defineEvent({
  name: "session.start",
  since: "0.1.0",
  version: 1,
  summary: "Once per loaded plugin before the first prompt, and again after that plugin reloads. Carries the session composition (the udev moment: the module sees the device).",
  input: z.object({
    sessionId: z.string(),
    cwd: z.string(),
    plugins: z.array(pluginRef),
  }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  aliases: ["classic.SessionStart"],
  frozen: true,
});

export const sessionReload = defineEvent({
  name: "session.reload",
  since: "0.1.0",
  version: 1,
  summary: "Plugin set changed. In-memory plugin state is recreated; reload is a state-recovery point.",
  input: z.object({ plugins: z.array(pluginRef) }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  frozen: true,
});

export const sessionEnd = defineEvent({
  name: "session.end",
  since: "0.1.0",
  version: 1,
  summary: "Session ends, or /clear, /resume, /branch runs.",
  input: z.object({
    reason: z.enum(["clear", "resume", "logout", "prompt_input_exit", "other"]),
  }),
  responses: [{ kind: "next", summary: "proceed", schema: z.unknown() }],
  aliases: ["classic.SessionEnd"],
  frozen: true,
});

export const sessionCompact = defineEvent({
  name: "session.compact",
  since: "0.1.0",
  version: 1,
  summary: "The conversation is about to be compacted.",
  input: z.object({}),
  responses: [
    { kind: "next", summary: "proceed", schema: z.unknown() },
    { kind: "skip", summary: "skip compaction", schema: z.object({ skip: z.string() }) },
  ],
  frozen: true,
});
