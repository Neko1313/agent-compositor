import { z } from "zod";
import { defineEvent } from "../define.js";

const denyValue = [
  { kind: "deny", summary: "refuse the call", schema: z.object({ deny: z.string() }) },
  { kind: "value", summary: "answer without executing", schema: z.object({ value: z.unknown() }) },
];

/**
 * Core-tool service events. The builtin tools (exec/read/write/edit) emit
 * these through the same chain as the plugin-facing $ API — core operations
 * are interceptable with { deny } / { value } exactly like plugin calls.
 * Shapes are richer than the $ API (cwd, ranges, replaceAll) because these
 * serve the model-facing tools, not the confined plugin surface.
 */
export const serviceShellExec = defineEvent({
  name: "service.shell.exec",
  since: "0.5.0",
  version: 1,
  summary: "Core exec tool: run a shell command (session cwd, timeout, env). With background: true it returns immediately with a shell id and keeps running.",
  input: z.object({
    command: z.string(),
    cwd: z.string(),
    timeoutMs: z.number().int().positive(),
    env: z.record(z.string()).optional(),
    background: z.boolean().optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceShellExecOutput = defineEvent({
  name: "service.shell.execOutput",
  since: "0.5.0",
  version: 1,
  summary: "Read a backgrounded shell's buffered output (BashOutput analog).",
  input: z.object({ id: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceShellExecKill = defineEvent({
  name: "service.shell.execKill",
  since: "0.5.0",
  version: 1,
  summary: "Terminate a backgrounded shell by id (KillShell analog).",
  input: z.object({ id: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceTodoUpdate = defineEvent({
  name: "service.todo.update",
  since: "0.5.0",
  version: 1,
  summary: "Core todo tool: replace (or read) the process-scoped task list.",
  input: z.object({
    todos: z
      .array(
        z.object({
          content: z.string(),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      )
      .optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceFileRead = defineEvent({
  name: "service.file.read",
  since: "0.5.0",
  version: 1,
  summary: "Core read tool: paginated file read with truncation note.",
  input: z.object({
    path: z.string(),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceFileReadText = defineEvent({
  name: "service.file.readText",
  since: "0.5.0",
  version: 1,
  summary: "Internal: raw full-text read (undo pre-image). null when missing.",
  input: z.object({ path: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceFileWrite = defineEvent({
  name: "service.file.write",
  since: "0.5.0",
  version: 1,
  summary: "Core write tool: create or overwrite a file.",
  input: z.object({ path: z.string(), content: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceFileEdit = defineEvent({
  name: "service.file.edit",
  since: "0.5.0",
  version: 1,
  summary: "Core edit tool: exact (or whitespace-normalized) text replacement.",
  input: z.object({
    path: z.string(),
    oldText: z.string(),
    newText: z.string(),
    replaceAll: z.boolean(),
  }),
  responses: denyValue,
  frozen: true,
});
