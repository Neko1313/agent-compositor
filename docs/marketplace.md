# Marketplaces and portable plugins

The catalog uses `.claude-plugin/marketplace.json`: `name`, `owner`, `plugins`,
relative `source` paths, and GitHub/Git source objects. The format follows the
[Claude Code marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
and [manifest reference](https://code.claude.com/docs/en/plugins-reference).

```text
/marketplace add owner/repository main
/marketplace list
/extensions install plugin-name@marketplace-name
/reload
```

For a local catalog, use `/marketplace add ./my-marketplace`. Add `--project`
to register it in project settings; registrations default to user scope.
`/marketplace update name` explicitly updates the Git snapshot; `remove name`
removes the registration while preserving installed plugins. Git checkouts are
pinned to a commit SHA. Credential-free HTTPS and local directories are supported;
ZIP, SSH, and private Git credential flows are outside this implementation.

Installation defaults to user scope (`~/.agent-compositor/plugins`).
`/extensions install name@market --project` installs only in
`<cwd>/.agent-compositor/plugins`. Enable/disable defaults to project scope;
`--user` selects user scope. To install dependencies:

```text
/extensions install mascot@agent-compositor --dependencies
```

Dependencies require explicit `--dependencies` and a `package-lock.json`, and are
installed with `npm ci --ignore-scripts`. The previous version is backed up before
update/remove. The installer supplies native plugins with host API packages
`@agent-compositor/*` so imports work outside the source monorepo.
Run `/reload` after changes. Disabled plugins are skipped before their executable
code is imported. Catalog changes and installation use the existing permission
gates for `marketplace_control` and `extension_control`.

## Compatibility contracts

| Claude Code component | Support |
| --- | --- |
| `.claude-plugin/plugin.json` | Metadata: name/version/description |
| `commands/*.md` and explicit command paths/maps | `/plugin:command`, `$ARGUMENTS`, `$1`, plugin root |
| `skills/*/SKILL.md` | Explicit `/plugin:skill` invocation; description and argument-hint |
| `.mcp.json`, `mcpServers` paths/inline maps | Merged with global/project MCP configuration; server names prefixed with the plugin name |
| `hooks/hooks.json`, explicit hook paths/inline definitions | Synchronous `type: command`, matcher, stdin JSON, timeout/cancellation |
| PreToolUse | Can deny/ask; allow cannot override a host deny |
| UserPromptSubmit | Can block and add additionalContext |
| SessionStart, PostToolUse/Failure, Stop/Failure, SubagentStart/Stop, Pre/PostCompact | Mapped to application events; a Stop hook decision does not restart a completed turn |
| Native TypeScript / Ink UI | Runs in Compositor; requires a separate adapter for Claude Code |

Compatibility is an explicit subset, not a complete Claude Code implementation.
Agents, LSP, monitors/channels, userConfig, HTTP/prompt/agent/async hook handlers,
MCP bundles, and unknown hook events are unsupported and produce loader errors.
PreToolUse `updatedInput` blocks the action with an explanation rather than
executing an unsupported argument transformation. Skill shell interpolation,
automatic skill selection by the model, and Claude-specific permission/tool
mappings are not emulated. Command/skill instructions are preserved; model
selection and allowed-tools fields in Markdown do not change host policy.

Command hooks execute as trusted user code. The agent's permission gate does not
provide an OS sandbox for an installed plugin.

## Sharing a plugin

This repository includes a ready-to-use catalog with 26 entries and a
[portable example](../examples/plugins/portable-example/.claude-plugin/plugin.json).
Native entries explicitly identify their runtime through `compositor.format`.
Sharing a catalog format does not make native TS/UI code executable in another
application.

```sh
npm run marketplace:validate
```

To create a Git marketplace, commit `.claude-plugin/marketplace.json` and the
plugin directories, validate them, then share the repository URL. Publishing to
Anthropic's marketplace is a separate action.

```json
{
  "name": "my-marketplace",
  "owner": { "name": "My team" },
  "plugins": [{ "name": "my-plugin", "source": "./plugins/my-plugin" }]
}
```

For an external GitHub plugin:
`{"name":"my-plugin","source":{"source":"github","repo":"owner/repo","ref":"main","sha":"<40-character-commit>"}}`.
Git URLs use `source: "url", url: "https://..."`; `path` selects a subdirectory.
Paths must remain inside the root, including after resolving symlinks.
