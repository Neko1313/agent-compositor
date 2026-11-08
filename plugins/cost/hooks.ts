// /cost, /usage: token accounting from turn.usage events (Claude Code /cost analog).
interface UsageTotals {
  in: number;
  out: number;
  turns: number;
}

const empty = (): UsageTotals => ({ in: 0, out: 0, turns: 0 });

export default {
  "turn.usage": (event: { turnId: string; inputTokens: number; outputTokens: number }, $: any) => {
    const t = ($.state.get("totals") as UsageTotals | undefined) ?? empty();
    t.in += event.inputTokens;
    t.out += event.outputTokens;
    t.turns += 1;
    $.state.set("totals", t);
  },
  "prompt.submit": (event: { text: string }, $: any) => {
    if (event.text !== "/cost" && event.text !== "/usage") return;
    const t = ($.state.get("totals") as UsageTotals | undefined) ?? empty();
    void $.ui.notify(
      `usage: ${t.in} input / ${t.out} output tokens across ${t.turns} turns (~${t.in + t.out} total)`,
      "info",
    );
    return { drop: "cost: usage reported" };
  },
};
