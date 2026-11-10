# Project memory

## Accepted replacement boundary — 2026-11-10

After reviewing the concept audit, the user chose that every part except tiling
must be replaceable. The fixed tiling mechanism owns the window tree, geometry,
workspaces, focus routing and drag/resize. Decoration, all other UI (including
the composer, forms, questions and approvals), and agent behavior must have
replaceable implementations with public contracts. Styling alone is insufficient:
rendering, input, state transitions and lifecycle must be replaceable too.

This supersedes earlier permanent host-ownership decisions for the editor and
dialogs, including historical notes farther below. The kernel and private UI/
session repository changes below implement selected replacements. Concept and
contract documentation record the boundary, acceptance evidence and limits. The user subsequently authorized the generic kernel work
below and explicitly rejected implementing DevOps-specific integrations as the
answer to this requirement. Audit artifacts: dist/concept-audit/report.json
(run-specific evidence).

## Generic kernel customization — implemented 2026-11-10

The kernel is domain-independent; coding is an optional composition. No
Kubernetes/GitLab/domain integration plugins were added. Catalog 0.18 exposes
replaceable turn execution, tool-batch scheduling, effective tool definitions,
input preparation, context-pressure management/compaction and journal writes.
Public AgentTurnContext/AgentToolBatchContext preserve lifecycle, permission
checks, model accounting and invocation-scoped cancellation. Host usage totals
also cover replacement strategies; publish returns transformed assistant text.
SessionJournal is structural, and a concrete fallback model is optional.

Runtime next() now supports actual awaited downstream results and streaming
backpressure. Async hook deadlines race uncooperative promises; hooks cannot use
host effects after expiry or unload. Wrapper faults do not replay completed
continuations. Explicitly selected missing/failed providers raise errors rather
than silently choosing another backend. Registration/composition validation is
atomic; manifests support within-tier priority. Native modules can export owned
plugin.<name>:<event> definitions, removed with their hooks on unload. Render-only
and render-time public API mutation paths are guarded; agent clear/compact and
awaited auth status route through services. Legacy synchronous auth-status fields
retain the host snapshot. Trusted JS remains in-process, not an OS sandbox.

Assembly controls: enabledPlugins (before import, also applies to host
contributions), toolProviders (whole schema/handler replacement), agent.tools
(final allowlist), agent.builtinTools/controlTools, and projectContext,
fileReferences and skills switches. Neutral instructions are the harness default;
agent.instructionsPreset=coding selects the former coding instructions. Reload
retains the harness and custom event/tool composition. Standard /login uses the
replaceable auth service even when the built-in profile has no OAuth endpoint.
Tool-call rewrites now reach both permission evaluation and execution.

The subsequent private UI/session repository work below completes the editor,
dialog and history/storage seams left by this kernel change. Config changes use
existing reload/restart behavior.
Custom strategies own their algorithms and must honor supplied signals/limits;
synchronous JS cannot be forcibly preempted and started effects are not undone.

Validation: 559 tests passed, 3 optional native checks skipped, 70 files;
line coverage 84.2%, all coverage gates passed. Typecheck/gen, 26-entry catalog,
scripted evals 5/5 and tool evals 3/3, and proxy smoke passed. Linux x64 release
build/install smoke includes an external kernel extension with private event,
exact tools and resume, without a fallback-model request or Node/Bun on PATH.
The real PTY regression passed with inspected screenshots under
dist/core-customization-verified. The earlier dist/core-customization-final is a
failed diagnostic: the harness searched before the composer redraw settled.
Its locate helper now waits for the exact visible text; no assertion was removed.
Summary and logs: dist/core-customization-report/report.json. No release was
published and no public tag or release assets were modified.

## Private UI controllers and complete session repositories — 2026-11-10

The user explicitly authorized implementing the remaining editor/dialog and
history/storage replacement work. Trusted native modules can export named
`controllers` and `sessionRepository` factories without hooks. `ui.controllers`
selects owners independently for editor, approval, question, form, placement and
history; `sessionProvider` selects the complete conversation backend. Omission
keeps standard implementations through the same registry/router. Explicit missing
selections fail closed rather than silently using another implementation.

Public controller leases carry private data/state directly to the selected owner,
with rendering, input, snapshot, measurement, pointer and teardown contracts.
Editor snapshots survive reload even when dispose erases state. Async extension
input is serialized; abort races uncooperative handlers and rejects late results.
UI close/session switch disposes pending leases and settles/cancels dialogs.
Forms validate returned field types/values; approvals require an explicit boolean
and valid scope. Editor/form views bypass unrelated render hooks. Pure rendering
also rejects effects through retained APIs belonging to a different owner, and
rejects recursive invalidate calls. Reference renderer forwards F1–F12 and their
modifiers, preserving text/function-key/mouse order in coalesced terminal reads.
Fixed tiling geometry/focus/drag/resize remains in WindowManager.

SessionRepository is a complete structural interface, independent of SessionStore
and filesystem roots. Journaling, browsing/search, rename/archive/fork, interactive
resume, headless startup resume and independent-agent restoration share the
selected backend. Reload gates calls, drains operations before opening the next
repository, validates the core contribution, commits, then disposes the old
backend. Failed preparation keeps the previous repository. Cleanup errors after
commit are recorded on the router. General settings and agent-window metadata
still use their separate storage services; changing providers does not migrate
records. Custom private input handlers have no automatic hook deadline and must
honor their lifetime signal. Trusted JS remains in-process.

Contracts/configuration: [docs/ui-controllers.md](docs/ui-controllers.md). External
fixture is test-only under tools/visual/controller-plugin; no domain integration
plugins or production remote storage backend were added. `visual:controllers`
exercises replacement behavior and persistence across actual PTY restarts in
source and compiled modes. Earlier failed diagnostic directories under dist/
record transport and bench-synchronization fixes; use the final report paths
recorded by the current verification run. Validation: 577 passed, 3 optional
checks skipped in 73 files; line coverage 84.51%, all gates passed. Typecheck/gen,
26-entry plugin catalog, scripted evals 5/5, tool evals 3/3 and proxy smoke passed.
Linux x64 build/install smoke passed with the external repository. Source/binary
replacement and standard PTY reports all pass; screenshots inspected. Summary:
dist/ui-replacement-report/report.json. Current replacement captures:
dist/ui-replacement-source-final and dist/ui-replacement-binary-final; tiling
regression: dist/ui-replacement-standard-final. No release has been published.

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

## Callix navigation, guarded editing and cost comparison

The user requested deep tests and better file/symbol navigation, precise edits
and token comparisons with conventional search methods. Callix remains native
and replaceable through service.project.query; no new Python bridge or mandatory
backend was introduced. The plugin now supports outline/read_symbol/impact,
exact path/name/ID disambiguation, indexed adjacency lookups, compact bounded
results, snapshot/filter cursors and payload size estimates. UTF-8 one-based
native spans are converted to exact UTF-16 edit ranges; truncated source never
issues an anchor. Native aliased calls and Unicode/CRLF source slices are tested.

The standard read tool also returns a guarded range anchor. Standard edit accepts
expectedHash/range/strict, so permissions, guards and checkpoints remain intact.
Stale or ambiguous changes fail; guarded inverses are recorded privately. File
mutation locks are shared across cores in-process, not across external editors.
Normalized edits now detect multiple matches correctly and cannot loop when a
replacement re-matches the whitespace-normalized needle. Replacement strings
are literal, including $&. Model-facing tool JSON stays valid above its limit;
compact results are capped at 128 KiB with a structured preview for oversized data.

Index builds are shared with per-consumer cancellation, checked for source
changes during analysis, and saved with root/config/binary provenance. Extra
ignore rules filter cached/output graph nodes (native CLI analysis still uses
its own discovery rules). Text search handles nested ignores, symlink escape,
deleted/binary/large files, streaming regex batches and bounded scan memory/time.
Skipped pagination matches are not all retained. Exact-ID warm lookups are tested
against a 10000-node graph without another node scan.

Commands: npm run test:callix, eval:navigation, eval:navigation:live. Fixed-protocol
comparison validates identical caller paths and edits for broad full-file,
bounded range and graph approaches. Approximate result tokens: 34880 / 376 / 834.
Callix cold path ~78 ms; warm graph requests ~2..6 ms in that fixture. Efficient
text is cheaper for the simple known-path task; do not claim universal savings.
Final live runs passed 4/4 guarded-edit/behavior/check episodes with actual
provider usage, but Gemma used text even when semantic tools were available.
DeepSeek used Callix and spent more input than its text-only run. ToolTraffic
estimates, provider input/cache/output and method adherence are recorded separately.
These are method/development comparisons, not branded-assistant or statistically
representative benchmarks. Earlier failed guard/command-adherence trajectories
remain under dist/navigation-live; final runs are dist/navigation-live-final.
See plugins/callix/README.md and docs/evals.md for exact contracts and results.

Final verification: 420 tests passed and three optional native tests skipped in
52 files; line coverage 81.87%. The explicit native Callix suite passed all 25
tests in four files. Typecheck, marketplace validation (26 entries), and diff
checks passed. The rebuilt Linux x64 binary passed install/checksum/default
plugin smoke, bundled cross-file Callix queries and guarded symbol editing with
an empty PATH, plus the existing background workflow checks. No release was
published for this task.

The first CI run exposed missing ripgrep on the hosted runner (regex pagination
test failed with spawn rg ENOENT). CI explicitly installs ripgrep before tests;
the regex test remains mandatory rather than skipped when the dependency is absent.

## Token efficiency, workflow profiles and auto-review inheritance

The user requested provider-cache optimization, fewer unnecessary auto-approval
prompts (particularly with Anthropic), and tool-use guidance/evals. Anthropic
now defaults to ephemeral stable tools/system breakpoints plus automatic growing
conversation caching; profiles can select prefix-only caching or opt out.
Responses/compatible adapters support an explicitly configured promptCacheKey.
Cache reads and writes are separate model.usage counters; missing write prices
mark the request unpriced. Declarations have deterministic name ordering.

Ephemeral workflow/task usage forwards once to the parent. New children check
the remaining ancestor allowance rather than resetting the parent session cap. Stage model profiles
now survive both the actual request model field (the parent model no longer
wins over a selected stage profile) and context compaction. App summarizers use
an optional fork factory to bind child streams; custom embedders without a fork
retain their existing summarizer. Native wire tests check the selected model,
not just profile labels. Input estimates are checked before charged requests,
with output limited to the estimated remainder. These remain token estimates,
not hard billing caps across independent sessions/providers.

Workflow runs reserve a shared maxTokensTotal allowance (default 120000) across
parallel stages. Failed/unreported/interrupted allocations are conservatively
charged; retries preserve the persisted tokensCharged ledger. This ledger may
exceed reported usage and is not a provider invoice. Reviewer calls retain the
parent's separate review budget. Persistent agent_control sessions remain
independent, rather than silently folding their usage into another session.

Auto review stays opt-in with a dedicated reviewer. Ephemeral children inherit
the root session's enabled state/review budget. Source code vocabulary and URLs
no longer trigger the command danger filter during writes/edits; canonical
sensitive/external paths still require manual approval. Single fenced JSON is
accepted; malformed responses/errors/explicit denies remain manual. Read-only
workflow status/list can be reviewed locally without a model call. Manual
fallback reasons reach approval dialogs. Unknown tools are not auto-allowed.

New tool_help retrieves examples/pitfalls/schema on demand. Every default tool
has parameter-shaped examples; plugins can supply ToolSpec.usage without adding
examples to every repeated schema. Default instructions discourage shell-based
file inspection, repeated reads, unbounded delegation and equivalent retries
after a denied action. eval:tools adds allowed-tool/call-count/result-size
checks, usable with existing --harness and Harness² materialization.

Recorded live development evidence: initial 4/6 and final 6/6 episodes across
Gemma4:31b-cloud and DeepSeek-v4.1-flash:1017-cloud. General policy and denial
feedback changed; the final denial prompt also explicitly requests write, so
these are diagnostic iterations, not an unbiased improvement score. Reports:
dist/evals-tools-live and dist/evals-tools-final. Provider cache contracts use
HTTP fixtures; no paid Anthropic/OpenAI cache-hit or dollar-saving claim is made.

Final local checks: 434 passed, three optional native tests skipped, 53 files;
line coverage 82.17%. The explicit native Callix suite passed 25/25. Typecheck,
marketplace validation, generated-contract sync and diff checks passed. Scripted
tool evals passed 3/3; live Ollama tool episodes passed 6/6 as qualified above.
The rebuilt Linux x64 archive passed installer/checksum/default-plugin/model,
background workflow, bundled Callix and guarded editing smoke. Main CI now runs
and preserves the scripted tool-use report. No release tag was published.

## Local read commands, Markdown and GNOME Terminal behavior

The user reported unnecessary approvals for grep/ls, absent native cursor
changes, browser/native appearance differences, missing model Markdown, and
asked about OpenAI/Google caching. They identified GNOME Terminal as their host.

Builtin exec now classifies a restricted POSIX read/search subset using verified
standard executables, project/cwd/symlink checks, allowed flags and tokenized
pipelines/chains. Unsupported syntax, redirects, substitutions, executable
filters, shadow binaries, env overrides and external paths remain approval-
requiring. A readOnly descriptor/rule match allows the default without a reviewer;
explicit ask/deny and custom exec implementations are preserved. Plan mode
permits verified reads. This is a permission convenience, not an OS sandbox.

Default assistant Markdown uses Marked/GFM tokens before styled wrapping:
headings, emphasis, lists/tasks, quotes, links, tables and literal fenced code.
Control sanitization remains; HTML is not executed and images are not fetched.
Historical blocks cache by text/width/theme. Plugins still replace ui.render.
A constrained single Ink Text row holds all styled spans so narrow resize does
not independently shrink segments into clipped words. Ctrl+J/LF is distinct
from Enter/CR even in coalesced typed input; paste keeps its separate channel.

VTE/GNOME Terminal lacks OSC 22 support. Native cursor shape cannot be changed
there by this protocol; no false Pointer capability is advertised. Title/border
hover highlighting works independently, including separator feedback. Known
Kitty/Ghostty/Foot environments use OSC 22; conservative unknown/multiplexer
fallback and AGENT_POINTER=on|off|x11 overrides exist. The browser bench explicitly
emulates OSC 22; that is not proof of native support or equal GTK font rendering.

OpenAI/Gemini cached-input usage existed before this task. OpenAI Responses now
has opt-in promptCacheOptions (mode/TTL); older APIs can use promptCacheRetention.
Cache-write usage is accounted separately when reported, including compatible
Chat endpoints. Gemini implicit caching remains provider-owned; thinking tokens
now count toward output usage. No explicit Google cache objects are created or
managed, and no external cache-storage fees are enabled automatically. See
provider-specific contracts in docs/agent-features.md, with official sources.

New npm run visual:presentation uses the real PTY and a token-scoped loopback
model fixture, with OSC 22 disabled. It captures Markdown, styled cells, literal
code, native-independent hover, resize and source/compiled app behavior. Actual
GNOME Terminal/GTK is not installed in this environment; browser captures verify
the emitted terminal output and fallback rather than native pointer support.

Final checks: 447 passed and three optional native tests skipped in 55 files,
line coverage 82.18%; explicit native Callix suite 25/25. Typecheck, catalog
validation, generated-contract sync, scripted tool evals and diff checks passed.
The complete real-PTY interaction scenario passed under dist/visual-terminal-verified.
Focused source screenshots were inspected under dist/visual-presentation-width;
compiled screenshots/report are dist/visual-presentation-binary-final (including
hover without OSC 22). Narrow styled rows remain readable after resize. The
rebuilt Linux x64 installer/default-plugin/model/workflow/Callix/edit smoke passed.
No new release tag/publication was requested.

The first CI run rejected the positive ls read test. Executable pinning now
compares canonical system targets (including symlink/multicall installations),
not literal /usr/bin/<name> strings. The positive fixture uses a controlled
standard PATH; a symlink to the real system ls is accepted, while a shadow shell
script remains rejected. No generic basename-only executable trust was added.

## Universal auto-review eligibility

The user explicitly requested that auto approvals apply to arbitrary console
commands and tool calls, rather than a small tool/command whitelist. Auto-approve
1.2 now accepts every model-facing tool requiring approval for assessment:
shell, MCP, workflows and custom plugins. Already permitted actions avoid an
extra review; explicit deny remains binding before any reviewer call. Only
allow + low passes automatically. No blanket permission or unrestricted mode
was added; uncertain/higher-risk responses and failures still ask the user.

service.permission.review now optionally carries the registered tool description,
parameter schema and bounded current task context. Ephemeral children forward
their task plus the parent's original task; review budgets remain shared. The
reviewer treats metadata/arguments/context as untrusted data. Inputs above 24000
JSON characters return to manual approval without truncating hidden effects.
Command names/URLs are no longer a hard manual-only filter. Protected filesystem
mutations are guarded by descriptor effects, including custom tool aliases.
Canonical checks support new nested paths and reject unresolved symlinks.

Audit errors now update the in-memory verdict/history as ask, and disabling auto
while a review or its audit/UI completion is pending cannot return a stale allow.
Tests cover generic eligibility, metadata/context delivery, actual plugin tool
execution, explicit deny, higher-risk verdicts, malformed/oversized/unconfigured
reviews, shared budgets, nested files, symlinks and late disable. The mode still
requires /auto on and a dedicated reviewer profile; defaults remain manual.

Verification: 461 tests passed, three optional native tests skipped, 56 files;
line coverage 82.29%. Typecheck passed. Catalog 0.14 adds optional review metadata;
marketplace metadata and generated docs/schema are synchronized.

## Human choices and questionnaires (2026-11-09)

Extended ask_user with rich options (label/description/recommended), single or
multiple choice, and default custom text (allowOther:false closes the set).
Preserved numeric input and the legacy answer result/callback string options.
Added ask_questions for atomic 1–8 question interactions, stable question IDs,
Back, editable review and explicit submission. Shared events schemas validate
unique IDs/labels, answer completeness, choices and cardinality; results include
selected labels plus optional custom text. Headless/cancel does not invent answers.

The real TUI supports arrows, Space, Tab, mouse choice/description/button hits,
scrolling and narrow layouts. Question drafts preserve unsent prompts; queued
approvals cannot consume keys during an active question. Plugins use $.ui.ask
and $.ui.questionnaire through replaceable service contracts (catalog 0.15).
Human waits in plugin hooks require an appropriate trusted hookTimeouts entry;
render hooks cannot request input. Core guidance recommends essential questions
only, after inspecting available context, independently of execution permissions.

Verification: 479 tests passed, three optional native tests skipped, 59 files;
line coverage 82.55%. Typecheck, marketplace validation, scripted evals (5+3),
proxy smoke, release build and installation smoke passed. visual:questions passed
for source and compiled binary, with screenshots inspected; visual:check passed
including legacy child ask_user. The maintained bench now has a questionnaire
scenario; native GNOME pointer/font support and live provider behavior are not
established by the scripted xterm.js fixture.

## Interactive chat history (2026-11-09)

/history, /sessions and bare /resume open the replaceable session-manager browser.
The pane supports live literal search by name/ID/conversation text, local activity
dates, message counts, current/archive markers, paged keyboard/mouse selection,
first-prompt/latest-reply preview, native rename, archive visibility and resume.
Default labels come from the first ordinary prompt without an extra model call.
The search field is independent of the unsent prompt; Escape/Close preserves it.
Pending filters cannot resume stale results, and active turns reject switching.
Resuming identifies the selected chat in the conversation title and resets stale
recipient/context/tool/scroll display state. Known ID/prefix resumption remains.

compositor --resume (without an ID) and --history open history at startup; they
require a TTY. Explicit --resume ID still works in headless/plain modes. Session
history stays scoped to the project's existing home-storage root. Sidecars now
hold bounded first/last prompts, last completed response and message counts.
Legacy metadata is enriched read-only with a bounded process cache; appends
persist it. Body search streams conversation records and excludes tools/system
instructions. Search cancels stale work and is debounced; no paid model is used.
Handled commands now persist as prompt.dropped, so newly recorded UI commands
cannot reappear as user messages when replaying a conversation. Older unmarked
records are preserved rather than guessed away.

Catalog 0.16 adds optional UiTextView.input and ui.change for reusable editable
plugin views. The host owns the active local draft; change its ID or remove/
reopen the view to reset it. Text edits emit ui.change, navigation/actions use
ui.press, and generic rendering/placement contracts remain replaceable.

Checks: 491 tests passed, three optional native tests skipped, 60 files; line
coverage 83.25%. Typecheck, marketplace, generated contracts, scripted evals
(5+3), proxy smoke, release build and installation smoke passed. visual:history
passed for source and compiled --resume startup with inspected screenshots;
the full real-PTY visual:check also passed. Artifacts: dist/visual-history-fixed,
dist/visual-history-binary-final and dist/visual-history-regression-final. These
use isolated storage and scripted providers; no native GNOME/live-model claim.

History resilience follow-up: missing rollout files no longer block searching
other chats; non-event JSON values are ignored for previews/search and retained
as corrupt records for loss-tolerant replay/fork. Added these cases to the store
checks. The existing workflow concurrency fixture now gates both workers on an
explicit barrier rather than assuming a 5 ms sleep overlaps disk scheduling.
Final full-suite count remains 491 passed / three optional skipped.

## TUI UX/UI review and shared refinements (2026-11-10)

The user requested loading UX/UI review skills and applying their principles to
every TUI segment, explicitly authorizing subagents. Used Impeccable 4.3.1 and
project tui-visual-check. Independent A design review scored baseline 27/40;
independent B supplied actual PTY/detector evidence without anchoring A. A third
controls review covered forms/question/placement editing. The archived critique
is `.impeccable/critique/2026-11-09T13-57-20Z__packages-app-src-ui-ts.md`; the maintained
per-segment principles are docs/tui-design.md. This was scoped refinement of the
existing i3-like terminal identity, not a replacement visual world.

Implemented shared readable split projection (24 columns/6 rows), preserved trees/
ratios and directional access to hidden panes, correct fullscreen/composer focus;
contextual status/titles/hints; complete semantic action navigation with unique
IDs, scrolling and overflow cues, including ui.render overrides; literal native
input/approval rendering; pinned/scrolled approval details and explicit scopes;
real question text editing/reverse Tab; required/validation/form scroll guidance;
safe placement Escape; effective proxy summary with optional redacted diagnostics;
New chat labels and pinned literal search fields. Whole-word wrapping no longer
splits valid task words due to a half-width heuristic.

Catalog 0.17 adds optional selectionText, UiTextView.hint and input.label. Mono
uses explicit RGB selection colors rather than black/gray ANSI names, since bold
black may become bright black and disappear on gray. Keep all styling, semantic
views, hints and plugin placement replaceable. Mascot assets and agent/workflow
behavior were preserved. The web detector returned [] with no meaningful markup
coverage; no DOM-overlay or native GNOME/screen-reader clearance is claimed.

The user chose to update Impeccable to the offered 4.8.1 in the NEXT session. Do
not update it during this review. Preserve this deferred request; the current
skill context was loaded once and its installed files were not rewritten.

Final verification for the TUI review: 513 tests passed, three optional native
checks skipped, 62 files; line coverage 83.83%. Typecheck, generated contracts,
26-entry marketplace validation, scripted evals 5/5 + 3/3, proxy smoke and rebuilt
Linux x64 installation smoke passed. Current broad/settings/question/workflow/
Markdown reports are under dist/ux-final-confirm; corrected history and compiled
RGB/long-approval checks are under dist/ux-final-functional. Representative PNGs
were inspected. Initial counterexamples are retained under dist/ux-final-round1
and are not current passing evidence. The critique snapshot is closed as its
baseline source changed. All owned visual servers/browsers were cleaned up.

## Dependency refresh (2026-11-10)

The user requested review and updates of all libraries, including tooling.
All 23 external direct npm dependencies were checked against stable registry
dist-tags; manifests now name current stable versions, with compatible
transitive refreshes and standalone plugin lockfiles checked. Major migrations:
Zod 3.25.76 -> 4.6.7, TypeScript 5.9.3 -> 7.0.2, Undici 7.30.2 -> 8.12.4,
Marked 17.0.6 -> 18.1.3, Node types 24.19.2 -> 26.6.6. Development/source runtime
minimum is now Node 22.19.0; CI tests it and Node 26 LTS.

Zod migration preserves frozen event acceptance/defaults and questionnaire
refinements, uses explicit record key/value schemas and public JSON Schema
conversion. Generated schemas now contain actual contracts for all 83 events.
TypeScript 7 needs explicit ambient Node types. Undici 8 changes HTTP proxy
defaults; preserve CONNECT with explicit proxyTunnel:true.

Bun 1.4.4, Callix 1.7.0, Monty 1.5.0, git-cliff 2.14.2 and upstream Harness²
commit 6868817518876de8fd170c6a8354daca273b6191 were already current. CI actions
are upgraded and SHA-pinned. Harness² requires Python >=3.12,<3.14; isolated
Python 3.13 adapter check passed, while host Python 3.14 is not supported.
No user-global tools or installed skills were upgraded. Impeccable's previously
accepted update remains deferred to the next session.

Validation: 518 generic tests passed (3 optional skipped), 25 explicit native
Callix tests passed, typecheck/gen/marketplace/proxy passed, scripted evals 5/5
and tools evals 3/3 passed. Real PTY broad and Markdown presentation scenarios
passed with visually inspected screenshots in dist/dependency-visual and
dist/dependency-presentation. Linux x64 release build/installer smoke passed;
no release was published. npm audit: zero advisories, npm outdated: empty.
See docs/dependencies.md for full inventory and maintenance constraints.

## Published v0.2.0 (2026-11-10 local time)

The user explicitly requested publication. Released v0.2.0 as Latest:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.2.0
Immutable annotated tag: 212d549e64cc374678d9e8e45a6c8230bdfa0154.
Successful publishing run: 42638064053 (workflow_dispatch from f9ea46e).
All 518 generic tests, marketplace validation and four native release build/
installer/model/workflow/Monty/Callix guarded-edit smoke jobs passed. Six public
assets exist: Linux/macOS x64/arm64 archives, install.sh and SHA256SUMS. Latest
API points to v0.2.0; checksum entries match GitHub asset digest metadata.

Initial tag run lacked ripgrep in the verification runner. A later build exposed
a macOS smoke fixture issue: /var and /private/var temporary directory aliases
caused an exact edit permission rule to miss the canonical tool path. Fixed
release dependency provisioning and realpath of the smoke root, then verified
the fixture under an aliased TMPDIR locally and on both macOS native runners.
Application guards were not relaxed. No release was published from failed runs.

The tag was not moved. The repaired workflow can publish an existing unpublished
tag via explicit release_tag input only if its package version and application
source match the tag; only release.yml and smoke.mjs differences are permitted.
Publishing checks out the immutable tag for git-cliff notes and installer, and
validates downloaded CI artifact digests before upload. This run's code exactly
matches the tag outside those two pipeline/fixture files.

## Wisp Soul composer plugin (2026-11-10)

The user supplied wisp-soul-ink.zip and requested the redesigned mascot as an
extension of human message input rather than a separate actor/window. Adapted
the supplied WispSoul text frames into plugins/mascot/wisp.ts; Unicode small
fullwidth dashes in eyes use ASCII dashes to keep terminal cell geometry stable.
No images are generated, no new library or model calls are added.

The default mascot now publishes UiTextView.attachment {site:'composer',width,
label} through the normal $.ui.view API. This is generic and replaceable; AppUI
contains no mascot-specific rendering or event logic. A stable latest-producer
slot lives inside the host-owned editor, never enters the tiling tree or plugin
placement panel, and is removed on disable/unload. Existing drafts/focus/dialog
controls stay host-owned. Protected dialogs/completions retain their full input
space. At >=60 columns and >=24 rows the text art sits in four rows beside the
editor; narrower screens retain status only. Existing legacy layout panes are
not restored for a composer attachment.

The activity reducer still observes tools, turns, planning, concurrent children,
manual dialog reactions and independent-agent metadata. Text motion uses 250ms
frames only when expanded/selected; compact, hidden, headless, paused, NO_COLOR
and TERM=dumb stop frame advancement while activity and transient expiry work.
/mascot on|off|pause|resume|pet|reload persist through project settings. Earlier
APNG pack settings are legacy and yield a notice; APNG assets/decoder and generic
raster/Kitty rendering remain available to other views and compatibility tests.

Validation: typecheck/generated contracts/marketplace passed; 522 tests passed
with 3 optional skips. Composer tests verify no separate window, stable draft,
compact behavior, producer priority and removal. Real PTY broad regression and
focused mascot lifecycle passed; current screenshots/report are under
dist/wisp-regression and dist/wisp-composer-final. Wide, compact and protected
approval screenshots were inspected. Earlier wisp-composer-proof/confirm are
failed diagnostic captures (unsupported test shortcut and inherited NO_COLOR),
not current evidence. The motion-only scenario explicitly omits inherited
NO_COLOR in its isolated child; production respects it and unit regressions
cover static preferences. Built Linux x64 distribution and installer/model/
workflow/Monty/Callix smoke passed. Published v0.2.0 assets were not changed;
these source changes await a future release.

## Wisp storyboard correction (2026-11-10)

The user supplied 1670.jpg as the intended visual reference. The four-row
WispSoul.tsx archive was a simplified diamond-like placeholder, not a faithful
representation of the curled pixel flame in the storyboard. The initial
integration incorrectly treated it as final artwork. Reference appearance now
wins: the plugin builds bounded 18x12 monochrome pixel silhouettes with a bent
flame tip, rounded body, negative-space eyes and state-specific decorations.
Half-block glyphs encode pairs of pixels into six terminal rows. Solid blocks
use background-filled cells in composer art to avoid font baseline seams.

UiTextView.attachment adds optional rows (1..8, default4) so other plugins can
choose bounded art height too; the host remains mascot-agnostic and the human
editor/compact/protected-dialog behavior is preserved. Wisp requests width18,
rows6; semantic theme accent keeps the character monochrome. This supersedes
the archive-based four-row visual while retaining the composer plugin model.

Verified: 522 tests passed, 3 optional skipped; typecheck/gen passed, focused
real PTY lifecycle and broad regression passed. Current captures are in
 dist/wisp-storyboard-confirm and dist/wisp-storyboard-regression; idle and
happy silhouettes were visually inspected. Linux x64 build and distribution
smoke passed. No published release assets or tags were changed.


## Ghost source media and native composer graphics (2026-11-10)

The user rejected the Wisp text/pixel replacements and chose to return to the
original Ghost. They offered new APNG assets; no replacement archive has arrived
yet. Do not redraw the character or synthesize intermediate poses. Preserve
source pixels, alpha and timing. The old bundled APNGs remain available and are
228x228, six frames at 180ms each (~5.6 fps); a renderer cannot manufacture smooth
source motion. Ghost remains a replaceable plugin attached to the human editor,
never a separate actor/window. This supersedes both Wisp sections above.

Mascot now decodes GIF (bundled MIT omggif 1.0.10) and PNG/APNG, including finite
loops, GIF disposal/background/transparency, and original positive frame delays.
Limits are 2 MiB input, 512x512 canvas, 600 frames and 8 million total decoded
pixels per state. Timeline follows monotonic elapsed source time, skips late
frames, freezes while paused/hidden, and stops finite animations. Transient state
expiry remains independent of long source holds. Automatic dark-ink repair is
restricted to SHA256 fingerprints of the ten historical bundled APNG files;
new artwork keeps its alpha untouched unless restoreInk is explicitly requested.

Renderer auto-negotiates Kitty or SIXEL. SIXEL requires DA1 code 4, measured
physical cell size (CSI16t or VTE-compatible CSI14t+CSI18t), and terminal
background (OSC11); otherwise the composer keeps compact semantic status with
images unavailable. It does not silently replace source artwork with block art.
Forced SIXEL still needs size/background replies. SIXEL composites alpha,
letterboxes aspect ratio, quantizes with a bounded weighted median-cut palette,
and clears old cells before geometry changes. Native-only frame changes bypass
React/Ink text repaint through separate text/raster dirty channels; public
RendererState.apply still reports all visual changes. Other text plugins retain
normal composer attachment behavior. No application-specific mascot code in host.

Validation: typecheck, generated contracts, marketplace validation and 536 tests
passed (3 optional native skips). Linux x64 build and extracted distribution
smoke passed, including packaged GIF decoding and license notices. Real PTY
compiled Ghost lifecycle and broad regression passed; final evidence is in
 dist/ghost-media-shipping-final and dist/ghost-media-regression-shipping.
Inspected the full-resolution Ghost and compact draft screenshots. Independent
ImageMagick SIXEL decode verified all 4096 checkerboard pixels; separate 4096
colour gradient check had maximum RGB error 7 (mean 2.67). Diagnostic Kitty
emulator observed ~35.8 distinct changes/s for a synthetic 50 fps GIF in a two
second run (dist/ghost-media-gif-smooth), not a native terminal-wide guarantee.
Native GNOME Terminal/VTE SIXEL rendering is not verified on the user's terminal;
the local VTE build lacks SIXEL. Do not claim pixel-perfect GIF in every terminal.
Release builder includes omggif README MIT notice; no FFmpeg runtime dependency.
No published v0.2.0 assets/tags were modified and no new release was requested.
