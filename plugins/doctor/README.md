# doctor

/doctor — sanity report: env vars (AGENT_BASE_URL/AGENT_API_KEY/AGENT_MODEL) and a live provider ping (Claude Code /doctor analog). Drop this folder to remove.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable doctor --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- doctor` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
