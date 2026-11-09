# Agent features: configuration and limits

This document covers the implemented plan recorded in MEMORY.md. Extensions
remain replaceable: Monty, Callix, web, auto review, and checkpoints are plugins;
shared service events and tool.call let other handlers replace them.

## Quick access

| Feature | Command / tool |
|---|---|
| Automatic approval review | `/auto on`, `/auto off`, `/auto status` |
| Code and conversation history | `/checkpoints`, `/restore <id> code\|conversation\|both`, `/rewind` |
| Change review | `/review [id]`, Keep change / Revert file buttons |
| Independent agents | `/agents`, `/agents create <name>`, `/agents create-shared <name>` |
| Message an agent | `/agents send <id> <prompt>` or click its pane and type |
| Agent controls | `/agents stop <id>`, `/agents archive <id>`, `/agents merge <id>` |
| Main conversation | Click Conversation or use `/agents parent` |
| Extensions | `/extensions list\|install\|update\|enable\|disable\|remove [name] [ref]` |
| Login and keys | `/auth`, `/login <profile> [ENV_VAR]`, `/logout <profile>` |
| Models | `/model`, `/model <profile-or-model>` |
| Usage and cost | `/usage`, `/cost` |
| Web | `web_fetch`, `web_search` |
| Code | `glob`, `grep`, `code_query` through Callix |
| Isolated Python | `run_python`, `workflow` through Monty |
| MCP / workflows | `/mcp`, `/workflows` |
| Sessions | `/sessions`, `/resume`, `/fork`, `/rename`, `/archive`, `/unarchive` |

## Auto review

Enable the mode explicitly for the current session. Approvals return to manual
after restart. Disabling it with the button also invalidates a review already in
progress: a stale review result cannot approve an action.

Configure a separate small-model profile in `agent-compositor.json`:

```json
{
  "providers": {
    "small": {
      "type": "openai-compat",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "YOUR_SMALL_MODEL",
      "apiKeyEnv": "SMALL_MODEL_API_KEY",
      "maxOutputTokens": 512
    }
  }
}
```

For the same platform, set `small_model` to create a `small` profile using the
main provider's settings. `.agent-compositor/auto.json`:

```json
{"profile":"small","maxReviews":50,"timeoutMs":8000}
```

Only actions that require approval through the normal chain are reviewed.
The plugin examines the exact tool, arguments, and descriptor. It automatically
approves only clearly low-risk exec/write/edit actions. Dangerous categories,
other tools, oversized input, exhausted budgets, errors, timeouts, and invalid
JSON fall back to manual approval. The reviewer has no tools and receives action
data as untrusted content. Explicit deny remains binding even if tool.check
tries to override it. Decisions never become broad permissions for future
commands.

The panel shows the reason and risk. The last 100 decisions are saved in
`.agent-compositor/approval-audit-<session>.json`. To replace the handler, use
`serviceProviders: {"service.permission.review":"other-reviewer"}`.
Model review helps select approvals; execution still passes through permissions
and the selected sandbox's restrictions.

## Checkpoints and review

`checkpoint-history` captures code and conversation before a normal turn, then
records file state after completion, failure, or interruption. Each session has
separate history at `.agent-compositor/turn-checkpoints/<session>/`.

- Code restores changed files, including creation and deletion.
- Conversation restores only context; Code leaves it unchanged.
- Both restores both states. Session resumption respects these restorations.
- Restoration refuses to overwrite a file changed since the snapshot.
- `/review` shows Before/After. Keep retains an existing change; Revert file
  restores the selected file through the normal approval flow.

Restoration is available through interactive controls after the current turn;
the model cannot rewind its own active turn. The `checkpoint` tool's `paths`
field selects files in code mode. The older single-file `checkpoints` plugin
remains a compatible `/rewind` fallback when no turn history exists.

Snapshots cover project files selected by Git/agent ignore rules, up to 10000
files, 8 MB per file, and 64 MB of original content. Exceeding a limit skips the
snapshot and notifies the user. Ignored runtime/dependency files, external systems,
and operations outside the repository cannot be restored. The UI shows the last
100 snapshots; review previews are limited to 10 files and 30 lines per side.
Old snapshots are not deleted automatically.

## Independent agents and worktrees

Each agent has its own AgentCore, transcript, session ID, permission state,
budgets, and pane. The parent can send requests asynchronously and read results
through `agent_control` with `action=list` and `id`; omitting id returns a short
list. The ordinary `task` tool remains an awaited subagent whose result returns
to the parent.

Create makes an `agent/<uuid>` branch and worktree from HEAD under
`.agent-compositor/worktrees/<uuid>`. Create-shared uses the current working tree:
conversations are separate, but files are shared. Uncommitted changes in the main
working tree are not copied to a new worktree.

Click a pane to select the input recipient; the Message title shows its name.
Ctrl+C in the selected pane stops that agent. Stop cancels the current request
and queued work. Approvals and questions from multiple agents are queued;
cancellation removes a waiting dialog. Panes and conversations are restored
after restart; unfinished actions are not replayed automatically. Archive retains
the worktree and files. Merge requires a finished agent and committed changes;
Git reports any conflicts.

Defaults allow 8 active agents, with up to 12 model steps and 50000 tokens per
turn for a new agent, and 200000 tokens per session. `agent_control` accepts
maxSteps and maxTokens; `agent.maxAgents` limits the count to at most 16.

## Usage, pricing, and quotas

`model.usage` accounts for main requests, compaction, and the small review model.
It records input/output/cache usage, per-model totals, and session counters.
If a provider omits usage, an explicitly marked estimate is used for budgets;
it is not presented as the provider's exact bill or converted into a cost.
Context estimation accounts for UTF-8 in non-ASCII text and attachments.

Set your prices per million tokens in `.agent-compositor/pricing.json`.
These numbers are illustrative; replace them with your provider's rates:

```json
{"default":{"inputPerMillion":1,"outputPerMillion":2,"cachedInputPerMillion":0.1}}
```

Requests without a configured rate remain unpriced. Budget settings:

```json
{"agent":{"maxTokensPerTurn":50000,"maxTokensPerSession":200000,"maxAgents":8}}
```

The core bounds requested output and stops further execution when a limit is
reached. These are local budgets based on reported/estimated tokens. Tokens
already generated by the provider may exceed the remaining budget, particularly
input tokens.

Providers do not share a universal quota API. For a compatible endpoint, set
these profile fields:

```json
{"quota":{"url":"https://api.example.org/quota","remainingPath":"account.remaining","limitPath":"account.limit","resetPath":"account.reset","unit":"tokens"}}
```

The endpoint must share the provider's origin. It uses the profile key and caches
results for 30 seconds. Without an endpoint, or on error, the UI reports that
quota information is unavailable. Account balance is not inferred from a local
counter.

## Extensions

The `.agent-compositor/extensions.json` catalog is an array of entries:

```json
[{"name":"my-plugin","repository":"https://example.org/my-plugin.git","ref":"v1.0.0"}]
```

The repository must contain plugin.json at its root. Installation targets
`$HOME/.agent-compositor/plugins` and requires an explicit Git ref; the result
includes the actual commit. Update repeats installation at the selected ref.
Previous versions and removed extensions are retained in extension-backups.
Source code does not execute during install; activation requires `/reload`.

Setting dependencies=true in `extension_control` permits lockfile-based `npm ci`
with package scripts disabled. Otherwise, dependencies are not installed.
HTTPS repository URLs cannot contain credentials; absolute local paths support
local development. Git hooks and recursive submodules are disabled during
installation. Disabled plugins are not imported even if their code would fail on
import. Modules can export dispose to release resources on reload/unload/close;
MCP uses this to stop its servers.

## Provider login

`/login <profile> <ENV_VAR>` saves the environment variable's value. The key itself
is not entered into the chat command line or included in the transcript.
Credentials live in `$HOME/.agent-compositor/credentials.json` with file mode
0600. This is a protected file, not a system keychain. `/logout` removes the saved
value; a separately configured environment/config key remains effective.

For OAuth device flow, configure oauth.clientId, deviceAuthorizationEndpoint,
tokenEndpoint, and optional scope in the profile. `/login <profile>` displays a
verification URL/code, waits for confirmation, and saves access/refresh tokens.
Expired tokens are refreshed before a model request. You need a registered OAuth
client and a server supporting that grant; private vendor CLI login protocols are
not emulated. HTTPS is required; local HTTP is permitted only when explicitly
selected with oauth.allowLocalhost for development.

Device flow follows [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628).

## Web and default integrations

`web_fetch` reads HTTP(S) text/HTML/JSON with a 15-second deadline and 1 MB limit;
up to 50000 characters are returned to the model. Redirects require a separate
fetch and approval. Web content is marked untrusted.

`web_search` uses BRAVE_SEARCH_API_KEY or a SearXNG endpoint from
`.agent-compositor/web.json`: `{"searchUrl":"https://search.example.org/search"}`.
SearXNG must enable JSON format. Results are limited to 10 with bounded snippets.
Protocols: [Brave Search](https://api-dashboard.search.brave.com/api-reference/web/search/get),
[SearXNG Search API](https://docs.searxng.org/dev/search_api.html).

See also [Monty](../plugins/monty/README.md), [Callix](../plugins/callix/README.md),
[Python workflows](../plugins/workflows/README.md), and [UI themes](ui-theming.md).
Monty isolates Python and explicit host callbacks; separate shell tools still
execute on the host under the normal permission policy.

## Autonomous execution and context budgets

The default harness now supplies base instructions through
`service.agent.instructions`: inspect project evidence, choose tools from their
schemas, execute authorized work, verify changes and report concrete blockers.
Project instructions and skill descriptions remain separate system context.
Override the service in a plugin, or configure `behavior.json` with
`{"instructions":"..."}`. `agent.baseInstructions=false` disables the default;
`agent.instructions` supplies a configuration default.

For substantial tasks, the model can call `task_plan` with a goal, tasks,
acceptance/evidence text and next action. Plans are stored privately per session
under `task-plans/<session-id>.json`; `/tasks` opens progress. The saved plan is
loaded as data on the next turn. `/continue` resumes unfinished work from the
current conversation and saved plan. Subagents inherit project instructions and
have separate plans and fresh context budgets.

Before accepting a final answer, `service.agent.finish` can request a concrete
continuation. The default refuses to finish a current plan with pending/running
items. For planned edits it requests a successful verification command (exit 0),
or an explicit `[verification unavailable]` / `[checks not applicable]` report.
`agent.verifyCompletion=true` extends that reminder to unplanned file edits;
`false` disables the default checker. A started workflow must be inspected, or
explicitly handed back as unfinished with `[workflow running]`. Completion
rechecks are bounded to two continuations. Plugins can replace this policy with
project-specific acceptance checks. Command-name recognition is a reminder,
not a proof that a test suite establishes correctness; artifact-based evals
provide a separate quality check.

The application defaults to 64 model steps per turn (`agent.maxSteps` overrides
it). Six consecutive failed tool calls stop the turn with preserved progress;
a recovery reminder appears after three. Configure
`agent.maxConsecutiveToolFailures` to change that bound. Existing token budgets,
permission denials and manual interruption remain binding. A stopped turn does
not claim successful completion; `/continue` starts another bounded turn.

`service.model.capabilities` resolves selected-model context/output limits.
Explicit profile `contextWindow` wins. Ollama profiles support native `/api/show`
and `/api/ps` metadata; the default local port 11434 and the Ollama UI preset
select that adapter. Gemini uses native model metadata. Other gateways can set
an origin-confined `metadataUrl` returning `context_window`, `context_length` or
`max_input_tokens`. Limits are cached for 60 seconds by endpoint/model/settings.
A private/global `model-catalog.json` can supply exact model entries:

```json
{"models":{"my-model":{"contextWindow":65536,"maxOutputTokens":8192}}}
```

Unknown limits use a marked 32768-token fallback. Settings includes a Context
window field for manual overrides. Switching models or stage profiles selects
its own limits; usage/billing counters are never treated as capacity metadata.
The status bar shows estimated occupancy and window size (`~` marks fallback).
Schemas, instructions, images and tool calls count toward the request budget;
output space is reserved and request output is capped accordingly.

Automatic compaction runs before model requests. Hard pressure bypasses the
cooldown. Summary requests are split into bounded segments and preserve goals,
constraints, decisions, paths, verification and next actions. System instructions
and recent complete tool-call/result groups survive; recent-tail size adapts to
the available budget. Failed/empty/non-shrinking summaries retain the original
history. A context-overflow error permits one compaction-and-retry, never a
partial tool execution. If instructions, schemas or a single recent result
still cannot fit, execution stops with an actionable error instead of looping.
