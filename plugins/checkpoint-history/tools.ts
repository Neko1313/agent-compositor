export default [
  {
    name: "checkpoint",
    description:
      "List or review turn checkpoints. Restore code, conversation or both from interactive controls after the turn ends; files edited afterwards are protected.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "diff", "restore"] },
        id: { type: "string" },
        mode: { type: "string", enum: ["code", "conversation", "both"] },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Restore only these changed files when mode=code",
        },
      },
      required: ["action"],
    },
    describe: (a: any) => ({
      tool: a.action === "restore" ? "checkpoint" : "checkpoint_read",
    }),
    execute: async (ctx: any, args: any) => {
      try {
        return {
          ok: true,
          data: await ctx.request("service.checkpoint.control", args),
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  },
];
