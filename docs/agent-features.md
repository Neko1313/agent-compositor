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

## Prompt caching and efficient tool use

Native Anthropic profiles default to `promptCaching: "conversation"`: ephemeral
5-minute breakpoints cover the stable tool catalog and system instructions, and
an automatic breakpoint follows the growing conversation. `"prefix"` caches
only tools/instructions (useful for independent one-shot reviewers); `false`
omits cache controls for gateways that do not support them. Cache hits depend
on the provider's minimum prefix length, exact content, lifetime and routing;
sending a breakpoint is not evidence of a hit. Writes can cost more than ordinary
input. See the [Anthropic cache contract](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

OpenAI Responses and compatible profiles can optionally set `promptCacheKey` to
a stable routing key. It is sent only when explicitly configured; generic
compatible endpoints receive no new cache fields by default. OpenAI's automatic
prefix caching remains provider-controlled; no response-result cache substitutes
for a model call. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
Tool declarations have a stable name order; timestamps and per-stage task text
are not inserted into the shared instructions.

`model.usage` separates `cachedInputTokens` from `cacheWriteInputTokens`, both
subsets of total input. Anthropic streaming counters are reconciled at the end
of the stream. Pricing configuration accepts `cacheWriteInputPerMillion` as well
as ordinary input/output and cached-read rates. A request with cache writes but
no write price is marked unpriced rather than silently billing writes as normal
input. Global/project `pricing.json` settings merge through plugin storage.
These are configured-price estimates, not a provider invoice.

Ephemeral `task`/workflow children forward usage once into the parent's counters
and check the remaining ancestor allowance before each new request.
An explicit stage profile also owns its context compaction calls; it no longer
silently uses the parent's possibly more expensive model. Input estimates are
reserved before sending a budgeted request, and requested output is bounded by
the remainder. Estimates/provider overhead and concurrent independent sessions
mean these token budgets are not a hard dollar cap. Persistent `agent_control`
sessions retain their own usage and budgets.

`tool_help` retrieves an available tool's usage, pitfalls, schema and argument
examples on demand; omitting `name` lists available tools. Every default tool has
schema-checked examples. Templates contain illustrative paths/IDs/anchors; the
model must substitute real returned values. Plugins can override guidance with
`ToolSpec.usage: {when, avoid?, examples: [{purpose, args}]}`. Guidance is not
copied into every repeated declaration. Existing `service.agent.instructions`
and materialized Harness² `toolguide.md` remain ways to tune general behavior.
The default policy favors narrow read/search, guarded edits, bounded delegation,
minimal polling and stopping equivalent retries after a permission denial.

Auto review remains opt-in (`/auto on`) with a dedicated profile in `auto.json`.
Ephemeral children inherit the parent's enabled mode and shared review budget;
turning it off stops subsequent inherited approvals. Review responses may be a
single JSON object or a single fenced JSON object, as some Anthropic profiles
return. Invalid/mixed prose, failures, explicit denies and unknown tools retain
manual fallback. Write/edit policy checks canonical paths rather than scanning
code for words such as `token` or documentation URLs. Sensitive/external paths
and dangerous command effects still require manual approval. Read-only
`workflow_run list/status` can be audited automatically without a paid reviewer.
Manual dialogs include the concrete review fallback reason. `/auto status`
shows the review history; missing reviewer profiles and exhausted review budgets
are configuration failures, not a reason to use the active expensive model.

## Read/search shell permissions and terminal rendering

The original builtin `exec` now classifies a deliberately limited read-only
shell subset before permissions run. Project-local `ls`, `grep`, `rg`, `pwd`,
`cat`, `head`, `tail`, `wc` and `stat` with supported flags can run without a
review model or manual approval. Pipelines and chains must consist entirely of
recognized commands. Executables must resolve to standard `/usr/bin` or `/bin`
programs; paths/cwd are checked against the project, including symlink targets.
Redirects, substitutions, jobs, unknown flags, executable filters (`rg --pre`),
recursive symlink following, shadow binaries and caller environment overrides
remain approval-requiring. Literal glob expansion is intentionally unsupported;
use the dedicated `glob` tool instead. This classification is not an OS sandbox.

Rules can match `readOnly: true`; an explicit exec ask/deny still wins over the
builtin default allow. Custom exec implementations receive no automatic trust
from their tool name. Plan mode accepts verified read-only exec calls and keeps
mutations denied. Prefer narrow native search/read tools when they avoid large
shell output, even when a shell read no longer needs confirmation.

Assistant Markdown is parsed before wrapping. The default view supports inline
strong/emphasis/code/links, headings, nested lists/tasks, quotes, GFM tables and
fenced code, including partial streaming input. Raw HTML is not executed and
images are not downloaded. Parsed historical blocks are cached by text, width
and theme; code remains literal. Plugins can still replace the conversation via
`ui.render`. Styled spans share a constrained Ink text row, avoiding independent
layout shrink during terminal resize. Ctrl+J/LF stays a draft newline even when
coalesced with text; Enter/CR submits, and bracketed paste stays separate.

Native mouse pointers depend on terminal support for OSC 22. GNOME Terminal/VTE
does not implement it; hover title/border highlighting and controls work without
Pointer capability. Known compatible terminals advertise it; unknown terminals
and multiplexers fall back. `AGENT_POINTER=on|off|x11` explicitly overrides the
conservative auto detection (on emits CSS names; x11 uses legacy xterm names).
Forcing on does not add support to VTE. The browser bench emulates OSC 22, which
is why its hand/resize cursor can differ from GNOME Terminal. See
[terminal compatibility](https://ghostty.org/docs/vt/osc/22).

### OpenAI and Google cache paths

Caching is provider-specific; it was not limited to Anthropic. OpenAI's automatic
prefix cache and Gemini's implicit cache already reported cached-input usage.
Stable tool order/instructions help both paths without creating remote objects.

OpenAI Responses optionally accepts `promptCacheOptions` (mode `implicit` or
`explicit`, TTL `30m` or `12h`) for models supporting the current API. A stable leading system-prefix breakpoint
is included; explicit-only mode requires that prefix. Earlier
models and compatible Chat APIs can instead use `promptCacheRetention`
(`in_memory` or `24h`). Options are sent only when configured; unsupported models
may reject them. `promptCacheKey` remains optional. Responses/Chat cache-write
counters are now separate from reads when the provider reports them. Choose
write prices for the actual model/TTL. See [OpenAI's cache documentation](https://developers.openai.com/api/docs/guides/prompt-caching).

Gemini implicit caching is automatic on supported models; hit counts come from
`usageMetadata.cachedContentTokenCount`. Output accounting includes both
candidate and thinking tokens. This integration does not create/manage explicit
Google cache resources or incur their storage fees automatically. That is a
separate lifecycle API, not an Anthropic `cache_control` parameter. See
[Google context caching](https://ai.google.dev/gemini-api/docs/caching).
