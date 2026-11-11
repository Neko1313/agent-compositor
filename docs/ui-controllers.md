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
