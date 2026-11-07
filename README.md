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
