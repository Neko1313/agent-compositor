import {
  checkpointStorage,
  capture,
  finish,
  list,
  changes,
  restoreCode,
  load,
} from "./store.ts";
async function review(id: string | undefined, $: any) {
  if (!id) {
    const listed: any = await $.emit("service.checkpoint.control", {
      action: "list",
    });
    id = listed.value?.[0]?.id;
    if (!id) throw new Error("No checkpoints to review");
  }
  if ($.state.get("review")?.id !== id) $.state.set("review-decisions", {});
  const result: any = await $.emit("service.checkpoint.control", {
    action: "diff",
    id,
  });
  if (result.deny) throw new Error(result.deny);
  const rows = result.value ?? [];
  $.state.set("review", { id, rows });
  const decisions = $.state.get("review-decisions") ?? {};
  await $.ui.view(
    "review",
    "Review changes",
    {
      lines: [
        {
          text: `${rows.length} changed files · preview: first 10 files / 30 lines per side`,
          tone: "muted",
        },
        ...rows.slice(0, 10).flatMap((row: any, index: number) => [
          {
            text: `${row.path} · ${row.kind} · ${
              decisions[row.path] ?? "pending"
            }`,
            bold: true,
          },
          {
            text: "[ Keep change ]",
            action: `accept:${index}`,
            tone: "success",
          },
          {
            text: "[ Revert file ]",
            action: `reject:${index}`,
            tone: "warning",
          },
          { text: "Before", bold: true },
          ...row.before
            .split("\n")
            .slice(0, 30)
            .map((text: string) => ({
              text: ("- " + text).slice(0, 1000),
              tone: "muted",
            })),
          { text: "After", bold: true },
          ...row.after
            .split("\n")
            .slice(0, 30)
            .map((text: string) => ({ text: ("+ " + text).slice(0, 1000) })),
        ]),
      ],
    },
    { site: "split", focus: false }
  );
}
async function show($: any) {
  const rows = await list($.session.cwd, $.session.id);
  $.state.set(
    "checkpoints",
    rows.map((r) => r.id)
  );
  await $.ui.view(
    "history",
    "Checkpoints",
    {
      lines: [
        { text: "Turn checkpoints", bold: true },
        ...rows.slice(0, 20).flatMap((r, i) => [
          {
            text: `${new Date(r.at).toLocaleString()} · ${r.id.slice(0, 8)} · ${
              r.after ? changes(r).length + " files" : "incomplete"
            }`,
            bold: true,
          },
          { text: "[ Review ]", action: `diff:${i}`, tone: "accent" },
          { text: "[ Restore code ]", action: `code:${i}` },
          { text: "[ Restore conversation ]", action: `conversation:${i}` },
          { text: "[ Restore both ]", action: `both:${i}` },
        ]),
        ...(!rows.length
          ? [{ text: "No snapshots in this session", tone: "muted" }]
          : []),
      ],
    },
    { site: "inspector", focus: false }
  );
}
export default {
  "turn.start": async (e: any, $: any) => {
    if (e.interactiveTool) return;
    try {
      const r: any = await $.emit("service.context.control", {
        action: "snapshot",
        beforeTurn: true,
      });
      $.storage?.paths &&
        checkpointStorage($.session.id, $.storage.paths.state);
      await capture($.session.cwd, $.session.id, e.turnId, r.value.messages);
      $.state.set("turn", e.turnId);
    } catch (error) {
      await $.ui.notify(`Checkpoint unavailable: ${String(error)}`, "warn");
    }
  },
  ...Object.fromEntries(
    ["turn.complete", "turn.failed", "turn.interrupted"].map((event) => [
      event,
      async (e: any, $: any) => {
        if (e.turnId !== $.state.get("turn")) return;
        try {
          await finish($.session.cwd, $.session.id, e.turnId);
        } catch (error) {
          await $.ui.notify(
            `Checkpoint finalization failed: ${String(error)}`,
            "warn"
          );
        }
      },
    ])
  ),
  "service.checkpoint.control": async (e: any, $: any) => {
    try {
      if ($.storage?.paths)
        checkpointStorage($.session.id, $.storage.paths.state);
      const rows = await list($.session.cwd, $.session.id);
      if (e.action === "list")
        return {
          value: rows.map((r) => ({
            id: r.id,
            at: r.at,
            complete: !!r.after,
            files: changes(r).map((c) => ({ path: c.path, kind: c.kind })),
          })),
        };
      const matches = e.id
        ? rows.filter((r) => r.id.startsWith(e.id))
        : rows.slice(0, 1);
      if (matches.length !== 1)
        throw new Error("Checkpoint not found or ambiguous");
      const value = await load($.session.cwd, $.session.id, matches[0].id);
      if (e.action === "diff")
        return {
          value: changes(value).map((c) => ({
            path: c.path,
            kind: c.kind,
            before: c.before
              ? Buffer.from(c.before, "base64").toString("utf8").slice(0, 20000)
              : "",
            after: value.afterContent?.[c.path]
              ? Buffer.from(value.afterContent[c.path], "base64")
                  .toString("utf8")
                  .slice(0, 20000)
              : "",
          })),
        };
      const mode = e.mode ?? "both";
      const probe: any = await $.emit("service.context.control", {
        action: "snapshot",
      });
      if (!probe.value?.canRestore)
        throw new Error(
          "Restore from interactive controls after the current turn"
        );
      if (mode !== "conversation")
        await restoreCode($.session.cwd, value, e.paths);
      if (mode !== "code") {
        const result: any = await $.emit("service.context.control", {
          action: "restore",
          messages: value.messages,
        });
        if (result.deny) throw new Error(result.deny);
      }
      await show($);
      return { value: { restored: value.id, mode } };
    } catch (error) {
      return { deny: String(error) };
    }
  },
  "prompt.submit": async (e: any, $: any) => {
    const [command, id, mode] = e.text.trim().split(/\s+/);
    if (!["/checkpoints", "/restore", "/review", "/rewind"].includes(command))
      return;
    if (
      command === "/rewind" &&
      !(await list($.session.cwd, $.session.id)).length
    )
      return;
    if (command === "/checkpoints") await show($);
    else if (command === "/restore" || command === "/rewind") {
      const r = await $.agent.tool("checkpoint", {
        action: "restore",
        id,
        mode: mode ?? "both",
      });
      await $.ui.notify(
        r.ok ? "Checkpoint restored" : r.error,
        r.ok ? "info" : "error"
      );
    } else {
      try {
        await review(id, $);
      } catch (error) {
        await $.ui.notify(String(error), "error");
      }
    }
    return { drop: "checkpoint-history: handled" };
  },
  "ui.press": async (e: any, $: any) => {
    if (e.site === "plugin-checkpoint-history-review") {
      const [action, index] = e.key.split(":");
      const data = $.state.get("review"),
        row = data?.rows?.[Number(index)];
      if (!row) return;
      if (action === "reject") {
        const result = await $.agent.tool("checkpoint", {
          action: "restore",
          id: data.id,
          mode: "code",
          paths: [row.path],
        });
        if (!result.ok) {
          await $.ui.notify(result.error, "error");
          return;
        }
      }
      const decisions = $.state.get("review-decisions") ?? {};
      decisions[row.path] = action === "reject" ? "reverted" : "kept";
      $.state.set("review-decisions", decisions);
      await review(data.id, $);
      return;
    }
    if (e.site !== "plugin-checkpoint-history-history") return;
    const [mode, index] = e.key.split(":");
    const id = ($.state.get("checkpoints") ?? [])[Number(index)];
    if (!id) return;
    const result = await $.agent.tool("checkpoint", {
      action: mode === "diff" ? "diff" : "restore",
      id,
      mode: mode === "diff" ? undefined : mode,
    });
    if (!result.ok) await $.ui.notify(result.error, "error");
    else if (mode === "diff") await review(id, $);
  },
};
