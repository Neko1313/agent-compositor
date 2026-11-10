# plugin-author

Create and improve Compositor plugins from a request: bundled skill, current contracts, starter files and non-executing structure checks.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable plugin-author --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- plugin-author` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

The bundled standard guide describes first-party automatic release preparation:
Conventional Commits feed the repository's generated version/changelog PR.
External plugin repositories provide their own release automation.
