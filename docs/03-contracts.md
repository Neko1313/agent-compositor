# 03. Contracts for CLI plugins

## Philosophy

A contract is a syscall ABI: versioned (semver), changed only through an explicit procedure, documented as a catalog. A plugin written against contract version N keeps working on N+1.

## Replacement contract — accepted target

Decision: 2026-11-10. The only fixed product mechanism is tiling: window-tree
ownership, geometry, workspaces, focus routing, and drag/resize. All other UI
and agent behavior must be replaceable without editing the host. This decision
supersedes earlier rules that made the composer and system dialogs permanently
host-owned. Existing exceptions below describe the implementation during the
migration, not the target architecture.

| Component | Required replacement surface |
|---|---|
| Message editor, completions and non-tiling shortcuts | Rendering, input handling, draft state, submission/steering intents and teardown |
| Approval, question and settings dialogs | Rendering, editing, validation, explicit results, cancellation and pending-request cleanup |
| Conversation, tools, status controls and window decoration | Content, interaction and presentation within compositor-owned rectangles |
| Commands, providers, auth and model selection | Default and extension implementations use the same public service paths |
| Tool definitions and execution | Explicit replacement of schemas/handlers; rewritten calls reach execution and permission evaluation consistently |
| Agent execution, recovery and context management | Replaceable orchestration strategies, rather than observers around fixed algorithms |
| Session and other state services | Replaceable persistence/control implementations with explicit lifecycle contracts |

Implementation requirements:

- Defaults and extensions use the same selection and lifecycle mechanisms.
  Selection must identify the active provider and report missing or conflicting
  providers; duplicate names must not silently discard a requested replacement.
- A visual override must not retain obsolete default hit areas or key handling.
  Components return semantic actions/results; the tiling manager retains control
  of window geometry and focus routing.
- Private editor/form state belongs to its selected implementation and does not
  become a broadcast event payload. Replacing a component does not require
  exposing passwords to unrelated render hooks or recording drafts in logs.
- Reload, disable, session switching and cancellation must dispose old instances,
  resolve or cancel pending interactions, and remove stale contributions.
- Replacement preserves the negotiated contract and the user's configured
  policy. A new dialog must return an explicit decision through the normal
  permission path; changing its appearance is not implicit authorization.

Acceptance requires actual external extensions, not only constructor injection
in tests: replace an editor and a dialog (including their input behavior), a
built-in tool definition, an auth flow, an agent strategy and a session service;
then verify unload/reload, cancellation and resumption with the same tiling
manager. Tests must also prove that rewritten tool arguments reach execution,
rendering cannot mutate agent state, and an unresponsive async hook cannot hold
the chain indefinitely. Until those checks exist and pass, describe the system
as extensible at selected seams rather than universally replaceable.

## 1. Event catalog

A machine-readable schema plus a human-readable document (`docs/events.md`). Every event: a name in the `plugin.foo:bar` format (namespaces instead of flat strings), a version, a payload schema, response forms, a default budget. Legacy names exist only as aliases in the schema — no multiplying handlers.

Base domains:

| Event | When | Response forms |
|---|---|---|
| `session.start` / `session.reload` / `session.shutdown` | Session lifecycle; reload is a state-recovery point | — |
| `tool.call` | Tool execution | `result`, `deny` |
| `tool.check` | Pre-execution check | `allow`, `ask`, `deny` |
| `agent.spawn` | Launching a child agent | `agentId`, `deny` |
| `prompt.compose` | System prompt assembly | `sections[{id, text, scope}]` |
| `ui.render` | Pane rendering | — (writing plugin state during render is forbidden) |

## 2. Hook contract

- **Onion chain:** a handler receives the event and `next()`; it may call `next(rewrittenEvent)`. Whoever doesn't call `next()` is the terminal.
- **Order:** explicit priority, not registration order (otherwise determinism breaks when the plugin set changes).
- **Budgets:** an own-time limit per handler; the clock runs only while the handler itself is working and stops on `await next()`. On exceed → fail-operational: a `.catch` window → replay. A handler error never kills the session.

## 3. Trust model — three classes

| Class | Execution | Purpose |
|---|---|---|
| `trusted` | Node.js, full access | provider plugins, first-party |
| `sandboxed` | Explicit language host required; TS modules currently refused | generated code through a replaceable sandbox provider |
| `render-only` | no state mutations | themes, layouts, visualizations |

The class is declared in the manifest and enforced by the runtime.

## 4. Plugin manifest

`plugin.json`: name, version, declared events, trust class, capabilities (`model` | `auth` | `workflow` | `tool` | `render`), status-bar contribution. Loader-only fields include `main` (entry file, default `hooks.ts` → `index.ts` → `index.js` → `index.mjs`), `tier` (chain tier, default `user`), `mcpServers` (validated stdio declarations/config references) and `resources` (additional package-local runtime files retained in bundles). A package can combine hooks/services, UI, tools, skills and MCP; skill-only/MCP-only packages need no dummy hook entry. See [composition and ownership](../plugins/plugin-author/skills/create-plugin/references/composition.md).

```json
{
  "name": "safety",
  "version": "0.1.0",
  "trust": "trusted",
  "tier": "append",
  "main": "./index.ts"
}
```

The hooks module exports a named `hooks` object: event name → `(event, $) => response | undefined`.

Search dirs, in precedence order (first hit wins name collisions): `./plugins`, `./.agent-compositor/plugins`, `$XDG_CONFIG_HOME/agent-compositor/plugins`. One corrupt manifest never blocks the rest; `sandboxed` plugin modules are refused until an explicit language host is linked. Monty is selected for generated Python, separately from trusted TypeScript module loading.

Replaceable service providers declare `provides` in their manifest. The app's
`serviceProviders` maps canonical event names to a selected plugin, while guard
hooks remain in the chain. `disabledPlugins` removes a plugin and its tools.
For example, `callix` provides `service.project.query` through the native CLI's
JSON graph. Trusted providers may declare bounded `hookTimeouts` for slow
operations; cancellation is exposed through `$.signal`.

Reload = reverse teardown (hooks + per-plugin state) + cache-busted re-import. State does not survive a reload — `session.reload` with the new composition is the documented recovery point.

Installing/enabling a plugin → a `session.start` event with its composition (udev analogy: the module saw the device). Disabling → `session.reload` without it; the plugin's in-memory state is recreated.

## 5. Model provider contract

A minimal model plugin: **name**, endpoint/interface, context limits, message format. Override is by name: a provider registers `my-model`, and the core can call it from workflows by that name. Prompt optimizations for their own model are an optional layer of the same plugin.

## 6. Authorization contract

Capability `auth`: a `login()` method. The base distribution ships form login; a corporate provider brings a plugin with their own SSO/OAuth — the core doesn't change.

## 7. Workflow contract

A workflow = data + a script in the sandbox (class `sandboxed`):

- **nouns** — domain entities (extending the language via a name table, with ownership);
- **`$`-API** — `spawn`, `emit`, `state`, `ui`: every call goes through the event bus;
- **journal** — an append-only log of steps: resume after a crash without losing progress;
- **limits** — a shared tokenBudget, concurrency (1–64), stagger delays against thundering herd.

## 8. Core ↔ renderer protocol

JSONL, semver. Messages:

| Direction | Message | Purpose |
|---|---|---|
| core → renderer | `declare` | Surface declarations (pane, site, status bar) |
| core → renderer | `render` | Full or incremental diff of a pane |
| renderer → core | `input` | Input → the focused pane |
| both | `focus`, `invalidate` | Focus transfer, damaged-region marking |

The renderer never calls the core outside the protocol. `hello`/`hello-ack` negotiate version and shared surfaces at session start.

The acceptance test is behavioral: two renderers on the same event log must produce identical user-visible output. `@agent-compositor/renderer-ink` is the reference terminal implementation (Ink 8, grid state machine + React view); a web/desktop renderer can replace it without touching the core.

Renderers own: cell-grid semantics (full/diff ops, scroll, cursor), style mapping to their toolkit, input key mapping. Renderers never own: focus policy for panes they didn't draw, event ordering, plugin state.

## Implementation status

Current core composition and strategy replacements are documented in
[core-customization.md](core-customization.md). Catalog 0.18 adds these services;
the older milestone list below is historical. Explicit within-tier priorities,
awaited middleware continuations, bounded asynchronous hooks and atomic plugin
registration are now implemented. Selected editor/dialog/placement/history
controllers and full session repository replacement are described in
[ui-controllers.md](ui-controllers.md), including privacy, lifecycle and limits.

The base runtime is implemented in the kimi-code fork and has passed an external review (Claude Mods API compatibility is pinned by a fixture). In this repo the kernel-side packages are implemented and tested end-to-end:

- **events** — versioned catalog (26 events), generated docs + JSON schema, CI-frozen shapes;
- **runtime** — onion-chain dispatcher with thread/own/yield budgets, fail-operational faults, chain trace (`--plugin-trace`);
- **hooks** — mods-style `(event, $)` layer; service-backed `$` methods are `service.*` events; private UI capabilities bypass broadcasts; per-plugin state; workspace confinement for fs/exec;
- **loader** — disk discovery, manifest validation, tiered registration, hot reload with reverse teardown;
- **protocol** — JSONL wire codec + handshake with version negotiation;
- **renderer-ink** — reference terminal renderer (grid state machine + Ink view); runs the full contour disk → runtime → protocol → Ink with input routed back;
- **agent** — reference agent loop: `prompt.submit → turn.start → service.model.complete → tool.call → tool.check → service.exec.run/service.fs.* → turn.complete`. Builtin tools ride the $ API events, so core operations are interceptable like anything else. Providers: OpenAI-compatible streaming (fetch, no SDK) + scripted provider for tests. `SessionPane` streams assistant text to the wire as grid diff ops.

Open items:

1. ~~Explicit priority instead of registration order~~ — implemented with manifest `priority` within each tier;
2. Structured core→renderer delta channel (today streaming renders as grid diffs; a web/desktop renderer may want a protocol minor with typed deltas);
3. ~~Porting the kimi-code agent core~~ — **superseded** by [06-core-blueprint.md](06-core-blueprint.md): the core is written greenfield as a best-of harvest over 8 local reference codebases; the fork is one reference among them.
