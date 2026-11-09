import * as path from "node:path";
import type { ToolContext, ToolResult, ToolSpec } from "../types.js";

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadOutcome {
  content: string;
  totalLines: number;
  edit?:{path:string;expectedHash:string;range:{start:number;end:number};strict:boolean};
  truncated: boolean;
}

export const readTool: ToolSpec<ReadArgs, ReadOutcome> = {
  name: "read",
  description: "Read UTF-8 text with a line range and a guarded edit anchor. Pass edit.path/expectedHash/range/strict to edit with exact oldText/newText. The anchor covers only the returned range. Files over 2 MiB require targeted search.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "number", description: "1-based start line" },
      limit: { type: "number", description: "max lines" },
    },
    required: ["path"],
  },
  describe: (args) => ({ tool: "read", path: path.resolve(args.path) }),
  async execute(ctx, args): Promise<ToolResult<ReadOutcome>> {
    try {
      const outcome = await ctx.request<ReadOutcome>("service.file.read", {
        path: path.resolve(ctx.cwd, args.path),
        offset: args.offset,
        limit: args.limit,
      });
      return { ok: true, data: outcome };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    const target = path.resolve(ctx.cwd, args.path);
    try {
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
