// Actual usage includes agent steps, compaction and small-model risk reviews.
type Totals = {
  in: number;
  out: number;
  cached: number;
  turns: number;
  cost: number;
  unpriced: number;
  estimatedRequests: number;
  byModel: Record<
    string,
    { input: number; output: number; cached: number; cost: number }
  >;
};
const empty = (): Totals => ({
  in: 0,
  out: 0,
  cached: 0,
  turns: 0,
  cost: 0,
  unpriced: 0,
  estimatedRequests: 0,
  byModel: {},
});
const file = ($: any) => `.agent-compositor/usage-${$.session.id}.json`;
async function show($: any) {
  const t: Totals = $.state.get("totals") ?? empty();
  await $.ui.notify(
    `usage: ${t.in} input / ${t.out} output tokens across ${t.turns} turns (~${
      t.in + t.out
    } total)`,
    "info"
  );
  if (!$.ui.view) return;
  let quota: any;
  try {
    quota = (await $.emit("service.usage.quota", {}))?.value;
  } catch {
    quota = undefined;
  }
  await $.ui.view(
    "usage",
    "Usage",
    {
      lines: [
        {
          text: `${t.in} input · ${t.out} output · ${t.cached} cached`,
          bold: true,
        },
        {
          text: `$${t.cost.toFixed(6)} configured-price estimate · ${
            t.unpriced
          } unpriced requests · ${t.estimatedRequests ?? 0} estimated requests`,
          tone: "muted",
        },
        {
          text: quota?.available
            ? `Account quota: ${quota.remaining}/${quota.limit} ${quota.unit}${
                quota.reset ? " · reset " + quota.reset : ""
              }`
            : "Account quota unavailable; local token budgets remain separate.",
          tone: "muted",
        },
        ...Object.entries(t.byModel).map(([model, r]) => ({
          text: `${model}: ${r.input}/${r.output} tokens · ${
            r.cached
          } cached · $${r.cost.toFixed(6)}`,
        })),
      ],
    },
    { site: "sidebar", focus: false }
  );
}
async function save($: any) {
  try {
    await $.fs.write(file($), JSON.stringify($.state.get("totals") ?? empty()));
  } catch (error) {
    await $.ui.notify(`Usage could not be saved: ${String(error)}`, "warn");
  }
}
export default {
  "session.start": async (_e: any, $: any) => {
    try {
      const saved = JSON.parse(await $.fs.read(file($)));
      if (typeof saved.in === "number" && typeof saved.out === "number")
        $.state.set("totals", { ...empty(), ...saved });
    } catch {
      /* first session */
    }
  },
  "model.usage": async (e: any, $: any) => {
    $.state.set("actual", true);
    const t: Totals = $.state.get("totals") ?? empty();
    if (e.estimated) t.estimatedRequests = (t.estimatedRequests ?? 0) + 1;
    const model = e.profile ?? e.model ?? "unknown";
    const row = t.byModel[model] ?? { input: 0, output: 0, cached: 0, cost: 0 };
    const cached = Math.min(e.cachedInputTokens ?? 0, e.inputTokens);
    t.in += e.inputTokens;
    t.out += e.outputTokens;
    t.cached += cached;
    row.input += e.inputTokens;
    row.output += e.outputTokens;
    row.cached += cached;
    let rates: any;
    try {
      const prices = JSON.parse(
        await $.fs.read(".agent-compositor/pricing.json")
      );
      rates = prices[model] ?? prices.default;
    } catch {
      /* rates are optional, never invented */
    }
    if (
      !e.estimated &&
      rates &&
      ["inputPerMillion", "outputPerMillion"].every(
        (key) => Number.isFinite(rates[key]) && rates[key] >= 0
      )
    ) {
      const cost =
        ((e.inputTokens - cached) * rates.inputPerMillion +
          cached *
            (Number.isFinite(rates.cachedInputPerMillion) &&
            rates.cachedInputPerMillion >= 0
              ? rates.cachedInputPerMillion
              : rates.inputPerMillion) +
          e.outputTokens * rates.outputPerMillion) /
        1000000;
      t.cost += cost;
      row.cost += cost;
    } else t.unpriced++;
    t.byModel[model] = row;
    $.state.set("totals", t);
    await save($);
    if ($.state.get("open")) await show($);
  },
  "turn.usage": async (e: any, $: any) => {
    const t: Totals = $.state.get("totals") ?? empty();
    if (!$.state.get("actual")) {
      t.in += e.inputTokens;
      t.out += e.outputTokens;
    }
    t.turns++;
    $.state.set("totals", t);
    await save($);
  },
  "prompt.submit": async (e: any, $: any) => {
    if (!["/cost", "/usage"].includes(e.text)) return;
    $.state.set("open", true);
    await show($);
    return { drop: "cost: usage reported" };
  },
};
