# Changelog

All notable changes are generated from Conventional Commits with git-cliff.

## v0.1.0 - 2026-11-09

### Build and maintenance
- Single-binary distribution via bun build --compile — smoke-tested headless (plugin discovery through compiled dynamic import, usage exit code, fail-operational turn error rendering); npm scripts build:binary/start; README with provider matrix and one-minute plugin ([5b4a0f3](https://github.com/Neko1313/agent-compositor/commit/5b4a0f3804db7f11f3eaf982fe067870027694cf))
- Ignore tsconfig.tsbuildinfo build artifacts (untrack previously committed ones) ([46d0836](https://github.com/Neko1313/agent-compositor/commit/46d08360270166f6fadbd316fc65f32b3f805d79))


### Documentation
- Initial design documentation — INDEX router, concept, UI, plugin contracts, motivation ([4e23c20](https://github.com/Neko1313/agent-compositor/commit/4e23c20550dea8542ea6e0bb8a9af6fa37a4d843))
- Translate all documentation to English ([2cf9c0b](https://github.com/Neko1313/agent-compositor/commit/2cf9c0b87f40a94a2412cbb20c0d4aa050eb77a4))
- Prior-art study — Claude Code, VS Code, Neovim, Sway, Linux architectures and adoption table ([22d6e0b](https://github.com/Neko1313/agent-compositor/commit/22d6e0b1f5dd872dff752459c975d94ace6eba9e))
- Core blueprint — best-of harvest from 8 reference codebases; supersedes fork-port open item ([f7004c7](https://github.com/Neko1313/agent-compositor/commit/f7004c7b153f77b510878e4c6deb0b0427eaf7c0))
- Translate repository documentation and memory to English ([1f4dd41](https://github.com/Neko1313/agent-compositor/commit/1f4dd4146a91fe830609823a060072020f9e221d))


### Features
- Event catalog + wire protocol packages with codegen, tests, and drift-checking CI ([41e4771](https://github.com/Neko1313/agent-compositor/commit/41e47717134fe4fd6c58d7c0fdcc83347a1f40fc))
- Onion event dispatcher — tier ordering, own/thread/yield budgets, fail-operational faults, chain trace; plus headless end-to-end example ([c4fdf10](https://github.com/Neko1313/agent-compositor/commit/c4fdf10dd5f9a9ece132afc673f95296004bed64))
- $ API layer — service.* events, per-plugin state, confined fs, provider contracts, interception; catalog 0.2.0 ([e537df8](https://github.com/Neko1313/agent-compositor/commit/e537df800702488f7a393be8d278fe78f7f93fb2))
- Plugin loader — disk discovery, manifest validation, tiered registration, hot reload with reverse teardown ([e667087](https://github.com/Neko1313/agent-compositor/commit/e6670870fb162c20166eff372702b5485907763a))
- Reference terminal renderer — grid state machine, Ink 8 view, protocol input ([8c11711](https://github.com/Neko1313/agent-compositor/commit/8c11711acf3d98b1efc884cc58c4339df13998b6))
- Reference agent loop + service.exec, fork-name aliases ([a734994](https://github.com/Neko1313/agent-compositor/commit/a734994f14398359f7f39046890777099e5b8b98))
- Layered config — system/global/project-walk discovery, JSONC, {env:}/{file:} substitutions, per-key origin tracking (harvest: opencode) ([f1a14e5](https://github.com/Neko1313/agent-compositor/commit/f1a14e572eef2b792935aa3881b9bf949cbe217c))
- Layered rule engine — worst-wins, source tie-breaks, session approvals (harvest: codex execpolicy + opencode rules) ([c32455b](https://github.com/Neko1313/agent-compositor/commit/c32455b8fa12aeb75646d557dc03ee47a54b5cb6))
- Codex-style session store — JSONL roll files, meta sidecars, fork/archive/delete, prefix lookup, corrupt-line tolerance ([d7fa28d](https://github.com/Neko1313/agent-compositor/commit/d7fa28dcd65cf4de191405641bdad1dbe36c0d77))
- Builtin tools riding $ API — exec/read/write/edit emit service.* events; default resolvers with timeout, truncation, exact+normalized edit, undo log; interception-tested ([1e23815](https://github.com/Neko1313/agent-compositor/commit/1e23815151ecf6e108e85825355dce371d10260b))
- Catalog entries for the core loop — turns (steer/interrupt/queue/failure) + core services (shell/file), allow-all default policy ([ff840b4](https://github.com/Neko1313/agent-compositor/commit/ff840b48e9f5c984cd6b85e001026f80319b9b0b))
- The agent loop — submit/steer/interrupt/queue, streaming provider contract + ScriptedProvider, permission-gated tool execution over the service chain, session persistence, fail-operational turns ([29d57d6](https://github.com/Neko1313/agent-compositor/commit/29d57d646bd4628171727e6addf8666062c4f61c))
- Token budget with reserve carve-outs + transcript compaction keeping system+tail, summarizer failure falls back to a marker ([428bdc0](https://github.com/Neko1313/agent-compositor/commit/428bdc078484fbabfc7e9b54d7990cd8d3367c11))
- Registry with progressive disclosure — frontmatter-only index, on-demand body load, keyword search, workspace-over-global shadowing ([e6dc07c](https://github.com/Neko1313/agent-compositor/commit/e6dc07c7b6e8fe6ab8a076758977d062c610e865))
- OpenAI-compatible streaming adapter — SSE reader, chunked tool-call reassembly by index, wire-order finish/usage, quiet abort ([364e8c6](https://github.com/Neko1313/agent-compositor/commit/364e8c67e151d32a76b92118638312f3821a2c2b))
- Resume + context pressure in the loop — replayTranscript rebuilds model-ready messages from the event roll (steer as mid-turn user, compaction cut line, partial-tail safe); AgentCore.resume adopts history; compaction trips between steps via TokenBudget and emits context.compacted ([4b5065c](https://github.com/Neko1313/agent-compositor/commit/4b5065c1078c6e0ad61d6437995d5245e0beff90))
- Terminal renderer + REPL — pure keystroke decoder (Enter submit / Tab steer / Ctrl+C interrupt-exit / Esc interrupt), catalog-event rendering with silent ok-results, y/n/a approval bridge, inflight-turn drain on stdin close ([455df33](https://github.com/Neko1313/agent-compositor/commit/455df3356cd0ddfd4e2c02c3cc6d2c6f0bb03c15))
- On-disk plugin loader — plugin.json manifest + hooks.ts discovery across plugin dirs, TrustClass validation (trusted/sandboxed/render-only), user-tier chain registration, workspace-shadows-global by name, skip-and-continue on malformed plugins (fail-operational) ([f015e91](https://github.com/Neko1313/agent-compositor/commit/f015e915f739a6b9b7660dc8fdd2915003ec15bb))
- The compositor binary — config+env → OpenAICompatProvider → disk plugins → session store → REPL; --plugins/--resume/--cwd flags; examples/plugins/hello shows tool.call interception answering exec before the builtin resolver ([d96ea72](https://github.com/Neko1313/agent-compositor/commit/d96ea7274ac110a08976b3b1765ede36a6ae6881))
- Default market — six removable plugins harvesting mainstream CLI features: slash-commands (palette), memory (COMPOSITOR.md, # notes), guard-secrets (key/token exfiltration guard), guard-scope (workspace jail), turn-log (JSONL journal), notify-done; wired drop responses to the real {drop: string} form; npm run install:defaults ([05245c2](https://github.com/Neko1313/agent-compositor/commit/05245c28e81e9891c0cc540f89e1dfa3da5adf78))
- Turn.usage turn-level event; service.shell.execOutput/execKill background-job services; service.todo.update task-list service ([35b723e](https://github.com/Neko1313/agent-compositor/commit/35b723eda84a50dece92570accfc19f1360dafc1))
- Claude-Code wave-1 core support — turn.usage emitted once per turn with cumulative totals; AgentCore.compactNow()/clear() public with $.agent exposure to plugins; builtin todo tool (TodoWrite analog) with process-scoped resolver state; exec background:true + exec_output/exec_kill tools (BashOutput/KillShell analogs) with buffered background jobs ([4fcd522](https://github.com/Neko1313/agent-compositor/commit/4fcd52207ded782a27e8eb91ff6c442493e8de35))
- Nine default plugins — cost (/cost), plan-mode (/plan read-only), todos (persist todo tool), checkpoints+rewind, btw (side questions), export (/export transcript md), doctor (env+provider ping), output-style (/style terse), session-ctl (/compact /clear); 15 removable plugins total ([121ca23](https://github.com/Neko1313/agent-compositor/commit/121ca239075c4e3e845466d536130c48150f8746))
- Service.agent.spawn + service.ui.ask service events; subagent.start/complete turn events (catalog, since 0.5.0) ([dfdb553](https://github.com/Neko1313/agent-compositor/commit/dfdb553baa2f3ef415e7074fd45c5ee264f531e1))
- Builtin task tool spawns subagent cores (service.agent.spawn, depth-guarded, ephemeral, child turn failure propagates as error value); builtin ask_user tool via service.ui.ask (fail-closed headless); extraTools option appends plugin tools; allow rules for task/ask_user ([7ba5616](https://github.com/Neko1313/agent-compositor/commit/7ba5616195ef5d60f4b34fd6ebffb8228ab7ec0a))
- Tools.ts convention — plugins can ship model-facing tools (validated, appended to the core toolset) ([dfd473c](https://github.com/Neko1313/agent-compositor/commit/dfd473c5a6b49b867a64b8b99032b8db648eb279))
- AskUserQuestion dialog (numbered options, multi-select, free text); onAsk wired only for interactive TTY (headless stays fail-closed); extraTools plumbing through buildApp ([c6d7fd0](https://github.com/Neko1313/agent-compositor/commit/c6d7fd077c4fd969c3f952621b2a14659ccddec5))
- Two default plugins — mcp (stdio MCP client, mcp_call gateway, AGENT_MCP_CONFIG/.agent-compositor/mcp.json) and workflows (deterministic multi-agent orchestration with replayable content-hash journal; Restate Dynamic Workflows pattern); 17 removable plugins total ([2aad806](https://github.com/Neko1313/agent-compositor/commit/2aad806696d8ebd944863bc051ba0cd0037d907f))
- Add interactive agent workspace, marketplace and quality tooling ([1cbd726](https://github.com/Neko1313/agent-compositor/commit/1cbd7265cc8c3e2ca03a45564f359283d2d4039d))
- Add binary distributions, verified installer and git-cliff notes ([67c5e20](https://github.com/Neko1313/agent-compositor/commit/67c5e20f71b5d3ee0399c037143e4b523a334dce))


### Fixes
- Drop duplicate glob import (typecheck) ([c5c38c9](https://github.com/Neko1313/agent-compositor/commit/c5c38c9742f020df0d8b4037c2ff84a24fa1dac0))
- ToolSpec.execute returns ToolResult; wire workspace dep ([f68f354](https://github.com/Neko1313/agent-compositor/commit/f68f354e557b8eb56b0ad29073e7c529dc4b251a))
- Normalized edit matching via raw-index mapping (window slide broke on length shift); generic request in test ctx ([0ca4c33](https://github.com/Neko1313/agent-compositor/commit/0ca4c3341a51d5042e1199a73ba29ff3d6e110cb))
- RequireMeta also probes the override sessionsRoot — append without cwd works again ([a859c60](https://github.com/Neko1313/agent-compositor/commit/a859c607ae2e4582731c60fbab48d501ce6e0232))
- Decision layers by specificity — command globs outrank tool-wide defaults, worst-wins within a layer (harvest: codex execpolicy tiered matching) ([5b648e2](https://github.com/Neko1313/agent-compositor/commit/5b648e2cbc26146e10b8993a32e77ca4b1c1d697))
- Tool.call gate keys on the presence of {result}, not on 'is object' — default allow-policy passthrough must not skip tool.check ([965f79f](https://github.com/Neko1313/agent-compositor/commit/965f79ff37662b236e435d86a845bd740ced0828))
- Persistence actually persists — AgentCore lazily ensures the session exists before append (create swallowed by catch); SessionStore.create never truncates an existing roll, so re-ensuring after restart/resume is safe ([93ac232](https://github.com/Neko1313/agent-compositor/commit/93ac2322b33dd0f7925f616e3978e881facb6e39))
- Pass approval request in the ask API shape {tool, args, reason}; tolerate non-TTY stdin ([e312664](https://github.com/Neko1313/agent-compositor/commit/e312664c450640017ae17caae0918b349b1bdfe1))


### Other changes
- Initial commit ([befd2b0](https://github.com/Neko1313/agent-compositor/commit/befd2b0d46c129fed1112b4d3c23c6fe1e4ef164))


### Refactoring
- Ride the catalog event names — service.shell.exec / service.file.read/write/edit, ask-for-exec defaults ([b05a0a6](https://github.com/Neko1313/agent-compositor/commit/b05a0a64fef22913584145e6db7d1f4810600997))


### Tests
- Unit coverage for all nine new default plugins; E2E: turn.usage→/cost→/export with exactly one model call; 15-plugin manifest assertion ([57d0ae7](https://github.com/Neko1313/agent-compositor/commit/57d0ae77a1fb2ee7ec03177557aaff998e1c4f90))
- Wave-2 E2E — subagent spawn/failure/depth-guard, ask_user headless+onAsk, tools.ts plugin loading, workflows run/journal-replay, stdio MCP over a fake node server; 17-plugin market assertion ([70ebf21](https://github.com/Neko1313/agent-compositor/commit/70ebf21426c82bde7245c345eaf32b1146903511))


Installation, platform support and known limitations: [release guide](https://github.com/Neko1313/agent-compositor/blob/main/docs/releases.md).
