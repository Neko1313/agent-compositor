import { isAbsolute, relative, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { ToolContext } from "@agent-compositor/tools";

const properties = {
  cwd:{type:"string",description:"Attached project directory; accepts absolute paths and ~/path. Defaults to the primary project."},
  action: {
    type: "string",
    enum: [
      "symbols",
      "definition",
      "references",
      "callers",
      "callees",
      "dependencies",
      "status",
      "outline",
      "read_symbol",
      "impact",
    ],
  },
  pattern: {
    type: "string",
    description:
      "Symbol ID, qualified name, exact name, or partial name. Use an ID for unambiguous graph traversal.",
  },
  path: { type: "string", description: "Restrict symbols to a source file." },
  refresh: { type: "boolean", description: "Force a new analysis." },
  limit: { type: "integer", minimum: 1, maximum: 1000 },
  cursor:{type:"string",description:"Opaque nextCursor from a graph page; repeat the same action/pattern/path filters."},
  maxTokens:{type:"integer",minimum:256,maximum:16000,description:"Approximate JSON result token budget (default 2000), not billed provider usage."},
  detail:{enum:["compact","raw"],description:"Compact locations by default; raw includes native metadata within the same budget."},
  kinds:{type:"array",items:{type:"string"},description:"Optional symbol kind filters, e.g. function, class, method."},
  depth:{type:"integer",minimum:1,maximum:4,description:"Maximum reverse impact traversal depth."},
};
const execute =
  (action?: string) => async (ctx: ToolContext, args: unknown) => {
    try {
      const input=args as Record<string,any>;
      let cwd=ctx.resolvePath?await ctx.resolvePath(input.cwd??ctx.cwd,{directory:true}):input.cwd??ctx.cwd;
      let path=input.path;
      if(ctx.resolvePath&&typeof path==='string'&&(isAbsolute(path)||path.startsWith('~/'))){
        const target=await ctx.resolvePath(path);
        if((await stat(target)).isDirectory()){cwd=target;path=undefined;}
        else{
          const root=ctx.workspaceRoots?.().filter(entry=>entry.kind==='directory'&&(target===entry.path||target.startsWith(entry.path+sep))).sort((a,b)=>b.path.length-a.path.length)[0]?.path;
          if(!root)throw Error('For project search/navigation attach the containing directory; an individual file can be read with read.');
          cwd=root;path=relative(root,target);
        }
      }
      const data=await ctx.request<Record<string,unknown>>("service.project.query",{...input,path,...(action?{action}:{}),cwd});
      return{ok:true,data:{...data,cwd}};
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
export default [
  {
    name: "code_query",
    description:
      "Navigate the Callix code graph. Start with symbols/outline, use an exact returned ID for definition, callers, callees, references or bounded impact. read_symbol returns the precise UTF-8 source slice and an edit anchor (path, expectedHash, UTF-16 range, strict): pass that anchor to the normal edit tool with exact oldText/newText. Re-read after stale-snapshot errors. Inspect resolver metadata; an empty degraded graph result does not prove no usages exist. Follow nextCursor for more results and tune maxTokens (default 2000). Cold indexing costs time, warm queries reuse the graph.",
    parameters: { type: "object", properties, required: ["action"] },
    describe: () => ({ tool: "code_query" }),
    execute: execute(),
  },
  ...["glob", "grep"].map((action) => ({
    name: action,
    description:
      action === "glob"
        ? "Find project files by glob, respecting ignore rules."
        : "Search project text; literal by default.",
    parameters: {
      type: "object",
      properties: {
        cwd:properties.cwd,
        pattern: { type: "string" },
        path: { type: "string" },
        regex: { type: "boolean" },
        limit: properties.limit,
        maxTokens:properties.maxTokens,
        offset:{type:"integer",minimum:0,maximum:100000,description:"Next offset from a previous text/file page; results can move after source changes."},
      },
      required: ["pattern"],
    },
    describe: () => ({ tool: action }),
    execute: execute(action),
  })),
];
