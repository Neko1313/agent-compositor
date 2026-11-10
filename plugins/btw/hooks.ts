// /btw <question>: side question answered by an isolated model call — the
// answer is a notification, never a conversation entry (Claude Code /btw).
export default {
  "prompt.submit": async (event: { text: string }, $: any) => {
    if (!/^\/btw(?:\s|$)/.test(event.text)) return;
    const q = event.text.slice(4).trim();
    if (!q) {
      await $.ui.notify("btw: usage — /btw <question>", "warn");
      return { drop: "btw: empty question" };
    }
    const answer = await $.model
      .complete({
        signal: $.signal,
        messages: [{ role: "user", content: `Answer briefly and standalone (no conversation context): ${q}` }],
      })
      .catch((err: unknown) => `btw failed: ${err instanceof Error ? err.message : String(err)}`);
    await $.ui.notify(String(answer ?? "(no answer)"), "info");
    return { drop: "btw: answered on the side" };
  },
};
