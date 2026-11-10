/**
 * slash-commands — the command palette.
 *
 * Claude Code / Gemini CLI ship slash commands; here they are a plugin,
 * because in a compositor even the command palette is a removable part.
 *
 * A `/`-prefixed prompt is consumed here ({drop}) and answered through
 * $.ui.notify instead of burning a model round-trip.
 */
interface PromptSubmit {
  text: string;
}

export default {
  "prompt.submit": async (event: PromptSubmit, $: any) => {
    const text = event.text.trim();
    if (!text.startsWith("/")) return undefined;

    const turns = ($.state.get("turns") as number) ?? 0;
    const prompts = ($.state.get("prompts") as number) ?? 0;

    switch (text.split(/\s/)[0]) {
      case "/help":
        await $.ui.notify(
          "commands: /help · /status · /usage — memory: # <note> · plugins live in ./plugins or ~/.agent-compositor/plugins",
          "info",
        );
        break;
      case "/status":
        await $.ui.notify(`session ${$.session.id.slice(0, 8)} · cwd ${$.session.cwd} · turns ${turns} · prompts ${prompts}`, "info");
        break;
      case "/usage":
        await $.ui.notify(
          `turns this session: ${turns} — token-cost introspection lands when the loop surfaces usage events`,
          "info",
        );
        break;
      default:
        return undefined; // Other plugins own their own commands.
    }
    $.state.set("prompts", prompts + 1);
    return { drop: `slash-command: ${text}` };
  },

  "turn.start": async (_event: unknown, $: any) => {
    $.state.set("turns", (($.state.get("turns") as number) ?? 0) + 1);
    return undefined;
  },
};
