import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoArgs {
  /** omit to just read the current list */
  todos?: TodoItem[];
}

export interface TodoOutcome {
  todos: TodoItem[];
}

/**
 * Task-list tool (Claude-Code TodoWrite analog). The tool only emits
 * `service.todo.update`; the default resolver keeps the process-scoped list
 * and the `todos` plugin can persist it from tool.result events.
 */
export const todoTool: ToolSpec<TodoArgs, TodoOutcome> = {
  name: "todo",
  description:
    "Read or replace the session task list. Pass the full updated list to set it; call with no arguments to read. Keep statuses honest: pending / in_progress / completed.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "status"],
        },
      },
    },
  },
  describe: () => ({ tool: "todo" }),
  async execute(ctx, args): Promise<ToolResult<TodoOutcome>> {
    try {
      const outcome = await ctx.request<TodoOutcome>("service.todo.update", { todos: args.todos });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
