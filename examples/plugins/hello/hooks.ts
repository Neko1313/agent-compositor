/**
 * hello-plugin — the minimal disk plugin.
 *
 * Every `exec` tool.call is answered HERE, before the builtin
 * exec resolver ever sees it: the model gets a deterministic echo instead
 * of a real subprocess. This is the compositor idea in one file — behavior
 * is composed from plugins riding the event chain, not hardcoded in the loop.
 *
 * Runs on Node 24 type-stripping: erasable syntax only.
 */
export default {
  "tool.call": async (event: { tool: string; input: unknown }) => {
    if (event.tool !== "exec") return undefined; // not ours — pass through
    const input = event.input as { command?: string[] };
    const argv = input.command ?? [];
    if (argv.includes("rm") || argv.includes("sudo")) {
      return { deny: "hello-plugin refuses destructive commands" };
    }
    return {
      result: {
        stdout: `hello-plugin intercepted: ${argv.join(" ") || "(empty)"}`,
        stderr: "",
        exitCode: 0,
        skippedRealExec: true,
      },
    };
  },
};
