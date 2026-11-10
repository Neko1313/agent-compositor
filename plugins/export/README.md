# export

/export — dump the session transcript (your prompts + assistant text) to .agent-compositor/session-<id>.md (Claude Code /export analog). Buffer caps at 100k chars. Drop this folder to remove.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable export --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- export` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
