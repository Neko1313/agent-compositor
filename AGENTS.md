# Project skills

## Project memory

Read [MEMORY.md](MEMORY.md) for saved project decisions and deferred topics.
The section «Агент фичи» records the feature-gap analysis versus Codex CLI,
Gemini CLI and Claude Code; it is a deferred discussion, not an instruction
to implement the roadmap without a user request.

## tui-visual-check

For work on the terminal UI—rendering, window placement, mouse/keyboard
input, drag/resize, plugin panels, slash suggestions or visual regression—
read and use [.agents/skills/tui-visual-check/SKILL.md](.agents/skills/tui-visual-check/SKILL.md).
It describes how to run the real app in a browser-backed PTY, interact with
it, inspect screenshots and verify saved placement after restart.

The skill can also be invoked as `$tui-visual-check`. Its entry points are
`npm run visual:check` (automated scenario) and `npm run visual:serve`
(interactive inspection). Use package tests for backend-only changes unless
there is also a UI behavior to verify.

The maintained bench documentation is [tools/visual/README.md](tools/visual/README.md).
