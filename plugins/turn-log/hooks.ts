/**
 * turn-log — the session journal.
 *
 * Gemini CLI has /stats; the data has to come from somewhere. Every turn
 * lands as one JSONL line: prompt, outcome, error if any. Read it with
 * `jq`, tail it, plot it — it's your data.
 */
const FILE = ".agent-compositor/turn-log.jsonl";

export default {
  "prompt.submit": async (event: { text: string }, $: any) => {
    $.state.set("pending", event.text.slice(0, 500));
    return undefined;
  },

  "turn.complete": async (_event: unknown, $: any) => {
    await append($, { ok: true });
    return undefined;
  },

  "turn.failed": async (event: { error?: string }, $: any) => {
    await append($, { ok: false, error: event.error });
    return undefined;
  },
};

async function append($: any, outcome: Record<string, unknown>): Promise<void> {
  const prompt = ($.state.get("pending") as string) ?? "";
  let existing = ((await $.fs.read(FILE).catch(() => "")) as string) ?? "";
  const line = JSON.stringify({ ts: new Date().toISOString(), session: $.session.id, prompt, ...outcome });
  await $.fs.write(FILE, existing + line + "\n");
  $.state.delete("pending");
}
