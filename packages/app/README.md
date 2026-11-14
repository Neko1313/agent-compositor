# compositor

The assembled agent: config → provider → disk plugins → session store → REPL.
This is the sway-analog entrypoint the libraries exist for — behavior is
composed from plugins riding the event chain, not hardcoded in the loop.

## Run

See [the agent features guide](../../docs/agent-features.md) for auto review,
worktree agents, code/conversation checkpoints, web, credentials, quotas and
extension installation.

```bash
# from source (bun resolves the workspace TS directly)
npm run start -w @agent-compositor/app

# or compile the default Ink frontend as a single binary
npm run build:binary -w @agent-compositor/app
./dist/compositor --plugins ./plugins
```

For native OpenTUI, use `npm run build:release` from the repository root and
keep the complete archive together. Its renderer, native library and parser
assets live beside the executable.

## Plugins start off

The default repository marketplace ships offline. `/marketplace` browses it;
installation leaves a package inactive and pins its version separately from the
app. Install in the chosen scope first, then use `/extensions enable NAME --project`
or `--user`, then `/reload`. Project decisions override user defaults. Discovery
and `--plugins` do not activate code. See [the standard](../../docs/plugin-standard.md)
for compatibility, tests, versions, updates and rollback.

## Flags

```
compositor [--plugins dir ...] [--resume [ID]] [--history] [--cwd dir] [--plain] [--renderer ink|opentui]
```

- `--plugins dir` — extra plugin directory (repeatable). Convention dirs
  (`~/.agent-compositor/plugins`, `./plugins`) are always scanned.
- `--resume id` — replay a persisted session's event roll and continue it.
- `--resume` / `--history` — open interactive chat history at startup.
- `/history`, `/sessions`, bare `/resume` — search saved chats by title, ID or conversation text; preview, rename and resume with keyboard or mouse.
- `--cwd dir` — project root for config discovery and session storage.

## Provider

Env wins over config:

| env | config fallback | default |
|---|---|---|
| `AGENT_BASE_URL` | `providers.default.baseUrl` | `http://127.0.0.1:11434/v1` (ollama) |
| `AGENT_API_KEY` | `providers.default.apiKey` | `ollama` |
| `AGENT_MODEL` | `model` | `gemma4:31b-cloud` |

## A plugin in one minute

```bash
mkdir -p plugins/hello
cat > plugins/hello/plugin.json <<'JSON'
{ "name": "hello", "version": "1.0.0", "trust": "trusted" }
JSON
cat > plugins/hello/hooks.ts <<'TS'
export default {
  "tool.call": async (event: { tool: string; input: unknown }) =>
    event.tool === "exec"
      ? { result: { stdout: "answered by plugin", exitCode: 0 } }
      : undefined, // not ours — pass through
};
TS
```

The plugin's `{result}` short-circuits the call: the builtin exec resolver
never runs. `deny: "reason"` refuses instead. Anything else (or `undefined`)
falls through to the next chain handler. See `examples/plugins/hello` for
the fuller version (destructive-command refusal included).

## Interactive UI

In a terminal, the app starts the Ink UI automatically. The core-side
`AppUI` controller exchanges versioned protocol messages with the renderer:
hello/ack, declare, render, focus, input and bye. The renderer has no access
to the agent state. Resizing reflows the visible conversation.

- Enter submits a message or queues it while the agent is working.
- Tab injects a steering message at the next model step.
- Left/Right, Home/End, Backspace/Delete edit the input. The default message
  editor and text, URL and password form fields move over and remove complete
  Unicode graphemes, including emoji sequences, flags and combining accents.
  Form values keep their 4096 UTF-16-unit limit without retaining a partial
  grapheme; passwords stay masked. Public editor cursor offsets remain UTF-16
  indices.
- PageUp/PageDown scroll the conversation.
- Y/N answers tool permission requests (once per call).
- Ctrl+C interrupts work; when idle it exits.
- `/reload` reloads disk plugins between turns, resetting plugin state.

Settings → Models & providers (`/model`) includes a Reasoning action per profile.
Choose the model's supported effort and save it for this project or all projects;
Provider default clears the explicit setting. It applies to subsequent requests
and survives restart. See [reasoning effort](../../docs/state-and-network.md#reasoning-effort)
for protocol support and configuration precedence.

`--plain` forces the legacy line-oriented REPL; redirected input also uses
that mode. It is retained for existing scripts and does not use the grid
protocol. The interactive UI is the protocol-based product path.
Session startup hooks run once before line input is processed, including an
immediate EOF. An empty input stream does not submit a model prompt.

In plain mode, Enter queues a new task and Tab steers the current turn. Registered
immediate controls run independently while the model is busy, including commands
in a pasted input block. Commands before a prompt finish their setup before that
prompt starts; controls can still run concurrently with one another. EOF waits
for accepted model work and commands. Ctrl+C interrupts active work or exits when
idle. Command failures are printed and do not discard subsequent input.

Plain command notifications are visible. For `-p` immediate commands, the command
owner's notifications become the text/JSON response, auxiliary model tokens appear
in `usage`, and error notifications produce a nonzero exit status. Startup and
other plugins' notifications are not substituted for that command result.

Interactive permission/question answers use a separate input buffer and never
become model prompts. Piped plain input cannot grant interactive permission:
configure scoped rules or opt into automatic review for authorized unattended
work. EOF or cancellation denies unanswered requests. UTF-8 split across input
chunks and grapheme deletion are preserved.

## App configuration

Fresh interactive launches without explicit model settings offer **Get started**.
The optional `/setup` guide helps select or create a provider, choose tools, apply
plugin changes and return to the conversation. **Settings → Setup guide** opens
it without replacing the message draft. The guide uses existing private provider
storage and the normal plugin installer/activation rules; displaying it does not
query a model or install anything. Skip is stored in private user `setup.json`.
It is not offered automatically for plain/headless execution or explicit resume,
and it respects `enabledPlugins`/`disabledPlugins` for the `setup-guide` host
component. There is no embedded inference model in this implementation.

The short connection editor has five fields, with the full editor behind
**Advanced settings**. Optional plugin choices do not disable existing plugins or
replace installed pins. Installation can need network access; failures are shown.
New activation requires **Apply plugin changes**, which uses the ordinary deferred
reload path while another agent is running. See [first-run setup](../../docs/getting-started.md).

```json
{
  "permissions": {
    "rules": [{ "tool": "exec", "command": "git status*", "decision": "allow" }]
  },
  "compaction": { "enabled": true, "contextWindow": 32768 },
  "skills": ["./team-skills"]
}
```

Compaction is enabled by default. Context capacity comes from the selected model's
metadata or explicit profile settings, with a marked 32768-token fallback.
`/compact` (from the enabled session-ctl plugin) summarizes older messages through
the configured provider, preserving the system prompt and recent tail.
The persisted compaction snapshot restores that same tail on resume.

Skills are discovered in `.agent-compositor/skills`, configured directories,
`~/.agent-compositor/skills`, `~/.claude/skills`, and `~/.cursor/skills`, in
that priority order. The model receives a compact index and can use the
`skills` tool to load a full body through `service.skills.load`.

Plugin loading is shared with `@agent-compositor/loader`, including manifest
validation and cache-busted imports. `hooks.ts`, index entries, default hook
records and named `hooks` exports are supported. In the app, workspace/extra
directories override global directories. Sandboxed plugins are rejected
before importing their code until an explicit language host is available.
Monty is the default replaceable backend for generated Python and workflows;
it does not execute TypeScript plugin modules or legacy JavaScript workflows.
See [sandbox setup and limits](../../plugins/monty/README.md).

The default `callix` plugin uses a native binary for code graph navigation.
See [installation and provider replacement](../../plugins/callix/README.md).

## Experimental OpenTUI frontend

`compositor --renderer opentui` opens the configured application with native
OpenTUI editors, questions and plugin views. From source use
`bun packages/app/src/bin.ts --renderer opentui`. Providers, private credentials,
session resume and plugin management use the same services as the default Ink
frontend. Settings forms run in separate windows while Main remains active or
waits for a human answer. This is distinct from `npm run opentui:preview`, which
uses isolated deterministic demonstration sessions.

See the [application frontend guide](../../docs/02-ui.md#experimental-opentui-application-frontend)
for controls, private-form behavior and current migration limits. Its stable
Alt+W Arrange, F2 Windows and Alt+0 Main controls retain resident native editors
while windows move, close or change workspace. Search includes current forms and
declared plugin UI routes; it stays outside model messages and journals.
The leading workspace bar marks occupied spaces with `*`; the window strip shows
only open windows on the current workspace. F2 also restores closed windows and
finds windows on other workspaces.
Arrange names and highlights the selected split, with its saved proportions and
the side `+` grows. Hidden targets retain an explanatory status.
In this OpenTUI Arrange mode, Ctrl+arrows retile the focused window at the same
edge of its directional neighbor, creating a nested split as needed. The moved
window keeps focus and a successful move exits zoom; no neighbor means no change.
Shift+direction swaps windows. Ctrl+arrows keep native editing behavior outside
Arrange, and held keys do not repeat a retile.
Manual approvals, questions and forms from UI tools have private request windows.
Retained background requests stay independent of their launcher and Main; F2
reopens a hidden request with its native field state. Ctrl+C in a request window
denies/cancels that request. The ordinary permission pipeline still applies.
Selected approval, question and form controllers also use these windows.
In Main, Alt+I switches their input with the parked native draft; separate
focused request windows give input directly to the controller. Selected editors
also retain their own view, draft and bindings, including F2 while an available
focused Draft owns Main. Alt+W, then W, or the Windows button opens navigation;
F2 Windows applies in Answer mode and other windows. Input shows Accepted or
Queued only after host/Core ownership, and rejection restores the visible draft.
Reload and session resume preserve its private UTF-16 checkpoint. Selected
history and placement controllers also open private independent windows.
History browsing runs while Main waits; mutations/resume retain normal readiness
checks. Arrange close hides their state, while Ctrl+C closes/cancels the selected
controller. Their old capabilities expire on unload, reload and session changes.
Ctrl+C in an immediate-command window cancels that command and its foreground
tools or auxiliary model call, preserving Main and neighboring command windows.
Explicit background work keeps its own lifetime; closing a window hides it.
Ink remains the default; the following detailed controls describe that frontend.
`--renderer` requires a TTY and is not accepted with `--plain` or `--prompt`.

## Tiling windows

The terminal UI uses a binary container tree. Conversation starts in the main
area; Tools opens on demand. Windows can be nested, resized, moved and closed. A
focused window has an accent border. Message input stays in a dock and only
receives typing when focused. Conversation views share the current agent
session; creating a view does not spawn another agent. Scroll positions
belong to individual windows. The application persists supported layout state
and independent-agent metadata in project-scoped private storage for restart.

Click **[Arrange]** or press **Alt+w** to enter **WINDOW MODE**. The dock shows
the focused window, workspace and controls. Bare keys arrange windows while
the message draft and cursor remain untouched:

| Key in WINDOW MODE | Action |
| --- | --- |
| h/j/k/l or arrows | Focus left/down/up/right, including collapsed windows |
| Shift + direction | Swap the focused window with its directional neighbor |
| Tab / Shift+Tab | Cycle content windows forward/backward |
| b / v | Set the nearest split and next opening to columns / rows |
| + / - | Grow / shrink the focused window's nearest split |
| 1…9 | Switch workspace |
| Shift+1…9 | Move the focused window to that workspace and follow it |
| f / q | Toggle fullscreen / close the focused window |
| w | Open the window finder |
| i / Alt+i | Leave the mode and return to message input |
| Escape / Enter / Ctrl+C | Leave the mode, retaining the selected window |

**Alt+w** toggles back to message input. In this mode Enter does not submit a
prompt, answer a question or decide an approval; Ctrl+C leaves the mode without
interrupting the agent. Mouse titles, separators and workspace controls still
arrange windows. Clicking the message dock returns to input. Finish or cancel a
private settings form or placement editor before entering window mode.

Click **[Windows]**, press **F2** with the default editor, or submit **/windows**
to open the window finder. Type to filter; Up/Down or Page Up/Down selects an
entry, and Enter or a click opens it. **WS N** identifies an existing window's
workspace; **Closed** identifies a retained view or an available plugin UI route.
The finder follows existing windows across workspaces and reopens a retained
conversation with the same window ID, transcript and unsent draft. Available
plugin commands use their normal UI route, without entering the model queue.
Escape restores the previous focus and exact draft cursor. The finder does not
make model decisions or send model requests. Private prompts remain pending.

Selected custom editor, question, approval and form controllers retain their own
F2 binding while they own input; **Alt+w**, then **w**, and the toolbar remain
host window controls outside a form. Alt+Tab is also accepted when delivered
by the terminal, but desktop window managers commonly reserve that combination.
Bracketed paste is marked separately: pasting a single `q` in window mode cannot
close a window. Unsent drafts remain in memory and do not survive process exit.

`/chat` returns to an existing main conversation window on its workspace or
restores it after closing. Repeated calls do not create duplicates. Alt+Enter
or Alt+s can also open a conversation view without submitting the message draft.
Closing a conversation window leaves the running model, transcript and draft
intact; when no conversation is visible, the footer shows the recovery shortcut.

`/agents` is an immediate user command: it opens a live expandable overview while
the main model works, without entering its prompt queue. Subcommands keep the
ordinary tool permissions. The overview shows Agent, State and Tokens used. Click
a row or use Up/Down and Enter to inspect its workspace, limits, failures and
the last twelve turn/tool activity events in this process. **All**, **Running**
and **Attention** tabs show current counts; Left/Right switches tabs in the
focused pane. Attention includes interrupted or failed agents. **Open conversation** enters the agent's own Reply
field. Updates do not queue behind the main model. Narrow panes stack fields;
use Alt+f for a full-width table. Earlier messages remain in the saved conversation.

Each agent conversation has **Overview** and agent-name tabs. Click a name or
use Left/Right to focus its existing pane; each agent keeps its own Reply draft
and transcript. Enter or **Send message** sends the current Reply draft.
PageUp/PageDown scroll history. With more than eleven active agents, **Previous
agents** / **Next agents** (Ctrl+p / Ctrl+n) open the first agent in the adjacent
group. Closing a pane preserves its draft within the process; restarting restores
the selected pane and committed messages, but not unsent drafts. Archiving removes
the agent's pane and tab while retaining its files and saved conversation.

**Saved activity** opens an agent's persisted prompts, turn events and tool
calls/results. Filter with All/Turns/Tools, expand records with mouse or keyboard,
and inspect arguments, output or failures. The view starts on the newest page
of 25 records; Previous/Next records reach earlier/later pages. Long records have
Previous/Next part controls. Refresh history reads the latest saved snapshot.
History survives restart and uses the configured session backend without a model
request. PageUp/PageDown scroll; Open conversation returns to the agent's Reply.

With the `resources` plugin enabled, `/resources` opens process CPU and memory
charts without involving the agent. The window updates while the main model
works; CPU/Memory tabs, Pause/Resume, Sample now and Clear history are local UI
controls. Sampling stops when hidden or closed. CPU 100% means one core; RSS/heap
cover this process, including in-process agents, and exclude child shell processes.
History is bounded and starts fresh after restart. See the
[plugin guide](../../plugins/resources/README.md) for limits.

With `btw` and `agent-hub` enabled, `/btw <question>` opens an independent agent
while the main turn continues. Type follow-ups in its Reply field; Enter sends
and Ctrl+C in that pane stops only that agent. Alt+i returns to the main message
editor, and `/chat` restores its conversation window. `/btw` reopens the last
side conversation for this project after closure or restart. Pane drafts survive
closure within the process; only committed messages survive restart. These agents
share the project workspace and ordinary permission rules. The previous isolated
notification is available as `/btw --once <question>`. Opening a side conversation
requires catalog 0.26 or later.

Closing a plugin pane with its titlebar `[x]`, Alt+Q or its Close action sends
`ui.press` with `key: "close"` to that surface. If it was the plugin's last
attached pane, the host also cancels that plugin's independent user tool
operations; those operations finish only after their ordinary cleanup. Other plugins and the main model
continue; the message draft and queued prompts are preserved. Closing one of
several panes from the same plugin leaves its other operations active; the plugin
can cancel a surface-specific task in its close handler. Late publications do not
reopen a closed pane. An explicit command or action for that plugin allows its
views to open again. Unloading the plugin clears these dismissal records.

Plugin views scroll with the mouse wheel. PageUp/PageDown scroll ordinary text
views; editable views may explicitly opt into host scrolling. For example,
`/test-report` keeps its path field and scrolls long diagnostics with these keys.
The overflow footer advertises host page keys only when the host owns them.

On macOS, configure your terminal's Option key as Meta to use the Alt shortcuts.

| Shortcut | Action |
|---|---|
| Alt+h/j/k/l or Alt+arrows | Focus in a direction |
| Alt+Shift+direction | Swap window with its directional neighbour |
| Alt+b / Alt+v | Choose horizontal / vertical split for the next window |
| Alt+Enter or Alt+s | Open another conversation view |
| Alt+t | Open tools view |
| Alt+q | Close focused window; collapse its empty container |
| Alt+= / Alt+- | Grow / shrink the nearest split |
| Alt+f | Toggle focused window fullscreen (input/status remain docked) |
| Alt+1..9 | Switch workspace |
| Alt+Shift+1..9 | Move focused window to workspace and follow it |
| Alt+i | Focus message input |
| Alt+o | Open plugin management, including while the agent is working or awaiting an answer |
| Alt+, | Open settings without replacing the message draft or answering a pending question |
| Alt+? | Open shortcut reference |
| Escape | Focus first window |

Alt is used because terminal apps cannot reliably receive Super. Some
terminal/desktop shortcuts may need remapping to pass Alt combinations.
Small terminals display the focused branch when a split cannot fit.
The plugin and settings shortcuts remain available when the status-bar buttons
cannot fit. Alt+i returns to the message or pending agent interaction. An open
settings form retains its own keyboard controls until submitted or cancelled.
On short terminals, a pending question or approval collapses to a reminder while
another pane has focus, leaving room for management. Alt+i or a click on the
reminder restores the full dialog; that click never submits an answer or grants
permission. Reopening management focuses its existing pane, including on another
workspace, without moving its saved placement.

Plugins can publish an inert text window from a hook:

```ts
await $.ui.surface("tasks", "Tasks", "Build: running\nTests: pending");
```

Repeating the same id updates its content; it retains its workspace and
placement. Plugin ids are namespaced. Input in a focused plugin window is
emitted as `ui.press` with its surface id as `site`. Placement, splitting,
focus and workspaces belong to the compositor, never to plugin code.
The protocol's new `layout` message carries resolved rectangles; peers
advertise `Layout` in their element capabilities. Older peers receive the
existing sequential surface stream.


Mouse focus is enabled automatically in an interactive TTY with SGR mouse
support. Left-click a window (including its border) to focus it; click the
message dock to type. Wheel up/down scrolls the window under the pointer.
Permission prompts retain focus until answered. Mouse reporting is disabled
on exit and the previous terminal screen is restored. Hold Shift to use the
terminal's native text selection in terminals that support that override.

Click a workspace number in the bottom bar to switch to it. Empty workspaces
start with no windows; use Alt+Enter or Alt+t to open a view there.


## Slash command suggestions

Type `/` in the message dock to see commands declared by loaded plugins.
Continue typing to filter by prefix. Up/Down selects a command; Tab or
Enter completes the selection. Press Enter again to execute a completed
command. Exact commands can be submitted directly. Escape hides the list;
clicking a suggestion completes it. Normal Tab steering is unchanged outside
the command list. `/reload` refreshes command metadata along with plugins.

Declare commands in `plugin.json` to make your plugin discoverable:

```json
{
  "name": "example", "version": "1.0.0", "trust": "trusted",
  "commands": [{ "name": "/example", "description": "Run an example", "usage": "/example <argument>" }]
}
```

By default the declaration supplies discovery metadata and the plugin handles
execution in `prompt.submit`. An explicit `execution: "immediate"` instead
dispatches `command.invoke` without a model turn or implied panel. See the
[command contract](../../docs/plugin-standard.md#immediate-user-commands).

## Placement rules for plugin windows

A plugin may request a named site when publishing a surface:

```ts
await $.ui.surface("usage", "Usage", "Tokens: 12 400", {
  site: "sidebar", size: 0.25, focus: false
});
```

Sites are compositor-managed tiling positions:

- `split`: split the focused window, using the current split direction.
- `sidebar`: split the workspace at the right edge.
- `inspector`: split below `relativeTo` (defaults to `session` when present).
- `status-bar`: split a strip below the workspace's windows. This remains a
  movable plugin window; it does not replace the app's docked system bar.

`size` is the new window's fraction of the target region (0.1–0.8).
`workspace` selects 1–9. Named sites open in the background by default;
`split` keeps the original focus-on-open behavior. Explicit `focus: true`
follows the window to its workspace. Missing anchors fall back to the
workspace region. Small terminals use the existing focused-branch fallback.

Users override plugin hints in `agent-compositor.json`:

```json
{
  "ui": {
    "sites": {
      "sidebar": { "size": 0.3, "focus": false }
    },
    "rules": [
      {
        "match": { "plugin": "cost", "surface": "usage" },
        "site": "sidebar",
        "workspace": 2,
        "size": 0.25,
        "focus": false
      },
      {
        "match": { "plugin": "diagnostics" },
        "site": "inspector",
        "relativeTo": "session"
      }
    ]
  }
}
```

Matches use exact plugin names and local surface ids (the `usage` passed to
`$.ui.surface`, before compositor namespacing). An omitted selector matches
all. Later matching rules override earlier rules field by field. The final
site is selected from rules or the plugin hint; that site's configured
values override plugin hints, and matching rule values override both.
`relativeTo` uses a compositor surface id (`session`, `tools`, or a
namespaced plugin id).

Placement runs only when a surface is first created (or recreated after
closing). Updating its text does not steal focus, switch workspaces, or
undo manual moves and resizing. External configuration edits apply after app restart. The placement panel below
can apply and save individual plugin rules during a running session.


## Manage plugins while the agent works

Click **[Plugins]** or submit **/plugins** to open the plugin manager. Choose
**Browse marketplace**, open a catalog, and type in its search field. Up/Down
selects a matching plugin; Enter or a mouse click opens the installation form.
Choose **This project** or **All my projects** and **Install inactive**. The result
provides **Enable installed plugin** and **Apply plugin changes**. The manager
also provides update checks, update/rollback/disable/remove actions, and links
back to installed plugins and catalogs. Catalog registration and refresh are
explicit actions. The management form defaults to the installation's scope.

These TUI controls and `/extensions`, `/marketplace`, `/settings`, `/models` and
`/providers` run independently of the model's prompt queue. They do not submit a
new model request or interrupt the current one. An agent question or approval
stays in the input dock; click another window or a toolbar button to keep
working, then click the dock to answer. Settings forms use the main area while
the pending agent question remains visible below.

Installation and activation choices can be saved during a turn. Updates,
rollbacks and removals requested through the TUI while an agent is running are
held in this app session so its loaded package files stay unchanged. Choose
**Apply plugin changes** or `/reload` to apply them: if busy, the status shows
**plugins pending**, and application waits for the current turn and queued
prompts to finish. Reload errors are reported; retry after resolving them.
Closing the app discards unapplied deferred file operations. Saved installation
and activation choices survive restart. A cancelled management caller also
discards its own unapplied deferred file operations; replacing a queued action
makes the latest caller its owner. Ordinary model prompts still queue;
plugin slash commands with an explicit UI route open immediately. Git review,
Usage, Todos, MCP, Workflows and Proxy provide these routes. Explicit immediate
commands such as `/auto on|off|status` also run while the agent works, without
opening a pane; `/auto history` requests the optional audit view. Unmarked
commands retain their normal prompt/queue behavior.

Actions in an already-open plugin panel can call guarded tools while the agent
works. These operations keep normal tool permissions and separate cancellation;
their results appear in the panel/transcript without entering the agent's model
context. Up to four concurrent user operations are allowed, with a five-minute
limit including approvals. Reload also waits for these operations to finish.
When a plugin with an active operation is focused, **Ctrl+C** cancels that
plugin's operations; **Alt+i** returns to the agent input, where Ctrl+C interrupts
the agent. The footer shows active UI tools when space allows.

## Manage plugin placement in the UI

Choose **Arrange plugin windows** in the plugin manager, press **Alt+p**, or submit **/placement**.
The panel lists surfaces already published by plugins, including closed
windows that can be reopened by applying placement. Plugins without a UI
surface are not listed; the empty state explains this.

Select **Window**, then change **Place**, **Workspace**, **Size**,
**Neighbour** and **Focus on opening**. Use Up/Down (or Tab) to choose a
field and Left/Right to change it; clicking a value cycles it forward.
Click an action or select it and press Enter:

- **Apply now** relocates the selected surface for this run.
- **Save rule + apply** saves an exact plugin/surface rule to the project's
  `.agent-compositor/agent-compositor.jsonc` and applies it immediately.
- **Close** (or Escape) returns to the window layout.

Saving preserves JSONC comments, unrelated settings and inherited placement
rules. Malformed configuration and write failures are reported in the panel.
Only the chosen rule is saved; Apply-only changes for other surfaces remain
session-local. Saved placement is used when that plugin publishes its surface
in later app sessions. This does not save the complete window tree or create
plugin surfaces automatically.


The default `todos` plugin now supplies a real plugin window. It opens at
startup, restores tasks from `.agent-compositor/todos.json`, and updates
when the agent uses `todo`. Use `/todos` to reopen it after closing.
In the placement panel, select **todos / Todos** to apply or save its placement.
Markers: `[ ]` pending, `[~]` in progress, `[x]` completed.


## Drag windows and resize with the mouse

The interactive TUI enables SGR button-motion reporting automatically.

- Drag a window's title or outer top border onto another window. Release
  near an edge to split on that side; release in the center to swap windows.
  A yellow target border and title show the pending operation.
- Drag a separator (either border cell between two windows) to resize its
  container. Changes preview live, with minimum sizes enforced.
- Drag a title onto a workspace number to move the window there and follow it.
- Click **[F]** in a window title to toggle fullscreen, **[x]** to close it.
- Escape cancels a drag; resizing the terminal cancels the active gesture.
  Dropping outside a window or workspace leaves window placement unchanged.

Message input and the system bar remain docked. Plugin placement controls,
permission prompts and slash suggestions react only to mouse presses, so
releasing a drag does not trigger a second action. Dragging changes the
current session's tiling layout; it does not automatically save placement
rules. Use **Arrange plugin windows → Save rule + apply** for explicit plugin rules.


Mouse hover is reported without holding a button. The compositor requests
`grab` over titles, directional resize pointers over separators, `pointer`
over buttons/workspace tabs and `text` over input. During a drag it requests
`grabbing` or `not-allowed`. The renderer uses OSC 22 mouse pointer shapes;
terminal support is required (this controls the OS mouse pointer, not the
text caret). Unsupported terminals keep their normal pointer. Mouse shape
and reporting modes are reset when the app exits.

## Appearance and presentation plugins

The default UI gives conversation the main area, opens Tools on demand
(Alt+t), distinguishes user/agent/tool rows, renders basic Markdown and uses
a two-line contextual footer. Task text wraps at words with hanging indents.
Ctrl+J inserts a newline; Shift+Enter works where supported by the terminal.
Enter sends the whole draft. Up/Down browse this run's prompt history.

The default `ui-theme` plugin offers `/theme slate|amber|mono` and remembers
the choice in `.agent-compositor/theme.json`.

Plugins can use `$.ui.configure` for palette, window chrome and presentation
options, or return `{ tree: { lines: [...] } }` from `ui.render` to replace
conversation, tools, status or plugin views. `ui.invalidate` refreshes cached
views. Unloading removes a plugin's appearance contribution. Input and
permission decisions remain host-owned. See [the UI plugin contract](../../docs/ui-theming.md)
for examples, ordering and rendering constraints.

## Internet and attached projects

Use `@~/proj`, `@/absolute/path` or `@"~/project with spaces/file.ts"` to attach
files/directories to the current session. `/workspace add PATH` and repeated
`--add-dir DIR` select additional project directories; `/workspace` lists scope.
Scope survives resume and is shared with delegated work. Independent agents can
select an attached `cwd` when created. The optional `web` plugin provides keyless
search and bounded HTTP source reading; `/web` shows provider setup.
See [configuration, examples and limits](../../docs/workspaces-and-web.md).
