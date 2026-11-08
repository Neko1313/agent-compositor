import { compileRules, type CompiledRule, type ToolCallDescriptor } from "@agent-compositor/permissions";
import { editTool } from "./tools/edit.js";
import { execTool, execOutputTool, execKillTool, type ExecArgs, type ExecOutcome, type ShellJobArgs, type ShellJobOutcome } from "./tools/exec.js";
import { readTool, writeTool, type ReadArgs, type ReadOutcome } from "./tools/fs.js";
import { todoTool, type TodoArgs, type TodoItem, type TodoOutcome } from "./tools/todo.js";
import { UndoStore, type ToolContext, type ToolResult, type ToolSpec } from "./types.js";

export { editTool } from "./tools/edit.js";
export {
  execTool,
  execOutputTool,
  execKillTool,
  type ExecArgs,
  type ExecOutcome,
  type ShellJobArgs,
  type ShellJobOutcome,
} from "./tools/exec.js";
export { readTool, writeTool, type ReadArgs, type ReadOutcome, type WriteArgs } from "./tools/fs.js";
export { todoTool, type TodoArgs, type TodoItem, type TodoOutcome } from "./tools/todo.js";
export { registerDefaultResolvers, type ResolverBus } from "./resolvers.js";
export { UndoStore, type ToolContext, type ToolResult, type ToolSpec, type UndoEntry } from "./types.js";

export const builtinTools: ToolSpec<unknown, unknown>[] = [
  execTool,
  execOutputTool,
  execKillTool,
  readTool,
  writeTool,
  editTool,
  todoTool,
];

/** Permission rules expressing conservative defaults for the builtins —
 *  the loop feeds these (source "config" rank) under any user rules. */
export { projectFiles, confinedPath, glob, queryProject } from "./project.js";

export const builtinToolRules: Parameters<typeof compileRules>[0] = [
  { decision: "allow", tool: "glob" },
  { decision: "allow", tool: "grep" },
  { decision: "allow", tool: "code_query", reason: "read-only project graph navigation" },
  { decision: "allow", tool: "run_python", reason: "bounded execution in the selected sandbox without host capabilities" },
  { decision: "allow", tool: "checkpoint_read", reason: "inspect local turn snapshots" },
  { decision: "allow", tool: "read", reason: "reads are safe; the resolver still confines paths to the project" },
  { decision: "ask", tool: "edit", reason: "file mutations need approval unless the session allows" },
  { decision: "ask", tool: "write", reason: "file mutations need approval unless the session allows" },
  { decision: "ask", tool: "exec", reason: "shell commands need approval unless rules allow" },
  { decision: "allow", tool: "todo", reason: "task lists are session-local state" },
  { decision: "allow", tool: "exec_output", reason: "reading a shell buffer is a read" },
  { decision: "ask", tool: "exec_kill", reason: "terminating processes needs approval unless rules allow" },
];

export { spawnCommand, stopProcess } from "./execution.js";
