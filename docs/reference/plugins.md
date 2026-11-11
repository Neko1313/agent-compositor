# Plugin reference

> Generated from repository sources. Run `npm run docs:gen`; do not edit by hand.

All 30 filesystem plugins start inactive. [Install and explicitly enable](../marketplace.md) a package in user or project scope before using it. Plugin versions are independent of the host.

| Plugin | Version | Purpose |
| --- | --- | --- |
| [auto-approve](../../plugins/auto-approve/README.md) | 1.3.1 | Opt-in risk review for arbitrary console, plugin, MCP and workflow tool actions. Only low-risk decisions pass automatically; explicit denies remain binding. |
| [background-jobs](../../plugins/background-jobs/README.md) | 0.1.0 | Event-driven completion subscriptions for background exec shells: wake the originating agent or notify the user without model polling. |
| [btw](../../plugins/btw/README.md) | 1.2.2 | /btw <question> — ask a side question answered in isolation by a fresh model call (Claude Code /btw analog: the answer lands as a notification and never enters the conversation). Drop this folder to remove. |
| [callix](../../plugins/callix/README.md) | 1.3.1 | Native Callix navigation with bounded graph/source results, guarded symbol edit anchors, fresh shared indexing and token-size estimates; replace through service.project.query. |
| [checkpoint-history](../../plugins/checkpoint-history/README.md) | 1.2.1 | Turn snapshots for code and conversation, with conflict-aware restore and review. |
| [checkpoints](../../plugins/checkpoints/README.md) | 1.1.2 | Pre-write file checkpoints (Claude Code rewind analog): write/edit tool calls snapshot the previous content; /rewind restores the most recent snapshot. Journal: .agent-compositor/checkpoints.json. Drop this folder to remove. |
| [ci-review](../../plugins/ci-review/README.md) | 0.1.0 | Read-only GitHub Actions runs and logs with a concurrent CI review panel |
| [cost](../../plugins/cost/README.md) | 1.3.0 | /cost and /usage — token accounting from turn.usage events (Claude Code /cost analog). Tally survives across turns in plugin state; drop this folder to remove. |
| [doctor](../../plugins/doctor/README.md) | 1.1.2 | /doctor — sanity report: env vars (AGENT_BASE_URL/AGENT_API_KEY/AGENT_MODEL) and a live provider ping (Claude Code /doctor analog). Drop this folder to remove. |
| [export](../../plugins/export/README.md) | 1.1.2 | /export — dump the session transcript (your prompts + assistant text) to .agent-compositor/session-<id>.md (Claude Code /export analog). Buffer caps at 100k chars. Drop this folder to remove. |
| [git-review](../../plugins/git-review/README.md) | 0.1.0 | Review Git status and staged or working diffs through a read-only tool and interactive panel. |
| [guard-scope](../../plugins/guard-scope/README.md) | 1.1.1 | Workspace jail for write/edit tools: paths escaping the session cwd are denied regardless of config permissions (belt over the builtin rules' suspenders). Drop this folder to remove. |
| [guard-secrets](../../plugins/guard-secrets/README.md) | 1.1.2 | Blocks private keys and API tokens from reaching the model or tool arguments (AWS AKIA…, OpenAI sk-…, GitHub ghp_…, Slack xoxb-…, PEM blocks). Drop this folder to remove. |
| [mascot](../../plugins/mascot/README.md) | 1.1.1 | GIF/APNG Ghost companion attached to the message composer; observes agent, tool and dialog activity. |
| [mcp](../../plugins/mcp/README.md) | 1.3.0 | MCP client: expose stdio MCP servers' tools to the model through the mcp_call gateway. Servers come from AGENT_MCP_CONFIG (JSON, Claude-style mcpServers) or <cwd>/.agent-compositor/mcp.json. |
| [memory](../../plugins/memory/README.md) | 1.1.2 | COMPOSITOR.md project memory — GEMINI.md / CLAUDE.md analog. `# <note>` appends to the memory file; every prompt gets the memory prepended as context. Drop this folder to remove. |
| [monty](../../plugins/monty/README.md) | 1.1.1 | Replaceable Python sandbox provider using Monty. No filesystem, network or shell capabilities are supplied. |
| [network-proxy](../../plugins/network-proxy/README.md) | 1.2.0 | Optional HTTP CONNECT proxy for model streams and network tools, with child-process proxy environment. |
| [notify-done](../../plugins/notify-done/README.md) | 1.1.1 | Desktop notification when a turn finishes or fails — the Claude Code Notification / codex notify hook analog, so you can look away while the agent works. Drop this folder to remove. |
| [output-style](../../plugins/output-style/README.md) | 1.1.2 | Output style for assistant text (Claude Code output-styles analog). /style terse strips filler openers ('Sure!', 'Certainly!'…), /style off disables. Rewrites assistant.text pre-render, so this plugin is trusted (render-only hooks see the opaque element tree). Drop this folder to remove. |
| [plan-mode](../../plugins/plan-mode/README.md) | 1.2.2 | Plan mode (Claude Code /plan analog): toggle with /plan — the model gets a read-only reminder, every write/exec call is denied until you toggle it off. Drop this folder to remove. |
| [plugin-author](../../plugins/plugin-author/README.md) | 1.3.0 | Create and improve Compositor plugins from a request: bundled skill, current contracts, starter files and non-executing structure checks. |
| [project-checks](../../plugins/project-checks/README.md) | 0.1.1 | Discover and run guarded local npm script checks from a tool or panel. |
| [session-ctl](../../plugins/session-ctl/README.md) | 1.1.2 | /compact — force context compaction now; /clear — drop the conversation, keep the system prompt (Claude Code /compact and /clear analogs). Both ride $.agent. Drop this folder to remove. |
| [slash-commands](../../plugins/slash-commands/README.md) | 1.1.2 | /help, /status, /usage — command palette harvested from Claude Code / Gemini CLI slash-command UX. Drop this folder to remove. |
| [todos](../../plugins/todos/README.md) | 1.2.0 | Persistent task list window. Restores tasks on startup, updates after todo tool calls, and opens with /todos. Placement is controlled by the compositor. |
| [turn-log](../../plugins/turn-log/README.md) | 1.1.2 | Append-only JSONL journal of every turn (prompt, outcome, error) at .agent-compositor/turn-log.jsonl — the /stats data source. Drop this folder to remove. |
| [ui-theme](../../plugins/ui-theme/README.md) | 1.1.1 | Switch between slate, amber and mono themes. Demonstrates appearance and ui.render overrides. |
| [web](../../plugins/web/README.md) | 1.2.1 | Bounded web reading and keyless DuckDuckGo or configurable Brave/SearXNG search through normal tool permissions. |
| [workflows](../../plugins/workflows/README.md) | 1.5.0 | Replaceable dynamic background workflows with persistent dependency stages, bounded parallelism, expansion, conditional branches, pause/resume/retry and Python/Monty journal compatibility. |

Each plugin page links to its own changelog. Bundled source availability does not imply an independently published plugin archive.
