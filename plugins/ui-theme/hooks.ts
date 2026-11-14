import type { HooksApi } from "@agent-compositor/hooks";
import type { UiAppearance, UiTextView } from "@agent-compositor/events";

const FILE = ".agent-compositor/theme.json";
const themes: Record<string, UiAppearance | null> = {
  slate: null,
  amber: {
    colors: { accent: "#e5bd85", titleBackground: "#30291f", selectionBackground: "#4a3b28", selectionText: "#f3f7fa" },
    chrome: { borderStyle: "round" },
  },
  mono: {
    colors: { text: "white", muted: "#b8b8b8", accent: "white", success: "white", warning: "white", danger: "white",
      border: "gray", titleBackground: "black", selectionBackground: "#b8b8b8", selectionText: "#101010" },
    chrome: { borderStyle: "single", controls: "always" },
  },
};
async function restore(_event: unknown, $: HooksApi): Promise<void> {
  let name = "slate";
  try {
    const value: unknown = JSON.parse(await $.fs.read(FILE));
    if (typeof value === "string" && Object.hasOwn(themes, value)) name = value;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") await $.ui.notify(`Could not restore theme: ${String(error)}`, "warn");
  }
  $.state.set("theme", name);
  await $.ui.configure(themes[name]);
}
export default {
  "session.start": restore,
  "session.reload": restore,
  "prompt.submit": async (event: { text: string }, $: HooksApi) => {
    const [command, name] = event.text.trim().split(/\s+/);
    if (command !== "/theme") return;
    if (!name || !Object.hasOwn(themes, name)) {
      await $.ui.notify(`Theme: ${$.state.get("theme") ?? "slate"}. Use /theme slate|amber|mono`);
      return { drop: "ui-theme: usage" };
    }
    $.state.set("theme", name);
    await $.ui.configure(themes[name]);
    try { await $.fs.write(FILE, JSON.stringify(name)); }
    catch (error) { await $.ui.notify(`Theme applied, but could not save: ${String(error)}`, "warn"); }
    return { drop: `ui-theme: ${name}` };
  },
  "ui.render": (event: { site: string; props: { lines?: UiTextView["lines"] } }, $: HooksApi) => {
    const name = $.state.get<string>("theme");
    if (event.site !== "status" || !name || name === "slate" || !event.props.lines) return;
    // Replace a view using the same portable text contract as any UI plugin.
    return { tree: { lines: event.props.lines.map((line, index) => index === 1 ? { ...line, text: `${name} · ${line.text}` } : line) } };
  },
};
