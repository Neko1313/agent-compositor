# cost

In the TUI, `/cost` and `/usage` uses an explicit UI route and remains available while the
agent works. It does not enter the model prompt queue. The line-based interface
retains its prompt-command handler.

/cost and /usage — token accounting from turn.usage events (Claude Code /cost analog). Tally survives across turns in plugin state; drop this folder to remove.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable cost --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- cost` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
