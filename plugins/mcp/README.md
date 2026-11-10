# mcp

MCP client: expose stdio MCP servers' tools to the model through the mcp_call gateway. Servers come from AGENT_MCP_CONFIG (JSON, Claude-style mcpServers) or <cwd>/.agent-compositor/mcp.json.

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
