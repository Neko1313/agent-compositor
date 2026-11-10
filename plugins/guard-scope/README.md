# guard-scope

Workspace jail for write/edit tools: paths escaping the session cwd are denied regardless of config permissions (belt over the builtin rules' suspenders). Drop this folder to remove.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable guard-scope --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- guard-scope` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
