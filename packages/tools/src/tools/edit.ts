import * as path from "node:path";
import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface EditArgs {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export interface EditOutcome {
  path: string;
  replacements: number;
  /** how the match was found — exact or whitespace-normalized fallback */
  match: "exact" | "normalized";
}

/**
 * Surgical edit. Semantics harvested from Claude Code / the kimi fork:
 *  - exact match required; empty or ambiguous (multi without replaceAll) → error
 *  - fallback: whitespace-normalized match (indentation drift), reported
 *  - every successful edit pushes an undo entry (swap old/new)
 */
export const editTool: ToolSpec<EditArgs, EditOutcome> = {
  name: "edit",
  description: "Replace exact text in a file. oldText must match uniquely unless replaceAll is set.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
      replaceAll: { type: "boolean" },
    },
    required: ["path", "oldText", "newText"],
  },
  describe: (args) => ({ tool: "edit", path: path.resolve(args.path) }),
  async execute(ctx, args): Promise<ToolResult<EditOutcome>> {
    const target = path.resolve(ctx.cwd, args.path);
    try {
      const outcome = await ctx.request<EditOutcome>("service.file.edit", {
        path: target,
        oldText: args.oldText,
        newText: args.newText,
        replaceAll: args.replaceAll ?? false,
      });
      ctx.undo.push({
        tool: "edit",
        path: target,
        inverse: { op: "edit", oldText: args.newText, newText: args.oldText, replaceAll: args.replaceAll },
      });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
