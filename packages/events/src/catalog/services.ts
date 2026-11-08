import { z } from "zod";
import { defineEvent } from "../define.js";

const denyValue = [
  { kind: "deny", summary: "refuse the call", schema: z.object({ deny: z.string() }) },
  { kind: "value", summary: "answer without executing", schema: z.object({ value: z.unknown() }) },
];

/**
 * service.* — the $ API surface. Every method on the plugin-facing `$` object
 * is itself an event: plugins can intercept each other's service calls with
 * { deny } or { value }; the chain's end (the core resolver) performs the real
 * operation and answers { value }. (Mods: "each $ method is itself an event".)
 */
export const serviceFsRead = defineEvent({
  name: "service.fs.read",
  since: "0.2.0",
  version: 1,
  summary: "$.fs.read(path): read a workspace-confined file (max 1 MB).",
  input: z.object({ plugin: z.string(), path: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceFsWrite = defineEvent({
  name: "service.fs.write",
  since: "0.2.0",
  version: 1,
  summary: "$.fs.write(path, content): write a workspace-confined file (max 10 MB).",
  input: z.object({ plugin: z.string(), path: z.string(), content: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceModelComplete = defineEvent({
  name: "service.model.complete",
  since: "0.2.0",
  version: 1,
  summary: "$.model.complete(request): call the configured model provider.",
  input: z.object({ plugin: z.string(), request: z.unknown() }),
  responses: denyValue,
  frozen: true,
});

export const serviceAuthLogin = defineEvent({
  name: "service.auth.login",
  since: "0.2.0",
  version: 1,
  summary: "$.auth.login(provider?): run the auth flow of the configured auth capability.",
  input: z.object({ plugin: z.string(), provider: z.string().optional() }),
  responses: denyValue,
  frozen: true,
});

export const serviceExecRun = defineEvent({
  name: "service.exec.run",
  since: "0.3.0",
  version: 1,
  summary: "$.exec.run(cmd, args?, opts?): run a workspace-confined subprocess (default 30 s timeout).",
  input: z.object({
    plugin: z.string(),
    cmd: z.string(),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceUiNotify = defineEvent({
  name: "service.ui.notify",
  since: "0.2.0",
  version: 1,
  summary: "$.ui.notify(message, level?): post a transient status message.",
  input: z.object({
    plugin: z.string(),
    message: z.string(),
    level: z.enum(["info", "warn", "error"]).optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceUiAsk = defineEvent({
  name: "service.ui.ask",
  since: "0.5.0",
  version: 1,
  summary:
    "$.ui.ask / the ask_user tool: ask the human a question (optionally with choices). Headless sessions deny (fail closed).",
  input: z.object({
    plugin: z.string(),
    question: z.string(),
    options: z.array(z.string()).optional(),
    multi: z.boolean().optional(),
  }),
  responses: [
    { kind: "deny", summary: "refuse the call", schema: z.object({ deny: z.string() }) },
    {
      kind: "answer",
      summary: "the user's answer",
      schema: z.object({ answer: z.union([z.string(), z.array(z.string())]) }),
    },
  ],
  frozen: true,
});

export const serviceTelemetryLog = defineEvent({
  name: "service.telemetry.log",
  since: "0.2.0",
  version: 1,
  summary: "$.telemetry.log(event, data?): structured log line.",
  input: z.object({
    plugin: z.string(),
    event: z.string(),
    data: z.record(z.unknown()).optional(),
  }),
  responses: denyValue,
  frozen: true,
});
