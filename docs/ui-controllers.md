# Private UI controllers and session repositories

The assembled terminal host can select implementations for the editor, approvals,
questions, local forms, placement settings and history. These are behavior
replacements: rendering, input, state and teardown belong to the controller.
The compositor retains window geometry, focus routing, workspaces and drag/resize.
Existing `ui.render` and appearance hooks continue to customize portable views
and decoration.

## Selection and modules

A trusted native plugin exports a named `controllers` factory map from its main
module. It can export controllers without exporting hooks. Selection is explicit:

```json
{
  "enabledPlugins": ["workspace-ui", "conversation-store", "session-manager"],
  "ui": {
    "controllers": {
      "editor": "workspace-ui",
      "approval": "workspace-ui",
      "question": "workspace-ui",
      "form": "workspace-ui",
      "placement": "workspace-ui",
      "history": "workspace-ui"
    }
  },
  "sessionProvider": "conversation-store"
}
```

Omitted entries use the standard implementation through the same controller
registry. A missing or failed explicit selection does not silently select the
standard behavior. An unavailable editor shows an error; unavailable approvals
deny, forms cancel and questions reject. The selected plugin must be enabled.
The standard `/history`, `/sessions`, `/resume`, rename, archive and fork command
entry points belong to `session-manager`; a composition may omit that contribution
and supply its own commands instead.

The configured [OpenTUI frontend](02-ui.md#experimental-opentui-application-frontend)
supports selected editors in Main and selected approval, question and private-form
controllers in Main and independent request windows. Only their validated views/cells reach the renderer;
the original private request is not attached as hidden native fallback data.
Selected history and placement controllers still fail before startup;
they are not silently replaced. Full controller adaptation remains a migration gate. The host can
inspect selection through `core.host.controllers.selectedOwner(kind)`, which
returns metadata without creating a controller or receiving private input.

Controller selection is partial. For example, with an enabled `workspace-ui`
plugin, `"ui": {"controllers": {"form": "workspace-ui"}}` replaces only local
forms; every omitted kind keeps its host implementation. Unknown kinds and
empty provider names remain configuration errors.

`UiControllerFactory`, `UiController`, `UiControllerInput`, `UiEditorState` and
`UiEditorIntent` are exported by `@agent-compositor/hooks`.
`AppUiControllerData`, `UiApprovalResult` and `UiHistoryIntent` from
`@agent-compositor/app` describe this host's private requests and results.

```ts
export const controllers = {
  editor: ({ state }, { signal, invalidate }) => {
    let text = state?.text ?? "";
    return {
      snapshot: () => ({ text, cursor: text.length }),
      preferredRows: () => 3,
      render: () => ({
        hint: "F2 sends",
        lines: [{ text: "Workspace input", bold: true }, { text }],
      }),
      handle(input) {
        signal.throwIfAborted();
        if (input.kind === "text") text += input.text;
        if (input.kind === "key" && input.key === "f2") {
          const submitted = text;
          text = "";
          return { type: "submit", text: submitted };
        }
      },
      dispose() { text = ""; },
    };
  },
};
```

A factory receives `{kind, data, state?}` and `{signal, invalidate()}`. Creation
and `render({columns, rows})` are synchronous. Views use `UiTextView`; direct
terminal controllers can additionally provide validated protocol cells per line.
`preferredRows(columns, maxRows)` requests bounded space. `pointer(row, col)`
returns a local `default`, `pointer` or `text` hint. Rendering and measurement
are pure: mutation services, state writes and recursive invalidation are rejected.
The renderer executes no plugin code and receives only protocol frames/cells.

`handle(input)` may return a promise. Extension inputs are serialized, rejected
on disposal, and late results cannot submit or settle another request. Controllers
must cooperate with the supplied signal for work they start; synchronous JS
cannot be preempted, and already-started effects are not undone. The private
controller channel has no automatic hook timeout; the selected implementation
owns its input algorithm. Unload, replacement, UI close and session transitions
clean up leases. A valid editor snapshot is retained before disposal so a reload
can pass the draft to the next instance, even when disposal erases local state.
Configuration selection follows existing restart behavior; `/reload` reloads
implementations under the current configuration.

Approval and question controllers occupy the input dock rather than locking
other windows. Their keyboard input is routed when the dock has focus; mouse
input outside the dock can focus and operate other panes and the toolbar. A
settings form may coexist in the main area. The agent remains suspended until
the dock receives an answer, denial or cancellation.

## Requests and results

| Kind | Private data | Result from `handle` |
|---|---|---|
| `editor` | Session ID, command discovery, optional file discovery; `state` is `{text,cursor}` | `{type:'submit'|'steer',text}`, `{type:'interrupt'}` or `{type:'scroll',rows}` |
| `approval` | Tool identity, descriptor and reason | `{allow:boolean,scope?:'once'|'session'|'project'}` |
| `question` | Question/options or questionnaire with stable question IDs | `{answer: UserQuestionAnswer}` or `'cancel'` |
| `form` | Validated `UiForm` declaration | `UiFormResult` or `'cancel'` |
| `placement` | `windows()`, `anchors()`, async `apply(id,placement,save?)` | `'close'`; placement changes use `apply` |
| `history` | Session ID/query, async `control(action,args)`, local `form(request)` | `'close'` or `{type:'resume',id,name?}` |

No result means the interaction continues. Editor and dialog text/key input is
routed to the active controller; mouse coordinates are local to its content.
Placement retains the panel's full frame coordinate convention. Fixed tiling
shortcuts remain routed by the host. Raw terminal function keys F1–F12, including
modifiers, pass through the reference renderer instead of being discarded by
Ink's text-input adapter.

In OpenTUI Main, selected private requests start in Draft mode. **Alt+I** or the
**Answer/Draft** button switches
between their input and the resident message draft, preserving the draft
and its cursor. A separate request window gives input to its selected controller
when that window is focused. Closing a window only hides the live lease; Windows
reopens it with controller-owned state. The host reserves
**Alt+W Arrange**, **Alt+0 Main**, spatial/workspace shortcuts and **Ctrl+C**
cancellation before controller input. **F2** reaches a selected editor only while
its available Draft owns focused Main in normal mode. In Answer mode, another
window, Finder, Arrange or an unavailable editor, **F2 Windows** remains a host
control. **Alt+W**, then **W**, and the Windows button always remain available.
Other unreserved function keys reach the selected controller only while it owns
input. Selected request controllers retain host F2 precedence.
A selected local form in Main does not block a new ordinary message from Draft
mode while the agent is idle. The form remains pending during that model turn.
Selected questions and approvals still require their own answer or decision.

OpenTUI keeps the selected editor's factory, command/file discovery capabilities
and `{text,cursor}` checkpoint inside the host. The cursor is a UTF-16 offset;
it is not a native textarea's display-cell offset. Only its rendered view and
bounded input/admission receipts reach the frontend. The native composer stays
parked, and an unavailable selected editor shows a constant error instead of
accepting native input. Window navigation remains usable.

Editor input is serialized through handling, admission and recovery. Busy submit
and steer intents retain Core's queue semantics without answering a pending
question. The host shows Accepted or Queued once ownership is taken. A genuine
pre-admission rejection restores the visible pre-input draft and cursor before
later admitted editor inputs run. An accepted prompt hook, command or model
failure does not restore the cleared draft or resubmit it. See
[Core input admission](core-customization.md) for the separate admission
and completion receipts. Reload and interactive session resume retain a validated
checkpoint before disposal. Old-generation handles and asynchronous capabilities
cannot submit into the replacement Core. Unsent drafts do not survive process
exit. Editor scroll intents scroll the transcript without changing window focus.

Controller lines occupy individual clipped terminal rows; optional validated
cells preserve their colors and text attributes, including wide characters.
The controller receives local content coordinates and actual viewport dimensions;
its hint occupies a separate host row. Portable action rows, tabs and table rows
send declared action IDs; a declared input uses the semantic change channel.
Raw key, text and bracketed-paste input otherwise goes directly to the lease.
Optional controller pointer-shape hints are not yet projected by this frontend;
native window-navigation pointers remain host-owned.
The host checks request identity and the displayed revision before admitting a
mouse/action input. Already admitted asynchronous inputs remain serialized when
the controller invalidates its own view. A later navigation action can suppress
continuation autofocus without discarding the admitted answer.

History uses semantic `{kind:'action',action}` and
`{kind:'change',id,value}` inputs from portable view actions and input fields.
It receives `open` after creation. `control` supports `list` (search and archived
filter), `rename`, `fork`, `archive` and `unarchive`. Resume is an explicit returned
intent so the host can close the old pane before changing the UI subscription.
The history controller owns selection, filtering, paging and presentation.

Requests, drafts and local form results travel directly to the selected factory;
they are not broadcast catalog payloads. Editor and form rendering bypasses
unrelated `ui.render` hooks. The wire necessarily contains the visible editor
text; a password controller must render a mask. The host validates form field
IDs/types, required values, select values and HTTP(S) URL fields before resolving
the requester. Approval results require a boolean decision and a recognized
scope; malformed results deny. Question results still pass through the normal
questionnaire validation in core. Existing permission policy remains binding.

Custom host form handlers can reuse
`validateUiFormResult(request, value)` from `@agent-compositor/events`. It returns
only declared fields after validating the action, field types, required values,
select membership and HTTP(S) URLs. Validation errors contain no submitted values.
The OpenTUI private adapter gives the selected factory a detached request copy;
its result validation retains the originally admitted declaration and question
choices, even if the factory or requester later mutates its own copy.
`core.host.setFormHandler(handler)` returns a disposer that clears the handler
only while that binding is still current. Disposing a superseded binding does
not clear or later revive another owner's handler.

Native form views treat a declared action with ID `cancel` as cancellation:
it returns `null` without collecting or validating fields. Escape and the host's
Cancel control have the same result. Other actions require a valid form result.

Trusted plugins can also call
`$.ui.controller(kind, data, fallback, invalidate, state?)` to select a private
controller for their own workflow. Those leases are revoked with both the
requesting plugin and the selected provider. This API and `$.ui.form` are private
host capabilities rather than events. Trusted JavaScript runs in-process;
these privacy boundaries are API routing guarantees, not an OS sandbox.

## Complete session storage replacement

A trusted native module can export:

```ts
export async function sessionRepository({
  cwd, sessionsRoot, stateRoot, signal, config,
}) {
  // Open the chosen backend and return the complete SessionRepository interface.
  return repository;
}
```

`SessionRepository`, `SessionRepositoryContext` and `SessionRepositoryFactory`
are public exports of `@agent-compositor/session`. The interface is structural:
no inheritance from `SessionStore`, filesystem directory or JSONL file is needed.
It requires `create`, `append`, `load`, `list`, `search`, `findByPrefix`, `fork`,
`rename`, `archive`, `unarchive` and `remove`. Optional `dispose` releases resources;
optional `root` supports callers that explicitly need a local path. A backend
without `root` works in the assembled application. Preserve session metadata,
ordered replay events, project scoping and supplied search cancellation.

`sessionProvider` selects one plugin's factory before startup resumption. The
same stable repository router serves journaling, the history services, interactive
resume, headless `--resume` and independent-agent restoration. The normal local
store is the default. Backend failures propagate instead of reading unrelated
local history. The existing `service.session.append` seam can independently
replace journal behavior; a composition selecting it must keep its writes and
chosen repository consistent.

Reload gates new storage calls, drains in-flight operations, opens the candidate
backend, validates/replaces the core contribution and commits the backend.
Initialization/validation failures retain the current repository. Retired
backends are disposed; cleanup errors are recorded in the router's
`cleanupErrors` without reverting an already committed backend. Application close
drains writes and disposes once. Changing provider does not migrate records:
remote concurrency, transactions, credentials and migrations belong to that
backend. General plugin settings and agent-window bookkeeping still use the
separate configuration/storage services.

## Verification

`packages/app/test/controllers.test.ts` loads the external test-only module in
`tools/visual/controller-plugin`, replaces behavior and storage, checks private
input, unload cancellation, reload draft preservation and startup/interactive
resume. Hooks and session package tests cover routing, pure rendering, async
cancellation, in-flight write draining and failed replacement.

`npm run visual:controllers` drives the actual PTY with F2/F3/F4/F5, checks
approvals/questions, masked forms, placement settings, custom history search and
resumption after process restart at 60 columns. `VISUAL_EXECUTABLE` selects a
built distribution. It uses fake credentials and a scripted/loopback model.
The fixture repository is test evidence, not a production storage implementation.
Standard placement/settings/question/history scenarios remain regression checks.
