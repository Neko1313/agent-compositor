// /export: transcript capture → markdown file (Claude Code /export analog).
interface Entry {
  role: "user" | "assistant";
  text: string;
}

const CAP = 100_000;

function buffer($: any): Entry[] {
  return ($.state.get("buffer") as Entry[] | undefined) ?? [];
}

export default {
  "prompt.submit": (event: { text: string }, $: any) => {
    if (event.text === "/export") {
      const entries = buffer($);
      const md = [
        `# session ${$.session.id}`,
        "",
        ...entries.map((e) => (e.role === "user" ? `## you\n\n${e.text}` : `## assistant\n\n${e.text}`)),
        "",
      ].join("\n");
      const out = `.agent-compositor/session-${$.session.id}.md`;
      return $.fs.write(out, md).then(
        async () => {
          await $.ui.notify(`export: ${entries.length} message(s) → ${out}`, "info");
          return { drop: "export: transcript written" };
        },
        async (err: unknown) => {
          await $.ui.notify(`export failed: ${err instanceof Error ? err.message : String(err)}`, "error");
          return { drop: "export: failed" };
        },
      );
    }
    // a real prompt: record it (this hook runs before rewrites land)
    const entries = buffer($);
    entries.push({ role: "user", text: event.text });
    $.state.set("buffer", entries.slice(-500));
  },
  "assistant.text": (event: { turnId: string; text: string }, $: any) => {
    if(typeof event.text!=="string")throw new TypeError("Assistant text must be a string");
    const entries = buffer($);
    const last = entries[entries.length - 1];
    if (last && last.role === "assistant") {
      last.text += event.text;
    } else {
      entries.push({ role: "assistant", text: event.text });
    }
    const trimmed: Entry[] = entries.map((e, i) =>
      i === entries.length - 1 && e.text.length > CAP ? { ...e, text: e.text.slice(-CAP) } : e,
    );
    $.state.set("buffer", trimmed.slice(-500));
  },
};
