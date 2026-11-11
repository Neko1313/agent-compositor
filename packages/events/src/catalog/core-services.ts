import { z } from "zod";
import { defineEvent } from "../define.js";

const denyValue = [
  {
    kind: "deny",
    summary: "refuse the call",
    schema: z.object({ deny: z.string() }),
  },
  {
    kind: "value",
    summary: "answer without executing",
    schema: z.object({ value: z.unknown().optional() }),
  },
];
export const servicePermissionReview = defineEvent({
  name: "service.permission.review",
  since: "0.8.0",
  version: 1,
  summary:
    "Optional risk review only after permissions require approval. A reviewer may allow this exact call or return to manual approval; explicit denies cannot be overridden.",
  input: z.object({
    tool: z.string(),
    callId: z.string(),
    input: z.unknown().optional(),
    descriptor: z.unknown().optional(),
    description:z.string().optional(),
    parameters:z.unknown().optional(),
    context:z.unknown().optional(),
  }),
  responses: denyValue,
  frozen: true,
});
export const serviceContextControl = defineEvent({
  name: "service.context.control",
  since: "0.8.0",
  version: 1,
  summary:
    "Snapshot or restore conversation context. Restore is restricted to interactive controls outside model execution.",
  input: z.object({
    action: z.enum(["snapshot", "restore"]),
    beforeTurn: z.boolean().optional(),
    messages: z.array(z.unknown()).optional(),
  }),
  responses: denyValue,
  frozen: true,
});
export const modelUsage = defineEvent({
  name: "model.usage",
  since: "0.8.0",
  version: 1,
  summary:
    "Per-request usage including auxiliary calls. Provider counts are preferred; estimated=true explicitly marks a fallback used for budgeting.",
  input: z.object({
    model: z.string().optional(),
    profile: z.string().optional(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedInputTokens: z.number().optional(),
    cacheWriteInputTokens: z.number().optional(),
    estimated: z.boolean().optional(),
  }),
  responses: [],
  frozen: true,
});
export const serviceUsageQuota = defineEvent({
  name: "service.usage.quota",
  since: "0.8.0",
  version: 1,
  summary:
    "Read optional provider-reported account quota; unavailable is explicit, not estimated.",
  input: z.object({}),
  responses: denyValue,
  frozen: true,
});
export const contextRestored = defineEvent({
  name: "context.restored",
  since: "0.8.0",
  version: 1,
  summary:
    "Conversation restored from a checkpoint; resets replay and renderer transcript.",
  input: z.object({ messages: z.array(z.unknown()) }),
  responses: [],
  frozen: true,
});
export const serviceCheckpointControl = defineEvent({
  name: "service.checkpoint.control",
  since: "0.8.0",
  version: 1,
  summary:
    "List, inspect and restore turn checkpoints through a replaceable provider.",
  input: z.object({
    action: z.enum(["list", "restore", "diff"]),
    id: z.string().optional(),
    mode: z.enum(["code", "conversation", "both"]).optional(),
    paths: z.array(z.string()).max(1000).optional(),
  }),
  responses: denyValue,
  frozen: true,
});
export const serviceAgentControl = defineEvent({
  name: "service.agent.control",
  since: "0.8.0",
  version: 1,
  summary:
    "Manage independent persisted agents and optional Git worktrees; messages run asynchronously with separate budgets.",
  input: z.object({
    action: z.enum(["list", "create", "send", "stop", "archive", "merge"]),
    cwd: z.string().min(1).optional(),
    id: z.string().optional(),
    name: z.string().max(100).optional(),
    prompt: z.string().max(100000).optional(),
    worktree: z.boolean().optional(),
    maxSteps: z.number().int().min(1).max(100).optional(),
    maxTokens: z.number().int().min(100).max(1000000).optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceSandboxRun = defineEvent({
  name: "service.sandbox.run",
  since: "0.8.0",
  version: 1,
  summary:
    "Replaceable isolated code execution. Host-supplied functions are process-local callbacks receiving (args, AbortSignal); never inferred from generated code.",
  input: z.object({
    language: z.string(),
    code: z.string().max(100000),
    inputs: z.record(z.string(), z.unknown()).optional(),
    functions: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z.number().int().min(100).max(300000).optional(),
    memoryBytes: z.number().int().min(1000000).max(128000000).optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceProjectQuery = defineEvent({
  name: "service.project.query",
  since: "0.8.0",
  version: 1,
  summary:
    "Replaceable project navigation provider: files, text, symbols, definitions and graph relations. Symbolic results include resolution metadata.",
  input: z.object({
    cwd: z.string(),
    action: z.enum([
      "glob",
      "grep",
      "symbols",
      "definition",
      "references",
      "callers",
      "callees",
      "dependencies",
      "status",
      "outline",
      "read_symbol",
      "impact",
    ]),
    pattern: z.string().max(1000).default(""),
    path: z.string().optional(),
    regex: z.boolean().optional(),
    offset:z.number().int().min(0).max(100000).optional(),
    cursor:z.string().max(1500).optional(),
    maxTokens:z.number().int().min(256).max(16000).optional(),
    detail:z.enum(["compact","raw"]).optional(),
    kinds:z.array(z.string()).max(30).optional(),
    depth:z.number().int().min(1).max(4).optional(),
    refresh: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceModelStream = defineEvent({
  name: "service.model.stream",
  since: "0.8.0",
  version: 1,
  summary:
    "Shared streaming provider gateway for agent turns, compaction and plugin model calls. Return an AsyncIterable of provider events.",
  input: z.object({ plugin: z.string().optional(), request: z.unknown().optional() }),
  responses: denyValue,
  frozen: true,
});
export const contextPrepared = defineEvent({
  name: "context.prepared",
  since: "0.8.0",
  version: 1,
  summary:
    "Final user content after project context and explicit file references have been expanded.",
  input: z.object({
    text: z.string(),
    images: z
      .array(z.object({ mimeType: z.string(), data: z.string() }))
      .optional(),
  }),
  responses: [],
  frozen: true,
});
export const assistantMetadata = defineEvent({
  name: "assistant.metadata",
  since: "0.8.0",
  version: 1,
  summary:
    "Provider reasoning continuation metadata for faithful session replay.",
  input: z.object({ turnId: z.string(), metadata: z.record(z.string(), z.unknown()) }),
  responses: [],
  frozen: true,
});
export const serviceSessionControl = defineEvent({
  name: "service.session.control",
  since: "0.8.0",
  version: 1,
  summary:
    "List, search, name, fork, archive or resume local sessions. Resume requires an interactive host.",
  input: z.object({
    action: z.enum([
      "list",
      "rename",
      "fork",
      "archive",
      "unarchive",
      "resume",
    ]),
    id: z.string().optional(),
    name: z.string().max(200).optional(),
    search: z.string().optional(),
    includeArchived: z.boolean().optional(),
    signal:z.unknown().optional(),
  }),
  responses: denyValue,
  frozen: true,
});
export const serviceSessionStore = defineEvent({
  ...serviceSessionControl,
  name: "service.session.store",
  summary:
    "Local session storage operations used by interactive session hosts.",
});

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
  summary:
    "Core exec tool: run a shell command (session cwd, timeout, env). With background: true it returns immediately with a shell id and keeps running.",
  input: z.object({
    command: z.string(),
    cwd: z.string(),
    timeoutMs: z.number().int().positive(),
    env: z.record(z.string(), z.string()).optional(),
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

export const serviceAgentSpawn = defineEvent({
  name: "service.agent.spawn",
  since: "0.5.0",
  version: 1,
  summary:
    "Spawn a subagent: a fresh AgentCore (shared provider/permissions/plugins, isolated transcript) runs the prompt to completion and returns its final text. Core-resolved.",
  input: z.object({
    prompt: z.string(),
    systemPrompt: z.string().optional(),
    agentId: z.string().optional(),
    detached: z.boolean().optional(),
    maxTokens: z.number().int().positive().max(1000000).optional(),
    maxSteps: z.number().int().positive().max(128).optional(),
    profile: z.string().optional(),
    signal: z.unknown().optional(),
  }),
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
        })
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
    expectedHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
    range:z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).optional(),
    strict:z.boolean().optional(),
  }),
  responses: denyValue,
  frozen: true,
});

export const serviceSkillsLoad = defineEvent({
  name: "service.skills.load",
  since: "0.5.0",
  version: 1,
  summary: "Load a skill by name from the configured registry.",
  input: z.object({ name: z.string() }),
  responses: denyValue,
  frozen: true,
});

export const serviceWorkflowRun = defineEvent({
 name:'service.workflow.run',since:'0.11.0',version:1,
 summary:'Replaceable persistent workflow lifecycle: start, inspect, pause, resume, retry or stop. Host permissions remain in each worker.',
 input:z.object({action:z.enum(['start','list','status','pause','resume','retry','stop']),id:z.string().optional(),stageId:z.string().optional(),title:z.string().optional(),completion:z.enum(['wake','notify','none']).optional(),stages:z.array(z.unknown()).optional(),concurrency:z.number().int().min(1).max(8).optional(),maxStages:z.number().int().min(1).max(500).optional(),maxTokensTotal:z.number().int().min(100).max(10000000).optional(),maxTokensPerStage:z.number().int().min(100).max(1000000).optional(),stageTimeoutMs:z.number().int().min(1000).max(3600000).optional(),waitMs:z.number().int().min(0).max(30000).optional()}),
 responses:denyValue,frozen:true,
});

/** Explicit user management; model tools retain their normal permission and turn path. */
export const serviceExtensionControl = defineEvent({
  name:'service.extension.control',since:'0.21.0',version:1,
  summary:'Manage plugin installation and activation from user UI independently of model turns. Busy file mutations wait for explicit application at idle.',
  input:z.object({action:z.enum(['list','check-updates','install','update','rollback','enable','disable','remove']),name:z.string().optional(),ref:z.string().optional(),scope:z.enum(['user','project']).optional(),dependencies:z.boolean().optional(),signal:z.unknown().optional()}),
  responses:denyValue,frozen:true,
});
export const serviceMarketplaceControl = defineEvent({
  name:'service.marketplace.control',since:'0.21.0',version:1,
  summary:'List, register, refresh or remove plugin marketplaces from user UI independently of model turns.',
  input:z.object({action:z.enum(['list','add','update','remove']),name:z.string().optional(),source:z.string().optional(),ref:z.string().optional(),scope:z.enum(['user','project']).optional(),signal:z.unknown().optional()}),
  responses:denyValue,frozen:true,
});
