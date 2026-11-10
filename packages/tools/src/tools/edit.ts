import * as path from "node:path";
import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface EditArgs {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  expectedHash?:string;
  range?:{start:number;end:number};
  strict?:boolean;
}

export interface EditOutcome {
  path: string;
  replacements: number;
  /** how the match was found — exact or whitespace-normalized fallback */
  match: "exact" | "normalized";
  hashAfter?:string;
  undo?:Omit<EditArgs,"path">;
}

/**
 * Surgical edit. Semantics harvested from Claude Code / the kimi fork:
 *  - exact match required; empty or ambiguous (multi without replaceAll) → error
 *  - fallback: whitespace-normalized match (indentation drift), reported
 *  - every successful edit pushes an undo entry (swap old/new)
 */
export const editTool: ToolSpec<EditArgs, EditOutcome> = {
  name: "edit",
  description: "Replace exact text in a file. Preserve ALL edit anchor fields from read/read_symbol: path, expectedHash, range, strict. Do not discard range or hash. A stale snapshot requires re-reading. oldText must match uniquely inside the selected range unless replaceAll is set.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
      replaceAll: { type: "boolean" },
      expectedHash:{type:"string",description:"SHA-256 of the UTF-8 file snapshot returned by code_query read_symbol; reject stale edits."},
      range:{type:"object",properties:{start:{type:"integer",minimum:0},end:{type:"integer",minimum:0}},required:["start","end"],description:"Optional UTF-16 start/end offsets (end exclusive) returned by read_symbol. Requires expectedHash and exact matching."},
      strict:{type:"boolean",description:"Require exact text; disable whitespace-normalized fallback."},
    },
    required: ["path", "oldText", "newText"],
  },
  describe: (args) => ({ tool: "edit", path: path.resolve(args.path) }),
  async execute(ctx, args): Promise<ToolResult<EditOutcome>> {
    try {
      const target = ctx.resolvePath?await ctx.resolvePath(args.path):path.resolve(ctx.cwd,args.path);
      const outcome = await ctx.request<EditOutcome>("service.file.edit", {
        path: target,
        oldText: args.oldText,
        newText: args.newText,
        replaceAll: args.replaceAll ?? false,
        expectedHash:args.expectedHash,range:args.range,strict:args.strict,
      });
      ctx.undo.push({
        tool: "edit",
        path: target,
        inverse: outcome.undo ? {op:"edit",...outcome.undo} : { op: "edit", oldText: args.newText, newText: args.oldText, replaceAll: args.replaceAll },
      });
      const {undo,...visible}=outcome;
      return { ok: true, data: visible };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
