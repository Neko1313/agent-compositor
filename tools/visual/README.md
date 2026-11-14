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

The emulator explicitly uses the stable Unicode 11 scalar-width provider before
receiving PTY output. This matches the width-two emoji/CJK and combining-mark
profile exercised by the native checks; xterm's default Unicode 6 profile treats
modern emoji as one cell and can leave stale glyphs after valid cursor updates.
The raw-ANSI regression checks both profiles against the same writes. This does
not establish support for every extended emoji or grapheme-cluster sequence.

The standard `visual:check` smoke uses its source ScriptedProvider and rejects
`VISUAL_EXECUTABLE`. For native Ink window verification use `visual:windows`,
which configures its isolated loopback approval/question fixtures. Actual-app
OpenTUI scenarios below also accept a complete relocated native archive.

The standard scenario also checks the semantic agent overview: expand by mouse
and keyboard, click state tabs, switch with Left/Right, resize to stacked narrow fields and enter the
selected agent's conversation. Screenshots include the expanded and narrow views.

`npm run visual:opentui-app` runs the actual application entry point with
`--renderer opentui`, isolated saved profiles and a bounded loopback HTTP model.
It does not inject a `buildApp` provider. It verifies pending Main question/draft
state while native provider/model/key/proxy forms complete, actual model and
authorization selection on the next HTTP request, independent form lifetime
during foreground interruption, and exact layout plus session restoration with
`--resume`. Synthetic keys must be absent from terminal output, provider bodies,
session journals and non-secret profile settings; diagnostic raw keyboard logs
are deliberately excluded. No user profiles or credentials are read.

Set `VISUAL_EXECUTABLE=/absolute/path/to/extracted/compositor` for the same proof
against a native archive. The report records the executable identity. The older
`visual:opentui`, `visual:opentui-windows` and `visual:opentui-inputs` commands keep
their isolated preview fixtures and test different integration boundaries.

`npm run visual:opentui-managers` checks the actual OpenTUI application with an
offline local catalog and the normal configured loopback provider. While Main
waits for an answer, terminal actions browse the canonical manager panels,
register the catalog, install a package inactive, explicitly enable it and queue
reload. The plugin's own storage receipt and pane establish when it actually
loads. The scenario also keeps a deliberately closed plugin window closed across
reload, exercises private placement Apply/Save rule/Cancel and restores the saved
rule after a real CLI restart. `/windows` must remain private host navigation without a
model request. No fixture permission rules or live model services are used.
Artifacts default to `dist/visual-opentui-managers/`; inspect the PNGs and report.
Set `VISUAL_EXECUTABLE` to an executable inside a complete extracted archive for
the same native check. The bench preserves `CI` and records native executable
and renderer hashes.
Before reopening Main's pending answer after manager navigation, the check waits
for its focused native footer, draft and Edit answer button inside the same pane.
The footer paints after the focus-dependent dock moves, so an early title update
cannot admit coordinates from the previous unfocused layout. Mouse targets also
wait outside synchronized output and retain the same completed-write count and
pane text across the coordinate stability check; the real click and saved-answer
assertion remain unchanged.

`npm run visual:opentui-navigation` checks the actual configured OpenTUI shell's
stable Arrange mode, private native finder, protected Main questions/approvals,
resident form/editor state and route lifetime. The scenario verifies current
workspace window strips and cross-workspace restoration through F2, all nine
workspace mouse targets at 38 columns, and exact saved split-tree/ratio restoration
after restart. Arrange checks identify the actual nested keyboard split and its
painted divider, distinguish saved proportions from cell allocation, exercise both
focused-child resize directions, and explain hidden or absent targets. Pointer
resizing still uses the real terminal path. An additional narrow-tiling flow uses
ordinary settings and Unicode windows on a temporary workspace: two columns fit
at 60×24, two rows fit at 38×24, and insufficient height at 38×16 projects only
the focused window. It checks actual minimum 24×6 tile bounds, visible divider
geometry, pointer and keyboard resize, cancellation, canonical tree preservation,
and the still-pending Main question and private form. Widening and the final CLI
restart retain the exact saved tree and fractions. A focus-publication flow uses
abort-aware file gates to finish ordinary public SDK producers after the user
selects Main, edits a private form, enters Arrange/Finder or changes workspace.
Passive first views and late commands must preserve that intent and native cursor;
explicit focus hints and configured rules keep their opt-in/opt-out behavior.
The same controlled gate proves a still-selected retained Finder route can open,
while an abandoned route cannot create a late window. Gate files control fixture
completion only; all user interaction still crosses the actual terminal.
The separate deterministic preview
retains its development keymap.
Artifacts default to `dist/visual-opentui-navigation/`; `VISUAL_EXECUTABLE` selects
a complete extracted native candidate rather than a source override.

`npm run visual:opentui-controllers` selects external approval, question and form
controllers in the actual configured CLI; the editor, history and placement keep
their host implementations. Its six flows exercise the existing F3/F4/F5 decision
contracts, Main answer-versus-draft ownership, independent operation windows,
retained local input state, terminal paste and local mouse coordinates, validated
colored/bold/CJK cells, masked supplied defaults, asynchronous responses and
cancel/unload fail-closed behavior. The requester and controller provider are
separate test-only plugins. A retained ordinary startup form also exercises Main's
FIFO while a real model turn completes, preserving the private form and native
draft/cursor until explicit submission. A normal exact permission rule permits disabling only
that provider through the public extension tool before real `/reload`; external
gate files control fixture completion, never application state. Private form
window selection waits for the exact Finder query, matching row count and native
highlight. A late result can legitimately have no selection: the bench uses one
ArrowDown only when needed, verifies the selected row and then sends Enter.
It never relies on query text alone to establish a current opening target.
Private form
receipts retain hashes rather than tokens, and terminal/provider/journal scans
exclude the diagnostic raw synthetic keystroke log. Artifacts default to
`dist/visual-opentui-controllers/`; `VISUAL_EXECUTABLE` checks a complete extracted
native archive. This scenario does not establish selected editor, placement or
full render/wire parity. The older `visual:controllers` keeps its complete Ink
composition and its documented custom-editor F2 key unchanged.

`npm run visual:opentui-editor` checks a selected editor in two fresh actual-CLI
compositions: native private requests, then selected private request controllers.
Its six bounded flows retain the original F2-submit/Enter-newline contract and
exercise UTF-16 cursor checkpoints, terminal paste, command/file capabilities,
visible busy queue receipts, accepted hook/provider failures, native and selected
private request ownership, and a real four-operation admission limit. A rejected
fifth immediate command must restore the visible editor lease before applying
following input. Canonical extension reload and chat-history resume carry the
unsent checkpoint before destructive disposal; a gated old-generation handler
must lose its capabilities and cannot submit afterward. Disabling the selected
owner fails closed. This is in-process transfer, not a promise to persist unsent
drafts across process restart. Finder opens through Alt+W then w while the custom
Draft owns F2; known-label selection retains the shared exact query/count/native
highlight acknowledgement. External gate files control fixture completion only.
Private form receipts retain a token hash, and privacy scans exclude the raw
synthetic keystroke log. Artifacts default to `dist/visual-opentui-editor/` with
separate `native/` and `selected/` reports; `VISUAL_EXECUTABLE` runs the same checks
against a complete relocated native archive.


`npm run visual:opentui-workspace-controllers` selects history and placement in
the actual configured CLI, leaving editor, question and private form controls at
`@host`. Its eight bounded flows exercise private Unicode history search and
cursor retention, native private forms, canonical list/rename/fork/archive and
unarchive controls, explicit resume with model context, and real placement
windows/anchors/Apply/Save across workspaces. Main's selected answer and message
draft stay pending while read-only history and placement work continues. Invalid
or removed targets fail; a gated earlier Apply cannot steal newer navigation.
Hide preserves a lease, while focused Ctrl+C, Core replacement and provider
unload revoke it. Restart restores committed context, rules and the complete
saved window tree, including a deliberately closed pane. Unsent drafts are only
checked across interactive resume, not process exit. The fixture records the
actual selected history resume intent before the bench restarts with that ID.

The separate observer proves private frames, raw inputs and local form results do
not use public `ui.render`, `ui.press` or `ui.change`. Deliberate `data.control`
calls retain the canonical session service interception payload, including search
and rename arguments; these expected service calls are not described as private
broadcast omissions. Synthetic tokens stay out of all observer events, terminal
output, HTTP requests and journals. External files gate producer completion only.
Artifacts default to `dist/visual-opentui-workspace-controllers/`;
`VISUAL_EXECUTABLE` runs the same checks against a complete relocated archive.
The shared Finder helper may pair an explicit command query with its expected
visible label: `/plugins` selects `Plugins` without also matching
`Plugins · placement`. Exact query, result count and selected native cells remain
required; existing callers keep their label-as-query default.


Known-label Finder opens in the controller, request-window, manager and
cancellation checks share [opentui-finder.mjs](opentui-finder.mjs). The helper
waits for one native panel's exact query, expected rows and highlighted choice;
it selects a late unselected result before one Enter. Query-only observations
do not select or open anything, preserving negative and Closed-row mouse checks.
The advanced navigation scenario keeps its deliberate partial-query, stale-route
and cancellation interactions separate.

`npm run visual:opentui-cancellation` checks immediate commands through the actual
configured OpenTUI CLI. Two commands from one plugin start real `/bin/sh` workers
under exact normal permission rules. Ctrl+C in one window must settle its
operation and kill its PID while the neighboring worker, Main's pending question,
selected answer and draft remain intact. Main interruption must preserve the
other command; its own Ctrl+C must then stop it. A denied third invocation must
create no process. Plugin storage receipts, distinct journal operation IDs and a
completed `/reload` establish settlement without injecting app or window state.
The provider is bounded loopback HTTP; no paid model or user credentials are used.
Artifacts default to `dist/visual-opentui-cancellation/`. Set `VISUAL_EXECUTABLE`
to the executable inside a complete extracted archive for the same native check.

`npm run visual:opentui-requests` checks the configured CLI's independent manual
input windows with a bounded loopback model. Main retains its pending selected
answer and draft while real builtin exec receives exact normal Allow once/Deny
decisions, same-owner direct/builtin questions coexist, a questionnaire returns
its structured answers, and a private form preserves its native cursor and
masked token through validation and hide/reopen. Public commands/actions gate
retained requests before and after actual launcher settlement; Main interruption
and cancellation of one request preserve the others. SDK receipts, exact tool
IDs, file effects and a real reload establish settlement. The private token must
remain absent from terminal output, HTTP bodies and saved journals; raw test
keyboard logs are deliberately excluded. No user credentials or paid provider
are used. Artifacts default to `dist/visual-opentui-requests/`; `VISUAL_EXECUTABLE`
selects the executable inside a complete extracted archive for the same proof.
Initial resize waits for the app's complete native pane geometry before starting
the question. Pointer targets exclude synchronized partial output and must keep
their coordinates and painted row stable across three browser animation frames.

`npm run visual:windows` checks the shipping Ink window controls through the
actual PTY: finder search and cancellation, draft/cursor retention, nearest-split
orientation and resize, directional movement, workspace transfer, fullscreen,
closed-conversation recovery and layout restoration after restart. Separate
fixtures keep an approval and a question pending while local window input is
handled. The fixture inspects only its isolated saved layout and session journal;
it does not mutate AppUI or WindowManager to simulate user actions. F2 exercises
the real terminal shortcut; Alt+Tab can be intercepted by the browser or desktop
and is not used as evidence. All model replies are local scripted fixtures.
For the same checks against an extracted native archive, set
`VISUAL_EXECUTABLE=/absolute/path/to/compositor` and run the command again. The
report records the exact executable SHA-256 and verifies isolated storage paths;
native model requests use the loopback fixture with an empty API key. Source
plugin-directory overrides are rejected in this mode.

`VISUAL_OUTPUT=dist/workflow-proof node tools/visual/workflow-check.mjs` checks
dynamic workflow tables with actual bounded workers: run/stage drill-down,
pause/release/resume, closing during worker completion and explicit reopening,
expanded result, clickable state tabs, Left/Right switching, keyboard collapse, narrow fields,
parent completion and restoration. `VISUAL_PLUGIN_DIR` selects an exact candidate
package; the bench records and verifies its loaded identity. Workflow plugin
certification runs this scenario as well as the legacy Python-journal UI scenario.

For a compiled host, set `VISUAL_EXECUTABLE` to an executable in a complete,
extracted archive and run `node tools/visual/workflow-check.mjs`. The native bench
uses a bounded loopback provider and a separately compiled trigger fixture in the
temporary project. It verifies the runtime workflow identity against the bundled
directory/version and records executable/plugin hashes and the six protocol
requests. Native mode rejects `VISUAL_PLUGIN_DIR` overrides so the shipping
workflow package is exercised.

With the same `VISUAL_EXECUTABLE`, `node tools/visual/agent-table-check.mjs` checks
the compiled agent overview while a main stream is held: immediate management,
manual create approval, side reply, filters, keyboard expansion, narrow fields,
close/reopen draft and restart transcript. It expects exactly two loopback
requests. For conversation tabs, run
`VISUAL_CONVERSATION_TABS=1 VISUAL_EXECUTABLE=/path/to/extracted/compositor VISUAL_OUTPUT=dist/conversation-tabs-proof node tools/visual/agent-table-check.mjs`.
It creates two agents while the main stream is held and checks tab switching,
isolated transcripts, independent drafts, button submission, closed-pane reopening,
narrow layout, persisted selected-window identity and restart history without a
reopen command. File reads only verify saved state; all interactions use actual
terminal input. Nine checks require exactly three loopback requests and zero paid
requests. Unsent drafts intentionally do not survive restart.

For saved agent history, select the same extracted host and run
`VISUAL_AGENT_HISTORY=1 VISUAL_EXECUTABLE=/path/to/extracted/compositor VISUAL_OUTPUT=dist/agent-history-proof node tools/visual/agent-table-check.mjs`.
It holds the main model while a second agent invokes the actual `read` tool,
opens Saved activity, filters with mouse and arrow keys, expands saved arguments
and output, checks narrow stacked fields, restarts and reopens the saved result.
Eight checks require exactly one held-main and two tool-cycle loopback requests,
with zero paid requests. The harness only seeds a temporary input file; the tool
call/result must be produced by the actual application and survive its journal.

Both overview and conversation scenarios use normal terminal input and isolated state, record
binary mode/hash and fail unexpected model requests. Stream comments keep held
fixture connections alive; a separate sixty-second deadline still bounds them.

Run `CI=1 npm run visual:check` to exercise the same real PTY with inherited CI
flags. The fixture preserves them: interactive output must appear before exit,
just as it does outside CI. Renderer regressions separately check that piped
output remains static.

The browser terminal sets `macOptionIsMeta: true`, so Option/Alt shortcuts emit
the same escape-prefixed terminal input on Linux and macOS. This setting belongs
to the browser bench; native macOS terminals need their own Option-as-Meta setting.
After cancelling a guarded UI operation, wait for its final panel state before
measuring coordinates for the next action. The tool journal can report a result
before the plugin finishes publishing that panel.

For manual inspection:

`VISUAL_OUTPUT=dist/setup-proof node tools/visual/setup-check.mjs` checks the real
first-run guide with no initial provider: automatic offer, persisted skip, private
short connection editor, chosen-plugin installation/enable/reload, draft retention,
narrow layout, completion persistence and a first task through a saved local
endpoint. The guide must make zero completion requests; only the explicit first
task uses the bounded loopback response. Credentials in this fixture are synthetic.
Set `VISUAL_EXECUTABLE` to the executable from an extracted release archive to
run the same flow against a compiled app. The bench records actual storage paths
for both modes; the report identifies source/binary mode and hashes the selected
binary. Keep the complete archive contents beside that executable.

`VISUAL_OUTPUT=dist/btw-proof node tools/visual/plugin-check.mjs btw` checks the
actual side-conversation flow: opening while the main model is held, inline
follow-ups, independent drafts, pane closure/reopening, side-only cancellation,
narrow input and committed history after restart. All requests use a local
protocol fixture. `VISUAL_PLUGIN_DIR` can select an extracted candidate package;
the fixture checks and records that exact loaded package identity.

```sh
npm run visual:serve
```

Open the printed `VISUAL_URL` (including its token) in a browser. One client
is active at a time. The app runs in a temporary project with Todos and slash
commands; restarting preserves that project's task data and placement rules.
Ctrl+C stops the server and removes the temporary project. The app's own
Ctrl+C closes only the PTY session; use Restart session to reopen it.

## OpenTUI prototype

`npm run visual:opentui` launches the OpenTUI preview in the same POSIX PTY
and xterm.js browser used by the Ink checks. It uses Bun and the Playwright
Chromium installation or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override described
above. The fixture holds one agent in a turn while a second agent receives
input. The scenario exercises native text editing, keyboard and mouse pane
focus, split orientation, swapping, resizing, zoom, independent drafts,
workflow row expansion, terminal resizing and
Ctrl+C cleanup. Set `VISUAL_OUTPUT` to choose a capture directory.

`npm run visual:opentui-windows` exercises the host-owned window manager through
the same actual PTY. It checks nested panes, directional focus, title drag/drop,
separator resize and cancellation, workspace moves, and closing/reopening a
running conversation without losing its in-process draft. Actual PTY restarts
verify saved tree geometry, focus, workspace and intentional pane closure, plus
restoration of an empty workspace. The scenario independently reads the app's
layout file named in `opentui-fixture.json`. It verifies layout persistence;
preview conversation history and unsent drafts do not survive process restart.

The visual server owns the temporary project. For OpenTUI its private
`.opentui-home` remains there across PTY restarts and is removed with the project
when the server stops. No real home or model credentials are used. Native panes
stay mounted with stable semantic IDs while the compositor changes their frames.

`npm run visual:opentui-inputs` exercises native questions, questionnaires and
private plugin forms through the actual core callbacks. It checks per-chat
ownership, explicit submission, choices/custom answers, independent message
drafts, focus switching, cancellation and form lifetime across foreground
interruption. Model-received answer receipts and the plugin's own form receipt
are inspected independently of UI labels. The synthetic password must stay out
of terminal output, provider requests and session journals. The bench necessarily
records typed bytes in `input.jsonl`, so use synthetic test values only. Private
form receipts store a password length/hash, never its submitted text.

The same browser scenario issues real `write` tool calls from both agents.
It checks the workspace on disk before and after answering, scrolls through the
arguments in a 48×18 terminal, visits Workflows with both requests pending and
exits while a later request is unanswered. The report and screenshots include
the state of each conversation, the observed file contents and PTY exit code.

The plugin scenario searches the real isolated local catalog, installs a project
package inactive, enables it while Main waits for approval, and checks its loaded
version once Main is idle. A controlled local upstream version change exercises
deferred update. Installed files, lock state and the plugin's own command receipt
are checked independently of rendered labels. Disable, cancelled removal and
confirmed removal use the actual management services. No remote catalog or model
endpoint is needed. `opentui-fixture.json` inside the temporary workspace supplies
the isolated catalog, package and storage paths for those independent checks.

`npm run visual:opentui-ghost` checks transfers on a PTY that
answers the Kitty capability probe. It compares decoded RGBA frame bytes and
ordering with the bundled idle and thinking animations. This verifies the
emitted image protocol. Physical terminals and multiplexer passthrough need
separate checks.

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

`node tools/visual/plugin-check.mjs git-review` exercises status, staged/working
diffs, scoped configuration, narrow terminals and restart. It also holds the
scripted agent active while refreshing real Git status, starts a controlled
long-running SDK subprocess through isolated fixture middleware, cancels it from
the panel and verifies that the PID is gone while the agent remains active.
The scenario also closes the panel before starting the held model, opens it
through `/git-review` while the model is active, and checks that the model stays
working. It then interrupts and continues the agent through terminal input.
Fixture processes and files belong only to the temporary bench project.

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
extracted compiled distribution. Its held model, question and continuation use
an abort-aware token-scoped loopback SSE endpoint, so compiled runs do not select
an external model. All projects/homes are isolated. Existing
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

### Project checks panel

`node tools/visual/plugin-check.mjs project-checks` runs the real Ink panel in an
isolated npm project. It discovers scripts, runs passing/failing checks, saves
output/timeout limits globally and verifies them after restart. A held scripted
model stays active while checks run; cancellation and panel Close must reap the
real npm child without completing the main turn. The scenario also checks draft
preservation during terminal resize and reopening the panel. Input goes through
xterm keyboard/mouse events. `VISUAL_PLUGIN_DIR` selects the exact source or
unpacked archive; `fixture-identity.json` records which copy was loaded.

The `network-proxy` plugin scenario also edits a joined emoji in username and
password fields, checks that Backspace removes the complete grapheme, saves the
form and verifies the isolated stored values without printing the secret. The
wire text and screenshots must keep the password masked. This tests the shared
built-in form editor; it does not change the user's proxy configuration.


### CI review panel

`node tools/visual/plugin-check.mjs ci-review` opens the real `/ci` panel in an
isolated PTY. The scenario configures an explicit repository and output limits,
selects runs/jobs/failed and full logs, cancels the settings form, saves a new
run limit while the main agent is busy, and checks
Cancel/Close cleanup of actual SDK-owned processes while the scripted main
agent remains held. It also verifies a preserved draft after resize and saved
settings after session restart. During a held CI subprocess, it requires the
visible busy status and verifies its removal after cancellation settles, while
previous results remain visible during pending work. `ci-fixture.mjs` installs a local executable
`gh` fixture only on that PTY child's PATH and records its argv; it never uses
user GitHub credentials or a live model. Refresh responses include a request
sequence marker: the scenario waits for the specific response to render before
starting cancellation checks, rather than accepting a previous result or a
subprocess-start record as completion. Reports retain screenshots, input and
terminal output. Screenshot capture waits for an xterm render event and browser
paint frames, and retains a companion text snapshot. Pending/cancelled captures
also assert their expected terminal state before and after the screenshot so a
previous painted frame cannot silently stand in for the requested state.
Cancellation waits for both the error and removal of the panel's busy state;
the conversation's earlier tool-error event alone does not acknowledge cleanup.
These checks do not establish live GitHub network reliability.


## Structured test reports

`node tools/visual/plugin-check.mjs test-reports` uses the real PTY with local
Vitest/Jest-shaped JSON, the actual report tool/panel and a controlled pre-tool
wait. It checks explicit reads, keyboard/pointer failure selection, a missing-file
error retaining labelled previous results, scoped configuration, narrow resize,
restart, the unsent draft and concurrent main-agent work. Cancel, titlebar `[x]`
and Alt+Q settle the controlled report operation without stopping that model.
At 60×24, PageDown must reach the final line of a long diagnostic; PageUp must
return to the unchanged path field. These are mandatory source and installed
archive observations for the report package. This wait is a
fixture dependency, not a measurement of disk latency. No live model or user
credentials are used. See the [package guide](../../plugins/test-reports/README.md).

A repeated successful read must enter the controlled dependency before the bench
releases it and waits for completion. The retained `Report loaded.` label alone
cannot acknowledge a new operation; configuring against that stale label can
race an active read. The concurrent-read capture also rejects `Cancel read`.

## Immediate controls and conversation recovery

`node tools/visual/plugin-check.mjs auto-approve` opens the optional audit history
explicitly, then closes it and runs `/auto on|off|status` while a controlled model
stream stays active. Those short commands must not reopen a pane. It closes the
main conversation with an unsent draft, restores it through Alt+Enter, then uses
`/chat` to restore/focus one existing conversation and return from workspace 2.
At 60×24 it pages through retained history to find the original held response.
The main model must continue independently, and a later prompt must still get
the second scripted response. The normal keyboard/mouse/restart checks follow.
This is actual source-app PTY evidence, not an external-model quality assessment
or proof of a compiled host archive. The fixture uses no saved profile or key.

## Independent resource monitor

`VISUAL_OUTPUT=dist/resources-proof node tools/visual/plugin-check.mjs resources`
loads the exact selected `resources` package through the real app. The main model
is held while the user opens the charts, waits for actual sample growth, pauses
across a measured observation window, switches tabs by mouse/keyboard, samples
manually, clears history, scrolls narrow controls, closes/reopens and restarts.
The fixture uses actual process counters, not seeded graph values.

For a complete extracted native host, use
`VISUAL_RESOURCES=1 VISUAL_EXECUTABLE=/path/to/extracted/compositor VISUAL_OUTPUT=dist/native-resources node tools/visual/agent-table-check.mjs`.
This uses the bundled plugin and one held-main loopback request; resource controls
must not produce additional model requests. Both paths record thirteen checks,
including the visual certification requirements, and capture wide/narrow/restart
screenshots. Source-host artifact certification can select an exact installed
plugin with `VISUAL_PLUGIN_DIR`; native proof uses bundled code only.
