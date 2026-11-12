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

The `agent-harness` contribution now defaults to domain-independent instructions.
`agent.instructionsPreset: "coding"` explicitly selects the former coding
instructions. `agent.instructions` or private `behavior.json` instructions can
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

`AgentCoreOptions.userCommands` supplies the currently loaded immediate user
controls. `submit` and `steer` dispatch them outside the prompt queue;
`invokeCommand` explicitly attempts this path and returns false if unregistered.
Owner cancellation, auxiliary usage accounting and teardown remain independent
of the active turn. See the [command contract](plugin-standard.md#immediate-user-commands).

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
Summarizer callbacks also receive optional `ctx.userRequest`, the latest user
message's text supplied separately from the messages being folded. Existing
callbacks can ignore it. The default model summarizer includes that exact text
as a labeled reference in every segment and merge request, including when the
user message is pinned outside the folded history. It distinguishes the request
from examples, scaffolds and earlier assistant proposals instead of inferring
that the task or its authorization is missing from a partial segment. This is
context for summarization, not a new tool-execution instruction.
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
