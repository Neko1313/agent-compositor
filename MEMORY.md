# Project memory

## Verified v0.5.1 publication — 2026-11-11

The user explicitly requested publication of the render fixes. Host v0.5.1 is
published as latest from tag commit 26fb7e38599ddb3bfa2858bd803f08fbba5934a9:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.5.1
Release run 42928439141 passed quality verification, all four Linux/macOS
x64/arm64 native build/installer smoke jobs, and publication. Main CI on
Node 22.19.0/26 and the documentation deployment also passed.

The public release has four archives, install.sh and SHA256SUMS. Verified latest,
non-draft/non-prerelease status, all archive digests against SHA256SUMS and GitHub
asset digests, and the downloaded installer/checksum file contents. Local compiled
v0.5.1 installer smoke passed before tagging. Publication evidence is retained at
dist/release/v0.5.1-publication.json. Coverage verification passed 840 tests with
3 optional skips and 88.24% line coverage. GitHub Pages serves the v0.5.1 CLI
reference and updated render architecture/bench instructions.

Plugin preparation was a no-op: no affected plugin runtime bundles, no release
metadata writes, development catalog remains 1.0.2. No independent plugin tags
were published. The rendering investigation below is now included in the host
release; benchmark observations retain their stated environment/terminal limits.

## Render latency, animation and VTE checks — 2026-11-11

The user reported whole-app stalls around animation/hover and identified GNOME
Terminal/VTE. AppUI previously drew both the assistant.text catalog precursor
and the rewritten delta, reparsing growing Markdown on every fragment. Text now
coalesces on a 16 ms timer; input/lifecycle draws remain immediate, turn completion
flushes pending text, and close cancels the timer. Ink incremental rendering is
enabled. Native composer images reserve their rectangle without portable RGBA
downsampling, and host-owned input bypasses the unused view cache key that used
to stringify full image payloads.

Added visual:performance to the existing real PTY/xterm.js bench: live source
animation, 1200 Markdown/Unicode fragments, keyboard echo, pointer/highlight
latency, erase counters, output volume, browser queue/long-task observations,
fixture CPU/event-loop measurements and eight seeded resize cell/style checks.
visual.frames remains an output-chunk counter, not FPS. Snapshot synchronization
requires complete borders and three stable browser frames; visible text access
now clips hidden xterm cells beyond the current viewport after shrinking.

Native GTK3/VTE replay of captured output/resizes exposed an existing ZWJ-width
mismatch that could scroll the whole layout and remove its header. Alternate
screen output now disables autowrap and restores it for external programs/exit.
Resize synchronization begins before Ink's out-of-band clear, preventing a blank
intermediate paint. Tests cover final streamed content and bounded redraws,
native image decoding avoidance, resize synchronization and wrap restoration.
VTE still shapes some ZWJ sequences as multiple glyphs: bounded output prevents
vertical damage but does not establish universal glyph-width/pixel parity.

Final sequential motion comparison: dist/render-baseline-final versus
dist/render-candidate-final. Streaming duration 28.53 s -> 3.99 s; PTY output
6,904,145 -> 721,004 bytes; whole-fixture CPU 32.79 -> 4.86 s. Hover-highlight p95
34.2 -> 18.2 ms. Streaming keyboard p95 62.4 -> 66.2 ms; do not claim typing
became faster. All eight terminal cell/style snapshots match. Resize blank paints
fell from two to zero in this run. Results are fixture/environment observations,
not guarantees for arbitrary projects/terminals. Performance runs must be serial.

The --vte profile models compact status without SIXEL/OSC 22 and checks real
hover painting. tools/visual/vte-replay.py optionally feeds the same raw trace to
an actual offscreen GTK3/VTE widget. Final trace/pixels/report are in
dist/render-vte-final, validated on VTE 0.84.1 (62x31, header/result/draft intact).
The local VTE build has no SIXEL; no live GNOME GPU/input/SIXEL claim is made.
Cold SIXEL encoding of the six bundled idle frames took 7..75 ms in a separate
microprobe; the graphics backend caches those frames. Custom large animations
and terminal-dependent Unicode width negotiation remain separate topics.

Final verification: 840 passing package tests, 3 optional skips, typecheck,
generation/docs build, broad real-PTY regression (dist/render-regression-final)
and source-image Ghost lifecycle (dist/render-mascot-final), with PNG inspection.
Changes are local and unpublished; no plugin/catalog versions were hand-bumped.

## Verified v0.5.0 publication — 2026-11-11

The user explicitly requested publication and release. Published host v0.5.0
from immutable tag commit 968b346aaab0f91ca29b4c0a6458a7292ebe4215:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.5.0
Release run 42913930683 passed its quality gate, all four native build/installer
smoke jobs (Linux/macOS x64/arm64), and publication. The non-draft release is
latest and contains four archives, install.sh and SHA256SUMS.

The first automatic plugin release preparation succeeded end to end. Reviewed
and merged PR #1 after CI on Node 22.19.0/26 and documentation checks passed.
Only generated release metadata/references changed; 27 plugin baselines are
recorded, workflows is 1.4.0, background-jobs is 0.1.0, Callix is 1.3.0 and the
development catalog is 1.0.2. A clean post-merge plugin:prepare returns no pending
plugins or writes. Host archives bundle these snapshots; independent plugin
release tags/archives were not published. GitHub required approval for the first
bot PR's workflows; these were approved after reviewing the generated diff.

Verification included 837 passing tests (3 optional skips), 87.42% line coverage,
all 27 deterministic plugin certificates, typecheck, documentation build, real
PTY checks and a local compiled installer smoke. GitHub Pages serves the updated
reasoning/workflow/background-job guides and the v0.5.0 CLI reference at
https://neko1313.github.io/agent-compositor/.

## Workflow completion and reasoning controls — 2026-11-11

New workflow_run runs default to completion:wake, with notify/none alternatives.
Each run retains its originating session context; retry/resume adopts the
requesting session and increments the delivery generation. Completion metadata
contains no worker output and uses the bounded service.agent.enqueue queue.
Interrupted foreground turns pause follow-ups while detached workflow stages
continue. Stopped work only notifies, paused work does not deliver, and loading
old journals never replays completion. Host shutdown drains cores and plugin
workers before closing state/network services. This extends the earlier optional
background-jobs work; workers still consume their normal model/token budgets.

Trusted hooks can acquire $.background() during a live invocation. Its services
and signal last for that plugin instance rather than a foreground turn; next()
is forbidden and unload revokes it. This is an explicit trusted SDK capability,
not isolation or a permission bypass.

The model selector and connection editor now expose profile reasoningEffort,
project/global persistence and Provider default reset. Reset is stored as null
to clear inherited legacy values; older saved profiles without the field retain
legacy inheritance. Changing effort preserves a manual model selection. Gemini
thinkingLevel is encoded uppercase; other provider fields keep their native
mapping. Offered protocol levels remain model-dependent, with official source
links in docs/state-and-network.md. Existing custom gateway levels stay visible.

Verification includes real PTY settings selection/restart/reset and workflow
parent wake (dist/visual-effort-final, dist/visual-workflow-completion), transport
fixtures, foreground interruption, per-run delivery, retries and SDK revocation.
Changes remain local and unpublished; plugin versions/changelogs are owned by
the automated release preparation workflow rather than hand-bumped here.

## Event-driven background jobs — 2026-11-11

The user requested long-lived background commands with completion subscriptions,
agent wake-up and continued foreground conversation without polling/model costs.
New optional background-jobs 0.1.0 observes the existing guarded
exec(background:true) path and exposes background_jobs list/status/subscribe/
unsubscribe. Default automatic mode is wake; mode:notify emits only a user
notification, autoSubscribe:false permits explicit subscriptions. Output and
cancellation remain separate guarded exec_output/exec_kill tools. No production
activation, publication or commit/push was performed.

Catalog 0.20 adds service.shell.jobs (metadata), shell.completed (OS close),
service.agent.enqueue (bounded owner/dedupe queue) and service.background.jobs
(optional plugin policy). Completion envelopes exclude stdout/stderr, command and
environment. Follow-ups have agent provenance, run after a busy turn, coalesce
nearby completions, pause after interruption and are revoked on owner unload.
Host lifetime checks use actual HooksHost registration, including dynamic SDK
plugins, rather than a stale composition snapshot. Normal permissions/budgets
apply; untrusted process output never becomes a user instruction.

Host shells now have per-core UUID identities instead of a global shell map,
16 concurrent jobs, bounded completed history and 512 KiB output tails per
stream. Background timeoutMs is enforced (default 120000, max 86400000). Failed
launches drain native close before rejecting. Clear/end/app close drain process
groups, workspace revocation kills affected commands, ephemeral subagents close
their shells, and app close cancels/drains an awakened provider stream. Successful
background admission no longer counts as an exec failure in harness recovery.

Plugin reload preserves version-1 session subscription records and reattaches
live jobs. Unknown/corrupt state is rebuilt from live host metadata without
replaying commands; restart cannot recover unowned OS children. Plugin removal
revokes subscriptions/queued wakes; host-owned commands continue until their own
cancel/timeout/session teardown. Single-shot headless runs do not become daemons.
Older v0.4.0 hosts lack these primitives, so installing this plugin alone there
is insufficient. The host update is part of this source change.

Initial integration caught a submit() microtask regression affecting immediate
Ctrl+C: reset waits are now conditional, preserving synchronous busy-state entry.
Clear reinitializes active plugins after teardown, preserving Callix warming;
host close also revokes dynamically registered plugin lifetimes.
Real PTY/browser verification exercises a cancelled busy turn, a background shell,
foreground chat, closed provider streams during waiting, one output-reading wake,
and an unchanged unsent draft. Evidence: dist/visual-background; the scripted
provider's six requests include interruption, launch, chat and result continuation,
not polling. A first bench attempt clicked before resize acknowledgement; the
scenario now waits for the actual resized footer. No product input relaxation or
timeout extension was used. External model reliability remains a separate claim.
Final package verification includes 825 passing tests (3 optional skips), typecheck,
the 94-page documentation build and the real PTY scenario at
dist/visual-background-final. The new-plugin release-plan regression preserves an
initial manifest byte-for-byte when its version stays unchanged, so formatting
alone cannot make the generated PR fail strict version checks. Expected missing
bootstrap manifests are read quietly. Final PR and installed-archive certificates
passed and match the current source identity; Linux x64 archive smoke passed.
This is local evidence, and no release has been published.

## Eager Callix warming and automatic plugin release preparation — 2026-11-11

The user requested proactive indexing for active Callix and automatic plugin
versions/changelogs. Callix now starts its owned primary-root warm immediately
on session.start/reload, precomputes navigation maps and shares analysis with
the first query without blocking startup. Debounce applies to later file edits.
session.end cancels/drains its watcher/build and retained queries. background:false
still disables warming. Tests cover startup before any query, sharing/cancellation
and the explicit lazy setting; source/archive behavior checks also exercise warm
startup without initiating analysis through a diagnostic query.

`.plugin-release.json` bootstraps at 0c0f975 and records each prepared source
baseline. `plugin:prepare` plans from committed history in a clean checkout;
`--write` applies metadata. The main-push `plugin-release-preparation` workflow
creates/refreshes automation/plugin-releases with SemVer, changelog entries,
relative catalog versions and generated references. fix/other runtime changes
select patch, feat selects minor and !/BREAKING CHANGE selects major; notes include
breaking migration bodies and commit links. Inputs include bundled workspace
code/manifests, selected lockfile dependencies, Monty's copied native variants and
distribution tooling. Docs/tests-only changes and unrelated docs dependencies do
not bump plugins. Higher pre-existing development versions survive migration.
Published archive entries stay pinned until certified catalog promotion.

Normal contribution CI reports pending preparation instead of requiring hand
bumps; generated release PRs use strict checks. Tag metadata validation rejects
unprepared runtime changes. Publication extracts only the selected changelog
entry and retains existing certification gates. Preparation itself does not tag
or publish. AGENTS.md, contribution docs and plugin-author's served standard guide
explain the new routine workflow.

GitHub's Actions PR-creation setting was enabled using the authorized gh account;
the API's combined can_approve_pull_request_reviews flag is true, while default
workflow permissions remain read. No automatic review/merge is implemented. The
preparation job explicitly dispatches CI/docs for its generated commit because
GITHUB_TOKEN-created PR events do not trigger those workflows. No PAT is stored.
No commit/push has deployed the new workflow yet.

An isolated full-repository snapshot prepared all 26 versions/catalog entries
successfully (the shared license-packaging fix affects every native artifact).
Strict checks and marketplace validation passed; after committing the generated
metadata, re-planning returned no changes and Callix tag validation passed. A
regression caught and fixed the initial catalog bump edge case when migration
followed an already raised development catalog version. Local tests also cover
breaking/patch/minor batches, archive pinning, dirty-checkout protection, actual
Bun input discovery without entrypoint execution, and release-note extraction.
Final verification passed 810 package tests (3 optional skips), 37 explicit
Callix checks, typecheck, docs generation/build, and Callix/plugin-author PR
certification. Callix's Linux x64 archive passed artifact certification and smoke.
The isolated generated release batch also passed the full docs check/build,
including commit summaries with MDX-sensitive braces, strict version checks,
catalog validation, a no-op repeat and tag-readiness checks. YAML/run-block shell
syntax was checked locally; the new workflow has not run on GitHub yet.

## Large Callix graph verification — 2026-11-11

The user authorized finding a large local project or cloning Superset to test
graph-size failures. The replan session recorded repeated `Callix graph exceeds
output limit` failures for status, symbols and a file-specific outline. Native
Callix produced a 69950821-byte graph (100610 nodes, 209723 relations) in 8.85s;
the adapter reproduced its 64 MiB failure in 8.65s. No replan source/configuration
was modified; diagnostics and isolated caches are under /tmp/compositor-replan-*.

The unreleased 1.3.0 now defaults to a 256 MiB native graph limit (the existing
maximum). Explicit lower limits remain honored for new builds. Overflow errors
distinguish full-graph bytes from model-facing maxTokens and suggest recovery.
Timeout/output limits no longer invalidate completed graph identities; concurrent
builds retain separate resource/deadline ownership. Earlier v3 disk-cache keys
remain readable. Disk validation avoids a second full stringify/parse of graphs.

On the same replan query, a cold outline returned 13 symbols in 10.2s, a warm
query in 65ms, and a fresh process read the disk cache in 352ms even with a 1 KiB
new-build limit. These are local observations, not general performance claims.
Tests cover a graph above 64 MiB, compact result budgets, resource-limit changes,
legacy disk caches and separate concurrent deadlines. The full suite passed 800
tests (3 optional skips), plus 36 explicit Callix checks, typecheck, documentation
build and PR/archive certification with archive smoke on Linux x64. Native
output, parsed graphs and adjacency maps still
need memory; graphs above 256 MiB require a narrower attached project or text
tools. This does not implement an unbounded/out-of-core graph database.

## Callix invocation and indexing reliability — 2026-11-11

The user reported that asking an agent to invoke Callix led to a long wait and
then no usable graph/tool. Their exact installed configuration and error were
not provided. A native probe on this checkout (632 discovered files) measured
about 7.9 seconds cold and 10 ms warm; these are one-machine observations.

Reproduced and fixed status triggering analysis, prose/log edits invalidating
semantic caches, and invalid direct service actions starting a native process.
Callix 1.3.0 adds readiness/error diagnostics without analysis, source/resolver
input fingerprints, one timeout across source-change retries, and immediate
recovery after the last consumer cancels. Last-consumer cancellation also drains
native process teardown before disposal completes. Attached roots use separate
disk-cache directories. Removing an attached root cancels its retained queries.

Enabled background mode now returns pending:true/complete:false after queryWaitMs
(default 10000, range 50..600000), while the owned build continues. Status shows
availability, selected executable, indexing attempts/time or the last failure.
glob/grep/read remain usable. Close/reload/disable cancels retained queries;
background:false retains synchronous bounded behavior. v3 fingerprints rebuild
older disk entries once. README/help explain code_query versus native callix
and action values such as read_symbol. No user activation or provider policy
was changed. Development catalog metadata is 1.0.1; the plugin is 1.3.0.

A real Gemma navigation/edit diagnostic used code_query successfully but first
invented a read_symbol tool and later exhausted its 80000-token task budget,
despite correct file effects and executed verification. It is a failed full task,
not evidence of general model reliability. The generic core now suggests an
available tool whose action enum exactly matches an unknown tool name; it does
not execute an alias, bypass policy or reveal excluded tools. A focused source
inspection task passed with actual code_query calls on Gemma and DeepSeek
(two requests each). Reports: dist/callix-reliability-live and
dist/callix-invocation-live. No general quality or speedup claim follows.

Artifact installation also exposed plugin archives copying notices from every
root dependency, including the documentation site, exceeding the installer's
directory inventory limit. Plugin builds now select notices from bundler inputs
and explicitly copied native packages; installer limits remain unchanged. A
regression verifies bundled notices survive and unrelated packages are excluded.

Local verification includes 797 package tests (3 optional skips), 33 explicit
native Callix checks, typecheck and documentation build. The package behavior
scenarios now assert non-indexing status, retained failure diagnostics and
pending-worker cleanup on the actual source/installed candidate. Independent
PR and archive certificates passed for the final Linux x64 candidate, along
with archive smoke. This is not four-platform publication certification. No commit, push
or release publication was requested for this fix.

## Docusaurus documentation and GitHub Pages — 2026-11-11

The user authorized building the documentation site and publishing it to GitHub
Pages, including repository configuration changes through the authenticated gh
CLI. Pages now uses Actions at https://neko1313.github.io/agent-compositor/;
the repository homepage points there. No native application release is implied.

The website workspace uses Docusaurus 3.10.2, its standard reading/navigation UI
and local full-text search. It publishes 92 pages from canonical docs, all 26
native plugin READMEs/changelogs, authoring references, the terminal manual and
the visual bench guide. website/.content and build are ignored projections;
edit links return to the original source. Navigation inventory and ownership
coverage live in tools/docs. The site describes main, with independent plugin
versions, rather than claiming immutable release snapshots.

New entry guides cover setup, the first plugin, architecture, contribution and
documentation maintenance. Generated committed references use real CLI help,
plugin manifests and package metadata. docs:check rejects stale output, missing
page/module coverage and broken links/anchors and executes the first-plugin
package through actual activation, unrelated-input handling, reload and disable.
An intentional wrong tutorial was rejected by the checker. docs:dev watches
canonical source directories; source-to-projection changes and restoration were
verified. AGENTS.md and the PR template require documentation impact review;
docs:impact routes diffs to relevant pages and is explicitly advisory.

The documentation workflow checks pushes/PRs and deploys main through the Pages
environment using OIDC. Existing application/plugin release gates remain separate.
GitHub branch protection was not changed: workflow execution alone does not make
it a required merge status. Runtime docs were corrected for model defaults,
layout persistence, context metadata, mouse support and historical milestones.

Docusaurus transitive Tinypool, serialize-javascript and SockJS UUID dependencies
have reviewed root overrides. Audit reports no moderate/high/critical entries;
five low entries remain from upstream deepmerge in the build-time SVGR chain
(docs/dependencies.md). Search uses hashed filenames: Docusaurus's local server
misredirects query-hashed JSON assets under a non-root base URL. Browser smoke
is docs:browser with an existing Chromium override; captures live under dist/.

Local typecheck and all 787 application tests passed (3 optional skips), along
with documentation checks/build and event generation. Publication status must
be verified from the documentation workflow and public URL after the commit.

## Verified v0.4.0 publication — 2026-11-10

The user authorized committing, pushing and publishing the host release after CI.
Feature commit da4c60a introduces explicit scoped activation, independent plugin
versions/catalog updates and mandatory certification. Release commit 74e76e9
sets the root/app/lockfile to 0.4.0 and documents the opt-in migration. Annotated
tag v0.4.0 points to 74e76e9c5ffe6e65c2c2b13b1b7afc43eb8eccda.

Main CI 42822150243 passed on Node 26 and 22.19.0. Release run 42822929225 passed
verification, native build/installer/model/Monty/Callix smoke on Linux x64/arm64
and macOS x64/arm64, then publication. GitHub reports v0.4.0 as latest, non-draft,
non-prerelease, published at 2026-11-10T13:22:18Z. Assets are the four native
archives, install.sh and SHA256SUMS. Published v0.3.0 assets/tags were not changed.

Before tagging, all 26 full source release certificates passed on the committed
candidate, including real PTY and live reference cases, and were reverified
against its source snapshot. Local Linux full distribution smoke passed; the
Harness2 Python 3.13 environment passed 46 tests. Source evidence is retained in
reports/certification/summary-release.json and host-v0.4.0.json.

This host release bundles the independently versioned plugin sources and offline
market. It does not publish separate plugin/* tags/releases or claim complete
four-platform standalone plugin archive certification. Those independent release
workflows retain their full gates and reference-service configuration requirement.
Fresh plugin activation is explicit; enable mascot or plugin-author in the desired
scope and reload when needed. Existing explicit user/project selections persist.

## Plugin coverage completion — 2026-11-10

The user asked to close the blocking gaps from the initial certification rollout.
This supersedes the initial 25-plugin/329-gap inventory below. All 26 native
packages now bind and pass their complete deterministic PR matrix and Linux x64
extracted-archive matrix. There are no deterministic adoption waivers.

Added tools/plugins/behavior requirement-specific oracles for actual SDK-loaded
modules, filesystem state, genuine legacy layouts, project isolation, HTTP and
CONNECT faults, stdio MCP, native Monty workers, controlled Callix processes,
workflow selection/routing/budgets, private forms and plugin authoring. Composite
cases repeat all component assertions on the managed installed package after
reload, fresh process, a synthetic contract-preserving update, rollback and
re-enablement. Synthetic updates are not historical compatibility evidence.
Archive scenarios verify embedded identity and use the same public SDK linking
helper as the real installer. A separate extracted native Callix check parsed a
TypeScript function through code_query successfully.

Nine package-specific real PTY scenarios exercise source/archive identity, actual
terminal input/actions, narrow drafts, dismissal and restart, retaining PNG/ANSI/
input/report evidence. Six model profiles use the declared live Ollama reference
(gemma4:31b-cloud), three repetitions of seven task types each. All 126 cases pass;
graders inspect actual artifacts, activated generated commands, approval verdicts,
workflow results, plans and retained compaction goals. Thirteen negative controls
reject wrong, unsafe, fabricated or incomplete outputs. Calls and tokens are
bounded; provider usage is recorded and unavailable monetary billing is null.
Standalone live evaluation is diagnostic, never a publication certificate.

Coverage found and fixed observable failures: unawaited notifications, lost
turn-log retry prompts, malformed export input, invalid MCP configurations and
hidden operation errors, cross-project checkpoint storage and cancelled restore
writes, hanging CONNECT shutdown, and default one-second model command deadlines.
Compaction now preserves its transcript AND reports summarizer/non-reduction
failure; session commands consume denied/failed controls so the model cannot
falsely claim success. Plugin authoring checks entry syntax without importing code
in Bun and guides complete-file edits and behavior verification. Changed plugins
have independent patch versions, changelogs and matching development catalog
entries. Coverage output now lives in reports/coverage so it cannot erase existing
certification evidence during a concurrent run.

Validation: 787 TypeScript tests passed, 3 optional skips; 86.7% line coverage.
Typechecks, generated contracts/schemas, marketplace metadata, independent version
checks, workflow YAML and the scripted 5-case/3-case/proxy evals passed. All 52
PR/archive certificates were reverified against the current inputs and exact
archive checksums. All nine required UI profiles passed; inspected the relevant
normal/narrow/private-form/restarted screenshots. Failed diagnostic captures and
superseded source identities are not publication evidence.

Current evidence: reports/certification/adoption-readiness.json and
verified-local.json, summary-pr.json, summary-artifact-local.json, per-package
artifact/linux-x64/pty, and dist/plugin-live-verified-<name>. The source release
gate still rejects uncommitted inputs; other three archive platforms and remote
CI were not executed. Model-dependent release CI requires repository variable
PLUGIN_LIVE_OLLAMA_URL and optionally secret PLUGIN_LIVE_OLLAMA_TOKEN; absence
blocks the release rather than replacing the model. No commit, push or release
was requested or performed in this follow-up.

## Initial fail-closed plugin certification — 2026-11-10

The user authorized implementing the blocking mechanism for current and future
plugins. V2 plans now declare component/trait profiles, platforms, preceding
release, individually bound cases, setup/oracles/forbidden effects and budgets.
The loader derives a union of mandatory requirements. Legacy v1 convenience
suites remain readable but cannot certify publication. Obvious omitted manifest
profiles are rejected; arbitrary trusted native logic still requires review.

Added tools/plugins/certification.ts, certify.ts, gate.ts and the scenario protocol.
Exact Vitest file/full-name results plus diagnostics reject skips, duplicates,
empty/unrelated runs, failures, retries and flaky passes. Scenario evidence binds
run ID, package, plan, host/tooling/fixture snapshot, platform and archive checksums.
Live cases must match predeclared provider/model/config/task digest, repeat count,
success floor and baseline; scripted models cannot satisfy them. Upgrade evidence
needs the actual previous tagged version and pinned artifact. A forgotten null
previousVersion cannot waive preceding tags. Release inputs must be committed.

The bounded runner limits time/output and terminates owned process groups on
failure/timeout, including descendants. Archive certification repeats component
and trait behavior against the installed candidate, rather than accepting a lone
install smoke. The archive embeds its build input identity and is checked before
execution. Publication/catalog generation reverify complete source and four-platform
archive certificates against the immutable plugin tag. Catalog promotion retains
hashed evidence; official archive validation rejects missing certification even
when an entry omits the native format marker. CI/host-release jobs automatically
run the mandatory deterministic matrix for every discovered native package.

All 26 native packages have v2 profiles and useful installed-package lifecycle
scenarios: inactive installation, enable, repeat, double reload, fresh process,
disable, re-enable and remove preserving independent settings. Their source
baseline scenarios pass. This does NOT mean all 26 are fully certified: only
notify-done currently satisfies the complete deterministic matrix; 25 are blocked
by 329 missing deterministic bindings. Real PTY/model/domain/migration coverage
must be implemented rather than relabeling broad convenience suites. The mandatory
CI step intentionally remains red while those requirements are absent. No
legacy adoption exemption or waiver silently grants readiness. The portable
Claude example is not an independently published native package.

A new command isolation probe found btw consuming /btw-unrelated. Fixed exact
command matching, added regression coverage and bumped its independent version
and development catalog entry to 1.2.0. notify-done now has real public-host
unrelated/repeat/dependency-failure recovery cases. Host update tests additionally
reject a tampered rollback backup while retaining the active version.

Validation: 761 TypeScript tests pass, 3 optional skips, 85.92% line coverage;
root and new plugin-tooling typechecks, schemas, marketplace metadata and workflow
YAML parsing pass. notify-done passes deterministic and Linux x64 archive matrices;
corrupt archives and uncommitted release inputs are rejected. Validator tests
exercise incomplete evidence, wrong content/platform/artifact, exact bindings,
model policy drift, preceding tags and catalog promotion with an older release.
Other platforms and live reference-model evaluations were not executed locally.
Reports: reports/certification/summary-pr.json, per-package readiness/certificates,
notify-done/artifact/linux-x64 and rejections/. No commit, push, release or remote
CI execution was requested or performed in this turn.

## Mandatory plugin testing model — 2026-11-10

The user correctly identified that the standard's test-plan format and green
commands do not define or enforce sufficient coverage. Audited the current
runner: unit/integration suites are self-declared, visual/evals optional, and
the shared per-plugin contract only exercises activation/unload. The previous
744/26 passing counts must not be described as complete plugin certification.

Added docs/plugin-testing.md as a proposed normative model, explicitly separating
host guarantees, actual plugin behavior and real model effectiveness. It defines
mandatory lifecycle cases, component/trait-derived obligations, objective case
oracles, negative controls for graders, source/artifact checks, previous-release
migration and live model evidence for model-dependent changes. Readiness has
passed/failed/missing/blocked/reviewed-not-applicable outcomes; missing required
evidence or skipped required cases cannot produce a green publication gate.

The model is not yet enforced by schemaVersion 1 or certification tooling.
Do not claim that all 26 packages satisfy it, fabricate mappings from existing
broad suites, or treat scripted model results as live quality evidence. Next
implementation should derive required matrices, bind individual executed cases,
audit actual coverage and gate release/catalog promotion on content-bound
certificates. This turn defines the model rather than silently implementing a
new testing framework before discussing its requirements.

## Plugin standard 1 and independent marketplace lifecycle — 2026-11-10

The user requested uniform plugin standards/testing, all plugins off by default,
a preconnected repository marketplace, scoped opt-in and independent plugin
versions/releases/updates. They explicitly chose independent versions and releases
in this monorepo rather than separate repositories. This authorizes the current
implementation; the earlier deferred marketplace discussion is resolved.

All filesystem packages now remain unimported until explicit user/project
activation (or an explicitly configured legacy capability selection). Kernel
loop/file tools, model/session/settings and management adapters remain available
for bootstrap. An exact enabledPlugins ceiling and disabledPlugins restrictions
remain binding. Project decisions override user decisions. Selection records bind
the actual source directory, persist across restart and do not silently fall back
to another copy when the chosen source disappears. User grants select shared code;
project-local overrides need explicit project consent. HOME workspaces keep new
project installations separate from user installations; legacy paths are retained.

The repository agent-compositor catalog ships offline. Bundled code is an inactive
cache: normal installed-app activation requires installing a scope-specific
snapshot first, preserving its version across core upgrades. Installed versions
outrank the cache. Official relative entries use matching self-contained bundled
snapshots; newer first-party versions require a published archive entry, avoiding
incomplete raw sources. Installed package versions remain unchanged on catalog
refresh. Local development folders can still be explicitly enabled for iteration.

Standard: docs/plugin-standard.md; JSON schemas under schema/plugin-*.json.
All 26 native first-party plugins declare compositor.standard=1/apiVersion=1,
independent SemVer, README/changelog and plugin.test.json. The initial migration
increments their own minor versions; catalog metadata starts at 1.0.0, and the
portable Claude example remains separate. QA plans reference existing meaningful
behavior suites and optional real PTY/eval checks. plugin:test runs a common
lifecycle contract, declared suites and scripted evals, emitting per-plugin JUnit;
zero executed tests is a failure. plugin:test:all runs all 26 packages. CI validates
schemas and rejects runtime/catalog changes without the appropriate version bump.
Positive test fixtures explicitly choose their packages; production has no
hidden auto-enable test mode. Harness2 fixtures now explicitly opt into their
requested plugin directories while respecting explicit capability restrictions.

Plugin releases use plugin/<name>/v<SemVer>, independently of host releases.
plugin-release.yml verifies, tests, builds and smokes four native artifacts, then
publishes that plugin without moving application latest. Dispatch builds only.
Development may run ahead of published catalog versions; unlisted new packages
can be tested/released before catalog promotion. Release CI emits a four-platform
marketplace-entry.json with archive URLs/checksums. plugin:catalog applies that
reviewed entry and increments catalog metadata; committing/pushing it is explicit.
Current first-party entries are still bundled/development snapshots pending their
first independent publication. No release or remote workflow was triggered here.

The installer supports pinned Git/local sources and SHA-256 platform archives.
Archive download/extraction is bounded (128 MiB compressed, 512 MiB decompressed,
120 seconds), accepts regular-file/directory ustar and rejects links, special
entries, duplicates and escapes before activation. Locks record version/source/
ref/commit or archive digest plus package content, including owned dependencies
and excluding provided host SDK links. Updates reject mutable same-version data,
modified installed contents, downgrades and incompatible metadata. Rollback checks
backup contents and preserves activation. Failed candidate/state commits retain
old code. Removing a package or catalog preserves independent user settings.

Marketplaces/extensions now render compact native text views, with mouse actions
for browsing/installing and management forms selecting user/project scope. They
report effective overrides, missing bound sources and reload requirements. Scope
is included in mutation permission descriptors. check-updates is read-only.
The real PTY marketplace scenario is npm run visual:marketplace.

Validation: 744 TypeScript tests pass (3 optional skips), 85.85% line coverage;
all 26 plugin-specific commands pass; Python 46 tests and scripted Harness2 12/12
pass. Typecheck, marketplace/schema/version checks, evals 5/5 + 3/3, proxy smoke,
Linux x64 app build and installed-release smoke pass. Individual Linux x64
plugin-author, todos, callix and monty archives build and pass the same secure
archive installer smoke (including real native dependencies). Source/binary PTY
checks cover inactive startup, default market, scope forms, installation without
activation, restart/disable and composite authoring; workflows PTY also passes.
Four-platform release jobs are configured, not locally verified on other targets.
Evidence: dist/standards-proof/report.json, dist/standards-market-final/,
dist/standards-author-final/, dist/standards-workflows-visual/,
dist/standards-harness2/ and reports/plugins/. Screenshots inspected.

This follow-up remains uncommitted/unreleased on top of pushed 45e47b2.
Published v0.3.0 is unchanged and does not include these new defaults/standards.

## Composite plugin packages — 2026-11-10

The user requested implementing the package model discussed after plugin-author:
one plugin can combine agent services/hooks, UI, tools, skills and MCP, and the
marketplace manages it as one installable unit. plugin_dev init now accepts a
distinct components array, retaining kind for a single component, including mcp.
Combined starters preserve service and prompt hooks together; pure skill/MCP
packages need no dummy JS entry. The composition guide is bundled on demand.

Native and Claude-compatible declarations now share the loader's stdio MCP
reader. It supports .mcp.json, inline/wrapped maps, config references and arrays,
validates before native import, expands PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT literally,
supports explicit cwd, and retains legacy owner-local IDs. Unsupported transports,
render-only MCP and cross-owner server ID collisions fail visibly. Config paths
are contained in the package; declarations do not launch processes. The ordinary
mcp/mcp_call gateway and permission policy still apply. The sample worker needs
Node or an explicitly configured runtime. Exact allowlists/selections are not
edited automatically; provider/controller selections still need restart.

Manifest resources retain additional runtime code/data in release bundles;
referenced MCP configs and standard skills/assets are also copied. Packaging
rejects escapes (including nested symlinks) and generated-entry collisions.
Marketplace install validates declarations before side effects; rejected updates
preserve the installed package. Reload disposes old MCP connections. Disabling
or removing the owner removes hooks/tools/skills/MCP contributions; independent
user settings survive. Removing a catalog retains installed extensions. MCP
dispose now also removes its exit listener to avoid accumulating listeners.

Validation: 681 tests pass, 3 optional skips, 85.89% line coverage; typecheck,
marketplace validation (27 entries), evals 5/5 and tool evals 3/3 pass. The Linux
x64 bundle and installed-release smoke pass, including composite scaffolding,
SDK tool, selected instructions, command, skill and real stdio MCP with an
explicit runtime under an empty PATH. Real PTY source/binary scenarios exercise
creation, write approval, reload, panel/command/skill/MCP, restart and owner
disable/re-enable. Screenshots inspected. Evidence:
dist/composite-source-lifecycle/, dist/composite-binary-lifecycle/ and
dist/composite-proof/report.json. This work is included in the authoring/composite
feature commit; it is unreleased and published v0.3.0 remains unchanged.

## Self-hosted plugin authoring — 2026-11-10

After v0.3.0 publication the user requested a plugin with a skill that lets users
write their own Compositor plugins inside the app. Added the ordinary replaceable
plugin-author plugin, /plugin request command, create-plugin skill and plugin_dev
tool. The host change is general: loaded disk plugins contribute skills/ entries,
with existing project/user sources retaining priority. Descriptions are refreshed
per turn, bodies load on demand, and reload/disable/removal updates discovery.
Virtual app-injected plugins without a disk root contribute no filesystem skills.
Selected service.agent.instructions replacements own their own index policy.

plugin_dev guide serves bundled contracts/patterns/testing and current canonical
event schemas, including from an installed distribution outside the workspace.
init creates non-overwriting local command/tool/panel/skill/service starters and
links public host SDK packages inside the new plugin. Paths use the attached
workspace resolver; cancellation/failure cleans up the newly created directory.
check validates metadata, entry containment and skill headers without importing
code. It explicitly does not prove syntax, imports or behavior. Tool permissions
still apply; no config allowlist/provider selection is changed or auto-activation
performed. User /reload between turns activates code; startup composition config
changes require restart. SDK links refer to the installation used at creation.

Release packaging now includes plugin-owned skills/resources. The marketplace
has 27 entries. Docs: docs/plugin-authoring.md and the bundled skill's references.
The real PTY scenario is npm run visual:author; source and binary variants check
skill/tool calls, an actual write approval, /reload, SDK-backed command execution
and process restart. Synchronize on the Ready status before reloading; visible
assistant final text alone does not mean the turn has finished.

Validation: 14 new integration cases, 650 total tests passed (3 optional skips),
85.47% line coverage; typecheck, marketplace validation, existing evals 5/5 and
3/3, Linux x64 build and installed-release smoke pass. The smoke now also checks
bundled skill/event schemas, scaffold/check and execution of an authored tool
with a public SDK import under an empty PATH. Reports:
dist/plugin-author-source-visual-final/report.json,
dist/plugin-author-binary-visual-final/report.json and dist/plugin-author-proof/.
One bounded Gemma live example generated a greeting command from a Russian
request, structurally checked it and left activation pending. After reviewing
its source, a fresh app executed it and emitted the requested notification with
zero model calls. This is one authoring example, not a general quality score.
Evidence: dist/plugin-author-live/generation.json and runtime.json.

This follow-up is included in the authoring/composite feature commit and remains
unreleased; published v0.3.0 predates plugin-author.
The earlier release remains at 0ce49d2; CI 42756249621 and release workflow
42756474129 succeeded, with four native bundles and verified publication/assets.

## v0.3.0 release preparation — 2026-11-10

The user authorized committing/pushing the accumulated workspace/web/Harness2
changes, checking remote CI, and publishing a release only after success.
Feature commit: 213f9a9. The next version is v0.3.0, reflecting new kernel,
workspace and web capabilities since v0.2.0. Root/app versions and lockfile must
match; CHANGELOG.md is generated with the pinned git-cliff. Follow
docs/releases.md: green CI on the exact release commit, then an annotated tag;
GitHub's release workflow verifies, builds/smokes four native bundles, and only
publishes after every gate. Remote run/publication status is authoritative on
GitHub, not inferred from local checks or this preparation note.

Local release-candidate checks pass: 636 TypeScript tests (3 optional skips),
44 Python tests, 12/12 scripted Harness2 cases, 5/5 basic evals and 3/3 tool
evals, proxy smoke, marketplace validation, typecheck, Linux x64 build and
installed-release smoke. Source and compiled real-PTY workspace/web/resume
scenarios pass; screenshots inspected. Re-generated schema/events.json to sync
catalog 0.19 before push. Local artifacts: dist/release-030-* and logs in
/tmp/release-030-*. Browser checks use an existing compatible Chromium via the
bench's executable override; no dependency or browser-version pins were changed.

## Harness² case suite — 2026-11-10

The user requested adding and improving cases through Harness². Added a real
upstream BenchmarkAdapter in tools/evals/harness2_bench.py, using the existing
CompositorSubstrate and upstream core.judge.judge_one. Optional Python 3.12/3.13
dependencies pin upstream commit 6868817518876de8fd170c6a8354daca273b6191;
package commands are eval:harness2 and test:harness2 (activate that environment).

The suite has 12 cases (5 train, 7 test): evidence, quoted home references,
multiple attached projects, search plus source/artifact, denied mutation, exact
file versus sibling scope, symlink escape, redirect boundary, denied attachment,
verified code fix, delegated grant boundary and untrusted page instructions.
Both splits were inspected during development; this is not an unseen benchmark.
The default scripted HTTP provider drives the actual CLI and loopback web tools;
live model runs are separate. Scripts/expectations/captures stay outside native
filesystem scope. Grade actual effects, correlated tool observations, no private
fixture leakage, request logs and budgets. Code artifacts also run independent
hidden Node checks. Canonical home/absolute spellings and write/edit alternatives
are accepted where appropriate. Failed/missing/duplicate/error final results and
timeouts fail; upstream judge exceptions remain ungraded and fail the runner.

New regression traces reproduced a core defect: native path preflight rejected
an out-of-scope path by terminating the entire turn without a tool result. Core
now reports a correlated denied result with normal no-bypass feedback, allowing
the model to report the boundary. Two assembly tests cover sibling and symlink
failures. Shared result recording keeps the normal and preflight paths aligned.

Rollouts use fresh temporary HOME/cwd, scrub host keys/proxies/preloads, bound
process execution and kill the group on deadline. Execution occurs outside the
report directory to avoid inherited parent-project config; only after exit are
artifacts archived under output/captures. Original roots remain in metadata for
canonical grading. Idempotent runs reject changed tasks/harness/model/runtime/
runner/configuration; manifests and fingerprints support trace inspection.
Trusted code and approved shell remain ordinary processes, not an OS sandbox.

Validation: 44 Python tests including protocol materialisation, false-positive
judging, deadline/launch failures, real two-process scope resume and hostile
report-parent configuration; 24/24 scripted episodes (two repetitions); 636
TypeScript tests passed, 3 optional checks skipped, 85.35% lines. Typecheck,
existing deterministic evals 5/5, Linux x64 build and release smoke pass. Final
suite evidence: dist/harness2-verified/report.json and
dist/harness2-tests/junit.xml. Live development runs before archive-layout
hardening passed Gemma 12/12 and DeepSeek 10/12; loopback web sources, one run per
case, not public search/model rankings. DeepSeek used a denied shell probe instead
of the symlink read and exceeded the delegated-case call bound; private fixtures
were not leaked. Reports: dist/harness2-current-{gemma,deepseek}/report.json.
No commit/push was requested for this follow-up.

## Harness test hardening — 2026-11-10

The user requested more tests. Added 44 cases: bounded HTTP streams and real
in-flight cancellation, redirect/error cleanup, search provider/key routing,
unsafe/malformed result links, CAPTCHA false positives, path alias revocation,
symlink retargeting, invalid saved scope, reference quoting/budgets/images,
queued input provenance, disabled references and delegated workspace commands.
New files: packages/app/test/web-network.test.ts, project-context.test.ts and
packages/tools/test/workspace.test.ts; assembly cases extend web-workspaces.test.ts.

The regression tests first reproduced four defects, now fixed:
- Inherited task hooks closed over the parent core and could run /workspace add
  against it. Grants require a matching requesting session as well as user origin.
- Relative saved paths could grant the process cwd on resume. Restore accepts
  canonical absolute-path records only; missing/malformed entries are skipped.
- Cancellation during attachment authorization returned stale content. Preparation
  rechecks cancellation across asynchronous boundaries and passes signals to reads.
- CAPTCHA in ordinary result text was mistaken for a human challenge. Detection
  now recognizes challenge container markup rather than matching arbitrary text.

Validation: 634 passed, 3 optional native checks skipped in 77 files; overall line
coverage 85.36%, all gates passed. Workspace lines 100%/branches 90%; reference
preparation lines 98.63%; web tool lines 97.22%. Typecheck, Linux x64 build and
installed-binary smoke passed. The compiled real PTY search/attachment/resume
scenario passes; screenshots inspected. Current evidence:
dist/harness-test-hardening-report/report.json and
dist/harness-test-hardening-binary/report.json. No commit/push or release
publication was performed for this follow-up.

## Harness internet and multiple projects — 2026-11-10

The user requested internet/search capability and simultaneous work across
projects using arbitrary file/directory references such as @~/proj. Implemented:

- Optional web plugin 1.1 defaults to keyless DuckDuckGo HTML search, preserves
  Brave-key/SearXNG selection and explicit provider errors, reports human
  challenges honestly, and returns bounded titles/URLs/snippets. web_fetch adds
  title and safe outgoing links; /web reports setup. The harness advertises actual
  web capability and source-citation guidance only when its tools are present.
- Shared WorkspaceAccess resolves ~/relative/absolute/parent paths, canonical
  symlinks, exact file grants and directory grants. @ references accept spaces
  and JSON escapes; @. lists the root. Suggestions browse a prefix without
  granting access. Tab completes; Enter submits a typed reference unless the
  user navigated to a suggestion. Scoped tool paths/cwd work across projects.
- /workspace list/add/remove, repeatable --add-dir, and workspacePaths config.
  Startup and dynamic grants are journaled as workspace.changed and restored
  on resume. Removing a directory removes nested grants; conversation content
  already read is not erased. Read denials apply to attachments, and mutation/
  shell/network policy remains binding. Tool response source directories are
  explicit; a file-only grant does not imply a whole-project navigation grant.
- Task agents inherit scope. submit carries a protected host origin through its
  queue; model-authored references and /workspace commands cannot add scope.
  Independent agents accept cwd at creation and can run concurrently in distinct
  attached projects. Relative parent grants are passed canonically instead of
  being reinterpreted under the child cwd; agent records retain projectCwd for
  restore and correct-repository worktree merges.
- Local filesystem enforcement applies to standard file tools/resolvers. A
  selected replacement resource tool retains its own path semantics and is not
  forced through the local filesystem resolver. Trusted JS is still in-process.

Catalog 0.19 adds workspace.changed and the reviewed optional cwd input on
service.agent.control. The frozen 0.17 baseline is unchanged; compatibility checks
explicitly validate/remove only this optional field before comparing old shapes.
Contracts/examples: docs/workspaces-and-web.md. This is server-text HTTP fetching,
not interactive browser automation; public HTML search can require a human check.

Validation: 590 tests passed, 3 optional native checks skipped in 74 files; line
coverage 85.25%, all gates passed. Typecheck/gen, 26-entry plugin catalog, scripted
5/5 and tools 3/3 evals, and proxy smoke passed. Actual public search returned
TypeScript documentation, and fetching its official page succeeded. Installed
Linux x64 smoke covers --add-dir, home paths and resumed scope without Node/Bun
on PATH. Source and compiled PTY scenarios cover completion, quotes, cross-project
read, loopback search/fetch and restart/resume at 60 columns; standard PTY also
passes. Final evidence: dist/harness-web-workspaces-report/report.json; live
probe: dist/harness-web-workspaces-report/live-web.json. Failed diagnostic
captures under earlier dist/visual-web-workspaces and dist/web-workspaces-binary
led to a history selection synchronization fix and HTTP-fixture tool-call name
lookup; they are not current passing evidence. No release was published.

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
