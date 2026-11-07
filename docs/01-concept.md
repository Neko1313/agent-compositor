# 01. Concept

## What this is

**agent-compositor** is an open runtime for LLM CLI agents, modeled on a Wayland compositor. The terminal is the display, the agent core is the kernel, plugins are clients. The protocol between them is versioned and stable; implementations are replaceable.

| Wayland | agent-compositor |
|---|---|
| DRM / kernel | Core: agent harness (models, tools, sessions, context compaction) |
| `wl_protocol` (versioned) | Event catalog + core ↔ renderer wire protocol (semver) |
| Clients | Plugins |
| Weston / Sway (replaceable compositor) | Renderers: TUI (Ink), headless, web |
| Surface (`wl_surface`) | Pane — a named cell buffer |
| Input and focus (seat) | Input routing between panes |
| Damage tracking | Incremental redraw (`invalidate`) |

## Three layers

1. **Core** — the untouchable "driver stack". An event bus: every API call passes through a chain of handlers (onion model: event → matchers → handlers → commands → core → back).
2. **Capability plugins** — models, SSO/login, workflow engines, tools. They change how the core behaves.
3. **Render-only** — everything that draws without mutating agent state: themes, layouts, visualizations.

## Principles

1. **Everything is an event.** Any extension is a handler for an event, not a patch to the core.
2. **The contract is stable, implementations change.** Like the syscall ABI in Linux: the event catalog is versioned, legacy names live on as aliases.
3. **A provider is a plugin, not a fork.** The minimal distribution: override the login with your own SSO and add a model plugin.
4. **Don't lock away technologies that work.** Mechanics that work well for one vendor (hooks, plugins, workflows) become native for everyone.
5. **The renderer is a consumable.** We marry the component model, not a specific engine; the engine can be replaced without touching the components.

## Where it grows from

The core is growing out of the [kimi-code](https://github.com/Neko1313/kimi-code) fork (branch `feat/plugin-in-process-runtime-poc`): an in-process plugin runtime with an onion event chain, `HookScope` budgets (the clock stops while a handler awaits `next()`), a fail-operational cascade (an error or timeout doesn't kill the session), and Claude Mods API compatibility. The runtime has passed an external architecture review; open items are listed in [03-contracts.md](03-contracts.md).
