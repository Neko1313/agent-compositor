# slash-commands

/help, /status, /usage — command palette harvested from Claude Code / Gemini CLI slash-command UX. Drop this folder to remove.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable slash-commands --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- slash-commands` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
