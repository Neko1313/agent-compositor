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
This capability is in the source tree after v0.3.0; the published v0.3.0 archive
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
