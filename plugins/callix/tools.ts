import { isAbsolute, relative, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { ToolContext } from "@agent-compositor/tools";
import { graphActions } from './adapter.js';

const properties = {
  cwd:{type:"string",description:"Attached project directory; accepts absolute paths and ~/path. Defaults to the primary project."},
  action: {
    type: "string",
    enum: [...graphActions],
    description:'Use status for a quick readiness/error check without indexing; definition or outline starts semantic analysis when needed.',
  },
  pattern: {
    type: "string",
    description:
      "Symbol ID, qualified name, exact name, or partial name. Use an ID for unambiguous graph traversal.",
  },
  path: { type: "string", description: "Restrict symbols to a source file." },
  refresh: { type: "boolean", description: "Force a new semantic analysis. Usually omit: source changes invalidate the cache automatically. status never starts analysis." },
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
      "Use code_query to navigate code with the Callix backend; do not invoke a tool named callix or run callix through exec. action:status checks executable availability, indexing progress or the last failure without starting analysis. Start navigation with definition (symbol name) or outline (exact file path), then use returned IDs for callers/callees/references/impact. Cold semantic analysis can take time; repeated queries reuse it. Do not force refresh repeatedly. On failure, inspect status and use glob/grep/read for immediate inspection. read_symbol returns source and an edit anchor (path, expectedHash, UTF-16 range, strict): pass all anchor fields to edit with exact oldText/newText. Empty degraded relation results do not prove no usages exist. Follow nextCursor and tune maxTokens (default 2000).",
    usage: {
      when:'Use code_query for semantic navigation. read_symbol, definition and callers are action values on code_query, not separate tools. Use status to diagnose delayed or unavailable indexing.',
      avoid:'Do not repeat refresh:true or shell-based indexing after an error. glob/grep/read work without building a graph.',
      examples:[
        {purpose:'Check availability and indexing without starting a build',args:{action:'status'}},
        {purpose:'Find a located definition before using its ID',args:{action:'definition',pattern:'calculateTotal',path:'src/total.ts'}},
        {purpose:'Read an exact definition for a guarded edit',args:{action:'read_symbol',pattern:'<returned symbol ID>',maxTokens:1500}},
      ],
    },
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
