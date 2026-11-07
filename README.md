# agent-compositor

An open runtime for LLM CLI agents: **core + swappable renderers + plugin contracts**.

A model provider integrates via plugins, not by forking: override the login with their own SSO, add a model plugin and workflow presets — and get a full-featured CLI agent. Analogous to a Wayland compositor: the protocol is stable, implementations are replaceable.

## Tech stack

| Layer | Technology |
|---|---|
| Core (agent harness: models, tools, sessions, context compaction) | TypeScript / Node.js |
| Plugin runtime | In-process, onion event chain; Claude Mods API compatible |
| Sandbox for generated code | QuickJS (workflow scripts with budgets) |
| Reference TUI | Ink (React + Yoga flexbox), scroll views built in |
| Core ↔ renderer protocol | JSON Lines, semver-versioned |
| License | MIT |

## Packages

| Package | What it is |
|---|---|
| [`@agent-compositor/events`](packages/events) | Versioned event catalog: the contract between core, plugins, and renderers. Source of truth in code; `npm run gen` emits [docs/events.md](docs/events.md) + `schema/events.json`, CI fails on drift. |
| [`@agent-compositor/protocol`](packages/protocol) | Wire protocol between core and renderers: JSONL framing, LSP-style capability handshake, Neovim-style grid/diff rendering with flush. |

| [`@agent-compositor/runtime`](packages/runtime) | Event dispatcher: onion hook chains with tier ordering (prepend→user→append→builtin→core), own/thread/yield budgets, fail-operational faults, chain trace (`--plugin-trace`). |
| [`@agent-compositor/hooks`](packages/hooks) | The `$` API (Xwayland surface): every `$` method is itself a `service.*` event — plugins intercept each other's calls with `{deny}`/`{value}`; per-plugin state, workspace-confined fs, model/auth provider contracts. |
| [`@agent-compositor/loader`](packages/loader) | Plugin loader: discovers `plugins/*/plugin.json` on disk (project + user config dirs), registers through the HooksHost with tier/trust from the manifest, hot-reloads with reverse teardown. |

Try the end-to-end headless demo (stdout = protocol JSONL, stderr = chain trace):

```sh
npm install && npm run example:headless
```

Or the disk-plugin demo (load → run → edit on disk → hot-reload):

```sh
npm run example:loader
```

## Documentation

Start with [docs/INDEX.md](docs/INDEX.md) — a map of all topics and the decision log:

1. [Concept](docs/01-concept.md) — what we are building and why
2. [UI](docs/02-ui.md) — the pane model, Ink, swappable renderers
3. [Contracts](docs/03-contracts.md) — what is needed to write plugins for the CLI
4. [Motivation](docs/04-motivation.md) — why the world needs this

## Status

Design stage. The core is growing out of the [kimi-code](https://github.com/Neko1313/kimi-code) fork (branch `feat/plugin-in-process-runtime-poc`): the in-process plugin runtime is already production-shaped and has passed an external architecture review.

## License

MIT — see [LICENSE](LICENSE).
