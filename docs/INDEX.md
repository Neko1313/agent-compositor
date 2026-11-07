# INDEX — documentation map and decision log

This is the router file: reading starts here. It links to topics and records significant decisions.

## Topics

| # | File | Topic | Status |
|---|------|-------|--------|
| 1 | [01-concept.md](01-concept.md) | Concept: what we are building and why | accepted |
| 2 | [02-ui.md](02-ui.md) | UI: the pane model, Ink, swappable renderers | accepted |
| 3 | [03-contracts.md](03-contracts.md) | Contracts for writing CLI plugins | draft |
| 4 | [04-motivation.md](04-motivation.md) | Motivation: why the world needs this | accepted |
| 5 | [05-prior-art.md](05-prior-art.md) | Prior art: architecture of Claude Code, VS Code, Neovim, Sway, Linux; what we adopt | accepted |

## Decision log

| Date | Decision | Status | Context |
|------|----------|--------|---------|
| 2026-11-07 | Build the compositor, don't rewrite the core | accepted | The core is a driver stack; a rewrite is months of work with no architectural gain |
| 2026-11-07 | Ink as the TUI component model | accepted | Community and example-code density are critical for agent-driven development; the render engine is a consumable |
| 2026-11-07 | Claude Mods API compatibility as the entry point | accepted | Xwayland strategy: compatibility with an existing protocol brings users from day one |
| 2026-11-07 | "Everything inside the core is an event" | accepted | Every `$`-API call goes through the event bus; extensibility without forking |
| 2026-11-08 | Public repository, MIT license | accepted | Frictionless reuse is part of the project's motivation |
| 2026-11-08 | English-only documentation | accepted | Audience is the world, not one team |
| 2026-11-08 | Mirror Claude Mods event/API taxonomy 1:1 | accepted | Xwayland strategy, confirmed against the v2.1.290 official reference |
| 2026-11-08 | Prior-art synthesis (see 05) | accepted | Five reference systems studied at code level; adoption table is the v1 blueprint |
| 2026-11-08 | Code starts with contracts: events + protocol packages | accepted | Runtime core ports from the kimi-code fork; everything else derives from the catalog |
| 2026-11-08 | Catalog as zod-defined source of truth, docs generated | accepted | Neovim api-metadata pattern; closes review gap #2; CI enforces drift |
| 2026-11-08 | Wire protocol handshake = LSP-style capabilities + semver | accepted | Major mismatch fails; minor negotiates to lower; no shared surface fails |
| 2026-11-08 | Runtime dispatcher as the first code above the wire | accepted | Onion chains, tier order, budgets (own/thread/yield), fail-operational, chain trace; Xwayland hook API sits on top of this |
| 2026-11-08 | Response forms matched by discriminating key + safeParse | accepted | z.object with z.unknown() accepts missing keys — safeParse alone cannot discriminate forms |

## Documentation rules

- Every significant choice is recorded in the decision log: date, decision, status, context.
- Statuses: `draft` → `proposal` → `accepted` → (sometimes) `rejected` — with the reason noted.
- This router file is updated when a topic is added; topics are numbered in reading order.
- Documents are written from "why" to "how": motivation and concept first, contracts and implementation after.
