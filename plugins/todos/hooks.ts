// Persistent task list with a compositor-managed window.
interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}
const FILE = ".agent-compositor/todos.json";
function validate(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return;
  if (!value.every(item => item && typeof item.content === "string" && ["pending", "in_progress", "completed"].includes(item.status))) return;
  return value.map(item => ({ content: item.content, status: item.status }));
}
async function show($: any): Promise<void> {
  const list = ($.state.get("todos") ?? []) as TodoItem[];
  const done = list.filter(item => item.status === "completed").length;
  const active = list.filter(item => item.status === "in_progress").length;
  const text = list.length
    ? `${done}/${list.length} complete · ${active} active\n\n` + list.map(item => `${item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[~]" : "[ ]"} ${item.content}`).join("\n")
    : "No tasks yet.\nAsk the agent to make a task list.\n[ ] pending · [~] active · [x] complete";
  await $.ui.surface("tasks", "Todos", text.length > 98000 ? text.slice(0, 98000) + "\n… task display truncated" : text, { site: "sidebar", size: .3, focus: false });
}
async function initialize($: any): Promise<void> {
  if ($.state.get("initialized")) return;
  let list: TodoItem[] = [];
  try {
    const raw = await $.fs.read(FILE);
    const parsed = validate(JSON.parse(raw));
    if (!parsed) throw new Error("invalid task list");
    list = parsed;
  } catch (error) {
    // Missing storage is the normal first-run state; malformed storage is left intact.
    if ((error as { code?: string }).code !== "ENOENT") await $.ui.notify(`todos: could not restore tasks (${String(error)})`, "warn");
  }
  $.state.set("todos", list);
  await $.emit("service.todo.update", { todos: list });
  $.state.set("initialized", true);
}
export default {
  "session.start": async (_event: unknown, $: any) => { await initialize($); await show($); },
  "session.reload": async (_event: unknown, $: any) => { await initialize($); await show($); },
  "prompt.submit": async (event: { text: string }, $: any) => {
    await initialize($);
    if (event.text.trim() !== "/todos") return;
    await show($);
    return { drop: "todos: opened task list" };
  },
  "tool.result": async (event: { tool: string; ok: boolean; output?: unknown }, $: any) => {
    if (event.tool !== "todo" || !event.ok) return;
    const list = validate((event.output as { todos?: unknown } | undefined)?.todos);
    if (!list) return;
    $.state.set("todos", list); $.state.set("initialized", true);
    await show($);
    try { await $.fs.write(FILE, JSON.stringify(list, null, 2)); }
    catch (error) { await $.ui.notify(`todos: could not save tasks (${String(error)})`, "warn"); }
  },
};
