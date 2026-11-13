# mcp

In the TUI, `/mcp` uses an explicit UI route and remains available while the
agent works. It does not enter the model prompt queue. The line-based interface
retains its prompt-command handler.

Refreshing tools uses the normal approval flow. Focus the input dock with Alt+i
to answer; panel keystrokes do not grant permission. The interactive hook allows
up to five minutes, including the human approval wait.

MCP client: expose stdio MCP servers' tools to the model through the mcp_call gateway. Servers come from AGENT_MCP_CONFIG (JSON, Claude-style mcpServers) or <cwd>/.agent-compositor/mcp.json.

Connections are started on first use and cached by project, server name and
configuration. Normal process exit and plugin disposal stop cached server
processes synchronously, including servers with background work that would
survive stdin closing. An already cancelled operation reads no configuration
and starts no server. Cancellation during initialization or a tool operation
stops the connection; a subsequent operation can reconnect. Cancelling discovery
stops the operation instead of reporting a successful partial server list or
starting further servers. Ordinary per-server discovery failures still appear
inline without hiding other servers.

`mcp_call` discovery returns complete tool definitions, including the server's
`inputSchema`, optional `outputSchema`, title, annotations and metadata. These
are server-provided data; annotations do not grant permissions. Use the actual
input schema when constructing `arguments` for a call. Older servers that omit
schemas remain readable; the gateway does not invent missing schemas.

Discovery fetches one page per selected server. Without `server`, it lists the
first page from each configured server and reports per-server errors inline.
Supply `server` to inspect only one server. If its entry includes `nextCursor`,
request the next page explicitly:

```json
{"action":"list","server":"catalog","cursor":"<nextCursor from that server>"}
```

The cursor is opaque, belongs to that server, and is not accepted on calls or
without a selected server. Pages are not automatically accumulated into an
unbounded model response. Malformed discovery data is an inline server error.
Invalid gateway arguments fail before configuration is read or a server starts.

Successful calls preserve content and structured results. A server result with
`isError: true` becomes a failed tool result, with the original result serialized
in the error so the agent can inspect both text and structured diagnostics.
Malformed call result objects or non-boolean `isError` flags fail as well.
This distinguishes a successful JSON-RPC exchange from successful tool execution.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable mcp --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- mcp` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
