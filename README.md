# agent-compositor

An open runtime for LLM CLI agents: **core + swappable renderers + plugin contracts**.

Read the **[documentation](https://neko1313.github.io/agent-compositor/)** for
getting started, architecture, extension development and the searchable plugin
reference. The site follows main; plugin versions are independent of the host.

The kernel is domain-independent. Select tools, instructions and plugins for a
particular workflow, or replace turn execution, tool scheduling, context and
journal strategies through public services. Coding capabilities can be omitted
entirely. See [core customization](docs/core-customization.md) for configuration,
extension contracts, and [UI controllers and session repositories](docs/ui-controllers.md)
for replacing input, dialogs, history and persistence.

A model provider integrates via plugins, not by forking: override the login with their own SSO, add a model plugin and workflow presets — and get a full-featured CLI agent. Analogous to a Wayland compositor: the protocol is stable, implementations are replaceable.

## Install

Linux (glibc 2.38+) and macOS, x64 and arm64:

```sh
curl -fsSL https://raw.githubusercontent.com/Neko1313/agent-compositor/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compositor --version
compositor
```

The installer verifies SHA-256 checksums and installs the executable, replaceable
standard plugins and animation assets under `$HOME/.local`. It leaves settings,
sessions and custom plugins intact. To update, run the same command again.
Since v0.4.0, all plugins start off and the repository marketplace
is available offline. Use `/marketplace` to install a package in your chosen
scope, then explicitly enable it with
`/extensions enable NAME --project` or `--user`, followed by `/reload`.
See [plugin standards and independent releases](docs/plugin-standard.md) and the
[mandatory testing and certification model](docs/plugin-testing.md).

To select a version or another installation prefix:

```sh
curl -fsSL https://raw.githubusercontent.com/Neko1313/agent-compositor/main/install.sh -o install-compositor.sh
sh install-compositor.sh --version v0.2.0 --prefix "$HOME/.local"
```

The core includes its runtime; Node.js and Bun are not required to start it.
The optional Monty sandbox needs Node.js 22+ on `PATH` (or `AGENT_NODE_BIN`).
New builds include the pinned native Callix executable with its plugin.
`CALLIX_BIN` can select your own executable. The already-published v0.1.1
archive predates bundling; use [explicit setup](plugins/callix/README.md) for it.
Models run through a configured provider: the default is Ollama at
`http://127.0.0.1:11434/v1` with `gemma4:31b-cloud`. You can select a provider
using `AGENT_BASE_URL`, `AGENT_MODEL` and `AGENT_API_KEY`.

Manual downloads are available in [GitHub Releases](https://github.com/Neko1313/agent-compositor/releases).
Extract the entire archive and keep `compositor` beside its `plugins/` and
`node_modules/` directories. See [release maintenance](docs/releases.md) for
building, verification and publishing with git-cliff.

## Internet and multiple projects

With the standard web plugin, `web_search` works without an API key and
`web_fetch` reads sources with URLs and outgoing links. `/web` shows setup.
Attach projects with `@~/proj`, absolute paths or `@"~/a project/file.ts"`;
use `/workspace add PATH` or repeated `--add-dir DIR` flags for additional scope.
Tools and independent agents can select an attached project's `cwd`.
See [internet and multiple projects](docs/workspaces-and-web.md).

## Create your own plugins

Version v0.4.0 includes the `plugin-author` plugin and `create-plugin` skill.
Use `/plugin <what the extension should do>` to develop a local command, tool,
panel, skill or service with the agent. `plugin_dev` supplies installed contracts,
starter files and non-executing structure checks. Explicitly enable the authored
plugin in a chosen scope, then use `/reload` between turns. See [plugin authoring](docs/plugin-authoring.md).

## Chat history

Use `/history`, `/sessions` or `/resume` without an ID to open searchable chat
history. Type a title, ID or conversation phrase; use arrows to preview a chat,
Enter to resume, or the mouse to select it and press Resume. Escape returns to
the prompt. Names default to the first task; the panel can rename chats and show
archived sessions. History is scoped to the current project's saved sessions.

Start directly in the picker with `compositor --resume` or `compositor --history`.
`compositor --resume <id>` and `/resume <id>` still open a known session directly.

## Ghost companion

The optional default Ghost plays GIF/APNG frames inside the message composer.
The renderer detects Kitty graphics or SIXEL; other terminals retain a compact
status instead of a block-art imitation. Use `/mascot off`, `/mascot pause`,
`/mascot resume` or `/mascot status`. Settings persist, and other plugins can
replace the companion. See [Ghost media configuration](plugins/mascot/README.md)
for terminal support, animation packs, source timing and verification limits.

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
| [`@agent-compositor/hooks`](packages/hooks) | The `$` API (Xwayland surface): service methods are `service.*` events; local forms and private settings use guarded host callbacks — plugins intercept each other's calls with `{deny}`/`{value}`; per-plugin state, workspace-confined fs, model/auth provider contracts. |
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

Start with [the documentation home](docs/overview.md) and
[the architecture map](docs/architecture.md). The
[documentation index](docs/INDEX.md) retains the dated decision log:

1. [Concept](docs/01-concept.md) — what we are building and why
2. [UI](docs/02-ui.md) — the pane model, Ink, swappable renderers
3. [Contracts](docs/03-contracts.md) — what is needed to write plugins for the CLI
4. [Motivation](docs/04-motivation.md) — why the world needs this

## Status

Working prototype: streaming agent core, tools, sessions, permissions, compaction, skills, disk plugins and an interactive Ink UI. The app UI uses the versioned core/renderer protocol. See [app usage and configuration](packages/app/README.md), [native Callix setup](plugins/callix/README.md), and [Monty sandbox](plugins/monty/README.md). Workflows execute Python through the selected sandbox; legacy JavaScript journals are preserved for inspection. Marketplaces distribute installable plugins; native packages can combine agent logic, UI, tools, skills and stdio MCP declarations. See [plugin authoring](docs/plugin-authoring.md) for features available since v0.4.0. A web renderer remains future work.

## License

MIT — see [LICENSE](LICENSE).

## Visual verification

Run the actual TUI in a browser-backed PTY with `npm run visual:serve`, or
exercise drag, resize, task updates and restart persistence with
`npm run visual:check`. See [the visual bench guide](tools/visual/README.md).

## Marketplace, state and quality

- [Plugin marketplaces and Claude-format compatibility](docs/marketplace.md).
- [Native provider/model settings, project storage and network proxy](docs/state-and-network.md). Click **Settings** in the TUI to configure connections and credentials.
- [Quality evals, Ollama and Harness² adapter](docs/evals.md).

Quick checks: `npm run marketplace:validate`, `npm run eval`, `npm run eval:proxy`,
`npm run test:ci`. Live Ollama checks: `npm run eval:ollama`.

The agent harness includes replaceable behavior/completion policies, per-session
`task_plan` progress (`/tasks`, `/continue`), automatic model-aware context
compaction and a context-budget indicator. Dynamic background workflows support
named dependency stages, expansion, bounded parallel agents and pause/resume/retry
in `/workflows`. See [agent controls](docs/agent-features.md#autonomous-execution-and-context-budgets),
[workflow contracts](plugins/workflows/README.md) and [outcome evals](docs/evals.md#agent-outcome-suite).
