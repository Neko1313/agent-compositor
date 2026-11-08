/**
 * guard-scope — the workspace jail.
 *
 * Codex sandboxes by default; here the same guarantee is a plugin: any
 * write/edit whose resolved path escapes the session cwd is denied at
 * tool.check time, no matter what the permission rules decided.
 */
import * as path from "node:path";

interface ToolCheck {
  tool: string;
  input: unknown;
}

export default {
  "tool.check": async (event: ToolCheck) => {
    if (event.tool !== "write" && event.tool !== "edit") return undefined;

    const input = (event.input ?? {}) as { path?: string };
    if (!input.path) return undefined;

    const resolved = path.resolve(input.path);
    const cwd = path.resolve(process.cwd()); // session cwd is the REPL's cwd
    const rel = path.relative(cwd, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return {
        decision: "deny" as const,
        reason: `guard-scope: ${resolved} escapes the workspace (${cwd})`,
      };
    }
    return undefined;
  },
};
