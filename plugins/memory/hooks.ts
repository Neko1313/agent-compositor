/**
 * memory — COMPOSITOR.md, the CLAUDE.md / GEMINI.md analog.
 *
 *   "# prefer pnpm in this repo"   → appended to COMPOSITOR.md, no model call
 *   anything else                  → prompt rewritten with a <memory> header
 *
 * The header is capped (2 KB) so a fat memory file can't eat the context.
 */
const FILE = "COMPOSITOR.md";
const CAP = 2048;

interface PromptSubmit {
  text: string;
}

export default {
  "prompt.submit": async (event: PromptSubmit, $: any) => {
    const text = event.text;

    if (text.trimStart().startsWith("#")) {
      const note = text.trim().replace(/^#+\s*/, "");
      if (note.length === 0) {
        $.ui.notify("empty memory note — nothing saved", "warn");
        return { drop: "empty memory note" };
      }
      let existing = ((await $.fs.read(FILE).catch(() => "")) as string) || "# COMPOSITOR.md — what this agent should remember\n\n";
      await $.fs.write(FILE, `${existing}- ${note}\n`);
      $.ui.notify(`remembered: ${note.slice(0, 80)}`, "info");
      return { drop: "memory note saved" };
    }

    let memory: unknown = await $.fs.read(FILE).catch(() => undefined);
    if (typeof memory !== "string" || memory.length === 0) return undefined; // no memory file
    const header = memory.length > CAP ? memory.slice(0, CAP) + "\n…(truncated)" : memory;
    return { text: `<memory>\n${header}\n</memory>\n\n${text}` };
  },
};
