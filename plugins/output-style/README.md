# output-style

Output style for assistant text (Claude Code output-styles analog). /style terse strips filler openers ('Sure!', 'Certainly!'…), /style off disables. Rewrites assistant.text pre-render, so this plugin is trusted (render-only hooks see the opaque element tree). Drop this folder to remove.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable output-style --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- output-style` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
