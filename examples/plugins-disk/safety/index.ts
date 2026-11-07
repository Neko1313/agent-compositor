export const hooks = {
  "tool.check": (e: { tool: string; input?: { command?: string } }) => {
    if (e.tool === "Bash" && e.input?.command?.includes("rm -rf /")) {
      return { decision: "deny", reason: "refusing to rm -rf /" };
    }
    return undefined; // fall through the chain
  },
};
