import { compileRules, type CompiledRule, type ToolCallDescriptor } from "@agent-compositor/permissions";
import { editTool } from "./tools/edit.js";
import { execTool, type ExecArgs, type ExecOutcome } from "./tools/exec.js";
import { readTool, writeTool, type ReadArgs, type ReadOutcome } from "./tools/fs.js";
import { UndoStore, type ToolContext, type ToolResult, type ToolSpec } from "./types.js";

export { editTool } from "./tools/edit.js";
export { execTool, type ExecArgs, type ExecOutcome } from "./tools/exec.js";
export { readTool, writeTool, type ReadArgs, type ReadOutcome, type WriteArgs } from "./tools/fs.js";
export { registerDefaultResolvers, type ResolverBus } from "./resolvers.js";
export { UndoStore, type ToolContext, type ToolResult, type ToolSpec, type UndoEntry } from "./types.js";

export const builtinTools: ToolSpec<unknown, unknown>[] = [execTool, readTool, writeTool, editTool];

/** Permission rules expressing conservative defaults for the builtins —
 *  the loop feeds these (source "config" rank) under any user rules. */
export const builtinToolRules: Parameters<typeof compileRules>[0] = [
  { decision: "allow", tool: "read", reason: "reads are safe; the resolver still confines paths to the project" },
  { decision: "ask", tool: "edit", reason: "file mutations need approval unless the session allows" },
  { decision: "ask", tool: "write", reason: "file mutations need approval unless the session allows" },
  { decision: "ask", tool: "exec", reason: "shell commands need approval unless rules allow" },
];
