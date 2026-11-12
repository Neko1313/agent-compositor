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

# or compile a single binary (bun build --compile, ~105 MB, self-contained)
npm run build:binary -w @agent-compositor/app
./dist/compositor --plugins ./plugins
```

## Plugins start off

The default repository marketplace ships offline. `/marketplace` browses it;
installation leaves a package inactive and pins its version separately from the
app. Install in the chosen scope first, then use `/extensions enable NAME --project`
or `--user`, then `/reload`. Project decisions override user defaults. Discovery
and `--plugins` do not activate code. See [the standard](../../docs/plugin-standard.md)
for compatibility, tests, versions, updates and rollback.

## Flags

```
compositor [--plugins dir ...] [--resume [ID]] [--history] [--cwd dir] [--plain]
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

## App configuration

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

## Tiling windows

The terminal UI now uses a binary container tree. Conversation and tools
start side by side; windows can be nested, resized, moved and closed. A
focused window has an accent border. Message input stays in a dock and only
receives typing when focused. Conversation views share the current agent
session; creating a view does not spawn another agent. Scroll positions
belong to individual windows. The application persists supported layout state
and independent-agent metadata in project-scoped private storage for restart.

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

The declaration supplies UI metadata; the plugin still handles execution
in its `prompt.submit` hook.

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
and activation choices survive restart. Ordinary model prompts still queue;
plugin slash commands with an explicit UI route open immediately. Git review,
Usage, Todos, MCP, Workflows and Proxy provide these routes. Other commands
retain their normal prompt/queue behavior.

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
