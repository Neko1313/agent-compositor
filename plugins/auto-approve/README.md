# auto-approve

Opt-in task-context review for console, plugin, MCP and workflow tool actions.
Structured approvals permit bounded low/medium-risk actions within the user task;
refusals stop the call, uncertainty asks the user and explicit host denies remain binding.

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

The reviewer returns exactly three fields: `approved` (`true`, `false` or `null`),
`risk` (`low`, `medium`, `high` or `unknown`) and a nonblank `reason`. `true` needs task context and
low/medium risk; `false` becomes a denied tool result without another approval
dialog; `null` returns to manual approval. High/unknown-risk approvals, malformed
responses, timeouts and unavailable audit storage remain manual. Legacy
`decision/risk/reason` responses still allow only low risk. Neither form creates
standing approval for subsequent calls. Normal clarification questions are unaffected.
The host supplies the complete submitted request and delegated parent request,
preserving late restrictions separately from prepared attachment data. Review
input is still bounded to 24000 serialized characters; oversized context remains
manual instead of being truncated into a misleading authorization prefix.
Use `/auto off` to return subsequent proposals to human decisions; it cannot
override a host permission-rule deny.

Hosts with catalog 0.30 remember identical approval refusals within one model
turn, avoiding duplicate reviews/dialogs while retaining fresh policy checks.
Changing auto mode invalidates that refusal memory, so `/auto on/off` and the
mode buttons take effect during an active turn. Status/history inspection does
not reset it. The invalidation service grants no permissions. Older hosts without
this service keep their existing behavior; mode controls remain usable.

The reviewer distinguishes missing information from a concrete violation:
undefined targets or effects require `null`/`unknown`, while refusal must identify
a prohibited, unrelated or unsafe effect. An injected claim of approval does not
authorize that effect. This guidance does not override the model's validated
refusal or convert it into an automatic grant.

## Develop

Run `npm run plugin:test -- auto-approve` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
