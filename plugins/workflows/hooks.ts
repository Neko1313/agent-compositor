import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HooksApi } from "@agent-compositor/hooks";
import type { UiTextView } from "@agent-compositor/events";

type Run = { id: string; steps: { prompt: string; result: string }[] };
async function runs($: HooksApi): Promise<Run[]> {
  const root = join(
    $.storage?.paths?.state ?? join($.session.cwd, ".agent-compositor"),
    "workflows"
  );
  const result: Run[] = [];
  for (const id of await readdir(root).catch(() => [])) {
    if (!/^[a-f0-9]{40}$/.test(id)) continue;
    try {
      const steps = JSON.parse(
        await readFile(join(root, id, "journal.json"), "utf8")
      );
      if (Array.isArray(steps))
        result.push({
          id,
          steps: steps
            .filter(
              (s) =>
                typeof s?.prompt === "string" && typeof s?.result === "string"
            )
            .slice(0, 100),
        });
    } catch {
      /* a partial journal must not hide other runs */
    }
  }
  return result.slice(-100).reverse();
}
async function show($: HooksApi): Promise<void> {
  const list = await runs($),
    selected = Math.min(
      $.state.get<number>("selected") ?? 0,
      Math.max(0, list.length - 1)
    );
  $.state.set("runs", list);
  $.state.set("selected", selected);
  const run = list[selected];
  const lines: UiTextView["lines"] = [
    { text: "Workflow journal", bold: true },
    { text: String($.state.get("status") ?? "Ready"), tone: "muted" },
    { text: "[ Refresh ]", action: "refresh", tone: "accent" },
    ...(run
      ? [
          {
            text: "[ Replay selected run ]",
            action: "replay",
            tone: "accent" as const,
          },
        ]
      : []),
    { text: "" },
    ...list.map((run, i) => ({
      text: `${run.id.slice(0, 10)} · ${run.steps.length} steps`,
      selected: i === selected,
      action: `select:${i}`,
    })),
    ...(!run
      ? [
          {
            text: "No runs yet. Ask the agent to run a workflow.",
            tone: "muted" as const,
          },
        ]
      : run.steps.flatMap((step, i) => [
          { text: `${i + 1}. ${step.prompt.slice(0, 1000)}`, bold: true },
          { text: step.result.slice(0, 2000), tone: "muted" as const },
        ])),
  ];
  await $.ui.view(
    "runs",
    "Workflows",
    { lines },
    { site: "inspector", size: 0.35, focus: false }
  );
}
export default {
  "session.start": async (_event: unknown, $: HooksApi) => {
    if ((await runs($)).length) {
      $.state.set("open", true);
      await show($);
    }
  },
  "session.reload": async (_event: unknown, $: HooksApi) => {
    if ((await runs($)).length) {
      $.state.set("open", true);
      await show($);
    }
  },
  "prompt.submit": async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== "/workflows") return;
    $.state.set("open", true);
    await show($);
    return { drop: "workflows: journal opened" };
  },
  "ui.press": async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== "plugin-workflows-runs") return;
    if (event.key === "replay") {
      const list = $.state.get<Run[]>("runs") ?? [],
        run = list[$.state.get<number>("selected") ?? 0];
      if (!run) return;
      try {
        const code = await $.fs
          .read(`.agent-compositor/workflows/${run.id}/code.py`)
          .catch(() => {
            throw new Error(
              "This run has no Python source. Legacy JavaScript journals cannot be replayed in the Python sandbox."
            );
          });
        const result = await $.agent.tool("workflow", { code });
        if (!result.ok) $.state.set("status", result.error);
      } catch (error) {
        $.state.set("status", String(error));
      }
    } else if (event.key.startsWith("select:"))
      $.state.set("selected", Number(event.key.slice(7)));
    else if (event.key === "down")
      $.state.set(
        "selected",
        Math.min(
          ($.state.get<Run[]>("runs") ?? []).length - 1,
          ($.state.get<number>("selected") ?? 0) + 1
        )
      );
    else if (event.key === "up")
      $.state.set(
        "selected",
        Math.max(0, ($.state.get<number>("selected") ?? 0) - 1)
      );
    await show($);
  },
  "tool.call": async (event: { tool: string }, $: HooksApi) => {
    if (event.tool === "workflow") {
      $.state.set("open", true);
      $.state.set("status", "Running…");
      await show($);
    }
  },
  "subagent.start": async (_e: unknown, $: HooksApi) => {
    if ($.state.get("open")) {
      $.state.set("status", "A workflow step is running…");
      await show($);
    }
  },
  "tool.result": async (
    event: {
      tool: string;
      ok: boolean;
      output?: { steps?: number; replayed?: number; ran?: number };
      error?: string;
    },
    $: HooksApi
  ) => {
    if (event.tool !== "workflow") return;
    $.state.set(
      "status",
      event.ok
        ? `${event.output?.steps ?? 0} steps · ${
            event.output?.replayed ?? 0
          } replayed · ${event.output?.ran ?? 0} executed`
        : event.error
    );
    await show($);
  },
};
