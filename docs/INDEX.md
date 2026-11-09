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
| 6 | [06-core-blueprint.md](06-core-blueprint.md) | Core blueprint: best-of harvest from 8 local reference codebases; subsystem → reference → what we take | proposal |
| 7 | [agent-features.md](agent-features.md) | Implemented agent plan: commands, providers, auto, checkpoints, worktrees, extensions, usage and setup limits | implemented |

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
| 2026-11-08 | $ API methods are service.* events; core resolvers at chain end | accepted | Mods insight "each $ method is itself an event": interception via {deny}/{value} needs the call to flow through the dispatcher like any other event |
| 2026-11-08 | Core written greenfield as best-of harvest over 8 reference codebases (codex, gemini-cli, qwen-code, opencode, aider, crush, goose, kimi fork) — cloned under projects/reference/ | accepted | Nikita (10:21): the 14-CLI research must drive the design, not a single codebase; core is plugin-first from day one. Supersedes open item #3 ("port the fork loop") |

## Current application composition

The interactive product path is `app → AppUI → protocol → renderer-ink`;
input returns through the same protocol. `core` is the active multi-turn
engine. `agent` and its pane demo remain historical reference code.
`plugins` is a compatibility facade over the shared `loader` implementation.
The app resolves config permissions, enables configurable compaction, and
injects a skill index plus a service-backed skills tool. `/reload` performs
explicit hot reload between turns. The legacy `--plain`/piped REPL remains
available for script compatibility, outside the grid renderer path.

| Date | Decision | Status | Context |
|------|----------|--------|---------|
| 2026-11-08 | App TUI uses protocol-only renderer access | accepted | Core-side UI controller owns drafts, history, permission prompts and intent routing; Ink draws surfaces |
| 2026-11-08 | Share disk loading and reject sandboxed modules before import | accepted | QuickJS is not linked; `plugins` delegates to `loader`, app directory overrides are preserved |
| 2026-11-08 | Wire config permissions, compaction and progressive skills into app | accepted | App assembly owns defaults; full skill bodies are loaded through an interceptable service |

## Tiling compositor (2026-11-08)

The app now owns a binary split tree per workspace. Windows support
geometric focus, directional swaps, nearest-container resize, close/collapse,
and fullscreen. The message input and status stay docked. Plugin text
surfaces use `service.ui.surface` / `$.ui.surface`; focused plugin keys use
`ui.press`. Protocol 0.2 adds resolved rectangle `layout` messages, gated
by the `Layout` element capability. Layout state is currently in-memory;
multiple conversation views share the same core session. See the app README
for terminal bindings and limitations.

## Plugin placement policy (2026-11-08)

`$.ui.surface` accepts optional placement hints for `split`, `sidebar`,
`inspector` and `status-bar`. App config `ui.sites` and `ui.rules` override
hints. Rules match plugin identity and local surface id, last matching
field wins. The compositor inserts windows into workspace trees; the
renderer continues receiving resolved rectangles only. Placement is
creation-only so content updates preserve manual layout and focus.

## Placement control panel (2026-11-08)

The app exposes plugin surface placement through `[Plugins]`, Alt+p and
`/plugins`. Draft edits are applied explicitly. Save writes a project-local
JSONC rule with exact plugin/surface selectors, preserving comments and
unrelated settings. The core-side controller relocates existing windows;
renderers still receive only protocol frames. Full tree persistence remains
outside this feature.

## Mouse window operations (2026-11-08)

Protocol 0.3 adds optional mouse press/move/release phases, window title
controls and drop preview hints. The renderer decodes SGR reports and draws
the preview; the compositor owns capture, hit testing, splitting, swapping,
workspace drops and resize rollback. Press-only peers retain click focus.

## Hover pointer feedback (2026-11-08)

Protocol 0.4 adds capability-gated `pointer` messages. The compositor hit
tests hover; Ink translates pointer shapes into OSC 22 and enables all-motion
mouse reporting. Supported terminal emulators show grab, resize, button and
text pointers; unsupported terminals keep their native pointer.

## UI presentation plugins (2026-11-09)

Accepted: retain the tiling compositor and introduce a shared default theme,
semantic conversation/tool rows and a compact contextual footer. Plugins can
replace their appearance contribution with `$.ui.configure` and override named
portable text views through `ui.render`. Unload removes contributions; stale
async views are discarded. Protocol 0.5 transports resolved chrome.
See [UI appearance and view plugins](ui-theming.md).

## Main agent integration (2026-11-09)

Merged upstream through `70ebf21`: task/subagents, ask_user, tools.ts plugins,
stdio MCP and workflows. The common loader supports tools-only plugins while
retaining manifest validation, trust rules, command metadata and reload.
TUI questions use the same onAsk channel as the CLI; child questions inherit
it. Reload updates hooks, tools and future child composition together. Parent
interruption propagates to the child; child tool declarations are deduplicated.

## Documentation rules

- Every significant choice is recorded in the decision log: date, decision, status, context.
- Statuses: `draft` → `proposal` → `accepted` → (sometimes) `rejected` — with the reason noted.
- This router file is updated when a topic is added; topics are numbered in reading order.
- Documents are written from "why" to "how": motivation and concept first, contracts and implementation after.

- [Marketplace and plugin portability](marketplace.md)
- [Project state and network proxy](state-and-network.md)
- [Quality evals and Harness²](evals.md)

- [TUI design principles and segment review](tui-design.md): readable window
  projection, focus/action navigation, literal review input, contrast and
  replaceable plugin view metadata (2026-11-10).

- [Dependency maintenance](dependencies.md): stable library/tool versions,
  migration decisions and verification (2026-11-10).
