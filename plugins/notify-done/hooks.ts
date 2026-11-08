/**
 * notify-done — look-away freedom.
 *
 * Long agent turns invite tab-switching; Claude Code and codex both ping
 * you when the model stops talking. Same idea, one hook, removable.
 */
export default {
  "turn.complete": async (_event: unknown, $: any) => {
    await $.ui.notify("turn complete", "info");
    return undefined;
  },

  "turn.failed": async (event: { error?: string }, $: any) => {
    await $.ui.notify(`turn failed: ${String(event.error ?? "unknown").slice(0, 120)}`, "error");
    return undefined;
  },
};
