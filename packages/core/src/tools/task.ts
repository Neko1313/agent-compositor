import type { ToolSpec } from "@agent-compositor/tools";

/** Claude Code's Task tool: hand a prompt to a fresh subagent (its own
 *  transcript, shared provider/permissions/plugins) and get the final text
 *  back. Execution lives behind service.agent.spawn, which the loop
 *  resolves — so plugins can intercept/deny subagent spawns like any
 *  other service call. */
export interface TaskArgs {
  prompt: string;
  description?: string;
  systemPrompt?: string;
}

export const taskTool: ToolSpec<TaskArgs, { output: string; agentId: string }> = {
  name: "task",
  description:
    "Spawn a subagent to work on a self-contained prompt in a fresh context. " +
    "Use for exploration, isolated edits, or parallelizable chunks. " +
    "The subagent returns its final text; it does not share your transcript.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "complete, self-contained instructions for the subagent" },
      description: { type: "string", description: "short label for progress display" },
      systemPrompt: { type: "string", description: "optional system prompt override" },
    },
    required: ["prompt"],
  },
  describe: () => ({ tool: "task" }),
  async execute(ctx, args) {
    if (!args.prompt || typeof args.prompt !== "string") {
      return { ok: false, error: "task: prompt is required" };
    }
    try {
      const spawned = await ctx.request<{ output: string; agentId: string }>("service.agent.spawn", {
        prompt: args.prompt,
        systemPrompt: typeof args.systemPrompt === "string" ? args.systemPrompt : undefined,
      });
      return { ok: true, data: spawned };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
