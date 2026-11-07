# 05. Prior art: how model-extensible systems are architected

A code-level study of five reference systems and what agent-compositor should steal from each: Claude Code (the contract we mirror), VS Code (layering and contribution rules), Neovim (UI compositor and external renderers), Sway/wlroots (IPC and the compositor split), Linux (stability doctrine and module discipline). Plus tmux and LSP as protocol references.

---

## 1. Claude Code — the contract layer (what we mirror)

Distribution: npm wrapper (`@anthropic-ai/claude-code`) → per-platform native binary (v2.1.x, ~340 MB, Bun-compiled). Embedded source paths in the binary confirm the internal layout: `src/components/` (TUI), `src/services/` (api, tools, messages, config, plugins), `src/tools/` (BashTool, EditTool…), `src/plugins/functionHooks/` (mods runtime), `src/commands/`, `src/utils/`, `src/ink.ts` (custom Ink fork).

### Plugin packaging (directory contract)

```
plugin-name/
├── .claude-plugin/
│   ├── plugin.json            # manifest: name, version, components, userConfig
│   └── marketplace.json       # optional: distribution
├── hooks/hooks.json           # {"modules": ["./register.js"]}
├── hooks/register.(js|ts|tsx) # entry: export register(on, options)
├── types/index.d.ts           # PluginState + mods API namespaces (optional)
├── skills/ commands/ agents/  # markdown components
├── *.test.ts                  # claude plugin test
└── .mcp.json                  # MCP server wiring
```

Two registration modes per component type: **directory auto-discovery** (`"agents": "./agents"`) or **explicit array** (silent failure if you forget to add a file).

### Mods: the runtime contract (from the official reference, v2.1.290+)

- **Entry:** `register(on, options)`; `on(event, matcher?, hook)`; returns a registration with `.catch(handler)`.
- **Hook signature:** `async ($, e, next) => next(e)`. `$` = the mods API. `e` = deeply frozen event. `next(e)` = onion chain. Extra channels on `next`: `next.signal` (AbortSignal), `next.origin` (`{plugin, tier}`), `next.budget.ms/remainingMs`, `next.to(e, tier)`, `next.error` (in `.catch`: `throw` | `timeout` | `re-entry`), `next.called`.
- **Tiers (execution order):** `prepend` → `user` → `append` → `builtin` → `core`. Enterprise policy mods run in `prepend`; the built-in guard (`sec-default@builtin`) loads ahead of user mods on managed machines.
- **Event taxonomy** (seven groups): Tools (`tool.call`, `tool.check`, `tool.describe`), Prompts (`prompt.submit/fill/suggest/edit/autocomplete/compose/section/context/attachment/mention`, `skill.prompt`, `attribution.text`), Commands & config (`command.run/describe`, `config.set/describe`, `settings.read`), Turns (`turn.start`, `turn.step` — async generator, `turn.complete`), Session (`start/end/compact/receive/send/append/attach/detach/measure`), Subagents (`agent.offer`, `agent.spawn`), Interface (`ui.render`, `ui.resolve`, `ui.press/input/select`, `ui.focus/scroll`, `ui.close`, `ui.message`, `ui.fault`), Other mods (`plugin.register`, `engine.create`), Telemetry (`telemetry.log/mark`), Settings hooks (`classic.<Event>` — legacy alias form, exactly our `classic.PreToolUse`).
- **Mods API (`$`) namespaces:** `$.ui` (resolve/invalidate/open/close/panes/focus/scroll/toast/notify/status/log/notice/ask/copy/selection/blit), `$.command`, `$.tool`, `$.agent`, `$.model` (complete/fork/classify), `$.prompt`, `$.turn`, `$.session` (messages/usage/compact/send…), `$.config`, `$.settings`, `$.env`, `$.fs`, `$.store` (cross-session KV, 4 MiB), `$.state` (reactive, per-mod), `$.clock` (now/sleep/after/every), `$.http`, `$.process` (run ≤ 30 s default / 10 min max, stdout ≤ 4 MiB), `$.mcp`, `$.audio`, `$.telemetry`.
- **Every `$`-API method is also an event** (`fs.read`, `model.complete`, …): hooks can intercept each other's API calls with `next(e)` / `{deny}` / `{value}`. And `engine.create` lets a mod add namespaces to the API for others — with context lending rules.
- **Render sites** (extension points in the UI): `Pane`, `AbovePrompt` (band), `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`, `AskUserQuestion`, `ToolProgress`, `Spinner`, `TurnDuration`, `InfoNotice`, `SessionMode`, `PromptHint`. Surfaces: `terminal`, `desktop`, `vscode`.
- **Elements** (what a `ui.render` hook returns): `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg`, `Client` (remote module!), `Raster`, `Image`. Element tables are per-app via `$.ui.resolve` — one tree, three renderers, each draws what it can.
- **Limits as contract:** hook own-time 10 s (50 ms for `prompt.edit`), `.catch` 1 s, tree ≤ 20 000 elements / 32 depth / 100 000 chars, `invalidate` throttled 10/s (30/s for visible chrome), names `[A-Za-z0-9_-]{1,64}`.

**Reuse now:** the entire mods event/API taxonomy is our Xwayland — mirror it 1:1 (already the plan in kimi-code fork). The **render-site + element-table** design is exactly our Pane/Site model formalized: sites are named extension points, elements are the vocabulary, per-surface resolve is swappable renderers. Steal `next.to(tier)` and `next.budget` channels verbatim. Steal the limits table as our v1 defaults.

---

## 2. VS Code — layering and contribution rules (what we enforce in core)

Source organization (official wiki):

```
src/vs/
├── base/          # utilities + UI primitives; no dependencies
├── platform/      # DI + base services shared by all layers
├── editor/        # Monaco core (common + browser + contrib + standalone)
├── workbench/     # framework: explorer, status bar, panels, notebooks
│   ├── api/       # vscode.d.ts: extension host AND workbench implementations
│   ├── services/  # core services
│   └── contrib/   # ALL features live here
├── code/          # desktop entry: Electron main, shared process, CLI
└── server/        # remote entry
```

Rules that make it scale:

1. **Layers are one-directional.** `base` ← `platform` ← `editor|workbench` ← `code`. No dependency from outside `workbench/contrib` into `contrib`.
2. **Target environments per folder:** `common` (pure JS) ← `browser` ← `electron-browser`; `node` ← `electron-utility` ← `electron-main`. You may only import from your environment or below. This is how they ship desktop + web from one tree.
3. **One file registers a contribution:** every `contrib` has a single `*.contribution.ts` imported by the workbench entry points; everything else is internal. A contribution exposes its public surface from one `common/<name>.ts` file; reaching into another contribution's internals is forbidden.
4. **Services are interface + identifier + ctor:** `registerSingleton(IFoo, FooImpl, InstantiationType.Delayed)`; consumers get it by decorating a constructor arg. DI gives them lazy instantiation and test doubles.
5. **The extension host is a separate process; `vscode.d.ts` is the only door.** The API file is implemented on both sides (workbench side / extension side) over RPC — the single most important seam in the product.

**Reuse now:** the `common/browser/node` folder convention maps directly onto our `core` (pure agent harness) vs `renderer-tui` vs `renderer-web` split. Adopt the **single contribution file** rule for our plugins: one `register.ts`, public surface from one `index.ts`. Adopt **service identifier + DI** inside the core — the kimi-code fork grows services ad hoc; a lightweight DI container (or even just the identifier pattern) prevents the god-object drift. Adopt the rule: *core never imports from contrib* (for us: core never imports from plugins).

---

## 3. Neovim — the UI compositor and external renderers (our headless protocol)

`src/nvim/` is a flat module-per-concern C tree; the extensibility lives in named subsystems, not frameworks:

- `api/` + `msgpack_rpc/` — **the versioned API surface.** Every function in `api/*` (buffer, window, tabpage, ui, nvim_exec…) is exported over msgpack-rpc; `api-metadata` is generated from source annotations. This is the contract; anything scriptable goes through it.
- `lua/` — embedded Lua runtime (user scripting, in-proc like our `trusted` class).
- `eval/` + `viml/` — legacy scripting layer kept as an API-compatible subsystem (the "classic." alias pattern again).
- `autocmd.c`, `usercmd.c`, `keycodes.c` — event + command registries.
- **`ui_compositor.c` + `ui.c` + `ui_client.c` — the compositor.** The core computes an abstract grid (rows × cols of cells with attributes); any number of UI implementations attach. Built-in TUI or external process (`nvim --embed`) speaking **the same UI protocol over msgpack**. Grid events, line updates, `flush` batching, mode/cursor events. Damage tracking at line granularity (`invalidate` analog).
- `terminal.c`, `vterm/` — in-process terminal emulator (a tool, like our Bash tool).
- `os/`, `event/` — libuv loop, job control, channels.

**Reuse now:** this is the strongest precedent for our core↔renderer split — Neovim proved one protocol serves both in-proc TUI and arbitrary external renderers. Copy the **grid/flush batching** semantics into our `render` message (full grid state + batched deltas, not per-keystroke redraw). Copy **api-metadata generation from annotations**: we write `/** @event tool.call @since 1.0 */` on emitters and CI generates `docs/events.md` + a schema — solves our gap #2 mechanically. Copy `nvim --embed` as the headless test harness pattern.

---

## 4. Sway — IPC and the compositor split (our daemon/client story)

`sway/` tree: `main.c` (entry), `server.c` (wlroots backend ownership), `config/` (parser + runtime config), `commands/` (every runtime command as a registered function: `cmd_*(…)`), `tree/` (the scene graph: `output → workspace → container → view`), `desktop/` (XDG shell impls: `xdg_activation`, `xdg_decoration`), `input/` (seats, libinput), `ipc-server.c` + `ipc-json.c` (first-class JSON IPC), `scene_descriptor.c` (object → renderer descriptor mapping), `sway-bar` + `swaynag` (separate binaries speaking the same IPC).

Key structural decisions:

1. **All state lives in the tree; commands are pure-ish mutations on it.** `commands/` is a flat registry — adding a feature = adding a command + config stanza, no core change.
2. **IPC is not an afterthought.** swaynag and swaybar are separate processes rendering parts of the UI; i3-msg compatibility made an ecosystem of scripts possible.
3. **wlroots is the library-OS:** Sway itself is a (comparatively thin) policy layer over reusable primitives. Two other compositors (Hyprland, river) built on the same wlroots and diverge wildly in policy — proof that the split works.
4. **i3 compat:** the config syntax and IPC events deliberately mimic i3, so tools/scripts migrated day one (our Claude-Mods-compat play).

**Reuse now:** the **tree as the single source of truth** with command registry on top — our session state + `$`-API are exactly that; formalize it. IPC JSON events as a published vocabulary (we planned it; sway is the reference implementation shape: `ipc-server.c` ≈ our unix-socket JSONL, `swaybar` ≈ an external status-bar renderer). And the wlroots lesson — extract a **libagent** of primitives so other "compositors" (distributions) can have different policy over the same core.

---

## 5. Linux kernel — stability doctrine and module discipline

Top level: `arch/` (per-arch ports) · `kernel/` (core: sched, module, trace, locking, signals) · `mm/` · `fs/` · `net/` · `drivers/` (the bulk, out-of-tree-ables) · `security/` (LSM) · `include/` (the public ABI headers — the contract!) · `samples/` `tools/` `scripts/` (in-tree dev tooling).

`kernel/` internals worth stealing:

- `kernel/module/` — the module loader: init/exit lifecycle, symbol export table (`EXPORT_SYMBOL`), dependency resolution, signature verification, `MODULE_LICENSE` gating (GPL-only symbols = trust tiers in-kernel).
- `kernel/trace/` + `tracepoint.c` + `kprobes.c` — observability is a first-class subsystem with its own ABI (tracefs), not a debug afterthought. (Our chain-trace gap #1.)
- `kernel/bpf/` — the verifier-based sandbox for user-supplied programs attached to hook points: exactly our QuickJS sandbox role, with a **verifier** instead of just timeouts.
- `kernel/seccomp.c`, `capability.c`, `landlock` — capability-based mediation; namespacing (`nsproxy.c`).
- `livepatch/` — safe replacement of loaded modules (our hot-reload).

The doctrines (Linus-enforced, cultural more than technical):

1. **"Don't break userspace."** The ABI (syscalls, `/proc`, ioctl semantics) is frozen; internals change freely. Regressions in behavior are reverted regardless of whose fault.
2. **The contract is in `include/`.** Headers + UAPI are the boundary; everything implementation-side is private.
3. **Modules are second-class citizens by design** — they live in the tree (mainline) or suffer bit-rot; out-of-tree modules break constantly. The cultural pressure toward upstreaming keeps the ecosystem coherent.
4. **Everything is a file; everything is observable.** tracepoints, kprobes, ftrace, perf — you can watch any subsystem. A system you can't observe can't be operated.

**Reuse now:** the "don't break userspace" rule becomes our **"don't break plugins"** — once an event ships in the catalog, its shape is frozen; changes go through new versions. UAPI ≈ our events catalog + `docs/events.md`, generated and CI-enforced. The eBPF **verifier** model suggests: our QuickJS sandbox should eventually have a static check phase (bounded loops, no dynamic import) before execution, not only runtime budgets. And the tracepoints doctrine: ship `--plugin-trace` (chain trace) **before** v1.0 — observability retrofitted is observability never.

---

## 6. tmux and LSP — the protocol references

- **tmux** `src/`: `server.c` / `client.c` / `proc.c` (forked daemon + control client), `control.c` (**control mode** — a stable text protocol over the pane stream; iTerm2/DotZero render remote tmux as a native UI), `layout.c` (tree layouts: the status line splits), `format.c` (`#{…}` format strings — the ancestor of sway's IPC JSON and our `declare` messages), `options.c` (global/session/window/pane option cascade = our settings precedence), `hooks.c` (`set-hook` — before/after events on every command).
- **LSP**: client/server over stdio with **capability negotiation** in `initialize` — the cleanest versioned-handshake design in the industry. Server declares what it can; client adapts. Both sides then respect it for the session. Our core↔renderer protocol should copy this: first message = capabilities exchange (which sites, which elements, which surfaces), then traffic.

## The synthesis — what we adopt, from whom

| Decision | Adopt from | Concrete form |
|---|---|---|
| Event + `$`-API taxonomy | Claude Mods | Mirror 1:1 (Xwayland), `classic.*` aliases |
| Render sites + element tables + per-surface resolve | Claude Mods | Sites = our Pane/Site registry; `$.ui.resolve` semantics |
| Onion `next` with `budget` / `origin` / `to(tier)` | Claude Mods | Hook channels verbatim |
| Limits table as contract | Claude Mods | v1 defaults: 10 s hook, 1 s catch, 20k-element trees |
| Layer folders + target environments | VS Code | `core/common` ↔ `renderer/tui` ↔ `renderer/web`, import rules |
| Single contribution file + one public surface file | VS Code | Plugin: `register.ts` + `index.ts`, internals private |
| Service identifier DI inside core | VS Code | interfaces + `registerSingleton`-style, no god objects |
| Core never imports plugins | VS Code (contrib rule) | enforced by lint/CI boundary check |
| Grid/flush UI protocol | Neovim | Batched `render` diffs, `flush` cadence |
| API metadata generated from annotations | Neovim | `@event` JSDoc → CI-generated `docs/events.md` + schema |
| Headless embed mode | Neovim `--embed` | unix-socket JSONL = first-class renderer |
| Tree = single source of truth; command registry | Sway | Session state tree + `$`-API mutations only |
| JSON IPC event vocabulary | Sway | Published event catalog; external status bars/widgets |
| libagent core / policy split | wlroots | Distributions = thin policy over shared primitives |
| "Don't break plugins" doctrine | Linux | Frozen event shapes; versions, never renames |
| UAPI = generated headers | Linux `include/` | `docs/events.md` + types as the only door |
| Static sandbox verification | eBPF | QuickJS pre-flight verifier (bounded loops, no net) |
| Trace-first observability | Linux tracepoints | `--plugin-trace` before v1.0 |
| Capabilities handshake | LSP | First protocol message = negotiate sites/elements/surfaces |
| Option cascade precedence | tmux | user → project → managed settings merge |
