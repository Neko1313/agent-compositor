import * as path from "node:path";
import type { ToolContext, ToolResult, ToolSpec } from "../types.js";
import {encodeEditAnchor} from '../edit-ref.js';
import {decodeReadCursor,encodeReadCursor,readHash,readPageEnd} from '../read-cursor.js';

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
  maxChars?: number;
  cursor?: string;
}

export interface ReadOutcome {
  content: string;
  totalLines: number;
  edit?:{path:string;expectedHash:string;range:{start:number;end:number};strict:boolean};
  editRef?:string;
  truncated: boolean;
  nextOffset?:number;
  nextCursor?:string;
}

function readArguments(args:ReadArgs){
  if(!args||typeof args!=='object'||Array.isArray(args)||typeof args.path!=='string'||!args.path)throw Error('read.path must be a nonempty string.');
  if(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<1))throw Error('read.offset must be a positive integer using 1-based lines; omit it or use 1 for the first line.');
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>10000))throw Error('read.limit must be an integer from 1 to 10000 lines.');
  if(args.maxChars!==undefined&&(!Number.isInteger(args.maxChars)||args.maxChars<1||args.maxChars>16000))throw Error('read.maxChars must be an integer from 1 to 16000 Unicode characters.');
  const cursor=args.cursor===undefined?undefined:decodeReadCursor(args.cursor);
  if(cursor&&((args.offset!==undefined&&args.offset!==(cursor.offset??1))||(args.limit!==undefined&&args.limit!==(cursor.limit??200))))throw Error('read.offset/limit conflicts with cursor; omit them or use the original line window.');
  return cursor;
}

export const readTool: ToolSpec<ReadArgs, ReadOutcome> = {
  name: "read",
  loopGuard: 'query',
  description: "Read UTF-8 text, default 200 lines and at most 16000 UTF-8 bytes, with a guarded edit anchor. Use offset/limit for targeted lines and maxChars for a smaller page in Unicode characters (1..16000). Copy nextCursor with the same path to continue inside a long line/window; after it ends, nextOffset continues line pages. Prefer copying editRef verbatim to edit with exact oldText/newText; edit.path may be omitted. Do not calculate offsets. The anchor covers only returned content. Files over 2 MiB require targeted search.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 1, description: "1-based start line; omit or use 1 for the first line" },
      limit: { type: "integer", minimum: 1, maximum: 10000, description: "Maximum lines to return (1..10000); default 200" },
      maxChars: {type:'integer',minimum:1,maximum:16000,description:'Maximum Unicode characters in this page; default 16000'},
      cursor: {type:'string',description:'Opaque nextCursor from this file; copy verbatim and omit offset/limit or keep them identical'},
    },
    required: ["path"],
  },
  describe: (args) => ({ tool: "read", path: path.resolve(args.path) }),
  validate:args=>{try{readArguments(args);}catch(error){return error instanceof Error?error.message:String(error);}},
  async execute(ctx, args): Promise<ToolResult<ReadOutcome>> {
    try {
      const cursor=readArguments(args);
      const target=ctx.resolvePath?await ctx.resolvePath(args.path):path.resolve(ctx.cwd,args.path);
      if(cursor&&cursor.path!==target)throw Error('read.cursor belongs to a different path; read this file without a cursor first.');
      const offset=cursor?cursor.offset:args.offset,limit=cursor?cursor.limit:args.limit;
      const raw = await ctx.request<ReadOutcome>("service.file.read", {
        path: target,
        offset,
        limit,
      });
      let page=raw;
      if(cursor&&typeof raw?.content!=='string')throw Error('read.cursor cannot continue a non-text result; restart this read without cursor.');
      if(typeof raw?.content==='string'){
        const start=cursor?.index??0,hash=readHash(raw.content);
        if(cursor&&(cursor.hash!==hash||start>=raw.content.length||start>0&&/[\uD800-\uDBFF]/.test(raw.content[start-1])&&/[\uDC00-\uDFFF]/.test(raw.content[start])))throw Error(`read.cursor is stale or has an invalid boundary; restart without cursor using offset ${cursor.offset??1} and limit ${cursor.limit??200}.`);
        const end=readPageEnd(raw.content,start,args.maxChars??16000);
        if(start>0||end<raw.content.length){
          const {edit,editRef:_ref,nextOffset,nextCursor:_cursor,...rest}=raw;
          const anchor=encodeEditAnchor(edit)&&edit!.range.end-edit!.range.start===raw.content.length?{...edit!,range:{start:edit!.range.start+start,end:edit!.range.start+end}}:undefined;
          page={...rest,content:raw.content.slice(start,end),truncated:end<raw.content.length||raw.truncated,
            ...(anchor?{edit:anchor}:{}),
            ...(end<raw.content.length?{nextCursor:encodeReadCursor({path:target,offset,limit,index:end,hash})}:nextOffset===undefined?{}:{nextOffset})};
        }
      }
      const editRef=encodeEditAnchor(page?.edit);
      const outcome=editRef===undefined?page:{...page,editRef};
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
