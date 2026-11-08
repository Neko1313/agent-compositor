import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface ExecArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Shell execution. The tool itself only emits `service.exec.run` — the
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
    },
    required: ["command"],
  },
  describe: (args) => ({ tool: "exec", command: splitCommand(args.command) }),
  async execute(ctx, args): Promise<ToolResult<ExecOutcome>> {
    try {
      const outcome = await ctx.request<ExecOutcome>("service.exec.run", {
        command: args.command,
        cwd: args.cwd ?? ctx.cwd,
        timeoutMs: args.timeoutMs ?? 120_000,
        env: args.env,
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
