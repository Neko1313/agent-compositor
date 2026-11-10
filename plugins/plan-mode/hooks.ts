// Plan mode (Claude Code /plan analog). /plan toggles read-only mode:
// prompts get a planning reminder; write/edit/exec/exec_kill calls are denied.
const WRITE_TOOLS = new Set(["write", "edit", "exec", "exec_kill"]);
const REMINDER = "\n\n[plan mode is ON: read-only. Produce a plan, change nothing. Send /plan again to exit.]";

export default {
  "prompt.submit": async (event: { text: string }, $: any) => {
    if (event.text === "/plan") {
      const on = !$.state.get("planning");
      $.state.set("planning", on);
      await $.emit("ui.reaction", {source:"plan-mode",kind:"planning",id:"mode",active:on});
      await $.ui.notify(on ? "plan mode ON — writes denied" : "plan mode OFF — writes allowed", "info");
      return { drop: "plan-mode: toggled" };
    }
    if ($.state.get("planning") && !event.text.startsWith("/")) {
      return { text: event.text + REMINDER };
    }
  },
  "tool.check": (event: { tool: string; input?: unknown; isReadOnly?:boolean }, $: any) => {
    if (!$.state.get("planning")) return;
    if(event.tool==="exec"&&event.isReadOnly)return;
    if (WRITE_TOOLS.has(event.tool)) {
      return { decision: "deny", reason: "plan mode is active — send /plan to exit planning and allow writes" };
    }
  },
};
