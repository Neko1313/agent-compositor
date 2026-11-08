import type { ToolSpec } from "@agent-compositor/tools";

/** Claude Code's AskUserQuestion: the model asks the human something the
 *  context can't answer (choices, intent, ambiguities). Resolved by the
 *  loop via service.ui.ask; headless sessions deny (fail closed) and the
 *  tool returns an error value the model can work with. */
export interface AskArgs {
  question: string;
  options?: string[];
  multi?: boolean;
}

export const askTool: ToolSpec<AskArgs, { answer: string | string[] }> = {
  name: "ask_user",
  description:
    "Ask the user a question when you need a decision the context cannot provide. " +
    "Provide options for a choice prompt (numbered for the user), or omit them for free text. " +
    "Headless sessions return an error — never rely on it succeeding.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "what you need to know, phrased for a human" },
      options: { type: "array", items: { type: "string" }, description: "choices; user answers with numbers" },
      multi: { type: "boolean", description: "allow multiple selections" },
    },
    required: ["question"],
  },
  describe: () => ({ tool: "ask_user" }),
  async execute(ctx, args) {
    if (!args.question || typeof args.question !== "string") {
      return { ok: false, error: "ask_user: question is required" };
    }
    try {
      const res = await ctx.request<{ answer?: string | string[] }>("service.ui.ask", {
        plugin: "core",
        question: args.question,
        options: Array.isArray(args.options) ? args.options.filter((o) => typeof o === "string") : undefined,
        multi: args.multi === true,
      });
      return { ok: true, data: { answer: res.answer ?? "" } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), denied: true };
    }
  },
};
