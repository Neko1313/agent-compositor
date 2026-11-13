import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoArgs {
  /** omit to just read the current list */
  todos?: Array<Omit<TodoItem,'status'>&{status:TodoItem['status']|'running'}>;
}

export interface TodoOutcome {
  todos: TodoItem[];
}

/**
 * Task-list tool (Claude-Code TodoWrite analog). The tool only emits
 * `service.todo.update`; the default resolver keeps the Core/dispatcher's list
 * and the `todos` plugin can persist it from tool.result events.
 */
export const todoTool: ToolSpec<TodoArgs, TodoOutcome> = {
  name: "todo",
  description:
    "Read or replace the session task list. Pass the full updated list to set it; call with no arguments to read. Keep statuses honest: pending / in_progress / completed. running is an alias for in_progress; results use in_progress.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "running", "completed"] },
          },
          required: ["content", "status"],
        },
      },
    },
  },
  describe: () => ({ tool: "todo" }),
  async execute(ctx, args): Promise<ToolResult<TodoOutcome>> {
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args))
        return {ok: false, error: 'todo: arguments must be an object; omit todos to read the current list.'};
      if (args.todos !== undefined) {
        if (!Array.isArray(args.todos)) return {ok: false, error: 'todo.todos must be an array.'};
        for (const [index, item] of args.todos.entries()) {
          const field = `todo.todos[${index}]`;
          if (!item || typeof item !== 'object' || Array.isArray(item))
            return {ok: false, error: `${field} must be an object with content and status.`};
          if (typeof item.content !== 'string')
            return {ok: false, error: `${field}.content must be a string.`};
          if (!['pending', 'in_progress', 'running', 'completed'].includes(item.status))
            return {ok: false, error: `${field}.status must be pending, in_progress (alias running), or completed.`};
        }
      }
      const todos=args.todos?.map(t=>({...t,status:t.status==='running'?'in_progress' as const:t.status}));
      const outcome = await ctx.request<TodoOutcome>("service.todo.update", { todos });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
