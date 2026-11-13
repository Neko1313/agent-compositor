# Core customization

The kernel supplies execution mechanisms and public contracts. Domain behavior
belongs to selected implementations. A coding assistant, an operations assistant
and another professional tool can use the same kernel without inheriting one
another's tools or instructions. The tiling mechanism remains unchanged.

Core composition and execution seams are complemented by selected private UI
controllers and a complete session repository contract. See
[UI controllers and repositories](ui-controllers.md) for editor/dialog behavior,
history, storage, lifecycle and selection.

## Select capabilities

An embedder can pass `fixedConfig` to `buildApp` to supply the composition
directly. The app validates the supplied configuration and skips discovery
of layered `agent-compositor.json(c)` files. This applies to child agents
as well. Plugin settings, stored sessions and project files retain their
normal lookup paths.

The assembled application accepts these settings in `agent-compositor.json`:

```json
{
  "enabledPlugins": ["my-kernel-extension", "agent-harness"],
  "serviceProviders": {
    "service.agent.run": "my-kernel-extension"
  },
  "toolProviders": {
    "inspect": "my-kernel-extension"
  },
  "agent": {
    "builtinTools": [],
    "controlTools": [],
    "tools": ["inspect"],
    "projectContext": false,
    "fileReferences": false,
    "skills": false
  }
}
```

- `enabledPlugins`, when present, is an exact name allowlist. Disk modules are
  excluded before import; host contributions also respect the list. The existing
  `disabledPlugins` list takes precedence. Omitting the allowlist discovers available packages while keeping them off until
  an explicit user/project activation. Project choices override user defaults.
  Plugin installation, activation and model profiles remain separate concerns.
- `agent.builtinTools` selects standard file/shell/Todo tools. Omitting it keeps
  the existing defaults. `agent.controlTools` selects `task`, `ask_user`,
  `ask_questions` and `tool_help`; an empty array removes all automatic helpers.
- `agent.tools` is the final model-facing allowlist, including extension tools.
  Calls through interactive `invokeTool` also obey it. An empty array means no
  tools; omission permits the composed set.
  An unknown tool name remains an error. When it exactly matches an action enum
  on an available tool, the error suggests that tool and its action argument.
  This is recovery guidance only: no alias is executed, permissions still apply,
  and excluded tools are not advertised as suggestions.
- `toolProviders` explicitly replaces a tool's whole definition, including its
  schema and handler, with the named loaded plugin's definition. Missing selected
  definitions raise an error. Ordinary `extraTools` still append without silently
  replacing earlier names.
- Project instructions, `@file` expansion and skill discovery can be turned off
  independently. This prevents unrelated repository content entering a selected
  domain's prompt.

The `agent-harness` contribution defaults to domain-independent instructions.
`agent.instructionsPreset: "coding"` selects coding instructions. For a guarded
edit, this preset directs the model to copy the returned `editRef` verbatim into
`target`, alongside `oldText` and `newText`. With an explicit anchor, the model
uses its path as `target` and copies its guards. See
[snapshot edit references](#snapshot-edit-references).
`agent.instructions` or private `behavior.json` instructions can
replace them; `agent.baseInstructions: false` disables this contribution's base
instructions. Disabling `agent-harness` removes its commands, task-plan tool and
behavior services. Other host contribution names include `model-selector`,
`provider-auth`, `session-manager`, `agent-hub`, `extension-manager` and `marketplace-manager`;
use their manifest names when selecting a composition.

Core embedders have equivalent `AgentCoreOptions.tools`, `controlTools`,
`toolNames`, `toolOverrides` and `plugins` controls. A concrete model adapter and
the disk `SessionStore` are optional. `SessionJournal` is a structural interface;
the selected streaming service may provide the model instead.

`service.permission.review` runs only after ordinary policy requires approval.
A valid `{deny:reason}` or `{value:{decision:"deny",reason}}` refuses the exact
call without a human dialog. Legacy `{value:{decision:"allow",risk:"low",reason}}`
can approve it; medium-risk approval additionally requires `policy:"task-context"`
and actual task context. Other values/failures remain manual. Nonblank reasons
are bounded to 1000 characters. Permission-rule denies run first and skip review;
automatic verdicts never create session/project approval entries. See the
[auto review protocol](agent-features.md#auto-review).

When host preparation rewrites or expands a submitted request, the user-role
message keeps optional host-only `userRequest` with the submitted text; `content`
remains the prepared model input. Permission review and delegated `parentTask`
use the complete submitted request, without a 2000-character prefix cut. Default
compaction supplies the same original text as its separate task reference.
Attachments and rewritten templates therefore do not become claimed user
authorization. A delegated request still cannot expand its parent's scope.
The core omits `userRequest` from model-stream request objects; bundled adapters
also omit it on the wire when used directly. Custom adapters used outside the
core should do the same. Context snapshots should retain this field. Legacy messages fall
back to their complete recorded content when no original request is available.

The journal reconstructs the field from existing submit/prepared records, and
new records add host-only turn correlation metadata. Steering that arrives while
submission/preparation is pending keeps its own user message instead of being
overwritten by the prepared body. A correlated submission that fails during
preparation stays in the audit journal. Replay excludes it from the model
history, so restarting the session cannot deliver the rejected request.

`AgentCoreOptions.userCommands` supplies the currently loaded immediate user
controls. `submit` and `steer` dispatch them outside the prompt queue;
`invokeCommand` explicitly attempts this path and returns false if unregistered.
Owner cancellation, auxiliary usage accounting and teardown remain independent
of the active turn. See the [command contract](plugin-standard.md#immediate-user-commands).

### Repeated approval refusals

Within a model turn, a completed approval refusal is remembered for an identical
effective tool name, argument values and preflight descriptor. Object key order
does not matter; different arguments (including cwd/options) or descriptors are
different proposals. If fresh rules/approvals and `tool.check` still require
review, the repeated proposal receives a denied result without another review or
human dialog. The result identifies reuse of the original refusal. This is not
semantic matching of differently written commands and does not grant authority.

Identical parallel proposals wait for the first review, then repeat preflight and
policy/guard checks. Only refusals are shared: an allow-once verdict does not
authorize a second execution. Waiting can be cancelled independently. A fresh
session/project grant or an explicit changed guard decision takes effect through
normal checks. Refusals are discarded when a turn ends or new user steering is
consumed; an old held model response retains its original context until that
boundary. Direct interactive calls and independent user operations are separate
explicit requests. Refusal memory is not persisted or inherited by child agents.
Question answers/model narration do not clear it or replace authorization.
Hosts/reviewer plugins call `service.permission.invalidate` with `{}` (catalog
0.30) after an explicit review-policy change. It clears only this negative memory,
returns `{value:true}` and grants no authority. An old in-flight refusal cannot
populate the replacement memory. Auto mode controls call this service when the
mode changes, including during an active turn; ordinary audit/status views do not.

Each refused proposal remains a separate failed tool result and counts toward
existing recovery limits. This suppresses duplicate approval work; it does not
make a model select an authorized alternative or finish an unverified task.

### Tool argument admission

`ToolSpec.validate?(args)` optionally returns a non-empty error string or
`undefined`. It is a pure synchronous argument check without a `ToolContext`:
perform no effects, model calls or filesystem access. The host supplies detached
arguments, so mutation cannot rewrite the descriptor or executed call. Exceptions,
asynchronous returns and malformed results become failed tool calls.
Omit the callback to skip this check; `null` and `false` are malformed declarations,
including when tools are supplied directly to the core instead of loaded from disk.
The disk loader's structural `PluginTool` contract includes the same optional
callback. Non-function values fail plugin loading before the tool is advertised;
valid callbacks are retained through reload and checked by the core at admission.

Execution validates the effective tool and arguments after `tool.call` rewrites,
before descriptor resolution, `tool.check`, permission review or approval. An
argument error is not a permission denial or an authorization grant; corrected
arguments still take the complete ordinary policy path. Hook-supplied results
retain their existing ownership instead of executing the target tool. Optional
`tool_help` previews run the same validator without running the proposed action.
Existing tools without validators keep their previous behavior. Execution-time
checks remain necessary, including file hashes and confinement; the built-in
editor also validates in its direct tool/service entry points.

For `edit`, identical `oldText`/`newText` is rejected early when a hash, range or
strict matching makes the operation exact. The error identifies `edit.newText`
and asks for a real replacement. Unguarded whitespace fallback remains available:
equal literals can legitimately normalize differently spaced source, and the
resolver still rejects replacements that leave the actual file unchanged.

Malformed `edit.range` objects and a missing hash for a guarded range also fail
before permission review or file access. Ranges require non-negative safe integer
`start`/`end` offsets with `end >= start`; they use UTF-16 code units with an
exclusive end, unlike `read.offset`/`limit`, which use lines. Copy the returned
anchor rather than calculating offsets from displayed line numbers. JSON-encoded
range strings are rejected rather than coerced. Corrected calls still require
ordinary authorization. After a fresh hash is checked, the resolver distinguishes
zero exact matches, multiple exact matches and an out-of-bounds range. Errors
report counts/bounds without quoting source or searching outside the selected
range. Rejections neither write nor create an undo entry; they do not widen the
range, drop guards or select a replacement automatically. A successful edit
invalidates the earlier snapshot hash, so later edits may require a fresh read.

### Whole-file writes

Native `write` expects complete file text. If the proposed content, with outer
whitespace trimmed, is a nonempty proper substring of the trimmed current file,
the tool reports that it would discard surrounding text. No mutation or undo
entry occurs. To intentionally retain only that excerpt, submit the complete
call with `allowPartialOverwrite: true`. That flag covers this single content
check. Ordinary permission rules still apply. New files, empty content and
complete replacements with other text use the usual write flow. The excerpt
check only recognizes verbatim text and cannot detect every accidental deletion.

The native writer obtains a UTF-8 text preimage for undo, then passes its
SHA-256 as `expectedHash` to `service.file.write` (catalog 0.32). A null hash
requests exclusive creation of a missing file. The default resolver checks
an existing file's bytes under the native mutation queue for that path.
A stale preimage or malformed UTF-8 stops the write. This queue serializes
native cooperating mutations and cannot lock out unrelated processes.
Custom file-service providers must implement the precondition to provide the
same behavior. Existing direct service calls can omit it.

Successful native edit and write receipts expose `fileAction: "edited"` or
`"wrote"` to the model, alongside the returned path and replacement or byte
count. Hooks continue to receive the original structured service outcome.
The coding preset directs the model to inspect the project's documented check
and run it with an available authorized tool once its changes are ready.

### Snapshot edit references

Builtin `read` adds optional `editRef` to its structured result and model-facing
metadata when it has a complete strict edit anchor. Callix `read_symbol` supplies
the same field on hosts with the reference encoder. The native editor's model
declaration requires three fields. A model can copy the reference into `target`.

```json
{"target":"<copy the returned editRef verbatim>","oldText":"a - b","newText":"a + b"}
```

A path is also a valid `target`. For a read that provides only an explicit
anchor, use its path as `target` and include its hash, range and strict flag.
A versioned `edit-v1:` reference selects an absolute path, full-file SHA-256 and
exact UTF-16 slice with strict matching. Use `./edit-v1:...` to select a
relative filename that starts with the reserved prefix. Existing native callers
can still supply `path` or `editRef` in their previous forms. Select one calling
convention per request. The host resolves the selector before permission checks.
Both plugin phases receive a concrete target, including checkpoint and scope
guards. Native `read`/`write`/`edit` checks receive the canonical descriptor path,
so a symlink or workspace alias cannot disguise the target from `tool.check`
guards. Custom tools retain their own descriptor/input contracts. Inputs rewritten
by a plugin are projected again before policy. A path passed as `target`, or
as legacy `path`, must be a non-empty string. A caller using the legacy
combination of `path` and `editRef` must select the same file with both, even
if two files have identical contents. Explicit `expectedHash`/`range`/`strict` fields remain
supported without a reference; when supplied with one they must agree exactly.
Conflicting guards, malformed/unsupported references and certain no-op edits fail
admission and `tool_help` preview before permission review or the built-in file-edit service. An
invalid present reference never silently falls back to unguarded editing.

References are portable snapshot selectors, not authenticated capabilities or
authorization tokens. They have no session cache or expiration timer and survive
journal replay/resume; the file's current hash must still match. Workspace/path
resolution, ordinary permissions, service interception, exact matching and guarded
undo remain in force. `replaceAll` affects only the selected range. Edits do not
expand that range, substitute a current hash or use whitespace fallback. A stale
reference requires a fresh read. The resolved guards cross the existing
`service.file.edit` seam; that event's schema is unchanged.

When a native edit omits its selector, validation fails before any mutation.
If the submitted old text appears in a single distinct snapshot among this
turn's retained native reads, the error can suggest the corresponding
`target` as a JSON field. The model can verify the intended file and explicitly
retry with that field. A retry goes through the usual permission and snapshot
checks. Missing, ambiguous or invalid selectors never trigger an automatic edit.
If an exact replacement succeeded earlier in the current turn and a later edit
cannot find the identical old text for the identical replacement, the error
identifies the most recent matching success in the retained history. The agent
can inspect that file and run the project checks. The earlier result describes
a past edit and does not certify the current file contents.

Journal `tool.call.input` records the effective input seen by hooks. The host
records how it projected a native selector in reserved `compositorEditInput`
metadata. Replay restores the model's original argument shape and removes the
host marker while retaining provider metadata. Existing journals using the
version 1 reference projection remain readable. For custom or older editors,
follow the tool's advertised schema.

Native file execution is bound to the canonical path evaluated by policy, including
after an approval wait. Retargeting an argument symlink does not redirect the
approved call. If resolving the approved canonical path itself now selects another
path, the call fails and requires a fresh request under current policy. This also
applies to ordinary native reads/writes/edits without references. Snapshot hashes
and the existing workspace/file-service checks remain in force.

SDK extensions may import `encodeEditAnchor` and `EditAnchor` from
`@agent-compositor/tools`. The pure encoder accepts a complete strict anchor with
an absolute path, lowercase 64-character SHA-256 and non-negative safe integer
range with `end >= start`; it returns a string or `undefined` for unsupported
anchors/references longer than 16384 characters. It neither reads a file nor
grants permission. The built-in `read` tool derives its reference from the
service's anchor without changing the `service.file.read` result contract.
Callix keeps explicit anchors on older SDKs lacking the encoder, and removes both
the anchor and reference when result budgeting removes source content.

### Permission previews

`tool_help` accepts `name` plus optional `preview` containing proposed arguments:

```json
{"name":"exec","preview":{"command":"npm test"}}
```

The returned `permission` contains `decision` (`allow`, `ask` or `deny`), `via`,
`scope: "rules-and-session-approvals"` and `executionAuthorized: false`. It uses
the same descriptor preflight as execution, including canonical file paths and
built-in read-only shell classification. It does not execute the proposed tool,
invoke its `tool.call`/`tool.check` hooks, run automatic review, ask a human or
create approvals. Rule bodies/reasons are not returned. Unknown tools, malformed
preview requests, argument-validator failures and descriptor-preflight failures return errors. This preflight
does not replace the target tool's complete execution-time argument validation.

This is a snapshot, not authorization: actual execution repeats preflight and
policy checks, applies argument rewrites and plugin guards, and performs review
when needed. `ask` means further review, which can be automatic; a questionnaire
answer cannot substitute for execution approval. Revoked approvals or later
policy/guard changes still block a previously allowed proposal. Preview an
independently authorized alternative rather than retrying refused effects.
Turn-local refusal memory is not part of this static snapshot.

The helper respects the effective tool composition, including independent user
operations. Embedders using `createToolHelp` outside AgentCore must explicitly
provide its optional preview callback; without it the ordinary help schema and
behavior remain available. Repeated identical help/preview observations use the
existing [query recovery bounds](#repeated-query-recovery).

## Replace execution strategies

`service.shell.jobs` inspects core-owned background shell metadata, and
`shell.completed` reports terminal OS-process events without output/commands.
Shell IDs and buffers are scoped to each core. Background deadlines are enforced;
session end, `AgentCore.close()` and application close drain process groups, and
removing an attached workspace terminates its retained shells.
Conversation clear ends the old session work and reinitializes active plugins,
so startup services such as Callix warming resume for the new conversation.

Trusted active plugins can use `service.agent.enqueue` with their plugin name,
an idempotency key and bounded text to enqueue an agent follow-up. The call
returns before any model response. Follow-ups run after the current turn, share
normal permissions/budgets, coalesce nearby messages from the same owner and are
revoked on owner unload. A user interruption pauses automatic processing: accepted
plugin-owned follow-ups stay queued until an explicit prompt continues the session,
including when stopped before an idle wake timer fires. Ordinary queued prompts
and steering are discarded. Clear/close discard pending follow-ups; clearing a
conversation also resets wake scheduling so subsequent jobs can deliver again.
An explicit continuation waits for the interrupted turn's terminal hooks and
journal writes to settle before starting another turn. This also applies when
an event subscriber immediately submits a prompt on `turn.interrupted`; cleanup
from the previous turn cannot replace the new turn's state or tool context.
Another Stop or Clear discards a continuation that is still waiting; closing
rejects it without starting a model request.
Consumers must treat process output as data and fetch it through guarded tools;
the host does not elevate a background event to user authorization. The optional
[background-jobs plugin](../plugins/background-jobs/README.md) implements the
subscription/delivery policy. `registerDefaultResolvers` now returns a shell
cleanup function with `revalidate()`; custom hosts must call cleanup at teardown.
`HooksHost.close()` revokes all registered plugin lifetimes, including dynamic
SDK registrations; `AgentCore.close()` calls it after draining its work.

Trusted hooks can call `const background = $.background()` while the hook is
active to retain services for asynchronous work. This handle keeps the original
session identity and plugin lifetime, independent of the launching foreground
turn's signal. Subscribe to `background.signal` for cancellation, use services
through the retained handle, and release work in the plugin's disposer. Unload
revokes old handles even if another instance reuses the name. A background handle
cannot call `next()` to continue an expired hook; render-only and sandboxed hooks
cannot acquire it. This is an explicit lifetime choice, not a separate process or
a bypass of service interception and permission checks.

### Truncated model responses

When a provider finishes with `length`, the default turn strategy discards every
tool call from that response, including calls whose arguments appear complete.
If a step remains, it permits one recovery per turn: it removes the partial
response from model context and gives host-origin feedback asking for a shorter
answer or a smaller focused tool call. This feedback preserves the original user
task and does not grant permissions. A `context.restored` journal snapshot records
the recovery boundary, so replay and resume do not resurrect discarded text or
attach it to later tool calls. Already streamed text may have been visible before
the context restore; it is not a completed answer.

The retry consumes an ordinary step and uses the same model, output ceiling and
remaining token budget. It does not enlarge limits or automatically compact an
input context solely because the provider reported `length`. A second truncated
response, or truncation at the last step, fails with the output/context-limit
error. Interruptions, journal failures, token exhaustion and ordinary provider
errors retain their existing stop behavior. Custom `service.agent.run` strategies
own their recovery policy.

### Context compaction

`TokenBudget.applyCapacity(capacity, overrides)` resolves provider limits against
the caller's configuration without replacing it. `outputReserve` exposes the
effective generation allowance; `configure` explicitly replaces settings. Both
construction and reconfiguration validate reserves. Defaults and clipping are
described in [context budgets](agent-features.md#autonomous-execution-and-context-budgets).
The `service.model.capabilities` input accepts an optional `profile`; omission
uses the selected profile. Capacity services must honor this field when serving
auxiliary models. Known output ceilings apply to every model request, including
summaries and review calls; denied resolution stops generation.

The default context compactor preserves the latest user request verbatim and
keeps recent complete tool groups within half the available transcript budget.
Plugin-owned automatic follow-ups remain visible to the model as host feedback;
they do not replace the task reference used for permission review, delegation
or compaction. The host records their provenance in the session journal and
preserves it on replay. Session request previews also retain the actual user
request. Ordinary user messages and initial delegated tasks remain requests,
regardless of whether their text resembles an automatic notification.
An oversized newest group may be summarized in full, including on the first
tool batch; compaction never re-executes its effects. Embedders using
`compactTranscript` can opt into this selection with `maxTailTokens` and
`preserveLastUser`; omitting them retains its original tail-selection behavior.
Failed, empty or non-shrinking summaries leave the original messages intact.
After successful default compaction, `AgentCore` retains a separate bounded
record of tool-reported observations alongside the model's summary. It includes
successful `read` paths, offsets, returned character counts and truncation;
successful `write`/`edit` paths; and reported `exec` exit codes or job starts.
Tool errors and incomplete output previews cannot become success records.
Nonzero process exit codes are retained with their actual values.
The record excludes source bodies, stdout, edit contents and model conclusions.
It retains at most 32 recent distinct observations, using at most 1024 estimated
tokens or one eighth of the available transcript budget, whichever is smaller.
Older entries are evicted with an omission marker; if none fits, no record is
added. Total post-compaction size, including this record, must still shrink.

This is historical evidence, not proof of current file contents, fresh checks,
authorization or completed work. Verification gates still inspect actual tool
execution; the record does not grant permissions or prevent legitimate rereads.
It is host-origin feedback, not a new user task, and survives replay through the
existing `context.compacted.messages` snapshot. Later compactions reconstruct it
from structured records rather than trusting the natural-language summary.
Clearing the conversation removes it. The standard UI omits it on load, context
restore and session switching while preserving it for the model. Embedders can
use the core's `isCompactionEvidence(message)` helper to recognize these internal
messages without hiding ordinary user text that quotes their contents.

`summarizeChunks` permits one correction round for a non-shrinking merge before
failing, with explicit length feedback and a shorter target. This adds at most
one merge round per compaction, through the same caller-supplied callback;
it neither truncates a candidate nor substitutes an empty successful summary.
Summarizer callbacks also receive optional `ctx.userRequest`, the latest
submitted request supplied separately from the prepared messages being folded
(or recorded user content for legacy messages). Existing
callbacks can ignore it. The default model summarizer includes that exact text
as a labeled reference in every segment and merge request, including when the
user message is pinned outside the folded history. It distinguishes the request
from examples, scaffolds and earlier assistant proposals instead of inferring
that the task or its authorization is missing from a partial segment. This is
context for summarization, not a new tool-execution instruction.
Every default summary request declares no tools and sets
`CompletionRequest.toolChoice: "none"`. Bundled adapters encode this as the
provider's explicit disabled-tool mode: `tool_choice: "none"` for Chat
Completions/Responses, `{type: "none"}` for Anthropic, and
`toolConfig.functionCallingConfig.mode: "NONE"` for Gemini. Omitting the new
optional field preserves the provider's normal behavior. Custom adapters should
honor it; compatibility endpoints may still violate the request, so the default
summarizer rejects any tool-call event even if the final reason is `stop` or
`length`. It drains the stream for usage accounting, executes no summary tool
calls and does not retry a tool-bearing response. Only output-limit truncation
without tool events uses the existing bounded increase in output allowance.
The reference and framing count toward the auxiliary context bound. If they
leave too little space for a bounded summary, no auxiliary call starts and the
original transcript is retained with a visible compaction failure. Attachments
remain on the retained user message; the auxiliary reference contains its text.

### Concurrent user tool operations

`$.agent.tool(name, args, {signal})` uses the ordinary effective tool registry,
rewrites, permissions, approval and execution hooks. During a model turn it runs
as a separately owned user operation, with its own cancellation, tool records
and token counters. At most four such operations may run; each has a five-minute
lifetime including approval waits. Idle calls retain the normal interactive
`invokeTool` behavior. Embedders can use `invokeUserTool` for the same routing.

User operations share session token accounting, but their results do not enter
the model conversation or reset its failure/completion state. Auxiliary model
calls still consume session budget; accounting does not reserve future tokens
across overlapping requests. `tool.operation` reports start/settlement, and
`operationId` correlates tool calls, checks, results and usage in the journal.
Replay retains those audit records without rebuilding them as model tool groups.
Journal failure stops both lanes before further effects are admitted.

Cancelling the model turn leaves independent user operations active. Cancelling
an operation, unloading its calling plugin or closing the core cancels its work;
owned SDK subprocesses are drained before completion. Concurrent tools cannot
clear, restore or compact the shared conversation or start a second turn there.
The TUI cancels a plugin's independent operations when its last attached pane
closes via `[x]`, Alt+Q or Close. Other plugins and the main model remain active.
If another pane from that plugin remains attached, the surface's close handler
owns finer cancellation instead of the host cancelling every plugin operation.
Reload waits for all active operations. Trusted replacement services must uphold
these boundaries themselves, including cancellation and resource cleanup.

Trusted plugins use the same service chain as the defaults:

| Service | Replacement responsibility |
|---|---|
| `service.agent.run` | The prepared turn's model/tool orchestration algorithm |
| `service.agent.batch` | Scheduling tool calls, including bounded parallel execution |
| `service.agent.tools` | Effective tool definitions before each turn or interactive invocation |
| `service.agent.instructions` / `service.agent.finish` | Base instructions and completion policy |
| `service.context.prepare` | User-content preparation and attachments |
| `service.context.manage` | Context pressure management before a default model step |
| `service.context.compact` | Conversation compaction |
| `service.session.append` | Journal-event persistence |
| `service.model.stream` / `service.model.capabilities` | Model transport and capacity |
| `service.auth.login` / `service.auth.status` | Login and authentication status |
| `service.agent.clear` / `service.agent.compact` | Session controls exposed through `$` |

Declare provided service names in the manifest's `provides` list to select a
specific implementation using `serviceProviders`. Missing selected providers
raise an error. A failed explicitly selected provider is not silently replaced
by the built-in backend. Ordinary middleware faults continue downstream, using
an already started continuation rather than executing its effects again.

`service.agent.run` receives `{ turnId, context }`. `AgentTurnContext` is exported
from `@agent-compositor/core`. It exposes:

- snapshots of messages, tool declarations and the prepared request;
- `append` and `replace` for conversation state;
- `stream` through accounted, budgeted model transport;
- `execute` for a batch through the normal tool permission path;
- `publish` through assistant-text hooks, returning the transformed text for
  the strategy's accumulated answer;
- `manageContext`, `compact`, cancellation and configured step limits.

The host still prepares the prompt and emits turn lifecycle events. A strategy
returns `{ value: { text, error?, metadata?, usage? } }`; the host records the
final answer and completion/failure. For example, middleware can observe a
default turn without implementing its algorithm:

```ts
export const hooks = {
  "service.agent.run": async (event, $) => {
    const result = await $.next();
    // Inspect or transform the downstream TurnOutcome here.
    return result;
  },
};
```

Contexts are invocation-scoped capabilities, not JSONL or renderer payloads.
They reject calls after their turn ends or a hook times out. The host binds
their signal to the current hook as well as the turn. A custom strategy owns
its algorithm and must use the supplied signal and limits. It does not inherit
the default loop's retry or completion-check sequence automatically. Tool and
model calls made through the supplied capabilities retain permission and token
accounting. Turn usage is collected by the host, so a replacement strategy does
not need to reimplement usage totals for those calls. Direct host operations by
trusted JavaScript are not sandboxed.

`service.agent.batch` receives the pending calls and an `AgentToolBatchContext`.
Its `execute(call)` retains per-call permissions, accepts only this batch's IDs
and executes each ID at most once. For parallel scheduling, await all desired
`context.execute` promises. Unscheduled calls receive explicit error results;
started calls settle before another model request. This preserves tool/result
groups in the transcript. Ordinary tool-call middleware transformations are
applied before permission evaluation and actual execution.

## Middleware, ordering and extension events

`next()` supports both existing pass-through returns and awaited downstream
results. Generator output continues streaming while an outer hook awaits its
continuation. A wrapper failure after `next()` never replays the lower action.
Within a tier, optional manifest `priority` sorts lower numbers first; equal
priorities preserve registration order.

Budgets race uncooperative asynchronous hooks instead of only setting an abort
flag. Waiting on `next()` pauses the own-time budget. Expired invocations cannot
make further effects through the `$` API. JavaScript running synchronously in
the host cannot be forcibly preempted, and already-started external effects are
not rolled back. Tool implementations must cooperate with their supplied
signal. These mechanisms are not process isolation.

A native hooks module can export `events: EventDef[]` alongside `hooks`. Define
names under `plugin.<manifest-name>:<event>` using `defineEvent` and schemas.
Definitions are local to the runtime, validated before registration, and removed
on unload. Another runtime is unaffected. An extension cannot overwrite a host
event or claim another plugin's namespace. Hooks referring to another plugin's
events require that owner's definitions to be registered first.

Registration validates the whole contribution before exposing hooks, avoiding
orphan handlers from failed modules. Reload also validates the next composition
before replacing the active one. All changes to enablement/configuration still
use the existing reload/restart workflow; this is not a general live config
editor.

Rendering hooks cannot use mutation services, model calls or agent controls
through the public API. Render-only plugins cannot call non-UI mutation services
from other hooks either. Private forms retain their guarded host channel.
`await $.auth.status()` uses the replaceable service; synchronous field reads on
the returned handle retain the legacy host snapshot for source compatibility.

## Verification

Runtime/core tests exercise real middleware return flow, generator streaming,
uncooperative hook timeout, priority, atomic registration, event namespace
ownership, replacement strategies, parallel scheduling, permission checks,
accounting, context expiry and delegation with exact inherited tools.

The application integration tests load executable extensions from isolated disk
directories, replace a tool schema/handler and turn strategy, exclude unwanted
modules before import, run without coding capabilities, reload, resume, and
replace the standard login service. They do not implement or contact any
professional-domain API.

The installed-binary release smoke also loads an external extension, its private
event schema and exact tool set, executes its replacement turn strategy and
resumes its session with no fallback-model request and no Node/Bun on PATH.

The event catalog has a committed signature baseline for catalog 0.17. It checks
that existing schemas and aliases survive this additive extension; schema
changes need an explicit compatibility review. This conservative check does not
prove semantic compatibility of arbitrary plugin code.

The journal seam replaces event writes independently. The selected
`service.session.append` implementation must acknowledge a successful write with
`{value:true}`. A denial, fault or missing acknowledgement stops the core and
blocks further execution in that instance. Repair storage and reopen/resume the
session to continue. A core without a configured journal remains usable in memory.
Before the journal chain runs, the core snapshots each payload using JSON
serialization. Backends receive detached JSON records, including when a live
service input contains an AbortSignal; they do not receive live signals or
callable host capabilities. Hooks and execution retain their original inputs.
Serialization errors fail closed through the same journal failure path.
The default journal propagates creation and append failures; the default store
serializes concurrent appends within one store instance. This is not a cross-process
transaction or an exactly-once guarantee for external effects. Terminal success
is published to subscribers only after the journal acknowledges it; a storage
failure is still reported through the live failure channel.

The selected
`sessionProvider` replaces the assembled storage stack, including history and
resumption; `ui.controllers` replaces its UI controllers. Their contracts and
external-extension checks are documented in [ui-controllers.md](ui-controllers.md).

### Task state inputs and ownership

`task_plan` accepts `in_progress` as an alias for `running`, and `todo` accepts
`running` as an alias for `in_progress`. Each tool validates before normalizing
its owned output/storage representation; input arguments remain unchanged for
audit. Saved plans use `running`, Todo results use `in_progress`, and the frozen
`service.todo.update` schema remains canonical. Other unknown states are rejected,
and Todo does not gain the plan's `blocked` state. Both active plan spellings
remain unfinished in the completion policy.
Missing fields, duplicate IDs and unsupported plan states report the specific
`task_plan.tasks[index].field` rather than silently inventing values. Validation
failures do not overwrite the saved plan.

Default Todo memory is local to `registerDefaultResolvers`/AgentCore rather than
the JavaScript process. Separate cores and ephemeral task children therefore do
not share an implicit list. Custom service providers and the Todos plugin's
explicit persistence/restore behavior retain their existing scope and formats.

### Model-facing tool text

A successful `ToolResult` may include optional `modelText` alongside `data`.
Callers, UI observers and `tool.result.output` retain the structured data; the
model receives the explicit text. Empty/absent text uses the existing JSON
presentation, and failure results retain their actual error. Text is data, not
authorization or a replacement for verification evidence.

Built-in `read` uses this view for ordinary UTF-8 source: one JSON metadata block
contains the returned page's exact edit anchor, line count and truncation status, followed
by source with literal line breaks. It does not decode literal backslash escapes
or alter the file. LF/CRLF, tabs and Unicode remain intact. Source with terminal
control characters keeps the existing JSON-escaped view; binary rejection is
unchanged. Custom read providers without a string `content` retain their prior
representation.
Native reads page dense content before applying the general presentation bound;
follow `nextCursor` before `nextOffset` as described in
[read pagination](agent-features.md). Custom service content is paged by the tool
as well; incompatible whole-window edit anchors are omitted from partial pages.

Built-in `exec` and `exec_output` use a separate readable view when the result
has string stdout and stderr. A `Command metadata (JSON)` header contains `result`
(all non-stream fields) and `presentation.sanitized`; separate labeled stdout and
stderr bodies follow with literal line breaks. Terminal sequences are removed
from the display and remaining unsafe controls are visibly escaped. LF/CRLF,
tabs, Unicode and literal backslash sequences remain intact. Metadata JSON escapes
control characters without changing their decoded values. The streams are
untrusted process output, not instructions or guarded edit source.

Structured data, exit codes, running/done flags, job IDs, durations and truncation
fields remain unchanged for callers and verification. A nonzero process exit is
still a failed check even when the tool call itself returned data. Launch receipts
without streams and nonstandard results retain their JSON view; actual tool errors
retain their error path. Current command observations for compaction come from
structured host results, including during replay, rather than parsing displayed
logs. Unknown status cannot become success from a printed or overridden exit-code
string. Older message snapshots with no structured command observation retain
their existing legacy JSON fallback.

The 128 KiB UTF-8 model-result bound applies to both forms. Oversized text becomes
a bounded JSON preview explicitly marked incomplete, without a top-level edit
anchor. The exact bounded view is journaled in optional `tool.result.modelText`
(catalog 0.31) and restored on replay, which applies the same byte bound to
external records. Older records retain their existing reconstruction. Consumers
needing structured results should use `output`, rather than parse model prose.

### Repeated query recovery

The default loop tracks tools explicitly declaring `loopGuard: "query"` on their
`ToolSpec`. Built-in `read` and Callix `glob`/`grep` opt in. This declaration is for
finite read-only observations; omit it for polling, streaming and effects. It
does not grant permissions or enter the model's tool schema. Legacy unannotated
tools and selected replacement run strategies retain their behavior.

A model step containing only successful annotated queries is repeated when every
effective tool/argument/result observation is already in the recent window. Object
argument key order is ignored; paths are not rewritten. The window retains at most
256 observation hashes and compares the text actually visible to the model. No
result is cached or substituted: each permitted call still executes normally.
After three repeated steps, the model receives one recovery reminder for that
streak. Six repeated steps stop the turn with preserved progress and an error.
The first novel observation does not count toward those six steps. A new result
or query resets the repeated-step count; a non-query/failed step, new turn or user
steering resets the window too. Context replacement, including compaction, resets
it so a new context can reread prior evidence. Duplicate calls within one model batch count as
one step. Alternating previously observed queries can still form a repeated streak.

Configure the positive integer `agent.maxRepeatedQuerySteps`, or the equivalent
`AgentCoreOptions.maxRepeatedQuerySteps`, to change the default six-step ceiling.
Smaller ceilings may stop before the three-step reminder. Polling tools such as
`exec_output` remain unannotated. An extension selecting its own tool definitions
can omit the flag for a read used as a deliberate poll. This is bounded recovery
for repeated observations, not a semantic proof of task progress or correctness.

### Coding completion checks

With `agent.instructionsPreset: "coding"`, the default completion policy asks for
verification after successful built-in `write`/`edit` calls even when no task plan
was saved. General instructions retain their prior plan/explicit-verification
behavior. `agent.verifyCompletion: false` still disables these default checks;
an explicitly selected `service.agent.finish` provider can replace the policy.

If every attempted built-in write or edit failed in the turn, the completion
policy requests a correction or a report explaining the outcome with
`[no file changes]`. A permission refusal stays binding. If a separate tool
made a change, identify that tool and its evidence in the report. The marker
describes the failed write/edit attempts. It does not certify the report or
substitute for running a check.

A recognized check must follow the latest successful built-in edit. Foreground
`exec` and configured `project_check` runs require exit code zero. Common check
names include test, typecheck, check, checks (including `node checks.mjs`), lint,
build, verify, pytest, vitest and ci.
Starting a background shell is insufficient: a matching later `exec_output` must
report `done: true` and exit code zero, without successful cancellation. Read the
actual terminal result before reporting that a background check passed.

Recognized check attempts that were not refused by permission policy remain
verification obligations throughout the current turn, including attempts before
the latest edit. Each needs a current successful result after that edit. Editing
does not erase an earlier failed check or make an earlier pass fresh; passing a
different check does not clear it. Check identity uses the tool, exact trimmed command or configured
check name, and explicit working-directory argument. A successful rerun of the
same check resolves its failure. Background attempts remain unresolved while
running or cancelled; observations from an older attempt cannot replace a newer
result. A background attempt started before the latest edit remains stale even if
its output arrives afterwards. This does not infer equivalence between differently
written commands or prove that the recognized command tests the right behavior.

Permission refusal is not an executed failing check. The core preserves optional
`denied: true` on the tool records passed to `service.agent.finish` (catalog 0.29);
older records may omit it. A refusal-only check from before the latest edit does
not itself create an old execution obligation. It also cannot erase a prior
non-refused attempt of that check. When an unresolved verification call was refused,
the default completion feedback explicitly forbids rerunning
that call or bypassing the refusal. Independently authorized checks can supply
additional evidence, but do not turn the refused check into a pass. Explain the
remaining limitation with `[verification unavailable]` rather than claiming all
checks passed. Execution failures without refusal retain the usual repair and
authorized rerun guidance.

The existing bounded completion-feedback loop remains in force; repeated missing
verification leaves the turn failed with saved progress. A concrete reason with
`[verification unavailable]` or `[checks not applicable]` still reports a genuine
limitation. This policy is a reminder based on recorded tool evidence, not proof
that an arbitrary command or model assertion establishes project correctness.
Independent acceptance tests remain necessary.
