# Project skills

## Project memory

Read [MEMORY.md](MEMORY.md) for saved project decisions and deferred topics.
The section "Agent features" records the feature-gap analysis versus Codex CLI,
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

## Repository language

Write repository documentation, comments, and project memory in English. Keep
chat replies in the user's language. Preserve intentional language support in
code and fixtures when translating repository text.

## Documentation maintenance

Read [docs/documentation.md](docs/documentation.md) before changing public behavior,
configuration, commands, extension contracts or operational limits. Update the
canonical documentation in the same change. Use `npm run docs:impact -- BASE_REF`
to find related pages; explain concretely when a change has no documentation impact.

Guides live in `docs/`; plugin README/changelog files remain owned by their plugin.
The Docusaurus site projects those sources into ignored `website/.content/`.
Never edit that projection or generated references by hand. Run `npm run gen` and
`npm run docs:gen` after changing their inputs, then `npm run docs:check`.
Keep executable tutorial examples in sync with their tested source files.
New pages must appear in `tools/docs/structure.mjs`; new packages need a mapping
in `tools/docs/coverage.json`. Current behavior belongs in maintained guides;
dated implementation notes and proposals remain clearly labeled as history.

## Plugin release metadata

Do not hand-bump plugin/catalog versions or duplicate commit summaries into plugin
changelogs for routine changes. Commit meaningful Conventional Commits (`fix`,
`feat`, and `!` / `BREAKING CHANGE` for incompatible changes). After a main-branch
push, `plugin-release-preparation` creates or refreshes the generated release PR.
It derives affected plugins from package files, bundled workspace inputs and
distribution tooling, updates versions/changelogs and development catalog entries,
and dispatches CI/documentation checks. Inspect `npm run plugin:prepare` from a
clean committed checkout when debugging the plan. The generated PR is reviewed
normally; it does not publish tags/archives or bypass certification. See
[independent plugin releases](docs/plugin-standard.md#independent-versions-and-releases).
