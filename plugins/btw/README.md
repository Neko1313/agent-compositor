# btw

`/btw <question>` opens an independent agent conversation while the main task
continues. Type follow-ups directly in its pane and press Enter. Its transcript,
tools, task and budgets belong to its own persisted session. The agent shares
the current project workspace and permission configuration; this is not a Git
worktree or a read-only answer mode.

`/btw` reopens the last side conversation for this project, including after a
restart. With no saved conversation it opens an empty one. A new question starts
a new conversation; normal independent-agent count and token/step limits apply.
Closing its pane leaves the agent running; Ctrl+C while focused on its pane stops
that agent. Unsent pane drafts survive closing/reopening during the process,
but are not persisted across restart. Use Alt+i followed by `/chat` to return to
the main conversation. `/agents` lists saved agents for further management.

For the former notification-only behavior, use `/btw --once <question>`. It
makes an isolated model call with no conversation context or tools and posts the
answer as a notification. This remains useful in plain/headless sessions.

Side conversations require catalog 0.26 or later and enabled `agent-hub` support.
If it is disabled, the command reports the missing capability; it does not send
the question to the main model. The `--once` mode works without agent-hub.
Disabling/removing btw does not delete or stop independently managed agents;
manage them through `/agents`.

## Use

This plugin is available through the default `agent-compositor` marketplace.
Installation does not enable it. Install in the chosen scope first to pin its
version independently of the host, then enable explicitly with
`/extensions enable btw --project` (or `--user`), then `/reload`.

## Develop

Run `npm run plugin:test -- btw` from the repository root.
`plugin.test.json` declares the behavioral suites and optional visual/eval checks.
See [the plugin standard](../../docs/plugin-standard.md) for lifecycle, scope,
compatibility and independent release requirements. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).
