import type { ToolContext } from "@agent-compositor/tools";

const properties = {
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
};
const execute =
  (action?: string) => async (ctx: ToolContext, args: unknown) => {
    try {
      return {
        ok: true,
        data: await ctx.request("service.project.query", {
          ...(args as object),
          ...(action ? { action } : {}),
          cwd: ctx.cwd,
        }),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
export default [
  {
    name: "code_query",
    description:
      "Navigate the project code graph: symbols, definitions, references, callers, callees and dependencies. Inspect status/metadata for resolution completeness. Indexing may take time on the first query.",
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
        pattern: { type: "string" },
        path: { type: "string" },
        regex: { type: "boolean" },
        limit: properties.limit,
      },
      required: ["pattern"],
    },
    describe: () => ({ tool: action }),
    execute: execute(action),
  })),
];
