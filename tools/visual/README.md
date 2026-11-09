# Visual terminal bench

This is the real Ink app inside a POSIX PTY, displayed by xterm.js in a
browser. It is not a reimplementation of the UI. Browser keyboard and mouse
reports travel back through the PTY. The scripted provider exercises todos, delegation, questions, approvals, review
and independent agents; no external model or real project credentials are used.

Requires Node >=22, Bun, Python 3, and a POSIX host (Linux/macOS).

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

## Evidence

Artifacts default to `dist/visual-proof/` (override with `VISUAL_OUTPUT`):

- PNGs: animated Ghost frames, mouse pet reaction, pause and manual approval;
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

The default scenario checks the portable half-block path. Run
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

`npm run visual:mascot` is the focused native-graphics lifecycle check. It
verifies source dimensions, changing frames, pause, fullscreen, dragging Ghost
onto workspace 2, hiding/showing its placement, resizing, and removal. Combine
it with `VISUAL_EXECUTABLE` to verify the compiled distribution through the
same PTY, without external model requests. Evidence defaults to
`dist/visual-ghost-lifecycle/`.

### Native settings scenario

Run `npm run visual:settings` to exercise the Settings toolbar, provider preset,
editable connection form, masked API key, authenticated proxy form, independent
model/tool switches, cancellation and restoration after restart. The real TUI
runs in the same isolated PTY fixture. It uses fake keys and local dummy
addresses, and does not contact an external model. Artifacts default to
`dist/visual-settings/`; set `VISUAL_OUTPUT` for another run. Inspect the PNGs and
`report.json`. `input.jsonl` intentionally captures raw input: never use real
credentials in this diagnostic bench. Provider discovery/authentication and
transport behavior are also covered by package tests and `npm run eval:proxy`.
