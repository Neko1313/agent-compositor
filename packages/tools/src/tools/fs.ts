import * as path from "node:path";
import type { ToolContext, ToolResult, ToolSpec } from "../types.js";
import {encodeEditAnchor} from '../edit-ref.js';

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadOutcome {
  content: string;
  totalLines: number;
  edit?:{path:string;expectedHash:string;range:{start:number;end:number};strict:boolean};
  editRef?:string;
  truncated: boolean;
  nextOffset?:number;
}

export const readTool: ToolSpec<ReadArgs, ReadOutcome> = {
  name: "read",
  loopGuard: 'query',
  description: "Read UTF-8 text, default 200 lines, with a guarded edit anchor. Use offset/limit for targeted ranges; nextOffset continues a truncated page. Prefer copying editRef verbatim to edit with path and exact oldText/newText, without calculating offsets. Explicit edit.path/expectedHash/range/strict remains supported. The anchor covers only the returned range. Files over 2 MiB require targeted search.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 1, description: "1-based start line; omit or use 1 for the first line" },
      limit: { type: "integer", minimum: 1, maximum: 10000, description: "Maximum lines to return (1..10000); default 200" },
    },
    required: ["path"],
  },
  describe: (args) => ({ tool: "read", path: path.resolve(args.path) }),
  async execute(ctx, args): Promise<ToolResult<ReadOutcome>> {
    if(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<1))return{ok:false,error:'read.offset must be a positive integer using 1-based lines; omit it or use 1 for the first line.'};
    if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>10000))return{ok:false,error:'read.limit must be an integer from 1 to 10000 lines.'};
    try {
      const raw = await ctx.request<ReadOutcome>("service.file.read", {
        path: ctx.resolvePath?await ctx.resolvePath(args.path):path.resolve(ctx.cwd,args.path),
        offset: args.offset,
        limit: args.limit,
      });
      const editRef=encodeEditAnchor(raw?.edit);
      const outcome=editRef===undefined?raw:{...raw,editRef};
      const content=outcome?.content;
      // Preserve raw line breaks for model edits, while keeping terminal controls
      // in the existing JSON-escaped representation.
      const readable=typeof content==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\r(?!\n)/u.test(content);
      const {content:_content,...metadata}=outcome??{};
      return { ok: true, data: outcome, ...(readable?{modelText:'Read metadata (JSON):\n'+JSON.stringify(metadata)+'\n\nFile content (verbatim):\n'+content}:{}) };
    } catch (err) {
      const message=err instanceof Error?err.message:String(err);
      const recovery=/\bENOENT\b/.test(message)?' Discover actual project filenames with available file-search tools before retrying; do not invent a path or create a file merely to satisfy this read.'
        :/\bEISDIR\b/.test(message)?' read expects a file, not a directory. Discover existing files, then read an exact returned file path.':'';
      return { ok: false, error: message+recovery };
    }
  },
};

export interface WriteArgs {
  path: string;
  content: string;
}

export const writeTool: ToolSpec<WriteArgs, { path: string; bytes: number }> = {
  name: "write",
  description: "Write (create or overwrite) a file.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  describe: (args) => ({ tool: "write", path: path.resolve(args.path) }),
  async execute(ctx, args): Promise<ToolResult<{ path: string; bytes: number }>> {
    try {
      const target = ctx.resolvePath?await ctx.resolvePath(args.path,{missing:true}):path.resolve(ctx.cwd,args.path);
      const previous = await ctx.request<string | null>("service.file.readText", { path: target });
      const outcome = await ctx.request<{ path: string; bytes: number }>("service.file.write", {
        path: target,
        content: args.content,
      });
      ctx.undo.push({ tool: "write", path: target, inverse: previous === null ? { op: "delete" } : { op: "write", content: previous } });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
