import type { HooksApi } from "@agent-compositor/hooks";
import type { UiTextView } from "@agent-compositor/events";

type Server = {
  name: string;
  tools?: { name: string; description?: string }[];
  error?: string;
};
async function configured($: HooksApi): Promise<Server[]> {
  try {
    const raw =
      process.env.AGENT_MCP_CONFIG ??
      ($.storage?.config
        ? JSON.stringify(await $.storage.config("mcp.json"))
        : await $.fs.read(".agent-compositor/mcp.json"));
    const value = JSON.parse(raw);
    if (
      !value.mcpServers ||
      typeof value.mcpServers !== "object" ||
      Array.isArray(value.mcpServers)
    )
      throw new Error("mcpServers must be an object");
    return Object.keys(value.mcpServers).map((name) => ({ name }));
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT")
      $.state.set("error", String(error));
    return [];
  }
}
async function show($: HooksApi): Promise<void> {
  const servers = $.state.get<Server[]>("servers") ?? [];
  const selected = Math.min(
    $.state.get<number>("selected") ?? 0,
    Math.max(0, servers.length - 1)
  );
  const current = servers[selected];
  const lines: UiTextView["lines"] = [
    { text: "MCP connections", bold: true },
    {
      text: `${servers.length} configured · ${
        $.state.get("busy") ? "working" : "ready"
      }`,
      tone: "muted",
    },
    { text: "[ Refresh tools ]", action: "refresh", tone: "accent" },
    { text: "" },
    ...servers
      .slice(0, 100)
      .map((server, index) => ({
        text: `${server.error ? "!" : server.tools ? "✓" : "○"} ${server.name}${
          server.tools ? ` · ${server.tools.length} tools` : ""
        }`,
        tone: server.error ? ("danger" as const) : ("text" as const),
        selected: index === selected,
        action: `select:${index}`,
      })),
    ...(!servers.length
      ? [
          {
            text: "Add servers to .agent-compositor/mcp.json, then refresh.",
            tone: "muted" as const,
          },
        ]
      : []),
    { text: "" },
    ...(current?.error
      ? [{ text: current.error, tone: "danger" as const }]
      : []),
    ...(current?.tools ?? [])
      .slice(0, 100)
      .flatMap((tool) => [
        { text: tool.name, bold: true },
        ...(tool.description
          ? [{ text: tool.description.slice(0, 1000), tone: "muted" as const }]
          : []),
      ]),
    ...($.state.get<string>("last")
      ? [
          {
            text: String($.state.get("last")).slice(0, 2000),
            tone: "muted" as const,
          },
        ]
      : []),
    ...($.state.get<string>("error")
      ? [
          {
            text: String($.state.get("error")).slice(0, 2000),
            tone: "danger" as const,
          },
        ]
      : []),
  ];
  await $.ui.view(
    "connections",
    "MCP",
    { lines },
    { site: "inspector", size: 0.35, focus: false }
  );
}
async function open($: HooksApi): Promise<void> {
  $.state.set("open", true);
  $.state.set("error", "");
  if (!$.state.get("servers")) $.state.set("servers", await configured($));
  await show($);
}
export default {
  "session.start": async (_e: unknown, $: HooksApi) => {
    const servers = await configured($);
    $.state.set("servers", servers);
    if (servers.length) await open($);
  },
  "session.reload": async (_e: unknown, $: HooksApi) => {
    $.state.set("servers", await configured($));
    if (($.state.get<Server[]>("servers") ?? []).length) await open($);
  },
  "prompt.submit": async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== "/mcp") return;
    await open($);
    return { drop: "mcp: connections opened" };
  },
  "ui.press": async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== "plugin-mcp-connections") return;
    if (event.key === "refresh" || event.key === "r") {
      $.state.set("busy", true);
      $.state.set("error", "");
      await show($);
      try {
        const result = await $.agent.tool("mcp_call", { action: "list" });
        if (!result.ok) $.state.set("error", result.error);
      } finally {
        $.state.set("busy", false);
        await show($);
      }
    } else {
      const count = ($.state.get<Server[]>("servers") ?? []).length;
      let selected = $.state.get<number>("selected") ?? 0;
      if (event.key.startsWith("select:"))
        selected = Number(event.key.slice(7));
      else if (event.key === "down") selected++;
      else if (event.key === "up") selected--;
      $.state.set("selected", Math.max(0, Math.min(count - 1, selected)));
      await show($);
    }
  },
  "tool.result": async (
    event: {
      tool: string;
      ok: boolean;
      output?: { servers?: Server[] };
      error?: string;
    },
    $: HooksApi
  ) => {
    if (event.tool !== "mcp_call") return;
    $.state.set("open", true);
    if (event.output?.servers) $.state.set("servers", event.output.servers);
    $.state.set(
      "last",
      event.ok ? "Last operation completed" : "Last operation failed"
    );
    $.state.set("error", event.error ?? "");
    await show($);
  },
};
