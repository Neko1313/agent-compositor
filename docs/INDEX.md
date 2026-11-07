# INDEX — documentation map and decision log

This is the router file: reading starts here. It links to topics and records significant decisions.

## Topics

| # | File | Topic | Status |
|---|------|-------|--------|
| 1 | [01-concept.md](01-concept.md) | Concept: what we are building and why | accepted |
| 2 | [02-ui.md](02-ui.md) | UI: the pane model, Ink, swappable renderers | accepted |
| 3 | [03-contracts.md](03-contracts.md) | Contracts for writing CLI plugins | draft |
| 4 | [04-motivation.md](04-motivation.md) | Motivation: why the world needs this | accepted |

## Decision log

| Date | Decision | Status | Context |
|------|----------|--------|---------|
| 2026-11-07 | Build the compositor, don't rewrite the core | accepted | The core is a driver stack; a rewrite is months of work with no architectural gain |
| 2026-11-07 | Ink as the TUI component model | accepted | Community and example-code density are critical for agent-driven development; the render engine is a consumable |
| 2026-11-07 | Claude Mods API compatibility as the entry point | accepted | Xwayland strategy: compatibility with an existing protocol brings users from day one |
| 2026-11-07 | "Everything inside the core is an event" | accepted | Every `$`-API call goes through the event bus; extensibility without forking |
| 2026-11-08 | Public repository, MIT license | accepted | Frictionless reuse is part of the project's motivation |

## Documentation rules

- Every significant choice is recorded in the decision log: date, decision, status, context.
- Statuses: `draft` → `proposal` → `accepted` → (sometimes) `rejected` — with the reason noted.
- This router file is updated when a topic is added; topics are numbered in reading order.
- Documents are written from "why" to "how": motivation and concept first, contracts and implementation after.
