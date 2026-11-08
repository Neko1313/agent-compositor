// Todo persistence: mirror the builtin todo tool's result to disk so the
// task list survives restarts (Claude Code TodoWrite analog, persisted).
interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export default {
  "tool.result": (event: { tool: string; ok: boolean; output?: unknown }, $: any) => {
    if (event.tool !== "todo" || !event.ok) return;
    const out = event.output as { todos?: TodoItem[] } | undefined;
    const list = out && Array.isArray(out.todos) ? out.todos : undefined;
    if (!list) return;
    $.fs
      .write(".agent-compositor/todos.json", JSON.stringify(list, null, 2))
      .then(() => $.ui.notify(`todos: ${list.length} item(s) saved`, "info"))
      .catch(() => {});
  },
};
