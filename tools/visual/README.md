# Visual terminal bench

This is the real Ink app inside a POSIX PTY, displayed by xterm.js in a
browser. It is not a reimplementation of the UI. Browser keyboard and mouse
reports travel back through the PTY. The scripted provider exercises todos, delegation, questions, approvals, review
and independent agents; no external model or real project credentials are used.

Requires Node >=22.19.0, Bun, Python 3, and a POSIX host (Linux/macOS).

```sh
npm install
npx playwright install chromium
npm run visual:check
```

The check starts a loopback-only server, opens headless Chromium, exercises
the UI, captures screenshots, and stops its server/processes. Browser
installation may require `npx playwright install --with-deps chromium` on
minimal Linux hosts. An existing compatible Chromium can be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome`.

For manual inspection:

```sh
npm run visual:serve
```

Open the printed `VISUAL_URL` (including its token) in a browser. One client
is active at a time. The app runs in a temporary project with Todos and slash
commands; restarting preserves that project's task data and placement rules.
Ctrl+C stops the server and removes the temporary project. The app's own
Ctrl+C closes only the PTY session; use Restart session to reopen it.

## Render performance

`npm run visual:performance -- --motion` runs the actual application in the
existing PTY/xterm.js bench with a deterministic 1200-fragment Markdown/Unicode
provider, a live Ghost animation, real keyboard input and pointer movement. It
measures idle input, input during streaming, a draft over long history, hover
round trips and eight seeded viewport sizes. `--motion` enables the diagnostic
Kitty emulator and omits inherited NO_COLOR in this isolated fixture. Without
it, the test exercises the text-only path. No model credentials are needed.

Capture a baseline before changing the renderer, then compare the candidate with
the same flags, fixture and environment:

```sh
VISUAL_OUTPUT=dist/perf-before npm run visual:performance -- --motion --baseline
VISUAL_OUTPUT=dist/perf-after npm run visual:performance -- --motion --compare dist/perf-before/report.json
```

Run performance measurements sequentially on an otherwise quiet machine. Avoid
running the package suite or other visual scenarios at the same time. Results
are observations of that workload/environment, not universal latency promises.
`--baseline` records existing latency without applying the candidate's 1000 ms
input/hover ceiling. Candidate runs also reject unexpected empty terminal paints
and steady-state scrollback clears. Parser counters track display, scrollback
and line erases without consuming the underlying ANSI commands.
`resizeEmptyPaints` separately counts an empty emulator paint immediately after
a viewport change when no new application output has arrived. Empty paints after
application output still fail the candidate check, including during resize.

`report.json` records output chunks/UTF-8 bytes, xterm render events, browser long
tasks, output queue/consume durations, input-to-paint and hover-highlight latency, pointer round trips
and observed native image changes. `visual.frames` still counts completed output
chunks; it is not FPS. Input timing starts when xterm sends real keyboard bytes
and ends at an xterm render event containing the expected composer text. Pointer
timing ends on the matching OSC 22 response.
Hover-highlight timing separately waits for the expected title-cell bold state
in an xterm render event, so an early cursor response cannot hide a delayed UI.
These timings include the browser,
WebSocket and PTY path; they do not measure physical monitor presentation.

`app-performance.json` records the fixture process's CPU time, memory and event
loop delay. It is diagnostic fixture instrumentation, not production telemetry.
Reports and PNGs remain under the selected ignored output directory.
The resize comparison checks terminal cell content, width, colors and attributes
after the complete frame is visible and stable across three animation frames.
It canonicalizes unwritten blank cells as spaces; it does not ignore styling or
text differences. Eight reproducible cases are a regression probe, not exhaustive
property-based coverage. Native terminal/GPU compatibility still needs separate
verification.

For a VTE-like capability profile, run
`VISUAL_OUTPUT=dist/perf-vte npm run visual:performance -- --vte`. This uses the
same real PTY and browser xterm emulator, with Ghost enabled, unsupported native
images falling back to compact status, and OSC 22 disabled. Hover latency is
measured from the actual title highlight; native pointer round trips are absent.
It models a VTE build without SIXEL, not every GNOME Terminal configuration.

Performance runs also retain `terminal.events.jsonl`: ordered PTY output and
viewport changes. If system Python has PyGObject, GTK3, a modern VTE 2.91 binding
with `get_text_format` (tested on 0.84.1), and an available X11 display, replay
that trace through the actual VTE engine:

```sh
GDK_BACKEND=x11 /usr/bin/python3 tools/visual/vte-replay.py dist/perf-vte
```

The GTK offscreen widget saves `vte-screen.png`, text and `vte-report.json`,
checking final geometry, the conversation header and final result/draft. It
waits for real widget allocation before feeding a resized frame. This supplements
the browser check with native VTE parsing/rendering; it does not measure live
GNOME input latency, GPU presentation or SIXEL when the local build lacks it.
The replay is deliberately optional and fails clearly when prerequisites are
missing. No application state or simulated UI methods are used as evidence.

## Evidence

Artifacts default to `dist/visual-proof/` (override with `VISUAL_OUTPUT`):

- PNGs: Ghost composer attachment, pause and manual approval;
  startup, drag/resize, tasks, saved placement, restored workspace, theme,
  compact/narrow terminals, slash palette, multiline input, subagent question,
  delegation, auto mode, review, checkpoints and independent-agent restoration.
- `report.json`: scenario assertions and errors. A failed check also captures
  `failure.png` when a page exists.
- `terminal.ansi`: raw application output.
- `input.jsonl`: actual PTY input and resize events, timestamped.

The scenario moves Todos by its title, resizes a separator, sends a prompt,
checks the tool's output, saves plugin placement, restarts the app, and opens
the saved workspace. Assertions read terminal cells, never AgentCore or
WindowManager state. Mouse actions use browser coordinates and xterm's mouse
reporting, not synthesized calls to compositor methods.

OSC 22 is deliberately translated into CSS cursors in this emulator, so
hover behavior can be asserted. This demonstrates the application's emitted
pointer requests, not support in an arbitrary native terminal. Browser
screenshots generally omit the OS pointer itself. Native terminal behavior,
external provider reliability and exact font rendering are separate checks.

`VISUAL_URL` can point `visual:check` at an already-running bench; in that
case the runner closes its browser but leaves the server running. Each
connection starts the app; use a fresh server for a clean initial fixture.

The browser and PTY retain the last viewport dimensions across restart. The
scenario also opens marketplace/proxy panes through real terminal input after
restoring an independent agent.

## Native graphics and compiled distributions

`npm run visual:background` exercises the background-jobs plugin in the real PTY.
It checks Ctrl+C during a busy turn, launches a real background shell, sends a
second user message while it runs, and leaves an unsent draft in the composer.
One completion reads the result and preserves that draft. The scripted provider
records open/closed request lifetimes to reject waiting streams or polling calls.
Evidence lives under `dist/visual-background/`; this does not certify external
provider reliability.

The default scenario checks portable text rendering and compact image status. Run
`VISUAL_GRAPHICS=kitty npm run visual:check` to let the browser bench answer the
real Kitty query and emulate emitted RGBA upload/placement/deletion commands.
The canvas overlay consumes PTY bytes only; it does not read AppUI or plugin
state. `visual.graphics.stats` records dimensions, uploads, placements and
protocol errors; `visual.graphics.active` reports live placements. This verifies
our protocol transport, not GPU rendering in a native Kitty-compatible client.

For inspecting an extracted release without loading the source fixture:

```sh
VISUAL_GRAPHICS=kitty VISUAL_EXECUTABLE=/absolute/path/to/compositor npm run visual:serve
```

The executable runs in the bench's temporary project and home, with no real
project settings. The compiled executable uses its configured provider rather
than the fixture's scripted provider; startup, mouse placement, pause and
workspace checks need no model requests. The full scripted scenario still uses
the source fixture. `VISUAL_EXECUTABLE` must point to the executable inside its
complete extracted distribution, beside `plugins/` and `node_modules/`.

`npm run visual:mascot` checks the Ghost image attachment through the real
PTY and the diagnostic Kitty emulator: source pixels, frame changes, pause,
pet, compact status, draft preservation, disable, and restart. The motion
scenario deliberately omits inherited NO_COLOR in its isolated child; production
still respects it. Combine with VISUAL_EXECUTABLE for a compiled distribution.
Evidence defaults to dist/visual-ghost-lifecycle/.

VISUAL_MASCOT_GIF selects a test GIF copied into the isolated temporary project.
An optional VISUAL_EXPECT_MIN_FPS sets an explicit observation threshold; the
report records observed image changes/s separately from the file timing. It is
not a hardware/terminal-wide performance promise. The 50 fps test asset must
contain enough distinct frames to make observed changes meaningful.

`node tools/visual/sixel-reference-check.mjs` optionally uses ImageMagick to
decode a 64×64 generated SIXEL checkerboard and checks all 4096 pixels (two RGB
levels of tolerance because SIXEL uses percentage colour definitions). This is
an independent encoder check, not native VTE screen verification. Tiny SIXEL
streams are avoided because the local ImageMagick decoder rejects files below
2048 bytes, including its own tiny outputs.

### Native settings scenario

Run `npm run visual:settings` to exercise the Settings toolbar, provider preset,
editable connection form, reasoning effort selection/persistence/reset, masked API key, authenticated proxy form, independent
model/tool switches, cancellation and restoration after restart. The real TUI
runs in the same isolated PTY fixture. It uses fake keys and local dummy
addresses, and does not contact an external model. Artifacts default to
`dist/visual-settings/`; set `VISUAL_OUTPUT` for another run. Inspect the PNGs and
`report.json`. `input.jsonl` intentionally captures raw input: never use real
credentials in this diagnostic bench. Provider discovery/authentication and
transport behavior are also covered by package tests and `npm run eval:proxy`.

### Dynamic workflow scenario

`npm run visual:workflows` starts an isolated real PTY with a test-only provider
and fixture plugin. Terminal commands launch the real workflow tool, discover
two workers and hold them at a fixture barrier. Mouse actions pause scheduling;
a terminal command releases the workers, then resume joins their results. The
scenario inspects stage detail and automatic parent-agent completion, restarts the application, verifies persisted
completion and submits foreground input with the context indicator visible.
It does not use live credentials. Artifacts default to `dist/visual-workflows/`.
The fixture plugin is outside shipped plugin directories.

### Markdown and native pointer fallback

`npm run visual:presentation` exercises a real PTY with a Markdown response,
checks heading/emphasis/list/table/quote/code cells, resizes the viewport, and
captures title hover with OSC 22 explicitly disabled (the GNOME/VTE case).
`VISUAL_EXECUTABLE` selects the compiled distribution. This scenario supplies a
loopback, token-scoped model fixture; it uses no external credentials or model.
Default artifacts are `dist/visual-presentation/`; set `VISUAL_OUTPUT` separately
for source and binary checks. Inspect the PNGs as well as `report.json`.

The ordinary bench explicitly requests `AGENT_POINTER=on` because it implements
OSC 22 in JavaScript. Set `VISUAL_POINTER=off` for manual native-fallback checks;
the standard pointer scenario expects the emulator feature and uses `on`.
Browser cursor emulation is not native GNOME Terminal support. Actual VTE/GTK
font rendering is not tested by xterm.js; equal cell dimensions and the same
built application are necessary before comparing source and installed versions.

### Human questionnaire scenario

`npm run visual:questions` runs a three-question form through the actual agent
loop and PTY. It selects rich radio/checkbox choices with the mouse, enters a
custom multiple-choice answer, returns with Back, resizes to 60 columns, fills
free text, edits an earlier answer from review and explicitly submits. The
scripted provider reads the structured tool result and displays the returned
values. Captures default to `dist/visual-questions/`; inspect the PNGs and
`report.json`. `VISUAL_EXECUTABLE` selects the compiled distribution via the same
loopback, token-scoped model fixture. No external models or credentials are used.

### Chat history scenario

`npm run visual:history` seeds named, archived and multi-turn sessions in the
isolated project and opens the actual history pane. Real keyboard/mouse input
pages the list, searches a phrase found only in an earlier response, resizes to
60 columns, renames the selected chat, shows archives, resumes its transcript and
sends a follow-up through the provider. Bare `/resume` and Escape are also checked.
The provider echoes earlier conversation context; no live credentials are used.
Artifacts default to `dist/visual-history/`; inspect PNGs and `report.json`.

Set `VISUAL_EXECUTABLE` to the built distribution and `VISUAL_START_HISTORY=1`
to test the binary's bare `--resume` startup entry. The same loopback model fixture
and isolated home storage are used. Set a fresh `VISUAL_OUTPUT` for each run.

### UX interaction scenario

`npm run visual:ux` checks readable window projection at 100x30, 80x24 and 60x24,
keyboard access to a hidden pane, fullscreen while composing, and an offscreen
provider action. It then opens a long real exec approval and checks its beginning,
end, tool identity and all permission scopes while scrolling. The command is a
safe print-only fixture and is always denied. The final mono history check reads
actual xterm RGB cells, avoiding a false contrast pass from ANSI color names.
`VISUAL_EXECUTABLE` selects the compiled distribution with a token-scoped loopback
model fixture. Default output: `dist/visual-ux/`; inspect PNGs and `report.json`.

The maintained [TUI design guide](../../docs/tui-design.md) explains the shared
layout, navigation, literal-input, contrast and plugin-contract decisions.

### Replacement controller scenario

`npm run visual:controllers` loads an external test-only plugin with custom editor,
approval, question, private form, placement and history controllers plus its own
structural session repository. Real PTY function keys exercise behavior replacement;
restart/search/resume checks persistence and a 60-column viewport. Artifacts default
to `dist/visual-controllers/`. `VISUAL_EXECUTABLE` checks a compiled distribution
using the token-scoped loopback model. Inspect the PNGs and `report.json`; raw input
captures contain only fake credentials. The fixture backend is not production code.

### Internet and attached-project scenario

`npm run visual:workspaces` uses a separate temporary home and real PTY to check
`@~/proj` completion, directory submission, quoted external files, cross-project
read, `/workspace`, a loopback search/fetch chain, and scope restoration after
restart/resume at 60 columns. `VISUAL_EXECUTABLE` checks the compiled distribution.
Inspect `report.json` and PNGs in `dist/visual-web-workspaces/`. The loopback fixture
uses no live credentials or search account; live-provider probes are separate.

## Plugin authoring lifecycle

`npm run visual:author` exercises the real PTY's `/plugin` flow with an isolated
scripted model: skill/composition guidance, a six-component scaffold, editing
without removing other hooks, a real write approval, structure checking, user
`/reload`, the authored command with an SDK import, an actual panel, plugin skill
loading and a real local stdio MCP call. It repeats execution after process
restart. It waits for the observed Ready state before
reload. It also disables the owner, observes its panel/MCP contribution disappear,
and re-enables it to exercise restoration. `VISUAL_EXECUTABLE` selects the compiled distribution; it must contain the
plugin-author skill/resources. `VISUAL_OUTPUT` selects a fresh capture directory
(default `dist/visual-plugin-author/`). The scenario supplies no live provider
credentials. Inspect `report.json` and the PNGs; scripted success checks the
integration path, not arbitrary model-generated plugin quality.

## Default marketplace and scoped activation

`npm run visual:marketplace` starts the actual TUI with no active filesystem
plugins. It browses the offline default catalog, installs packages inactive,
explicitly enables Todos in project scope, verifies restart persistence and
disables it. Real terminal mouse/keyboard actions then install and enable a
package through forms selecting user scope. `VISUAL_EXECUTABLE` selects an
extracted compiled distribution. All projects/homes are isolated. Existing
positive scenarios now explicitly select their fixture plugins; discovery alone
never activates production code.

## Plugin certification scenarios

`node tools/visual/plugin-check.mjs git-review` exercises status and distinct
staged/working diffs against the real Git fixture. It also checks keyboard
actions, scoped configuration save/cancel and restoration after restart,
48×18 controls, panel close/reopen and an unsent draft. `VISUAL_PLUGIN_DIR`
selects the exact source or extracted archive candidate.

`node tools/visual/plugin-check.mjs <plugin>` runs the package-specific scenario
for auto-approve, checkpoint-history, cost, mascot, mcp, network-proxy, todos,
ui-theme or workflows. `VISUAL_OUTPUT` selects a fresh evidence directory.
`VISUAL_PLUGIN_DIR` selects the exact extracted archive candidate; the bench
asserts the loaded directory and writes `fixture-identity.json`. All activation,
configuration, model responses and project data remain isolated fixtures.

The certification wrapper is `tools/plugins/visual-scenario.ts`; it verifies
required observations and hashes PNG, ANSI, input and report evidence into the
scenario protocol. Interactive actions travel through terminal input. The proxy
password fixture is private and must never appear in visible cells, model context
or ordinary plugin events/logs. Screenshots verify masking; deterministic privacy
cases additionally inspect the receiver and excluded channels.

For a Git-reviewing candidate, `VISUAL_GIT_FIXTURE=1` seeds the isolated PTY
project with a real local Git repository, one commit, and distinct staged and
working changes in `review.txt`. It requires Git on PATH, ignores global/system
Git configuration, and uses no remote. With `VISUAL_CERT_PLUGIN`, this fixture
explicitly allows the fixed read-only `git_review` tool; it is a test grant, not
a production permission default. `VISUAL_PLUGIN_DIR` still selects and verifies
the exact candidate directory.

The marketplace scenario also holds a scripted model turn while real terminal
mouse/keyboard input opens Plugins, searches a catalog, installs and enables a
package and queues reload. It verifies application after interruption, then
keeps an agent question pending while catalog search and provider settings are
used. No live model or credentials are involved.
At 48×18 it also opens management with Alt+o / Alt+,, checks the compact pending
question, expands it with a mouse click before answering, and verifies that
later keyboard navigation preserves an unsent message draft.
