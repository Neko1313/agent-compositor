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
    const FILE = $.storage?.paths
      ? ".agent-compositor/memory.md"
      : "COMPOSITOR.md";

    if (text.trimStart().startsWith("#global ") && $.storage?.paths) {
      const note = text.trim().slice(8).trim();
      if (!note) return { drop: "empty global memory note" };
      const existing = String(
        (await $.storage.get("notes", "global").catch(() => "")) ?? ""
      );
      await $.storage.set("notes", `${existing}- ${note}\n`, "global");
      await $.ui.notify("Global memory note saved", "info");
      return { drop: "global memory note saved" };
    }
    if (text.trimStart().startsWith("#")) {
      const note = text.trim().replace(/^#+\s*/, "");
      if (note.length === 0) {
        $.ui.notify("empty memory note — nothing saved", "warn");
        return { drop: "empty memory note" };
      }
      let existing =
        ((await $.fs.read(FILE).catch(() => "")) as string) ||
        "# COMPOSITOR.md — what this agent should remember\n\n";
      await $.fs.write(FILE, `${existing}- ${note}\n`);
      $.ui.notify(`remembered: ${note.slice(0, 80)}`, "info");
      return { drop: "memory note saved" };
    }

    if (text.startsWith("/")) return; // Commands must reach their owning plugin unchanged.

    const global = $.storage?.paths
      ? String((await $.storage.get("notes", "global").catch(() => "")) ?? "")
      : "";
    let memory: unknown = [global, await $.fs.read(FILE).catch(() => undefined)]
      .filter(Boolean)
      .join("\n");
    if (typeof memory !== "string" || memory.length === 0) return undefined; // no memory file
    const header =
      memory.length > CAP ? memory.slice(0, CAP) + "\n…(truncated)" : memory;
    return { text: `<memory>\n${header}\n</memory>\n\n${text}` };
  },
};
