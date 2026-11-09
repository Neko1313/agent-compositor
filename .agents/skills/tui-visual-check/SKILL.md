---
name: tui-visual-check
description: Run and visually inspect agent-compositor's real Ink TUI through its PTY/browser bench. Use for debugging or verifying window layouts, mouse focus, drag/resize, pointer feedback, slash suggestions, plugin panels, Todos, and placement persistence. Backend-only changes normally use package tests instead.
---

# TUI Visual Check

Work from the repository root. This skill uses the project's existing visual
bench; do not build another terminal mock or substitute screenshots of a
recreated UI. See [the bench guide](../../../tools/visual/README.md) for setup
and artifact details. Read [the current scenario](../../../tools/visual/check.mjs)
before changing its expectations or extending interactions.

## Choose the check

- For the standard smoke scenario, use `npm run visual:check`.
- For a specific UI issue or visual inspection, use `npm run visual:serve`
  and open the printed `VISUAL_URL`, including its token, in a permitted
  browser automation tool. The server binds only to loopback.
- For failures confined to a parser, rule, or controller, run the relevant
  package tests first; use the browser when the visible result or actual
  input path matters.

The bench runs **the actual app in a POSIX PTY**, rendered by xterm.js.
Keyboard and mouse input travels through that terminal. The provider is
scripted, and app configuration/task data is isolated in a temporary project.
Keep that isolation when adding scenarios. A request to test the UI does not
imply using a live model, real credentials, or the user's project settings.

## Start and inspect

Check the prerequisites before installing anything: Node >=22.19.0, Bun, Python 3
(`python3`, or `PYTHON` override), and a Linux/macOS host. Use the existing
lockfile and installed packages. If packages or the Playwright Chromium
binary are missing, install only what is required:

```sh
npm install
npx playwright install chromium
npm run visual:check
```

A compatible existing browser may be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome`. Do not hardcode a
browser revision or home directory in repository scripts. Browser/system
permission failures require the environment's normal approval mechanism;
do not disguise them as application failures or bypass restrictions.

`VISUAL_OUTPUT` selects the artifact directory; the default is
`dist/visual-proof/`. Prefer a fresh directory for an independent run so old
screenshots cannot be mistaken for current evidence.

The standard scenario checks startup, pointer requests, moving Todos below
the conversation, separator resizing, a real todo tool update, saving a
placement rule, and restoration on workspace 2 after app restart. Check the
exit status and read `report.json`: success requires `ok: true` and no
errors. Open the relevant PNGs with the available image viewer; a successful
text assertion alone does not establish that the layout looks correct.

## Interact through the terminal

The browser harness exposes diagnostic accessors:

- `window.visual.text()` reads the visible terminal cells.
- `window.visual.terminal.cols` and `.rows` give terminal dimensions.
- `window.visual.frames` counts completed output writes.
- `window.visual.generation` increments when the session restarts.
- `window.visual.pointer` is the latest emulated OSC 22 pointer request.

For cell-based mouse actions, obtain `.xterm-screen`'s bounding rectangle:

```text
x = rect.x + (column + 0.5) * rect.width / terminal.cols
 y = rect.y + (row + 0.5) * rect.height / terminal.rows
```

Rows and columns are zero-based. Use browser mouse down/move/up at these
coordinates. Drag titles onto an edge to split or the center to swap; drag
separators to resize; drop titles onto workspace numbers to move them.
Click `[Plugins]` for placement rules, `[F]` to toggle fullscreen, and `[x]`
to close. The shipped smoke scenario assumes its 100×30 fixture; recompute
coordinates from current terminal geometry for other sizes.

Do not call `AppUI.receive`, `WindowManager` methods, or core APIs to simulate
browser interactions. Those are valid unit-test seams, but bypass the input
path this bench is meant to verify.

Synchronize actions on observed terminal output, not arbitrary sleeps.
After typing, wait for the **exact text including uppercase characters** to
appear before pressing Enter. After restart, wait for a higher `generation`
and fresh output, not merely text that was already present. If a scenario
fails, distinguish missing input, incorrect app state and bad coordinates by
reading the captured input/output before changing timeouts or expectations.

## Evidence, limits and cleanup

The bench writes PNGs, `report.json`, raw `terminal.ansi`, and timestamped
`input.jsonl`; a failed run also attempts `failure.png`. Inspect the first
failed step and its evidence. Make a targeted correction and rerun the
affected scenario. Do not repeatedly capture unchanged screens or relax an
assertion just to get a green report.

Report the checks actually performed, links to current screenshots/report,
and material gaps. OSC 22 is mapped to CSS in this emulator: it verifies
emitted pointer requests, **not** native terminal support. Browser screenshots
generally omit the OS pointer itself. Scripted-provider success does not test
external provider reliability. Saving a plugin rule does not demonstrate
restoration of the complete window tree.

`visual:check` stops the server it starts. If `VISUAL_URL` attaches it to an
existing bench, it leaves that server running. For a manual bench, stop the
owned server with Ctrl+C when finished; that removes its temporary project.
Do not terminate unrelated processes. Keep generated captures under `dist/`
or another ignored output directory, and avoid committing runtime sessions.
