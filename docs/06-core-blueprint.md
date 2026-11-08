# 06 — Core blueprint: best-of harvest from 8 reference codebases

Status: proposal. Supersedes open item #3 in `03-contracts.md` ("port the kimi-code agent core" — the fork becomes one reference among eight, not the port source).

## Principle

The compositor core is written greenfield, plugin-first: every subsystem is a plugin surface from day one. No subsystem is copied wholesale. Reference repos (cloned under `projects/reference/`, plus the kimi-code fork) are read for design decisions and semantics; the code is ours, behind the catalog event seam.

Reference set: **codex, gemini-cli, qwen-code, opencode, aider, crush, goose, kimi-code fork**.

## Subsystem → reference → what we take

| # | Core subsystem | Primary reference | What we harvest |
|---|----------------|-------------------|-----------------|
| 1 | Config | **opencode** | 4-layer merge (global → project → system → MDM), farthest→closest, JSONC, `$schema`, `{env:VAR}` / `{file:path}` substitutions |
| 2 | Permissions & policies | **opencode** + **codex** | allow/ask/deny permission rules; execpolicy rule files (action + resource + effect); separate `policies` (deny provider, hard-deny, block MCP/skill/plugin) |
| 3 | Loop control | **kimi fork** + **codex** | prompt queue with notify/steer, cancel, max-steps, retry with snapshot; UX pattern Tab-queue vs Enter-inject |
| 4 | Tool set | **kimi fork** (semantics) | os (bash/glob/grep/read/write), edit — battle-tested schemas, undo, result truncation; executed through `tool.call → tool.check → service.*` |
| 5 | Context providers | **aider** (repo map) + **crush** (LSP) + **callix** (later) | tree-sitter repo map as cheap global context; symbol-level provider interface; pluggable context-provider plugin type |
| 6 | Plugins | **Claude** (docs) + **opencode** | git-repo marketplaces, npm/local sources, `plugin:command` namespaces, plugin components (commands/agents/skills/hooks/MCP) |
| 7 | Skills | **SKILL.md** standard (docs) | progressive disclosure; cross-catalog reading (`~/.claude/skills`, `~/.cursor/skills`) |
| 8 | Sessions | **codex** | resume/fork/archive/unarchive/delete, cwd-scoped, pickers |
| 9 | Compaction | **Claude** + **gemini** | `/compact [instructions]`; `/expand` to un-compact |
| 10 | Headless | standard (all 14) | `-p` one-shot + `stream-json` NDJSON events |
| 11 | Event seam / renderer | **compositor runtime** (done) | onion chains, tier budgets, fail-operational — settled, not reopened |

## Already settled (do not re-derive)

- Catalog as zod source of truth, codegen, drift CI (events package).
- Wire protocol: LSP-style handshake, grid diff rendering.
- Onion dispatcher with tier ordering, own/thread/yield budgets.
- `$` API = `service.*` events; core resolvers at chain end; core tools ride the events.
- Ink renderer behind the protocol; renderers own grid semantics only.

## Non-goals

- No wholesale file copying from any reference. Harvest = read, decide, write ours.
- No LSP protocol dependency in v1 (callix context-provider comes later, behind the provider interface).
- No DI container. The core composes by explicit constructors; plugin boundaries are the catalog events, not an IoC graph.

## Build order

1. **Config** (package `config`) — opencode layering, feeds settings into hooks host. — **DONE 2026-11-08** (system→global→project-walk, {env:}/{file:} subs with escape+comment semantics, JSONC, origin tracking with sensitive flags; 17 tests)
2. **Permissions** — policy rules + execpolicy-style rule files; resolves `tool.check` decisions.
3. **Sessions** — codex lifecycle semantics over the existing runtime state.
4. **Loop control** — queue/steer/cancel/retry on top of the reference loop.
5. **Tools** — real os/edit set through the event seam.
6. **Context** — repo map provider; callix provider interface reserved.
7. **Plugins & skills** — marketplace + SKILL.md loader.

Each step: implement, test, record decision in INDEX.
