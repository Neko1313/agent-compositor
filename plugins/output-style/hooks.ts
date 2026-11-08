// Output style (Claude Code output-styles analog). "terse" strips common
// filler openers from assistant text deltas. Toggle: /style terse | /style off
const FILLER = /^(sure|certainly|great question|of course|absolutely|no problem)[,!\.]*\s*/i;

export default {
  "prompt.submit": (event: { text: string }, $: any) => {
    if (event.text === "/style terse" || event.text === "/style off") {
      const style = event.text === "/style terse" ? "terse" : "off";
      $.state.set("style", style);
      void $.ui.notify(`output style: ${style}`, "info");
      return { drop: "output-style: switched" };
    }
  },
  "assistant.text": (event: { turnId: string; text: string }, $: any) => {
    if ($.state.get("style") !== "terse") return;
    const cleaned = event.text.replace(FILLER, "");
    if (cleaned !== event.text) return { text: cleaned };
  },
};
