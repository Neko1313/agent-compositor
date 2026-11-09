# Project memory

## Implemented: auto approval review

The user requested automatic action approval based on risk assessments by a
small/inexpensive model. This is implemented as a replaceable plugin on top of
the shared permission chain, with a separately configured reviewer profile.
It defaults to off.

- Modes: manual and explicitly enabled `auto`.
- Assess the concrete tool and arguments: command, paths, network access, scope,
  reversibility, secret access, and effects on external systems.
- Reviewer output is structured: risk level, decision, and brief reason. Low-risk
  actions may be approved within policy; dangerous, ambiguous, or unknown actions
  go to the user.
- Explicit deny and sandbox restrictions remain binding. Errors, timeouts, and
  invalid reviewer output fall back to manual approval.
- Show decisions and reasons in the UI/log; provide thresholds, a review budget,
  and immediate auto disable. Treat commands and tool output as data, not as
  instructions to the reviewer.

Configuration: `.agent-compositor/auto.json`, command `/auto on|off|status`.
Full feature instructions: [docs/agent-features.md](docs/agent-features.md).

## Default plugin choices

The user selected Monty for isolated code execution and Callix
(https://github.com/Callix-Tools/callix) for repository analysis/navigation.
These are replaceable default plugins, not mandatory core dependencies.
Use Callix's native binary and JSON graph (`callix analyze`), without a Python
API/venv intermediary. The `callix` plugin provides `service.project.query`;
select alternatives through `serviceProviders`. Monty isolates Python code and
explicit host callbacks; it does not provide OS isolation for arbitrary shell
processes.

The original gap analysis below is a historical snapshot. The user subsequently
requested its implementation; compare it with current code before acting on it.

### Plan implementation status — 2026-11-09

The user explicitly requested all planned features. At this milestone, the code
was in the working tree without a commit/publication. The original analysis
below is historical: its list of missing features no longer describes the
current implementation.

Implemented:
- Shared model/tool contracts, model switching, and tools/hooks reload.
- Anthropic, Gemini, Responses, and OpenAI-compatible providers; retry, replay
  metadata, images, and truncated-stream detection before tool execution.
- AGENTS/CLAUDE/GEMINI instructions, skills, @files/@images, ignore rules,
  an editor, and history.
- Headless text/JSON/JSONL, JSON schema validation, and resume/fork/archive/rename UI.
- Once/session/project permissions and small-model auto review with audit/fallback.
- Native Callix binary/JSON graph and Monty Python/workflows with replay/cancel.
- MCP/workflow panels; MCP timeout, cancellation, cwd-aware connection caching,
  and process disposal on reload/close.
- Web fetch and Brave/SearXNG search with size limits and separate permissions.
- Checkpoints of available project files and conversation; code/conversation/both
  restore, protection against later edits, Before/After review, and per-file
  Keep/Revert controls.
- Install/update/enable/disable/remove extensions from a configured Git catalog;
  lockfile dependencies without scripts, previous-version backups, and disable
  before import.
- Keys in a private file, OAuth device flow/refresh for a configured client,
  profile selection, and logout. Private vendor CLI login protocols are not
  imitated.
- Usage for all model calls, cache, configured pricing, marked estimates when
  providers omit usage, token/step budgets, and configurable account quotas.
- Independent agents with separate sessions, panes, budgets, and Git worktrees;
  asynchronous messages/results, stop/queue cancellation, archive/merge, mouse
  recipient selection, and conversation/pane restoration after restart.
- Queued approval/question dialogs for multiple agents and waiting-dialog cancellation.

Configuration and limits are documented in docs/agent-features.md. External
search, quota, and OAuth integrations require the user's endpoints, keys, or
registered client. At this milestone, live cloud accounts were not tested without
credentials; HTTP fixtures and local processes were checked. Monty does not
isolate the host shell. Checkpoints cannot undo external side effects and are
bounded by project ignore/size rules. The real PTY/browser UI scenario stores its
results under dist/visual-verified.

## Agent features

Date: 2026-11-09. The user requested saving the comparison with Codex CLI,
Gemini CLI, and Claude Code for later discussion. This section records discussion
topics, not authorization to implement the roadmap immediately. Statements below
describe the original analysis, before the implementation status recorded above.

### Main finding

The project had a working agent loop and windowed TUI. Most gaps concerned tools,
integrations, and execution management. A promising distinction was a windowed
workspace for multiple independent agents and tools. At the time, multiple
conversation views shared one AgentCore: multiple windows did not yet mean
multiple agents.

### Already working at the time

- Streaming answers, file reading/editing, shell, and background processes.
- Interruption, task steering, and queued requests.
- Session resumption, context compaction, skills, and hooks.
- Todos with UI/persistence and local plugins with UI.
- Windowed TUI: workspaces, mouse focus, drag/resize, and plugin placement.

### Missing capabilities at the time

- An MCP client for server connections, tool discovery, and execution.
- Subagents with separate loops/contexts, lifecycle, result exchange, budgets,
  and worktree isolation. agent.offer/agent.spawn were declarations only.
- OS sandboxing for shell/files/network; permissions and guard plugins did not
  replace it.
- Dedicated glob/grep, symbol navigation, and LSP. Shell search was possible,
  but there was no dedicated code-navigation layer.
- Built-in web_search/web_fetch.
- Images, attachments, and multimodal provider messages.
- Full headless operation: one-shot prompts, JSON/JSONL, and exit codes.
- Built-in diff/review and an interactive change-selection workflow.
- Extension installation/updates, a catalog, and dependency management.

### Partially implemented at the time

- Providers: OpenAI-compatible Chat Completions only; no native Anthropic, Gemini,
  Responses API, account login, UI model selection, or complete provider recovery.
- Context: COMPOSITOR.md memory and a skill loader; no automatic
  AGENTS.md/CLAUDE.md/GEMINI.md loading, @files, or shared context exclusion policy.
- Sessions: resume was connected; fork/archive existed in storage, but lacked UI
  search, naming, selection, and branching.
- Rewind: the last saved state of one file; no turn-wide checkpoint with separate
  code/conversation restoration.
- Permissions: rules and one-off approval; session/project approval persistence
  was not complete as a user workflow.
- Context/usage: estimated tokens and compaction; no full cost, cache, or quota
  accounting.
- Input: slash suggestions existed; multiline editing, prompt history, an
  external editor, and attachments were missing.
- Plugin placement persisted, but the complete window tree and independent
  agent/task state did not.

### Architectural limits at the time

- Model-facing tools were fixed when AgentCore was created. Plugins needed a
  standard schema/handler registration mechanism.
- Main requests called provider.complete directly, so replacing
  service.model.complete did not cover the whole agent loop.
- Check the current implementation before acting: these findings describe the
  analysis date, not guaranteed future gaps.

### Proposed sequence (not yet approved at that point)

1. Extensible core: tool registration and a shared model-request path.
2. Repository work: project instructions, search, @files, input editor, diff.
3. MCP and providers: external tools, native adapters, model selection.
4. Reliable execution: sandbox, persistent approvals, checkpoints, headless JSON.
5. Multitasking: subagents, independent sessions, worktrees, and pane presentation.

### Comparison sources

- Codex CLI: https://learn.chatgpt.com/docs/codex/cli
- Claude Code extensions: https://code.claude.com/docs/en/features-overview
- Claude checkpoints: https://code.claude.com/docs/en/checkpointing
- Gemini subagents: https://geminicli.com/docs/core/subagents/
- Gemini sandbox: https://geminicli.com/docs/cli/sandbox/
- Gemini headless: https://geminicli.com/docs/cli/headless/
- Gemini extensions: https://geminicli.com/docs/extensions/

Competitor capabilities differ; this list does not claim complete parity.
Recheck official documentation before making a new comparison.

## Ghost mascot — replaceable default plugin

The user supplied 10 APNG animations and requested an interactive mascot reacting
to component hooks. `plugins/mascot` preserves the originals, decodes frames, and
subscribes to turn/tool/subagent, ui.reaction, and agent.activity events.
The core has no Ghost-specific logic: shared UiTextView.raster, ui.visibility,
and $.ui.remove allow replacement. Ink displays RGBA through colored half blocks;
native Kitty/Sixel support is unnecessary. Hidden/headless surfaces do not run
animation timers. Controls: `/mascot on|off|pause|resume|reload`, Pause/Resume,
and Pet Ghost. Configuration: `.agent-compositor/mascot.json`, replaceable
project-local APNG packs, and configurable tool/reaction mappings. Details:
plugins/mascot/README.md.

Mascot checks at that milestone: 336 tests passed, 1 optional Callix test skipped,
and typecheck passed. The real PTY/browser scenario captured 24 screenshots with
report.ok=true under dist/visual-mascot. It covered frame changes, Pet, pause,
a subagent question, manual approval, and existing window interactions. All 10
APNG files matched the user's archive byte for byte.

## Marketplace, home storage, proxy, and quality evals — 2026-11-09

Implemented in the working tree at this milestone, following the user's request:
- `.claude-plugin/marketplace.json`, Git/local marketplace registration, explicit
  updates/pinned commits, name@marketplace installation in user/project scope,
  and backups. Relative sources and GitHub/HTTPS Git source objects are supported.
  The repository has a 26-entry catalog and portable Markdown command example.
  Installed native plugins outside the monorepo resolve host API imports through
  host package bindings.
- Claude compatibility adapter: namespaced commands/skills, `$ARGUMENTS`/positional
  arguments, MCP maps, synchronous command hooks, matcher/stdin/timeout/cancel,
  and deny/ask. This is an explicit subset: agents/LSP/mods/async/prompt/http hooks
  and userConfig are not silently emulated; unsupported components cause loader
  errors. Native TS/Ink UI does not automatically become portable to Claude.
- Runtime data defaults to `~/.agent-compositor/projects/<name>-<canonical hash>`:
  sessions, agents/worktrees, Todos, workflows, checkpoints, UI preferences,
  memory, and plugin state/cache. Old project-local data receives a nondestructive,
  one-time migration. `AGENT_STORAGE_MODE=project` retains portable mode.
- `$.storage.config/get/set` and service.storage.* with global/project/session/cache
  scopes, atomic JSON writes, plugin namespaces, path/symlink confinement, and a
  render guard. Legacy relative $.fs .agent-compositor paths are remapped.
  Global/project/component configuration merges; independent agent roots inherit
  parent profiles/MCP/proxy while retaining separate runtime state and local
  overrides. `#global note` saves global memory; `# note` saves private project
  memory. COMPOSITOR.md is migrated without deletion.
- Replaceable network-proxy plugin: `/proxy status|on|off`, proxy.json, pre-request
  validation, native Node Undici and Bun fetch proxy routing, model streams,
  OAuth/quota/web, and shell/MCP proxy environment without changing global
  process.env. Invalid enabled routing blocks model requests. The real endpoint
  remains user-configured and routing defaults to off. OpenAI/Anthropic API keys
  were not supplied or requested at this milestone.
- Persistent/background Callix graph, cache fingerprint, source/Git/tool change
  hooks, debounce, and cleanup. Queries verify freshness. External edits and disk
  reuse after restart were checked with a real CLI subprocess; the native Callix
  adapter was also checked.
- Reproducible isolated eval fixtures/rubrics, repetition/split/baseline reports,
  and explicit live Ollama runs. Gemma4/DeepSeek model tags were preserved exactly.
  The DeepSeek cloud tag was installed in the existing Ollama instance; no local
  inference claim was made.
- Real Harness² Substrate and BenchSpec-compatible workspace_config
  materialisation, headless compositor trajectories, and process-group timeouts.
  The upstream deterministic demo and a Compositor/Gemma rollout were checked.
  These are not full JobBench/LAB/WorkBuddy results or measurements of recursive
  optimization gains with live models. Upstream commit:
  6868817518876de8fd170c6a8354daca273b6191; Python 3.13 isolated under /tmp.
- Vitest 5/coverage, JUnit/Cobertura, and deterministic eval/proxy/catalog CI steps.
  Node >=22.12. The vulnerable older Vitest/tinypool toolchain was removed; the
  pre-existing Zod 3 major migration was outside this change. Existing worktree
  edits were preserved. No commit/push/publication had been requested or performed
  at this milestone.

Usage and limits: docs/marketplace.md, docs/state-and-network.md, docs/evals.md.
Run evidence: dist/quality-report.json, dist/evals-ollama-final/report.json,
dist/harness2-smoke/report.json, dist/harness2-demo/demo.json, and
dist/visual-marketplace-storage/report.json. These are run-specific evidence,
not permanent quality guarantees. Keep shared catalogs free of machine-local
cache paths; Git project registrations retain pinned provenance and reconstruct
the cache in the user's home directory.

Final checks for this milestone: 355 passed and 1 optional Callix test skipped
(native Callix separately passed 5/5), across 45 test files. Coverage: lines 80.16%,
statements 76.45%, functions 76.06%, branches 66.02%; all gates passed. Typecheck
and diff checks passed. Live Ollama passed 10/10 (5 each for Gemma and DeepSeek).
The PTY/browser scenario captured 26 screenshots with ok=true. Machine-readable
report: dist/quality-report.json; interpretation and limits: docs/evals.md.
Changes were still uncommitted at the time of this recorded validation.

## Release distribution (2026-11-09)

Release tooling uses pinned git-cliff 2.14.2 with Conventional Commit groups in
cliff.toml. The first planned public tag is v0.1.0, matching the root and app
versions. GitHub Actions verifies quality, builds native Linux/macOS x64/arm64
archives, tests their installers against local model/release servers, then
publishes all assets from a draft. A branch dispatch only builds and verifies.

Distribution plugins and host API modules are external to the Bun executable;
user/project plugins take precedence. Keep the extracted directory together.
Monty retains its Node bridge requirement; Callix is a separate executable.
install.sh checks SHA-256, supports version/prefix selection, switches an active
symlink and preserves user state. README and docs/releases.md document usage.

Local checks: full suite 359 passed / 1 optional test skipped before the final
loader JS regression case; focused final changes passed 32/32, typecheck passed.
The Linux x64 archive passed checksum rejection, versioned/latest installation,
all default plugin loads, a mock provider turn, packaged Monty execution and
state preservation. Remote platform/publication results must be checked in CI.
Known pre-existing dependency issue: npm audit flags Zod 3 for
GHSA-mrhx-c7xc-m3w5; the Zod 4 migration is outstanding (docs/releases.md).

The v0.1.0 candidate tag was not published: Ubuntu 22.04 failed the packaged
Monty check because the upstream native module requires __isoc23_sscanf
(glibc 2.38+). All other platform archive checks passed. Keep that candidate tag
as history; publish the corrected distribution as v0.1.1, with Linux x64 on
Ubuntu 24.04 and an explicit glibc 2.38+ support floor. Two existing integration
tests also needed bounded 10-second waits and reliable cleanup under CI load;
the focused tests pass locally. No published tags were moved.

v0.1.1 was published successfully:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.1.1
Release workflow: https://github.com/Neko1313/agent-compositor/actions/runs/42553673828
All four native archive jobs, quality verification and publication passed.
The release quality suite passed 360 tests with 1 optional Callix test skipped.
Main CI also passed (run 42553665436).

The public Linux x64 asset was downloaded through install.sh with checksum
verification and installed under /tmp/compositor-live-v0.1.1. The installed
binary printed version 0.1.1 and loaded all 25 default plugins from a fresh
project with PATH=/nonexistent, confirming that starting the core does not
require Node.js or Bun. Executing the Monty bridge still requires Node.js.
The working tree was clean before recording these publication results.

## Ghost: full-resolution terminal graphics

Ghost now keeps the original 228x228 APNG frames and source timing instead of
sampling to 96x96. Protocol 0.6 negotiates optional `render.raster` with the
`Raster` capability; catalog 0.10 permits bounded 512x512 RGBA. The shared Ink
renderer probes Kitty graphics support, strips terminal replies from keyboard
input, transmits compressed/chunked pixels, caches frames and places them after
Ink commits. Window/workspace changes, editor suspension and exit clean up
placements. `AGENT_GRAPHICS=off|kitty|auto` controls selection. Auto falls back
inside tmux/screen; no passthrough, Sixel or iTerm2 backend is implemented.
Plugins continue to replace rasters through ui.render or supply their own views.

The supplied APNGs retain dark outline/eye RGB but incorrectly set its alpha to
zero; the supplied storyboard shows those details opaque. The mascot decoder
optionally repairs dark pixels within 12 source pixels of the opaque sprite.
It changes alpha only, preserving original RGB, poses and timing. Built-in
packs enable this repair; custom packs default off; `restoreInk: false` restores
exact source transparency. Original APNG assets remain unchanged. Repeated
activity events no longer postpone the animation timer indefinitely.

Validation: 369 tests passed and 1 optional Callix test skipped; coverage gates
passed (lines 80.32% in that run). Typecheck, generated docs and diff checks
passed. The complete PTY scenario passed both native-protocol emulation and
portable fallback (26 captures each). The compiled Linux distribution passed
installer/model/Monty smoke and the focused native-graphics lifecycle scenario:
source-size animation, pause, fullscreen, mouse drag to workspace 2, hidden
placement cleanup, resize and disabling the mascot. Native Kitty GPU rendering
was not directly tested: browser captures emulate the real emitted protocol.

Evidence: dist/visual-ghost-native-final/report.json,
dist/visual-ghost-fallback/report.json, dist/visual-ghost-binary/report.json.
The fullscreen binary capture is
dist/visual-ghost-binary/01-native-fullscreen.png.
New bench command: npm run visual:mascot. VISUAL_EXECUTABLE selects an extracted
compiled executable in visual:serve/visual:mascot with isolated home/project.
The local distribution is dist/release/linux-x64/compositor/compositor; public
v0.1.1 still contains the earlier implementation. No new release tag was made.

## Bundled Callix native dependency

Release builds now install the pinned official Callix 1.7.0 archive for their
native Linux/macOS x64/arm64 target. `plugins/callix/distribution.mjs` shares the
version/checksum table and verified extraction between explicit setup and the
release builder. Only the verified binary and upstream MIT license are streamed
out of the archive; a developer-local ignored bin/ is never copied. Offline
builds can supply CALLIX_RELEASE_ARCHIVE and undergo the same checksum check.
The distribution includes plugins/callix/bin/callix, LICENSE and release.json,
with source URL, platform, version and archive/binary/license SHA-256 digests.

The existing runtime priority remains CALLIX_BIN, executable setting, bundled
binary, then PATH. Provider replacement/disable settings are unchanged; loading
a plugin performs no installation or downloads. Source users can still run
node plugins/callix/install.mjs explicitly. Published v0.1.1 predates bundling;
no existing release or version tag is overwritten by this implementation.

Local validation: 379 tests passed, 1 optional native Callix source test skipped,
48 files; coverage lines 80.33%, all gates passed. Typecheck and diff checks
passed. The rebuilt Linux x64 release passed install/checksum/model/Monty smoke.
Its installed compositor invoked the real code_query tool and returned a
resolved cross-file TypeScript call with CALLIX_BIN cleared and PATH empty.
The smoke also checks packaged license/provenance and Callix --version.
All four native platform builds and installed Callix cross-file checks passed
in workflow_dispatch run 42578297780 (Linux x64/arm64, macOS x64/arm64):
https://github.com/Neko1313/agent-compositor/actions/runs/42578297780
Publishing was skipped because this was a branch run. Main CI also passed:
https://github.com/Neko1313/agent-compositor/actions/runs/42578290036
Implementation commit: 99f6b52. The local Linux archive was rebuilt with the
updated documentation at dist/release/compositor-linux-x64.tar.gz.

## Native model/provider/proxy settings

The workspace bar now exposes Settings. `/settings`, `/providers` and `/models`
open the built-in model-selector panel. Connections can be added from Ollama,
OpenAI Responses, Anthropic, Gemini and compatible-gateway presets; edited,
copied by ID, tested, removed or switched without editing JSON. GET /models
uses each provider's authentication headers and the shared model network client;
manual IDs remain available when discovery is unsupported. Discovery is bounded
and does not issue a completion or display provider error bodies. Profiles use
private/global providers.json; private model.json restores profile plus model.
API keys remain in credentials.json (0600). Project overrides beat global
settings, including immediately after a global edit.

Trusted plugins have host-owned `$.ui.form`: text, URL, masked password, select
and toggle fields, actions, validation, mouse focus, keyboard navigation,
scrolling and cancel/abort/close cleanup. Draft/results bypass ui.render and
catalog events. Password declarations cannot contain initial secrets. Headless
hosts require an explicit handler. `$.storage.configure` writes private project
or global component settings atomically; both APIs are guarded against untrusted
plugins and ui.render mutation. Existing storage/network service hooks still
consume effective proxy configuration; these callbacks do not replace them.

The network-proxy plugin owns a native form for HTTP(S) CONNECT endpoint,
username/password, separate model/tool switches, bypass hosts and persistence
scope. `/proxy` opens it; status/on/off remain available. Blank secret fields
retain current values; explicit switches clear saved credentials. API-key login
also uses a native form when no configured OAuth device flow exists. Structured
plugin views now scroll from the top; conversation logs continue following the
tail. Arrow/Enter navigation activates visible plugin actions.

Verification: 389 tests passed, 1 optional native Callix test skipped, 49 files;
coverage lines 80.99%. Typecheck, standard PTY visual regression, settings PTY
scenario and compiled-binary settings scenario passed. Inspected actual PNGs;
settings scenarios exercise fake keys, native input, proxy switches, restart and
cancel. Local proxy smoke passed model/tool HTTP CONNECT and shell environment.
Linux x64 release build/install/Callix/model smoke passed; no new release tag was
published. `npm run visual:settings` is the maintained settings check; its raw
input.jsonl must never contain real credentials. See docs/state-and-network.md
and tools/visual/README.md for contracts, interaction and scope details.

## Agent harness, model context and dynamic workflows

The user explicitly requested implementation of the audited harness gaps.
Base agent instructions now resolve through service.agent.instructions, with
behavior.json/config overrides; project/skill instructions remain separate.
service.agent.finish provides a replaceable completion gate. Per-session
private task-plans/<session>.json preserves model-authored goals, tasks,
acceptance/evidence and next action; /tasks opens it and /continue resumes a
bounded turn. Planned edits require recorded successful verification or explicit
unavailable/inapplicable reporting; pending plan items request continuation.
Background workflow hand-off must be explicit. Gates/reminders are not proofs of
correctness; command recognition is deliberately documented as a heuristic.
Application default is 64 steps/turn. Repeated tool failures trigger recovery
instructions and stop after six consecutive failures without progress.

service.model.capabilities supplies context/output capacity. Explicit profile
contextWindow, native Ollama/Gemini metadata, optional same-origin metadataUrl,
a configurable exact-ID model-catalog.json and marked 32768 fallback are
supported. Limits update on model/profile changes with a 60-second metadata
cache. Provider usage is not capacity. Schema/system/image/tool overhead counts,
output is reserved/capped, hard pressure bypasses cooldown, summarization uses
bounded segments and adjusts recent tail while retaining tool/result groups.
Failures, empty summaries and non-shrinking summaries retain original history.
Context overflow permits one compaction retry. Subagents inherit project rules,
use separate budgets/plans and route optional stage profiles independently.
The TUI shows estimated context occupancy and fallback provenance.

The replaceable workflows plugin adds workflow_run: persistent background DAG
stages, ready-stage concurrency, conditional branches, JSON expansion into workers
and automatic downstream joins, status/wait, pause/resume/retry/stop. It keeps
Python/Monty workflow journals compatible. UI exposes stages, worker IDs, live
activity, outputs/errors, attempts and accounted tokens. Atomic serialized run
snapshots and process leases prevent competing execution; interrupted runs load
paused, with explicit resume. App reload/exit cancels workers; this is not an OS
daemon. Cached completion is not refreshed against later repository changes,
and interrupted external effects are not exactly-once. Stage budgets default to
60000 tokens/10 minutes/32 steps; concurrency 2 (max 8), stages 100 (max 500), four
active runs. Workers cannot launch nested background workflows.

New npm run eval:agent exercises cross-file bug repair and failure recovery/API
preservation with actual executed checks and independent hidden behavioral
graders outside the model workspace. Initial live run with an incomplete eval
search toolset passed 1/4; restoring default Callix search and bounded recovery
produced 4/4 on gemma4:31b-cloud and deepseek-v4.1-flash:1017-cloud. This is a small
development suite, not an unbiased capability/parity benchmark. Evidence:
dist/evals-agent-live/report.json (diagnostic) and dist/evals-agent-final/report.json.
The maintained real PTY check npm run visual:workflows passed dynamic fan-out,
parallel workers, pause/join/resume, result detail, restart and foreground input.
The standard visual scenario also passed. Bench plugins remain under tools/visual
and are not shipped as application defaults. Contracts and limits are documented
in docs/agent-features.md, docs/evals.md and plugins/workflows/README.md.

Final local verification for this milestone: 403 tests passed, one optional
native Callix test skipped, 50 files, line coverage 81.46%; typecheck passed.
Source PTY workflow and settings scenarios passed, as did the standard visual
regression. Installed Linux x64 smoke now explicitly starts/polls a background
workflow across separately bundled hooks/tools and checks its worker output.
Shared registry ownership lives behind service.workflow.run in the hooks entry,
so source module sharing is not assumed by release bundles. Native metadata
queries against the existing Ollama returned 262144 context tokens for
Gemma4:31b-cloud and 1048576 for DeepSeek-v4.1-flash:1017-cloud in this environment.
Typed control chunks and bracketed paste use separate Ink input channels;
form passwords remain masked. No release tag/publication was requested.
