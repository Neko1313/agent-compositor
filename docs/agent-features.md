# Agent features: configuration and limits

This document covers the implemented plan recorded in MEMORY.md. Extensions
remain replaceable: Monty, Callix, web, auto review, and checkpoints are plugins;
shared service events and tool.call let other handlers replace them.

## Quick access

| Feature | Command / tool |
|---|---|
| First-run model and tool setup | `/setup`, Settings → Setup guide |
| Automatic approval review | `/auto on`, `/auto off`, `/auto status` |
| Code and conversation history | `/checkpoints`, `/restore <id> code\|conversation\|both`, `/rewind` |
| Change review | `/review [id]`, Keep change / Revert file buttons |
| Independent agents | `/agents`, `/agents create <name>`, `/agents create-shared <name>` |
| Message an agent | `/agents send <id> <prompt>` or click its pane and type |
| Agent controls | `/agents stop <id>`, `/agents archive <id>`, `/agents merge <id>` |
| Main conversation | `/chat` restores/focuses it; Alt+Enter opens a view; `/agents parent` resets agent targeting |
| Extensions | `/extensions list\|install\|update\|enable\|disable\|remove [name] [ref]` |
| Login and keys | `/auth`, `/login <profile> [ENV_VAR]`, `/logout <profile>` |
| Models | `/model`, `/model <profile-or-model>` |
| Usage and cost | `/usage`, `/cost` |
| Human decisions | `ask_user`, `ask_questions` |
| Web | `web_fetch`, `web_search` |
| Code | `glob`, `grep`, `code_query` through Callix |
| Isolated Python | `run_python`, `workflow` through Monty |
| MCP / workflows | `/mcp`, `/workflows` |
| Sessions | `/history`, `/sessions`, `/resume`, `/fork`, `/rename`, `/archive`, `/unarchive` |

## Interactive plugin management

The terminal plugin manager supports catalog search, scoped inactive install,
explicit enable, update checks and deferred application while the agent works.
Agent questions and approvals stay docked while other windows remain usable.
See [the management flow](../packages/app/README.md#manage-plugins-while-the-agent-works).

## Auto review

Enable the mode explicitly for the current session. Approvals return to manual
after restart. Disabling it with the button also invalidates a review already in
progress: a stale review result cannot approve an action.

`/auto on|off|status` execute immediately during a model turn without a panel.
`/auto history` explicitly opens the optional audit view. Merely completing a
review never opens that view. The immediate command contract requires catalog
0.25 or later. Closing the audit view leaves the enabled mode unchanged.

Optionally configure a separate small-model profile in `agent-compositor.json`:

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

Without a reviewer profile, `/auto on` uses the active model/provider. For a
dedicated reviewer on the same platform, set `small_model` to create a `small`
profile using the main provider's settings. `.agent-compositor/auto.json`:

```json
{"profile":"small","maxReviews":50,"timeoutMs":8000}
```

Only actions that require approval through the normal chain are reviewed.
The plugin examines the exact arguments, descriptor, registered description and
parameter schema, plus bounded task context. Every model-facing tool is eligible:
arbitrary console commands, MCP, workflows and custom plugins are not excluded
by name. Already permitted actions avoid a paid review; only ask decisions enter
the reviewer.

Task context preserves the complete submitted text, including restrictions beyond
2000 characters, rather than treating attached file contents or a rewritten
template as the user's request. Delegated reviews also receive the complete
parent request. The existing 24000-character serialized review-input bound still
applies: oversized input goes to manual review without clipping the task or
sending an auxiliary model request.

The reviewer returns exactly three fields:

```json
{"approved":true,"risk":"medium","reason":"The user requested this bounded project CI check."}
```

`approved: true` permits a task-scoped low/medium-risk action. The host receives
`{decision:"allow",risk,reason,policy:"task-context"}` for that exact call.
`approved: false` returns a denied tool result with the review reason, without
asking the same question again. `approved: null` means the user must decide.
The reviewer is instructed to use `null`/`unknown` when targets or effects are
undefined, and reserve refusal for concrete prohibited, unrelated or unsafe
effects. Missing information alone does not establish a violation.
High/unknown-risk approvals, missing task context, protected write paths, inputs above 24000 JSON
characters, exhausted budgets, errors, timeouts, and invalid JSON fall back to
manual approval. The reviewer has no tools and receives action
data as untrusted content. Explicit deny remains binding even if tool.check
tries to override it. Decisions never become broad permissions for future
commands.

After a refusal, identical proposals in the same model turn reuse that refusal
without another paid review or human dialog. Every proposal still gets its own
denied tool result, and fresh policy/guard checks still apply. Allows are never
shared this way: an approval for one execution does not authorize another.
New turns, consumed user steering and explicit mode changes refresh the refusal
context; status/history inspection does not. See [refusal scope and policy
invalidation](core-customization.md#repeated-approval-refusals).

The optional `/auto history` view shows the reason and risk. The last 100 decisions are saved in
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

In current development builds, `/agents` focuses a live overview with Agent,
State and Tokens used columns. Click a row or select it with Up/Down and Enter
to expand its workspace, per-turn limits, failure and recent activity. **Open
conversation** focuses that agent's Reply field. **All**, **Running** and
**Attention** tabs show counts; Attention contains interrupted or failed agents.
Click a tab or use Left/Right in the focused pane. Agent lifecycle and tool events
refresh the visible overview without submitting a prompt to the main model.
Narrow panes stack labeled fields. Recent activity is limited to the last twelve
turn/tool events in this process; open the saved conversation for earlier history.
The host `/agents` command and subcommands dispatch independently of an active
model turn. Tool effects retain their normal permission checks. Disabling
agent-hub removes the host command; an active plugin's `/agents` declaration keeps
its own command contract.

With `btw` and `agent-hub` enabled, `/btw <question>` immediately opens a separate
persisted agent conversation while the main model continues. The focused pane
has its own message field: Enter sends a follow-up without queuing behind the
main turn. Ctrl+C stops the focused agent; closing the pane preserves its work.
`/btw` reopens the last side conversation for this project after closure or restart,
or opens an empty conversation if none exists. Alt+i followed by `/chat` returns
to the main conversation. Pane drafts survive closure within the current process;
only committed messages survive restart. These agents share the project workspace
and permissions and have independent token/step limits, not isolated worktrees.
The former isolated notification is available as `/btw --once <question>` without
tools or transcript context. Side-conversation opening requires catalog 0.26 and
an explicit user invocation; models cannot use it to change the user's focus.

Each agent has its own AgentCore, transcript, session ID, permission state,
budgets, and pane. The parent can send requests asynchronously and read results
through `agent_control` with `action=list` and `id`; omitting id returns a short
list. The ordinary `task` tool remains an awaited subagent whose result returns
to the parent.

Create makes an `agent/<uuid>` branch and worktree from HEAD under
`.agent-compositor/worktrees/<uuid>`. Create-shared uses the current working tree:
conversations are separate, but files are shared. Uncommitted changes in the main
working tree are not copied to a new worktree.

Click an agent pane to use its own Reply field. Alt+i focuses the main message
editor and resets agent targeting; its draft is separate from each Reply field.
Conversation tabs show Overview and up to eleven active agents. Click a name or
use Left/Right to focus that agent's existing pane, preserving separate Reply
drafts and histories. Enter or **Send message** sends the pane's draft;
PageUp/PageDown scroll its history. For larger agent lists, **Previous agents** /
**Next agents**, or Ctrl+p / Ctrl+n, open the first agent in the adjacent group.
Closing and reopening retains drafts within this process. Restart restores the
selected pane and committed history; unsent drafts are not persisted. Archived
agents disappear from conversation tabs and their panes close.

Ctrl+C in the selected pane stops that agent. Stop cancels the current request
and queued work. Approvals and questions from multiple agents are queued;
cancellation removes a waiting dialog. Panes and conversations are restored
after restart; unfinished actions are not replayed automatically. Archive retains
the worktree and files. Merge requires a finished agent and committed changes;
Git reports any conflicts.

**Saved activity** in an agent conversation or expanded overview row opens that
agent's persisted session journal. **All**, **Turns** and **Tools** tabs filter
saved prompts, turn lifecycle/usage and tool calls/results. Click a row or use
Up/Down and Enter to expand the original JSON record, including tool arguments,
outputs, denial and failure details. Records are paged in groups of 25, initially
showing the newest page. Large records have **Previous part** / **Next part**
controls with 8000 Unicode code points per part; the complete saved record remains
accessible. PageUp/PageDown scroll the current view.

The history is a snapshot read from the agent's configured session repository;
**Refresh history** reloads it, including events saved since opening. It is
available after restart and does not submit a prompt or copy tool output into
the main conversation. Reading shows progress; failures retain the previous
snapshot and offer retry. Closing or archiving an agent prevents a pending read
from reopening its history. The reader loads the session through the repository's
existing full-session API; streaming large journal reads are not yet supported.
The overview's short recent-activity preview remains limited to this process.

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

`web_search` defaults to keyless DuckDuckGo HTML search. BRAVE_SEARCH_API_KEY
selects Brave when no provider is explicitly configured; a SearXNG endpoint in
`.agent-compositor/web.json` (`{"searchUrl":"https://search.example.org/search"}`)
remains supported. SearXNG must enable JSON format. Results are limited to 10 with
bounded snippets. `/web` shows setup. See [multiple projects and internet](workspaces-and-web.md)
for provider selection, home/absolute references, `--add-dir`, `/workspace` and
concurrent agents in selected project directories.
Protocols: [Brave Search](https://api-dashboard.search.brave.com/api-reference/web/search/get),
[SearXNG Search API](https://docs.searxng.org/dev/search_api.html).

See also [Monty](../plugins/monty/README.md), [Callix](../plugins/callix/README.md),
[Python workflows](../plugins/workflows/README.md), and [UI themes](ui-theming.md).
Monty isolates Python and explicit host callbacks; separate shell tools still
execute on the host under the normal permission policy.

## Autonomous execution and context budgets

Shell guidance recommends separate calls for independent project checks.
An exact command grant does not authorize additional chained commands,
redirections or a `cd` prefix. Compound requests continue through normal
permission matching; this guidance does not grant or split execution.

Long-running commands can return control through `exec(background:true)`. Enable
the optional [background-jobs plugin](../plugins/background-jobs/README.md) to
subscribe automatically: process completion queues one agent follow-up after the
current turn, or a user-only notification. No model requests are made merely to
wait. The user can keep chatting; logs and cancellation remain guarded through
`exec_output` and `exec_kill`. String stdout/stderr are shown to the model as
separate readable streams with exit/job metadata. Display-only terminal cleanup
does not alter raw results or verification; running jobs remain unfinished. See
[model-facing tool text](core-customization.md#model-facing-tool-text).
These are live-session jobs; session close stops
them, and a single-shot headless command does not become a daemon.

Headless execution reports a host interruption as unsuccessful (exit code 1) in
`text`, `json`, and `stream-json` formats. Text output preserves any text already
streamed and adds an interruption error. JSON results, including the final result
line in `stream-json`, keep the `{type, sessionId, response, usage, error?}` shape:
`response` preserves partial text from this invocation and `error` identifies the
interruption. If interrupted before output, `response` is empty; a resumed
conversation's earlier answer is never reused. Completed turns and handled host
commands remain successful (exit code 0 unless another error occurs); a handled
command with no assistant output has an empty response.

The [workflows plugin](../plugins/workflows/README.md) uses the same follow-up
queue for new `workflow_run` runs: default `completion:"wake"` resumes the
originating parent after completion/failure, `"notify"` only notifies the user,
and `"none"` stays silent. Workers continue independently of an interrupted
foreground turn; automatic parent continuation waits until the user continues.

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

Both `task_plan` and `todo` accept `running` or `in_progress` for active work.
Plans normalize/persist this as `running`; Todo results and service payloads use
`in_progress`. Pending/completed states keep their meaning, and plan-only
`blocked` is not a Todo status. Unsupported states remain errors. Either active
plan spelling keeps work unfinished for completion checks.
Malformed Todo replacements identify the first invalid field with a zero-based
path such as `todo.todos[4].status`, plus the accepted type or values. Invalid
arguments, non-array lists and non-object items are rejected before requesting
the update service; an invalid replacement leaves the current list and its
persisted file unchanged. Omit `todos` to read, or pass `[]` to clear the list.

The default in-memory Todo list belongs to its Core/dispatcher, including when
several agents share one process. A child or another project cannot overwrite it.
Persistence providers can restore their scoped state; the Todos plugin retains
its existing project file format.

Before accepting a final answer, `service.agent.finish` can request a concrete
continuation. The default asks for a useful final answer when the model stops
with empty or whitespace-only text, including after tool execution. Repeated
empty replies fail after the existing two completion continuations; normal
step/token limits and tool permissions still apply. This reminder does not
repeat a completed tool automatically. The default also refuses to finish a
current plan with pending/running items. For planned edits it requests a successful verification command (exit 0),
or an explicit `[verification unavailable]` / `[checks not applicable]` report.
Recognized execution attempts remain obligations across subsequent built-in edits
in the same turn: each needs a passing result after the latest edit. An edit does
not clear an earlier failure or make an earlier pass fresh; a different passing
check cannot hide an unresolved failure or running/cancelled check. A check started
in the background before an edit remains stale even if it completes afterwards.
A pre-edit permission refusal alone does not create an execution obligation or
erase an earlier attempt; unresolved refusals still forbid rerunning or bypassing
the refused effect. Identity uses
the tool, exact trimmed command/check name and explicit working-directory argument;
rerun the same check to resolve its failure.
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

Repeated successful queries have a separate guard. Built-in `read` and Callix
`glob`/`grep` opt in through optional `ToolSpec.loopGuard: "query"` metadata.
After three model steps containing only already-seen successful observations,
the model receives a recovery reminder; six repeated steps stop with saved
progress. Configure `agent.maxRepeatedQuerySteps` to change that ceiling. New
observations, other operations and user steering permit renewed investigation.
Unannotated polling tools retain their behavior. See the precise
[window and reset rules](core-customization.md#repeated-query-recovery).

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

With context management enabled, the main request uses the resolved output reserve even when the provider has no
capacity metadata. Defaults scale to small windows: output reserves at most
8192 tokens or a quarter of the window, and extra system headroom reserves at
most 2048 tokens or an eighth of the window. Explicit `reserveOutput` must be a
positive integer; remove an old zero value to use the default. `reserveSystem`
can be zero. Reserves are bounded to leave at least 128 transcript tokens;
oversized instructions or schemas can still require a larger context window.

Known provider output ceilings cap both main and auxiliary requests. Auxiliary
calls resolve their own profile's ceiling and do not inherit the foreground
profile's capacity. Capacity resolution does not overwrite configured reserves,
so a temporary low ceiling does not persist after switching providers. An
explicit denial from the capacity service stops generation before a model call.

Automatic compaction runs before model requests. Hard pressure bypasses the
cooldown. A bounded host record preserves tool-reported read offsets, changed
paths and command outcomes independently of model-written summaries. It survives
restart and remains hidden from the conversation UI; historical observations do
not count as fresh verification or completed work. See
[context compaction](core-customization.md#context-compaction) for bounds and
embedding details. Summary requests are split into bounded segments and preserve goals,
constraints, decisions, paths, verification and next actions. Segment packing
uses the same Unicode-aware token estimate as context pressure and reserves
space for instructions. Summaries and merge requests ask for concise progress
notes with explicit size targets; raw file contents and repetitive records are
omitted. If a merge fails to shrink its input, one additional correction round
per compaction supplies the rejected length and a concrete shorter target.
It uses the same owning model and budget. A second non-shrinking result or an
empty correction stops compaction and preserves the original history; summaries
are never silently cut to fit. When a segment reaches its output limit, only
that segment is retried with a doubled allowance, capped at 8192 tokens or a
quarter of the configured context window, whichever is smaller. This permits at
most three attempts per segment through the owning model and budget. Partial
summaries are discarded; cancellation, provider errors and streams lacking a
completion event do not trigger this retry. Summary requests explicitly disable
tool use. Any returned tool call fails compaction without executing the call or
replacing the original history, even if followed by a normal completion event;
these responses do not trigger the output-limit retry. System instructions
and recent complete tool-call/result groups survive when they fit the retained
tail budget. Oversized recent groups can be folded into the summary as a whole;
their calls/effects are not retried. The latest user request remains verbatim
when its working context is folded, including after completion/recovery feedback
was added by the harness.
Such feedback carries an explicit host-origin marker and remains working context;
it does not replace the task reference. Real user steering still updates that
reference, even if its text begins with the same words as a harness message.
Failed/empty/non-shrinking summaries retain the original
history. A context-overflow error permits one compaction-and-retry, never a
partial tool execution. If fixed instructions, schemas, the preserved user
request or the resulting summary still cannot fit, execution stops with an
actionable error instead of looping.

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
For a proposed call, `tool_help` can also preview current rule/session-approval
decisions without executing or requesting approval. This never grants permission;
real execution rechecks guards and review. See [permission previews](core-customization.md#permission-previews).
The default policy favors narrow read/search, guarded edits, bounded delegation,
minimal polling and stopping equivalent retries after a permission denial. The coding
preset also requires a recognized successful check after the latest built-in
write/edit before ordinary completion, without requiring a task plan. Starting a
background test does not count as completion; inspect its finished output.
See [coding completion checks](core-customization.md#coding-completion-checks)
for opt-out, replacement policies and explicit limitations.

`read.offset` uses 1-based integer lines (omit it or use 1 to start); `read.limit`
is an integer from 1 to 10000, defaulting to 200 lines from the requested offset.
Each tool page also returns at most 16000 UTF-8 bytes, even for a single dense
line. `maxChars` accepts 1..16000 Unicode characters to request a smaller page;
the byte bound still applies and never splits a code point. If the selected
line window does not fit, copy `nextCursor` verbatim into another `read` with
the same `path`; omit `offset`/`limit` or keep the original values. The cursor
preserves the original line window and verifies its returned content has not
changed. It is stateless across cores/restarts and never grants file access.
A stale cursor gives the original line window to reread. Character pages keep
Unicode code points intact; edit ranges still use UTF-16 offsets.

Clients must follow `nextCursor` before `nextOffset`. Only after the character
window finishes does `nextOffset` expose the next line page. Do not assume a
requested line range fits in one result. This changes the default for long lines
and large explicit ranges; consumers that previously used only line pagination
must handle `nextCursor`. The underlying `service.file.read` input is unchanged.
Use targeted search to locate relevant sections instead of repeatedly reading
a large file from its start. The edit anchor covers exactly the
returned content, including on later pages. Ordinary source is presented to the model with
literal line breaks and separate JSON anchor metadata; callers/UI retain the
structured result. See [model-facing tool text](core-customization.md#model-facing-tool-text).
Native text-search results can include ready `readArgs` for a match deep inside
a long line. Copy those into `read`, then use its exact edit anchor; the search
preview itself is not guarded source. See the
[search-to-edit workflow](../plugins/callix/README.md) for fields and limits.
The model-facing schema matches these existing
runtime bounds. Invalid pagination is rejected with a clear error before path
access, without normalizing zero to one. Missing-file and directory errors retain
the underlying error and explain how to discover a real file. No read failure
creates a replacement file or changes workspace grants.

The native model-facing `edit` tool requires `target`, `oldText` and `newText`.
For a guarded edit, copy the `editRef` from `read` or `code_query read_symbol`
verbatim into `target`. Copy the source to replace into `oldText` and put the
replacement in `newText`. The reference identifies the file, its snapshot and
the selected range. It works after session resume while the hash still matches.
For an explicit anchor, use its `path` as `target` and copy `expectedHash`,
`range` and `strict` together. A plain path in `target` selects a file without
snapshot guards unless guards are also supplied.

The core supplies the selected path to plugin hooks and permission checks.
Existing native callers can still submit `path` or `editRef`. Conflicting
guards and invalid references fail before editing. See
[snapshot edit references](core-customization.md#snapshot-edit-references).
With hash/range/strict,
identical `oldText` and `newText` fail before permission review or file access,
with an error identifying `edit.newText`. Supply text that implements the change.
Unguarded whitespace-normalized matching can still use equal literals to change
different actual spacing. All unchanged file results remain errors. See
[tool argument admission](core-customization.md#tool-argument-admission).

A missing hash is reported separately from invalid offsets, including for insertions;
malformed ranges and missing range hashes fail before approval or file access.
Offsets are UTF-16 code units, end exclusive, not line numbers. Match errors
distinguish zero matches, multiple matches and bounds beyond the snapshot;
copy the complete fresh anchor before retrying. The runtime never fills in a
hash or drops the range automatically. Stale hashes still require a new read,
and rejected edits do not change the file or add an undo entry. See
[semantic navigation and edit anchors](../plugins/callix/README.md#precise-navigation-and-guarded-edits). Missing-file (`ENOENT`)
edit errors preserve the underlying error and remind the model to discover actual
project filenames before retrying, rather than creating a guessed replacement.
The hint does not create files, relax guards or authorize a denied operation.

The default edit resolver rejects a replacement whose resulting file text is
unchanged, including guarded ranges, empty insertions and normalized matches.
It does not write the file or return an undo operation. This compares actual
before/after text: identical `oldText`/`newText` can still perform a real whitespace
normalization when the file differs from both. A no-change error asks for the
intended replacement, or to omit editing if the file is already correct.

Auto review remains opt-in (`/auto on`). A dedicated profile in `auto.json` is
optional; if absent, the active model/provider performs the review. Blank or
invalid explicit profile settings return to manual approval without a fallback
provider switch.
Ephemeral children inherit the parent's enabled mode and shared review budget;
turning it off stops subsequent inherited approvals. Review responses may be a
single JSON object or a single fenced JSON object, as some Anthropic profiles
return. Legacy `decision/risk/reason` JSON remains supported: `allow` still needs
low risk; `deny` refuses the call and `ask` remains manual. Extra/mixed response
fields, invalid JSON and dependency failures return to manual approval. Explicit
permission-rule denies skip the reviewer and cannot be overridden.
Unknown tool semantics require a cautious assessment; tool names are not an eligibility whitelist. Write/edit policy checks canonical paths rather than scanning
code for words such as `token` or documentation URLs. Sensitive/external paths
remain guarded; command effects are assessed by the reviewer regardless of executable name. Read-only
`workflow_run list/status` can be audited automatically without a paid reviewer.
Manual dialogs include the concrete review fallback reason. `/auto status`
reports the mode/count without opening a pane; `/auto history` shows decisions.
An omitted reviewer profile uses the active model, while an invalid explicit
profile never switches providers silently. Exhausted review budgets remain manual.

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

## Human choices and questionnaires

The model can call `ask_user` for one question or `ask_questions` for 1–8 related
questions. This is a human input channel; execution permissions use the approval
channel. The instructions recommend asking only for decisions missing from the
conversation and repository, rather than repeatedly interrupting routine work.

Both tools accept string choices or objects with `label`, `description` and
`recommended`. A recommendation is displayed without selecting an answer.
`multi: true` enables compatible multiple choices. Custom text is available by
default; `allowOther: false` closes the choice set. Questions without options
accept free text. Labels must be unique within a question (up to 12 choices).

```json
{
  "title": "Project setup",
  "questions": [
    {
      "id": "target",
      "header": "Deploy target",
      "question": "Where should this application run?",
      "options": [
        {"label": "Staging", "description": "Preview first", "recommended": true},
        {"label": "Production", "description": "Public deployment"}
      ]
    },
    {
      "id": "checks",
      "question": "Which checks should run?",
      "options": ["Unit tests", "Browser tests"],
      "multi": true
    }
  ]
}
```

Use arrows to focus an option, Space to toggle it, Tab to reach custom text or
navigation, and Enter to continue. The previous numeric input (`2` or `1,3`)
continues to work. Choices, descriptions, Back/Next and review entries are
clickable. Page Up/Down or the wheel scroll long questions. Escape cancels the
whole interaction. Drafts survive Back and editing from the review screen.

A questionnaire returns only after explicit submission of the review screen:
`{"answers":[{"id":"target","selected":["Staging"]},{"id":"checks","selected":["Unit tests"],"text":"Load tests"}]}`.
IDs must be unique and start with a letter; the result is validated for complete,
unique answers, allowed choices and single/multiple cardinality. Custom text is
returned separately from selected labels. No partial result is sent to the model.
`ask_user` keeps its existing `{answer: string | string[]}` result. Embedders
implementing `onAsk` should inspect `request.questions` for the new questionnaire
shape; legacy calls retain `request.question`, string `options` and `multi`.

Plugins use `await $.ui.ask({...})` or `await $.ui.questionnaire({...})` through the
replaceable `service.ui.ask` and `service.ui.questionnaire` contracts. A trusted
plugin that waits for human input inside a hook must configure a suitable
`hookTimeouts` entry in its manifest; the default hook budget is two seconds.
Do not request input during `ui.render`. Cancellation and headless operation
fail rather than manufacture answers. The TUI queues concurrent questions;
unrelated approval requests do not consume keys while an active question owns
the input. Answers never become user prompts, and the unsent prompt is preserved.


## Interactive chat history

Configured session storage must acknowledge event writes. A storage failure stops
further model/tool execution in that core instance and reports a failure instead
of successful completion. Repair storage, then reopen/resume the session. Effects
that completed before the failed write may still have happened.

On resume, tool calls without saved results receive explicit interrupted-result
records before the next message. Their outcomes remain unknown: recovery does not
execute them again. Inspect external state before retrying such actions.

`/history [search]`, `/sessions [search]` and bare `/resume` open the same
replaceable session-manager view. Each entry includes a user name or the first
ordinary prompt, local last-activity date/time, and user/completed-assistant
message count. The current chat and archived chats are marked. Arrow/Page keys
page through the results; clicking selects a preview of the first prompt and
latest completed reply. Enter or Resume restores the selected conversation.
The conversation title identifies the resumed chat. Rename opens the native
local form. Archive visibility defaults to hidden, with an explicit toggle.
Escape/Close leaves the current session and unsent prompt intact.

Search is case-insensitive literal text over names/IDs/previews, with streaming
conversation-body fallback. Tool output and instructions are excluded. Metadata
previews are bounded, not model-generated; no model requests or extra tokens are
needed for history. Legacy roll files are enriched read-only with a bounded
in-memory summary cache; their sidecars receive the new fields on the next
append. Rapid input is debounced/cancelled, and pending results cannot be resumed.
Switching during an active turn is rejected; read-only history listing remains
available. Session files remain in the existing project-scoped home storage.

`compositor --resume` and `compositor --history` open the picker at startup and
require an interactive terminal. Explicit `--resume <id>` keeps working for TUI
and headless runs. Ambiguous/missing IDs report an error instead of switching.

Catalog 0.16 adds a reusable optional `UiTextView.input` field (`id`, `value`,
`placeholder`) and `ui.change {site,id,value}` for editable plugin views. Text
and Backspace/Delete/Ctrl+U edit the local field; keys such as Enter, arrows and
Escape arrive as `ui.press`. The field value initializes the local draft; change its ID or remove/reopen the
view to reset it. Input never enters the model prompt. Handled UI commands are
recorded as `prompt.dropped`, so new command records cannot become user messages
after resume. Session list,
search and mutations still use `service.session.control`/`service.session.store`.

## Independent process resource charts

Enable the `resources` plugin and run `/resources` to open a live window while an
agent works. CPU/Memory tabs plot real process samples with labeled scales and
current RSS/heap values. The plugin adds no model tool and sends no model request.
Pause/Resume, Sample now and Clear history work independently of agent execution.
Closing or hiding the window stops sampling; reopening retains this process's
bounded history, while restart/reload starts fresh. See the
[resource monitor guide](../plugins/resources/README.md) for measurement scope,
CPU scaling, sample timing and limits. Child shell processes and external model
servers are excluded; this is not per-agent or machine-wide attribution.
