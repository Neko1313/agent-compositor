// Session commands consume failures too, so denied controls cannot reach the model.
export default {
  "prompt.submit": async (event: { text: string }, $: any) => {
    if (event.text !== "/compact" && event.text !== "/clear") return;
    try {
      if (event.text === "/compact") await $.agent.compact("plugin /compact");
      else await $.agent.clear();
    } catch (error) {
      await $.ui.notify(`${event.text} failed: ${String(error)}`, "error");
      return { drop: "session-ctl: failed" };
    }
    await $.ui.notify(event.text === "/compact" ? "compaction requested" : "context cleared (system prompt kept)", "info");
    return { drop: event.text === "/compact" ? "session-ctl: compacted" : "session-ctl: cleared" };
  },
};
