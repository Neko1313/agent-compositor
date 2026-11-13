import * as path from "node:path";
import type { ToolContext, ToolResult, ToolSpec } from "../types.js";
import {decodeEditRef,resolveEditRef,editTargetPath} from '../edit-ref.js';

export interface EditArgs {
  path?: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  editRef?:string;
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
  if(!args)return'edit.path must be a non-empty string, or supply a valid editRef.';
  try{args=resolveEditRef(args);}catch(error){return error instanceof Error?error.message:String(error);}
  if(typeof args.path!=='string'||args.path.length===0)return'edit.path must be a non-empty string, or supply a valid editRef.';
  if(typeof args.oldText!=='string')return'edit.oldText must be a string containing the current source text.';
  if(typeof args.newText!=='string')return'edit.newText must be a string containing the intended replacement.';
  if(args.oldText===args.newText&&(args.strict===true||args.expectedHash!==undefined||args.range!==undefined))
    return'edit.newText is identical to edit.oldText. This exact edit would leave text unchanged. Supply replacement text that implements the intended change; do not repeat identical arguments. No file was read or changed.';
  if(args.range!==undefined){
    const range=args.range;
    if(!range||typeof range!=='object'||Array.isArray(range)||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<range.start)
      return'edit.range must be an object with non-negative safe integer start/end offsets, with end >= start. Offsets are UTF-16 code units, end exclusive, not line numbers or a JSON-encoded string. Copy the range from the current read/read_symbol edit anchor. No file was read or changed.';
    if(!args.expectedHash)return'edit: guarded range requires expectedHash. Copy the complete edit anchor (path, expectedHash, range, strict) from read/read_symbol; re-read if the snapshot may have changed.';
  }
}

/**
 * Surgical edit. Semantics harvested from Claude Code / the kimi fork:
 *  - exact match required; empty or ambiguous (multi without replaceAll) → error
 *  - fallback: whitespace-normalized match (indentation drift), reported
 *  - every successful edit pushes an undo entry (swap old/new)
 */
export const editTool: ToolSpec<EditArgs, EditOutcome> = {
  name: "edit",
  description: "Replace exact text in a file. Prefer editRef copied verbatim from read/read_symbol + exact oldText/newText; path is already in the reference and may be omitted. Do not calculate offsets. Alternatively preserve ALL explicit anchor fields: path, expectedHash, range, strict. Replacements that leave text unchanged are rejected. A stale snapshot requires re-reading. oldText must match uniquely inside the selected range unless replaceAll is set. References do not grant permission.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string",description:'Required without editRef. With a reference this may be omitted; an explicit path must resolve to the same file.' },
      editRef:{type:'string',maxLength:16384,description:'Snapshot/range reference from read/read_symbol. Copy it verbatim with exact oldText/newText. Supplies path and replaces manual expectedHash/range/strict fields; conflicting explicit guards are rejected.'},
      oldText: { type: "string", description: "Current source text to replace, copied exactly from the selected read range." },
      newText: { type: "string", description: "Replacement implementing the intended change. With hash, range or strict matching it must differ from oldText; do not echo the old text unchanged." },
      replaceAll: { type: "boolean" },
      expectedHash:{type:"string",description:"SHA-256 of the UTF-8 file snapshot in the edit anchor from read or code_query read_symbol; required with range and rejects stale edits."},
      range:{type:"object",properties:{start:{type:"integer",minimum:0},end:{type:"integer",minimum:0}},required:["start","end"],description:"Optional UTF-16 start/end offsets (end exclusive) from the read/read_symbol edit anchor. Requires expectedHash and exact matching."},
      strict:{type:"boolean",description:"Require exact text; disable whitespace-normalized fallback."},
    },
    required: ["oldText", "newText"],
    anyOf:[{type:'object',properties:{path:{type:'string'}},required:['path']},{type:'object',properties:{editRef:{type:'string'}},required:['editRef']}],
  },
  describe: (args) => ({ tool: "edit", path: path.resolve(editTargetPath(args)) }),
  validate:editArgumentError,
  async execute(ctx, args): Promise<ToolResult<EditOutcome>> {
    const invalid=editArgumentError(args);if(invalid)return{ok:false,error:invalid};
    try {
      args=resolveEditRef(args);
      const selectedPath=editTargetPath(args);
      const target = ctx.resolvePath?await ctx.resolvePath(selectedPath):path.resolve(ctx.cwd,selectedPath);
      if(args.editRef!==undefined){
        const anchor=decodeEditRef(args.editRef);
        const selected=ctx.resolvePath?await ctx.resolvePath(anchor.path):path.resolve(anchor.path);
        if(target!==selected)throw Error('edit.path does not match editRef. Use the path returned with the reference, or read the intended file again.');
      }
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
