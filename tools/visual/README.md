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
