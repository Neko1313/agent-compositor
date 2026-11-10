# 01. Concept

## What this is

**agent-compositor** is an open runtime for LLM CLI agents, modeled on a Wayland compositor. The terminal is the display, the agent core is the kernel, plugins are clients. The protocol between them is versioned and stable; implementations are replaceable.

The runtime is domain-independent. Software development is one possible
composition; operations and other professional workflows can select different
tools, authentication, instructions and execution strategies without inheriting
coding capabilities. See [core customization](core-customization.md) for the
implemented composition controls and their limits.

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

## Replacement boundary — accepted 2026-11-10

The tiling manager is the fixed product mechanism. It owns the window tree,
resolved rectangles, workspace membership, focus routing, and drag/resize
operations. Window decoration and the contents of those rectangles remain
replaceable.

Every other part of the application's UI and agent behavior must have a
replaceable implementation. This includes the message editor, completion
palette, conversation views, status controls, forms, questions, approval UI,
commands, model/auth integrations, tools, agent execution strategies, context
management, and session services. The shipped implementation is a default
provider, not an exclusive path hidden inside the application assembly.

Replacement means installing and selecting an extension without editing or
forking the host. Styling alone is insufficient: interactive components need
replaceable rendering, input handling, state transitions, and lifecycle.
Agent components need replaceable behavior through the same public contracts
used by the defaults. The event dispatcher and versioned protocols are the
shared infrastructure for these implementations; they do not justify keeping
non-tiling product policy inaccessible to extensions.

This is the accepted target boundary, not a statement that today's application
already implements it. The migration and acceptance criteria are recorded in
[03-contracts.md](03-contracts.md#replacement-contract--accepted-target).

## Where it grows from

The design grew out of the [kimi-code](https://github.com/Neko1313/kimi-code)
fork's in-process plugin experiment. The active core in this repository was
subsequently written independently, as recorded in [06-core-blueprint.md](06-core-blueprint.md).
Its event chains, execution budgets, compatibility adapters and replacement
surfaces are assessed against the current implementation and tests, rather than
the historical review of that earlier experiment.
