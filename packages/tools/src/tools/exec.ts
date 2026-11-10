import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface ExecArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Claude-Code-style run_in_background: return a shell id immediately, keep the process alive */
  background?: boolean;
}

export interface ExecOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Shell execution. The tool itself only emits `service.shell.exec` — the
 * default resolver (resolvers.ts) spawns the process; a plugin can sit in
 * the chain to sandbox, log, or rewrite the command before it runs.
 */
export const execTool: ToolSpec<ExecArgs, ExecOutcome> = {
  name: "exec",
  description: "Run a shell command and return its output. cwd defaults to the session cwd.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "shell command line" },
      cwd: { type: "string" },
      timeoutMs: { type: "number", default: 120_000 },
      background: { type: "boolean", description: "start detached; returns {shellId} — poll output via the execOutput tool, stop via execKill" },
    },
    required: ["command"],
  },
  describe: (args) => ({ tool: "exec", command: splitCommand(args.command) }),
  async execute(ctx, args): Promise<ToolResult<ExecOutcome>> {
    try {
      const outcome = await ctx.request<ExecOutcome>("service.shell.exec", {
        command: args.command,
        cwd: ctx.resolvePath?await ctx.resolvePath(args.cwd??ctx.cwd,{directory:true}):args.cwd??ctx.cwd,
        timeoutMs: args.timeoutMs ?? 120_000,
        env: args.env,
        background: args.background,
      });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

function splitCommand(command: string): string[] {
  // coarse argv split for permission matching (handles quotes well enough for globs)
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return parts.map((p) => p.replace(/^["']|["']$/g, ""));
}

export interface ShellJobArgs {
  id: string;
}

export interface ShellJobOutcome {
  id: string;
  stdout: string;
  stderr: string;
  done: boolean;
  exitCode: number | null;
  durationMs: number;
}

/** Read a backgrounded shell's buffered output (BashOutput analog). */
export const execOutputTool: ToolSpec<ShellJobArgs, ShellJobOutcome> = {
  name: "exec_output",
  description: "Read the buffered stdout/stderr of a background shell started with exec(background=true). Returns done/exitCode when the process exited.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "shell id from exec background:true" } },
    required: ["id"],
  },
  describe: () => ({ tool: "exec_output" }),
  async execute(ctx, args): Promise<ToolResult<ShellJobOutcome>> {
    try {
      const outcome = await ctx.request<ShellJobOutcome>("service.shell.execOutput", { id: args.id });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

/** Terminate a backgrounded shell (KillShell analog). */
export const execKillTool: ToolSpec<ShellJobArgs, { id: string; killed: boolean }> = {
  name: "exec_kill",
  description: "Terminate a background shell by id.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  describe: () => ({ tool: "exec_kill" }),
  async execute(ctx, args): Promise<ToolResult<{ id: string; killed: boolean }>> {
    try {
      const outcome = await ctx.request<{ id: string; killed: boolean }>("service.shell.execKill", { id: args.id });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
