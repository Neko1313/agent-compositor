# auto-approve

Opt-in risk review for arbitrary console, plugin, MCP and workflow tool actions. Only low-risk decisions pass automatically; explicit denies remain binding.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable auto-approve --project` (or `--user`), then `/reload`.

`/auto on` enables review for the current session using the active model/provider.
`/auto on|off|status` are immediate user controls, including while the model is
working. They respond with notifications and do not open a panel. `/auto history`
explicitly opens the optional audit view with mode controls. Closing that view
does not disable review or cause subsequent reviews to reopen it. This command
path requires a host with catalog 0.25 or later.
A separate reviewer profile is optional: set `profile` in scoped `auto.json` to
use one. An invalid explicit profile returns to manual approval rather than
silently selecting another provider. Review limits, exact-call context and
failure behavior are described in the [auto review guide](../../docs/agent-features.md#auto-review).

## Develop

Run `npm run plugin:test -- auto-approve` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
