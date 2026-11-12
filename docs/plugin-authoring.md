# Develop extensions inside Compositor

A customizable kernel needs a way for its users to create its extensions. The
standard `plugin-author` plugin ships the `create-plugin` skill, installed
contract guidance and the `plugin_dev` tool. It uses the same file tools,
permissions, plugin loader and reload path as other extensions.

In a build containing this plugin, first explicitly enable `plugin-author` in the desired scope with
`/extensions enable plugin-author --project`, then `/reload`. Installation alone
does not activate it. Newly authored plugins also need explicit scoped activation. Start with a request such as:

```text
/plugin Add a /deploy-status command that reads my project's deployment settings
/plugin Create a panel for the health checks exposed by our existing gateway
/plugin Make a skill for our incident review workflow
```

Ordinary requests to create a Compositor extension also match the skill's
compact description. `/plugin` without arguments displays usage without calling
a model. The agent loads detailed guidance on demand, asks for missing domain
requirements when necessary, creates/edits local files and verifies the result.
This capability ships in v0.4.0 and later; the published v0.3.0 archive
predates it.

## Authoring tools

`plugin_dev` supports:

- `guide`: bundled overview/contracts/patterns/testing/composition/standard topics. The events topic
  returns names or the full input/response schema for an installed canonical
  event, rather than guessing from a different version's documentation.
- `init`: command, tool, panel, skill, service or MCP starter; `components` combines
  several in one package while `kind` selects one. Default destination:
  `.agent-compositor/plugins/<name>`. It creates new directories only, uses the
  attached workspace path resolver and links installed public SDK packages.
  Existing plugin files are edited with normal tools. Scaffolding does not need
  Node or Bun on PATH, install dependencies or activate code.
- `check`: native manifest, entry/resource containment, MCP configuration and skill header checks. It never
  imports the candidate. Its `kind: structure-only` result separates metadata
  correctness from runtime behavior.

The tool follows normal permission policy. A structure check cannot establish
syntax/import correctness, acceptance criteria, cancellation or interaction.
After reviewing/checking files, use `/reload` between turns and exercise the
actual command/tool. Configuration selections are loaded at startup; restart
when editing `enabledPlugins`, `agent.tools`, `toolProviders`, `serviceProviders`,
`ui.controllers` or `sessionProvider`. Preserve their unrelated entries.

The authoring plugin does not create a new capability allowlist or select a
replacement automatically. An existing exact allowlist must include the desired
plugin/tool; a declared service provider must be explicitly selected. Native
trusted modules have ordinary host execution powers. Keep a source installation
while an extension's SDK links still point to its API packages.

## Skills travel with plugins

Interactive hooks can call `$.agent.tool(name, args, {signal})` to invoke an
effective tool with the normal permission chain. The optional signal cancels the
call and its owned SDK work. During an active agent turn the host uses a separate
user-operation context; avoid assuming its result becomes model conversation
history. Supply visible progress, cancellation and errors in the panel, and do
not reopen a panel the user closed while awaiting completion. See
[operation limits and lifecycle](core-customization.md#concurrent-user-tool-operations).

The TUI sends `ui.press {site, key: "close"}` for titlebar/Alt+Q dismissal as
well as action-row Close. Handle it by marking the surface closed, cancelling
its own work and calling `$.ui.remove`. The host cancels independent operations
when the plugin's last attached pane closes and suppresses late publications of
closed panes until an explicit plugin command/action. With several panes, the
plugin close handler owns finer cancellation. Keep cleanup in `finally`; hiding
a window alone is not evidence that its resources have settled.

Since catalog 0.24, a `UiTextView` can select `scrollKeys: "host" | "plugin"`.
`"host"` routes PageUp/PageDown to bounded viewport scrolling without emitting
those keys as `ui.press`, including when `input` is present. `"plugin"` forwards
them for custom pagination. Omission preserves existing behavior: host scrolling
for ordinary views, plugin key handling for views with `input`. Mouse-wheel
scrolling remains available. Host scrolling preserves the input value and clamps
the offset at the end so PageUp moves immediately after repeated PageDown.
Dialog controllers still own their own input algorithm. This option requires a
host with catalog 0.24 or later; do not assume an older host accepts a new field.


Command/panel starters declare a UI command route and implement `ui.press` as
well as the prompt fallback. Keep both handlers in sync when replacing starter
behavior. The TUI uses the UI handler, including while the model is active; the
line-based interface uses the prompt handler. See the
[command routing contract](plugin-standard.md#commands-that-open-ui).

File tools must describe the actual path they will access. The host canonicalizes
path descriptors before permission rules, including custom tools and rewritten
arguments, so symlink aliases cannot evade a target-path deny. Return relative
paths relative to the selected workspace; do not resolve them against the host
process's working directory. In `execute`, use `ctx.resolvePath` for workspace
file access or the scoped storage API for plugin settings. Canonical policy
metadata does not grant access or attach a workspace, and descriptor checks do
not replace these execution-time boundaries.

Native plugins can include `skills/<name>/SKILL.md` (or loose Markdown skills)
with name/description frontmatter. The loader must enable and load the plugin
before its skills enter discovery. Project/configured/user skill sources keep
priority over plugin sources. Descriptions are advertised to the model; full
bodies load through the `skills` tool. Bodies and supporting resources are copied
into release bundles with their owner plugin.

Discovery and descriptions are recomputed for each turn. `/reload` updates the
set of loaded owners; disabling/removing a plugin removes its skills from future
discovery and prompt indexes. Material already read in a conversation remains
in that conversation. `agent.skills: false` disables the skill helper/index.
An explicitly selected replacement for `service.agent.instructions` owns its
instruction/index policy, just as it owns the rest of that replacement behavior.

See the bundled [skill](../plugins/plugin-author/skills/create-plugin/SKILL.md)
and its [contracts](../plugins/plugin-author/skills/create-plugin/references/contracts.md),
[patterns](../plugins/plugin-author/skills/create-plugin/references/patterns.md)
and [verification guidance](../plugins/plugin-author/skills/create-plugin/references/testing.md).

## Composite packages and MCP

For example, `plugin_dev` can create a package with
`{"action":"init","name":"workspace-suite","components":["service","panel","tool","skill","mcp"]}`.
It shares one manifest and install/update/enable/disable/remove lifecycle. Native
and Claude-compatible MCP declarations use the same validated stdio reader.
Servers start on use through the ordinary MCP gateway, with normal permissions;
reload disposes old connections. Explicit service/controller selections still
require configuration and restart. Exact plugin/tool allowlists are preserved.

Manifest `mcpServers` accepts inline server maps, relative JSON config references,
or arrays. `.mcp.json` is also discovered. The exported ID is
`<plugin-name>-<local-server-name>`; conflicting owner IDs fail visibly. Both
`${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` expand in server command/args/env/cwd.
Use `resources` to retain additional package-local runtime files in native release
bundles. The sample server requires Node.js or an explicitly configured runtime;
the Compositor binary does not provide a general Node executable on PATH.

The [composition reference](../plugins/plugin-author/skills/create-plugin/references/composition.md)
documents the full schema, packaging and lifecycle checks. Market catalog removal
retains installed packages; extension removal remains a separate explicit action.

## Views without agent tools

A plugin can provide a UI command and view without defining any model-facing tool.
The [resources plugin](../plugins/resources/README.md) is a maintained example:
`/resources` routes to its declared UI site while the model is busy, and the
`ui.press` handler receives `command:/resources`. Its timer reads local process
counters and republishes a bounded text view. `ui.visibility` suspends hidden
sampling; close and module `dispose()` stop the timer. CPU/Memory tabs and graph
cells use existing portable view contracts, including a chart-switch fallback
when tabs are unavailable. This pattern also fits standalone dashboards whose
contents do not need to enter an agent conversation.
