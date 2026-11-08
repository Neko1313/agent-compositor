// /compact and /clear (Claude Code analogs) via the $.agent session controls.
export default {
  "prompt.submit": (event: { text: string }, $: any) => {
    if (event.text === "/compact") {
      return Promise.resolve($.agent.compact("plugin /compact")).then(() => {
        void $.ui.notify("compaction requested", "info");
        return { drop: "session-ctl: compacted" };
      });
    }
    if (event.text === "/clear") {
      return Promise.resolve($.agent.clear()).then(() => {
        void $.ui.notify("context cleared (system prompt kept)", "info");
        return { drop: "session-ctl: cleared" };
      });
    }
  },
};
