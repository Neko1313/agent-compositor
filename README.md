# agent-compositor

An open runtime for LLM CLI agents: **core + swappable renderers + plugin contracts**.

A model provider integrates via plugins, not by forking: override the login with their own SSO, add a model plugin and workflow presets — and get a full-featured CLI agent. Analogous to a Wayland compositor: the protocol is stable, implementations are replaceable.

## Tech stack

| Layer | Technology |
|---|---|
| Core (agent harness: models, tools, sessions, context compaction) | TypeScript / Node.js |
| Plugin runtime | In-process, onion event chain; Claude Mods API compatible |
| Sandbox for generated code | Replaceable Monty plugin for Python with explicit host capabilities |
| Code navigation | Replaceable Callix plugin using the native CLI JSON graph |
| Reference TUI | Ink (React + Yoga flexbox), scroll views built in |
| Core ↔ renderer protocol | JSON Lines, semver-versioned |
| License | MIT |

## Packages

The implemented agent feature set, commands, configuration and limits are in
[the agent features guide](docs/agent-features.md), including auto review,
independent worktree agents, checkpoints, authentication and extension management.

| Package | What it is |
|---|---|
| [`@agent-compositor/events`](packages/events) | Versioned event catalog: the contract between core, plugins, and renderers. Source of truth in code; `npm run gen` emits [docs/events.md](docs/events.md) + `schema/events.json`, CI fails on drift. |
| [`@agent-compositor/protocol`](packages/protocol) | Wire protocol between core and renderers: JSONL framing, LSP-style capability handshake, Neovim-style grid/diff rendering with flush. |

| [`@agent-compositor/runtime`](packages/runtime) | Event dispatcher: onion hook chains with tier ordering (prepend→user→append→builtin→core), own/thread/yield budgets, fail-operational faults, chain trace (`--plugin-trace`). |
| [`@agent-compositor/hooks`](packages/hooks) | The `$` API (Xwayland surface): every `$` method is itself a `service.*` event — plugins intercept each other's calls with `{deny}`/`{value}`; per-plugin state, workspace-confined fs, model/auth provider contracts. |
| [`@agent-compositor/loader`](packages/loader) | Plugin loader: discovers `plugins/*/plugin.json` on disk (project + user config dirs), registers through the HooksHost with tier/trust from the manifest, hot-reloads with reverse teardown. |
| [`@agent-compositor/renderer-ink`](packages/renderer-ink) | Reference terminal renderer: consumes the wire protocol (declare/render/focus), draws surfaces with Ink 8, turns keystrokes into `input` messages. Render-only by contract — the core it faces could be in-process or across a pipe. |

Try the end-to-end headless demo (stdout = protocol JSONL, stderr = chain trace):

```sh
npm install && npm run example:headless
```

Or the disk-plugin demo (load → run → edit on disk → hot-reload):

```sh
npm run example:loader   # or: npm run example:ink (interactive TUI)
```

Run the interactive app with `npm run start -w @agent-compositor/app` (Bun required). Provider settings are documented in the app README.

## Documentation

Start with [docs/INDEX.md](docs/INDEX.md) — a map of all topics and the decision log:

1. [Concept](docs/01-concept.md) — what we are building and why
2. [UI](docs/02-ui.md) — the pane model, Ink, swappable renderers
3. [Contracts](docs/03-contracts.md) — what is needed to write plugins for the CLI
4. [Motivation](docs/04-motivation.md) — why the world needs this

## Status

Working prototype: streaming agent core, tools, sessions, permissions, compaction, skills, disk plugins and an interactive Ink UI. The app UI uses the versioned core/renderer protocol. See [app usage and configuration](packages/app/README.md), [native Callix setup](plugins/callix/README.md), and [Monty sandbox](plugins/monty/README.md). Workflows execute Python through the selected sandbox; legacy JavaScript journals are preserved for inspection. Marketplace and web rendering remain future work.

## License

MIT — see [LICENSE](LICENSE).

## Visual verification

Run the actual TUI in a browser-backed PTY with `npm run visual:serve`, or
exercise drag, resize, task updates and restart persistence with
`npm run visual:check`. See [the visual bench guide](tools/visual/README.md).

## Marketplace, state and quality

- [Plugin marketplaces and Claude-format compatibility](docs/marketplace.md).
- [Home/project state, plugin storage API and network proxy](docs/state-and-network.md).
- [Quality evals, Ollama and Harness² adapter](docs/evals.md).

Quick checks: `npm run marketplace:validate`, `npm run eval`, `npm run eval:proxy`,
`npm run test:ci`. Live Ollama checks: `npm run eval:ollama`.
