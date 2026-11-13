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

/** Exact edits cannot change text when their literal replacement is identical.
 * Unguarded whitespace fallback can still normalize actual source in that case.
 */
export function editArgumentError(args:EditArgs):string|undefined {
  if(!args||typeof args.path!=='string'||args.path.length===0)return'edit.path must be a non-empty string.';
  if(typeof args.oldText!=='string')return'edit.oldText must be a string containing the current source text.';
  if(typeof args.newText!=='string')return'edit.newText must be a string containing the intended replacement.';
  if(args.oldText===args.newText&&(args.strict===true||args.expectedHash!==undefined||args.range!==undefined))
    return'edit.newText is identical to edit.oldText. This exact edit would leave text unchanged. Supply replacement text that implements the intended change; do not repeat identical arguments. No file was read or changed.';
}

/**
 * Surgical edit. Semantics harvested from Claude Code / the kimi fork:
 *  - exact match required; empty or ambiguous (multi without replaceAll) → error
 *  - fallback: whitespace-normalized match (indentation drift), reported
 *  - every successful edit pushes an undo entry (swap old/new)
 */
export const editTool: ToolSpec<EditArgs, EditOutcome> = {
  name: "edit",
  description: "Replace exact text in a file. Replacements that leave the actual file text unchanged are rejected. Preserve ALL edit anchor fields from read/read_symbol: path, expectedHash, range, strict. Do not discard range or hash. A stale snapshot requires re-reading. oldText must match uniquely inside the selected range unless replaceAll is set.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string", description: "Current source text to replace, copied exactly from the selected read range." },
      newText: { type: "string", description: "Replacement implementing the intended change. With hash, range or strict matching it must differ from oldText; do not echo the old text unchanged." },
      replaceAll: { type: "boolean" },
      expectedHash:{type:"string",description:"SHA-256 of the UTF-8 file snapshot in the edit anchor from read or code_query read_symbol; required with range and rejects stale edits."},
      range:{type:"object",properties:{start:{type:"integer",minimum:0},end:{type:"integer",minimum:0}},required:["start","end"],description:"Optional UTF-16 start/end offsets (end exclusive) from the read/read_symbol edit anchor. Requires expectedHash and exact matching."},
      strict:{type:"boolean",description:"Require exact text; disable whitespace-normalized fallback."},
    },
    required: ["path", "oldText", "newText"],
  },
  describe: (args) => ({ tool: "edit", path: path.resolve(args.path) }),
  validate:editArgumentError,
  async execute(ctx, args): Promise<ToolResult<EditOutcome>> {
    const invalid=editArgumentError(args);if(invalid)return{ok:false,error:invalid};
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
      const message=err instanceof Error?err.message:String(err);
      const recovery=/\bENOENT\b/.test(message)?' Edit requires an existing file. Inspect actual project filenames with the available discovery tools before retrying. Do not create a guessed replacement just to make this edit succeed.':'';
      return { ok: false, error: message+recovery };
    }
  },
};
