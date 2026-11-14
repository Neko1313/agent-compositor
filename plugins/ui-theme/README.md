# ui-theme

Switch between slate, amber and mono themes. Demonstrates appearance and ui.render overrides.

`/theme slate|amber|mono` publishes portable appearance in Ink and the opt-in
OpenTUI frontend. Amber and mono include explicit selection color pairs for
readable text with either frontend's defaults. The status-text `ui.render`
override currently applies to Ink; OpenTUI render overrides remain separate
migration work. See [appearance semantics](../../docs/ui-theming.md).

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable ui-theme --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- ui-theme` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
