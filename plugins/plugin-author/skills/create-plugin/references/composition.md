# Compose and distribute a plugin

A native plugin is one installable package. It can combine hooks and agent
services, tool exports, UI panels/controllers, skills and MCP server declarations.
Choose components independently; no separate plugin per component is required.

```json
{"action":"init","name":"workspace-suite","components":["command","tool","panel","service","skill","mcp"]}
```

Use `kind` for one component, or `components` for a nonempty distinct set. The
starter merges command/panel effects and service hooks in one module. Edit that
module without replacing other selected components. A skill-only or MCP-only
package needs no dummy executable entry. `service` is an example instructions
provider; other agent service seams remain available through installed contracts.

## MCP declarations

Native and Claude-compatible packages use the same reader. A package may include
`.mcp.json`, manifest `mcpServers` (a relative JSON filename, inline server map or
`{mcpServers:{...}}`), or an array of those declarations. Explicit declarations
merge after `.mcp.json`; later local names override earlier ones. Exported server
IDs are `<plugin-name>-<local-server-name>`. Cross-owner ID collisions fail load.

```json
{
  "name":"workspace-suite", "version":"0.1.0", "trust":"trusted",
  "main":"hooks.ts", "mcpServers":"config/servers.json", "resources":["mcp"]
}
```

```json
{"mcpServers":{"local":{"type":"stdio","command":"node","args":["${PLUGIN_ROOT}/mcp/server.mjs"],"cwd":"${PLUGIN_ROOT}","env":{"MODE":"local"},"timeoutMs":30000}}}
```

Only stdio is implemented. `type` may be omitted. `command` is required; args
are strings, env values are strings, timeoutMs is a positive integer <=120000.
`${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` expand literally in command, args,
env values and cwd. Explicit relative cwd resolves against the plugin root;
without cwd, the gateway retains the project working directory. Config references
must resolve inside the package. Declarations are validated before native code
imports, and structure checks never launch servers. Render-only plugins cannot
contribute executable MCP servers.

The sample server requires Node.js; set an explicitly available runtime when
necessary. The installed Compositor executable does not bundle a general Node
command on PATH. Enable the ordinary `mcp` plugin and `mcp_call` tool in existing
allowlists when needed. Calls use normal permission policy and start servers
lazily. The gateway's `list` action starts servers to enumerate tools.

## Ownership and lifecycle

Install/update/enable/disable/remove operates on the entire package. After
`/reload`, its hooks, tools, skills and MCP contributions follow the loaded owner.
Reload disposes old MCP connections; the next call uses current declarations.
Independent user MCP settings retain priority and survive removing a plugin.
Previously read skills remain in conversation history. Selection mappings for
service/controller replacements still require explicit configuration and restart.

Marketplaces can distribute native composite packages using the ordinary catalog
entry. Removing a marketplace removes the catalog, not installed packages. Update
and removal remain explicit operations; removal keeps the existing backup policy.
Use `resources` for additional package-relative runtime files/directories (such
as the MCP server). Release packaging copies these, MCP config references and
standard skills/assets. Do not declare generated entry files, node_modules or
host binaries as resources. Include dependencies or install them explicitly with
the normal locked, scripts-disabled dependency installation option.

## Verify the whole package

Run metadata checks before loading; then exercise the actual command/panel,
selected service, tool, skill load and MCP call. Test update and disable/re-enable,
confirm removed contributions disappear, and verify external processes stop on
reload/close. A successful tool or metadata check alone does not prove UI or
service replacement behavior. Repeat in the installed distribution when shipping
runtime resources, and inspect the real terminal UI for panel/input changes.
