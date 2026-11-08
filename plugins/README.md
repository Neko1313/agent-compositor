# Default plugin market

The compositor ships empty on purpose — behavior is composed from plugins.
This folder is the **default market**: the features every mainstream agent
CLI ships, reimplemented as removable plugins over the event chain.
Harvested from Claude Code, Codex CLI, Gemini CLI, and friends.

Delete any folder = the feature is gone. Nothing here is load-bearing.

| Plugin | Feature | Harvested from |
|---|---|---|
| `slash-commands` | `/help`, `/status`, `/usage` command palette | Claude Code `/`-commands, Gemini `/help /stats` |
| `memory` | `COMPOSITOR.md` project memory; `# note` appends | `CLAUDE.md`, `GEMINI.md` |
| `guard-secrets` | private keys / API tokens never reach the model or tools | secret-redaction in hosted agents, done locally |
| `guard-scope` | write/edit outside the workspace cwd → denied | codex sandbox modes |
| `turn-log` | JSONL journal of every turn at `.agent-compositor/turn-log.jsonl` | Gemini `/stats` data source |
| `notify-done` | desktop notification on turn complete / failed | Claude Code Notification hook, codex notify |

## Install

Running from the repo, `./plugins` is discovered automatically.
For the compiled binary (or a global install):

```bash
npm run install:defaults   # copies plugins/ → ~/.agent-compositor/plugins
```

## Write your own

Copy `examples/plugins/hello` or any folder here. `plugin.json` + `hooks.ts`,
both required; hooks are `async (event, $) => …` keyed by catalog event name.
Return `{result}` to answer a `tool.call`, `{deny}` to refuse, `{decision}` to
override `tool.check`, `{text}`/`{drop}` to rewrite or eat a `prompt.submit`.
`undefined` always means "not mine — pass through".
