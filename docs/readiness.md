# Readiness for a stable 1.0

The target is a complete, extensible coding agent that can be used to develop
Compositor itself and other projects. A release number, a large tool catalog or
a passing unit suite does not establish that outcome. This page tracks the
required evidence; it is not a declaration that 1.0 is ready.

## Plugin development and interface usability

The 1.0 objective explicitly includes developing missing plugins needed for
everyday project work and improving the terminal interface until complete
user workflows are convenient. This is implementation scope, not only an
evaluation of existing features.

- Identify missing capabilities from real development tasks. Extend an existing
  plugin or create a focused plugin through the public extension API; avoid
  adding host-specific integrations when an extension can own the behavior.
- Exercise the complete plugin lifecycle: discover, install, enable, configure,
  use, update, disable and remove. Verify failures, recovery, reload and saved
  settings as well as the successful path.
- Make plugin search, tools and settings usable while an agent is running.
  Preserve drafts and task progress while navigating, answering a question or
  approval, cancelling work and returning to the conversation.
- Review keyboard and mouse operation, focus, visible progress and errors,
  narrow terminals and restart persistence. Define concrete scenario criteria
  before changing the interface; validate them in the real PTY bench using
  the project's tui-visual-check skill.
- Use Compositor itself for plugin and UI development where practical, then
  independently review the patch, execute behavior checks and inspect actual
  terminal screenshots. A model's success report or passing headless tests
  cannot establish interface usability.

Prioritize gaps that block daily work, then repeated friction observed during
use. This scope does not raise the authorized live-model spending limit.

### Accepted usability work — 2026-11-13

The user's daily-use feedback adds these implementation requirements:

- Approval review must handle concrete CI/shell/plugin actions with the user's
  actual task context and a validated structured decision. Enabling auto should
  not silently require a second model profile. Explicit denies stay binding;
  malformed or unavailable review is distinguishable from an actual decision.
  Ordinary clarification questions must remain separate from permission review.
- Commands need an immediate, non-model execution path independent of whether
  they render a view. `/auto` should not require an otherwise unhelpful panel.
  Long operations need progress, cancellation and an optional deeper view.
- First launch should explain profiles and available plugins, recommend a useful
  starting selection and help apply the user's choices. Investigate an optional
  small CPU model embedded without an Ollama/server requirement. No implementation
  or quality claim for that embedded model is established yet; first-run setup
  must remain usable when no model is available.
- Workflows and agents need reusable interactive tables, expandable details,
  tabs and drill-down into an individual agent's actions. Replace static row/column
  dumps where those interactions improve navigation; preserve keyboard/mouse
  operation and narrow-terminal behavior.
- Provide a convenient side conversation such as `/btw` with an independent
  agent while the main task continues. A closed main conversation must be easy
  to restore without losing its process, history or draft. Existing Alt+Enter
  conversation creation needs explicit discoverability and behavioral proof.
- Support useful views that need no agent, including live resource charts. An
  explicit action may share a selected observation with an agent. Task-service
  integrations such as Jira are examples to evaluate, not authorization to
  connect an account or create external tasks automatically.

These are acceptance requirements, not a claim that the current release supplies
them. Prioritize approval behavior and conversation recovery, then the common
command/view contracts and onboarding. Deterministic checks do not substitute
for independent review of the complete real terminal flows.

Version 0.8.0 ships catalog 0.25 immediate commands independently of views,
headless `/auto on|off|status`, an explicitly requested `/auto history` view and
idempotent `/chat` restoration. Real PTY checks cover a held model, unchanged
draft, repeated restoration, workspace return, narrow history and restart.
Core checks cover owner dispatch, failure isolation, tool permissions, auxiliary
usage, cancellation, unload and shutdown bounds.

The bundled `resources` plugin provides a standalone non-model window with live
process CPU/RSS charts, pause/manual sampling and bounded in-memory history.
It includes in-process agents; child shells, model servers, per-agent attribution
and broader resource integrations remain open. Agent and workflow views use
catalog 0.27 semantic tables and catalog 0.28 tabs: expandable details, state
filters, paginated stages/results, keyboard/mouse navigation and narrow stacked
fields. Workflow pause/resume and legacy journals remain available. Closing the
workflow view leaves stages running, rejects stale renders and allows explicit reopening.

Per-agent conversation tabs preserve separate drafts and histories, provide
button/Enter submission and navigation through all sixteen allowed agents, and
restore the selected pane with committed messages after restart. Unsent drafts
survive navigation but do not survive restart. Saved activity exposes persisted
prompts, turn lifecycle/usage and tool arguments/results/errors through filtered,
paginated expandable records read through the configured session repository.
Linux PTY checks cover an actual read tool call, a held main stream and restored
saved output. Full native UI coverage on other platforms and actual terminal
graphics remain separate gates from native installer/protocol checks.

`/btw` opens an independent persisted agent with its own Reply field, immediate
reopening, separate draft, focused-agent cancellation and restart history.
`/btw --once` preserves notification-only behavior. Both modes ship in 0.8.0;
the bundled btw package is version 2.0.0. Source integrations and compiled Linux
PTY scenarios cover these flows while a main model is held.

Auto-review validates structured `approved: true|false|null` decisions.
Task-context low/medium approvals can proceed; refusals stop the call without
another manual question; uncertainty and review failures remain manual. Explicit
host denies remain binding. Missing targets/effects require uncertainty rather
than a fabricated violation. Full Linux source release-stage certification on
exact release source `4b5b297` passes the declared gemma4:31b-cloud matrices for
auto-approve 1.4.1, workflows 1.6.1, btw 2.0.0 and plugin-author 1.4.0:
24/21/24/21 cases, unchanged oracles and three repetitions. This is one-reference
evidence. Ordinary clarification questions remain human decisions; arbitrary
model classification quality is not established.

The plain/headless interface preserves independent controls in pasted input,
queues Enter follow-ups, reserves Tab for steering, drains accepted commands on
EOF and consumes human dialog answers separately from model prompts. Command
notifications and auxiliary usage appear in headless results; command errors
fail that invocation. Installed-runtime checks cover actual raw PTY approval,
interruption and CLI exit on all four declared platforms.

The optional first-launch `/setup` guide requires no configured model. It offers
a short private provider editor, suggests explicit optional plugin choices,
preserves installed pins, applies reload through the normal UI path and returns
to the first task without losing a draft. Eleven compiled Linux PTY checks cover
the automatic offer, persisted skip/completion, masked/private credentials,
selected-plugin installation/activation, narrow layout and one first task through
a saved loopback connection. Embedded CPU inference-assisted onboarding and its
model quality remain open.

### 0.8.0 publication — 2026-11-13

[v0.8.0](https://github.com/Neko1313/agent-compositor/releases/tag/v0.8.0) is
published from `4b5b2972b23b0a8c20c813f076b14ba601d77849`.
[Candidate verification](https://github.com/Neko1313/agent-compositor/actions/runs/43345109570)
and [tagged publication](https://github.com/Neko1313/agent-compositor/actions/runs/43346528810)
passed source checks and native build/install jobs on Linux x64/ARM64 and macOS
x64/ARM64. All 32 tagged installed-runtime reports were independently audited.
Matching Node 22/26 CI passed; coverage passes 1315 tests with three optional skips.
All 4487 Linux candidate shipping files match the locally exercised archive,
including executable bits and symlink targets. Real setup, conversation-tab and
workflow PTY scenarios pass with inspected narrow/restored/completed screenshots.
All six public assets were downloaded; the four archives and installer match
published checksums and all available GitHub asset digests match the downloaded
bytes. The public Linux distribution has the same 4487 shipping files as the
verified candidate. An isolated public 0.7.4→public 0.8.0 installer upgrade
preserves settings, plugin state, draft, old executable and the old session's
journal prefix; the new host resumes its original task/answer. Versioned and
latest installs both pass. The upgrade uses two bounded loopback completions,
not a live provider. Public integrity evidence is retained under
`dist/release-0.8.0-public`.
This intermediate release does not close the stable 1.0 gates.

### Two-family coding diagnostic — 2026-11-13

The unchanged two-task coding suite ran twice each on gemma4:31b-cloud and
DeepSeek-v4.1-flash:1017-cloud through the existing Ollama service, using the 0.8.0
runtime code. Both score 3/4, for 6/8 overall. One Gemma run repairs the artifact
but repeats a denied scratch-test command instead of running the existing allowed
project checks. One DeepSeek run passes all artifact/original-check oracles but
cannot admit its next request within the declared 80000-token turn allowance
before terminal completion.
Neither failure is reclassified as success. Trace/report/task/runner/grader hashes
are retained under `dist/evals-v080-cross-model`.

These are known small tasks, not held-out general development benchmarks or a
broad model-independence claim. The original criteria and limits were unchanged.
No OpenAI profile/request or spending-guard change was used; Ollama monetary
billing is unavailable. Denial recovery, efficient completion and broader real
project/self-development coverage remain open.

Follow-up recovery experiments did not establish a fix. A supplemental general
instruction scored 7/8. A longer model-facing denial footer scored 8/8 in the
ordinary suite, but its successful Gemma greeting runs never encountered a
denial. A separately declared controlled probe inserted one real denied command
after a successful live edit and before verification, then used live models for
the remaining work. Across two repeats per family, the prior footer scored 2/4
and the candidate 1/4 under the stricter recovery criteria (one controlled denial,
no further denials/questions and successful original project oracles). These
small exploratory results do not establish a general performance difference;
they did not justify promotion. The candidate footer was withdrawn. Original
tasks, graders, permissions and budgets were not weakened. Evidence and the
withdrawn source hash are retained in `dist/verification-recovery/decision.json`.
The next investigation is existing check discovery and task context rather than
another unverified instruction-only change.

### Finite-query repetition recovery — 2026-11-13

The default loop now warns after three repeated query-only steps and stops after
six, using optional `ToolSpec.loopGuard: "query"` metadata. Built-in read and
Callix glob/grep opt in; polling remains unchanged. New observations, other
operations, steering and context replacement permit fresh investigation. The
recent window is bounded; see [exact rules](core-customization.md#repeated-query-recovery).

The 0.8.0 tagged native matrix passes the query probe on all four platforms,
including real read/grep journal evidence for bounded refusal and recovery after
a new observation. The earlier archive failed the new probe. Final coverage
passes 1315 tests with three optional skips.

Two prototype CPU greeting attempts still score 0/2 with 17 admitted requests.
Neither reaches the reminder threshold, so this is not a measured recovery or
efficiency gain. The final context-replacement reset is covered by regressions
and the rebuilt archive, not by that earlier compaction-disabled model run.
Novel-but-unproductive queries and proposal-only responses remain separate gaps.

### No-change edit evidence — 2026-11-13

The default file-edit resolver rejects a replacement whose actual resulting text
is unchanged, before writing or adding undo state. Useful whitespace normalization
still works when identical arguments change the actual file. Five regression
cases cover exact/normalized single/all replacements and an empty guarded
insertion. The six-response discovery/read/no-change-edit probe passes on all
four platforms in the 0.8.0 tagged matrix; the earlier archive fails its no-change
check. These establish tool behavior, not autonomous model correctness.

Two subsequent known greeting diagnostics still score 0/2 with 21 admitted local
requests. One guarded edit introduces invalid syntax and fails completion checks;
the other returns a proposal without implementing it and fails independent
grading. Neither invokes a no-change edit, so the model runs do not directly
validate its new rejection or establish improved model quality. The native and
unit regressions provide the rejection evidence.

### Ordinary directory-reference coding diagnostic — 2026-11-13

The CPU evaluator can now exercise the existing `@.` directory-reference flow
using `--project-reference`. Under this explicitly different context condition,
Qwen scored 1/2 on the known checkout task and 0/2 on the known greeting task.
The successful attempt performed a guarded edit, ran the real project checks
and passed independent behavior checks while preserving protected files. Across
the four attempts, 42 local completions were admitted; no paid request occurred.

Those historical failures exposed repeated successful read/search loops and an
identical-text edit reported as successful, followed by failing verification.
Completion remained failed. The later query/no-change protections have separate
regressions; these original runs do not prove that directory context alone
supplies reliable coding. Prompts, source hashes, budgets, failures
and cleanup are retained; this is not an unseen benchmark or an unchanged-prompt
comparison. See [local evaluation controls](evals.md).

### Current verification evidence after reruns — 2026-11-13

Build-only [run 43320159884](https://github.com/Neko1313/agent-compositor/actions/runs/43320159884)
at `7139daa` passed verification and all four native build/install jobs. All 28
downloaded runtime reports pass, including four coding-completion scenarios on
each platform with actual process exit codes and run counts. Publication was
skipped. This establishes the runtime checkpoint, not a public release or broad
real-model readiness.

The coding completion policy no longer accepts an earlier successful check when
a subsequent attempt fails. Every recognized check attempted after the latest
built-in edit requires current passing evidence; another passing command does
not hide a failure. Actual process tests and the installed Linux archive prove
refusal after pass/fail and recovery after a third successful check. The native
release probe now requires all four unchecked/checked/regressed/recovered cases.
The same four scenarios pass on all platforms in the published 0.8.0 matrix.
These policy checks do not establish live model quality or stable 1.0 readiness.

### Navigation composition and discovery recovery diagnostic — 2026-11-13

The local CPU evaluator can explicitly compose read/write/edit/exec with Callix
glob/grep and records the tools actually transmitted to the model. The known
multi-file coding diagnostic still scores 0/2 both before and after clearer
discovery/read guidance; admitted calls increase from 14 to 24. This does not
establish a model-quality improvement or readiness for autonomous development.
The case, independent grader and request/context/output limits are unchanged.

Read now exposes its integer, 1-based pagination limits and rejects invalid
values with specific recovery guidance. Empty file/text searches and invalid
directories explain how to discover actual paths without inventing them. The
six-response discovery/read/no-change-edit probe passes on every native platform
in the 0.8.0 release. These checks establish bounded tool behavior, not general
model competence. See [evaluation guidance](evals.md) and
[release verification](releases.md).

### Workflow close boundary regression — 2026-11-13

The prepared 0.8.0 source candidate exposed an asynchronous workflow render
arriving after its view was closed. Render revisions now reject stale work and
close waits for already-submitted publications. A deterministic regression and
the required real PTY scenario verify background workers completing while the
view stays closed, followed by explicit reopening. Source and compiled Linux
scenarios pass. These are controlled checks; the published 0.8.0 matrix now
supplies all four native build/install gates and final coverage of 1315 tests.
They do not establish broad model quality or 1.0.

Follow-up Node 22 CI found premature acknowledgement when a background refresh
superseded a navigation render. The queue now covers loading and publication and
navigation waits for the replacement frame. A deterministic regression fails on
the prior implementation. The fixed queue is included in 0.8.0 and passes the
real PTY workflow scenario and final native matrix.

The refreshed local Linux archive also passes the real workflow PTY scenario and
all eight installed-runtime probes. Its closed, completed and narrow screenshots
were inspected. Source workflow certification passes all bindings and 21/21 live
reference tasks on gemma4:31b-cloud. Generated workflows 1.6.1 ships in 0.8.0;
public shipping files match the exercised Linux archive.

### Planned OpenTUI migration — 2026-11-13

The user explicitly requested adding migration to OpenTUI to the plan. OpenTUI
is the intended future terminal frontend. The opt-in
[application frontend](02-ui.md#experimental-opentui-application-frontend) now
runs the configured app with `compositor --renderer opentui`. The deterministic
[conversation and workflow preview](02-ui.md#opentui-conversation-prototype)
remains a separate development fixture. Ink remains the default.
The acceptance checks below govern the switch to a shipping frontend. Preserve the agent core, provider adapters, permissions, tools,
session state and extension ownership contracts throughout the migration.

1. Build a separate `renderer-opentui` prototype using the existing Bun/React
   stack. Exercise the message editor, the original Ghost beside the composer,
   agent tabs and one expandable workflow table. Verify actual interaction and
   media behavior before extending the implementation to all screens.
2. Evolve the UI description where needed so OpenTUI receives reusable interactive
   components rather than only preformatted rows/cells. Keep existing plugin
   views usable through an adapter; plugins must not require a wholesale rewrite
   or execute arbitrary frontend code merely to show a view.
3. Move the production conversation, input, approvals/questions, onboarding,
   settings, plugin management, workflows and agent drill-down onto the new
   frontend. Use native input/selection/scrolling components and explicit
   expandable details. Preserve the compositor's window-manager model, including
   the existing tiling tree, independent focus, workspaces, drag/drop, resizing,
   close/reopen and saved placement. Keep non-model commands independent of rendering.
4. Verify the original character assets, transparency, frame timing, state
   transitions, resize/clipping and terminal protocols. Test actual APNG/GIF
   animation support rather than inferring it from static image decoding. Retain
   the user's choice against substituting block artwork. Video is an additional
   supported media path to evaluate, not a reason to convert transparent assets
   to an unsuitable format or invent animation frames.
5. Pass real PTY keyboard/mouse/paste/Unicode/focus tests, draft and session
   restoration, concurrent tools/agents, and compiled archive/install checks on
   all declared platforms. Verify native library/resource packaging. Switch the
   default renderer only after the replacement passes those gates; retire the
   Ink frontend after the migration is complete.

The first prototype passed seven Linux browser-backed PTY checks at 100×30
and 48×18. A held streaming Main session remained active during a Side reply,
workflow row expansion and draft recovery. Checks covered mouse selection,
keyboard navigation, a multiline Unicode paste and process exit. A separate
PTY check matched every emitted RGBA frame in the idle and thinking loops to
the original Ghost images. The browser and byte-level checks emulate Kitty
protocol support. Native terminal coverage, additional protocols, the full
plugin view contract and packaged releases remain outstanding.

A follow-up Linux PTY run exercised concurrent permission requests from two
agents. It verified per-chat badges, full argument inspection in a narrow
terminal, switching to Workflows and returning with drafts intact, a one-time
allow and a denial. Independent file checks verified that only the selected
write took effect. A repeat requested permission again, and closing the
preview while it waited preserved the preexisting file.

The source preview now uses the existing host-owned binary window manager.
Native panes receive rectangles and retain their editor instances through nested
splits, directional focus, workspace moves, drag/drop, resize, zoom and closure.
The host persists the tree, ratios, selected workspace, focus and closed panes.
Actual project installation, explicit enable/disable and deferred update/removal
keep saved and loaded-version status separate. User placement-rule controls,
provider/settings flows and selected controller adaptation still need migration.
Production protocol binding, saved conversation recovery and release packaging
remain outstanding.

Its main Linux PTY scenario passes 18 checks, including visible Main/Plugins panes,
layout controls, independent approval routing, deferred updates, command-written
version receipts before and after update, disable/removal and clean shutdown.
The updated command exposed and then verified a fix for Bun retaining old
package modules despite a changed manifest. These checks use a deterministic
local provider and local upstream fixture, not a real-model development task.

The window-manager scenario also verifies close/reopen draft, cursor and undo
state, actual title and separator gestures, workspace moves, compact projection
and layout restoration after actual PTY restarts. An empty selected workspace
must remain empty. These checks distinguish in-process editor retention from
conversation recovery after process exit, which is not implemented in the preview.

A single-packet F5/Alt+Y input initially confirmed Main after host focus had
already moved to Plugins. Native focus changes now commit synchronously, and
action admission checks the current host snapshot. Real PTY bursts verify that
hidden approvals stay pending, typed text reaches the newly selected chat without
loss, and a following denial targets only that chat's request.

Native single/multiple-choice questions, custom answers, questionnaires and
private text/password/URL/select/toggle forms now use per-core host callbacks.
Each preview conversation arbitrates approvals, questions and forms in one FIFO.
The input editor preserves an independent chat draft; a model can work while a
private form is open. Foreground interruption cancels its question while a form
owned by a separate user operation stays live. The source preview rejects
selected custom question/form controllers without silently substituting a native
view. Independent settings-pane placement and precise delegated-child request
attribution remain production integration gates.

The inputs PTY scenario checks actual model-received answers and a trusted
plugin's private result, rather than only UI labels. It caught and verified fixes
for questionnaire text loss between pages and rapid Escape/mouse-release packets
leaving a native pointer capture active. A synthetic password stays out of the
terminal output, provider requests and session journals. The bench's raw keyboard
log intentionally records synthetic test input; it is not a real credential test.

Initial technical references are the official [OpenTUI components](https://opentui.com/docs/components/),
[image](https://opentui.com/docs/components/image/),
[video](https://opentui.com/docs/components/video/) and
[runtime/platform requirements](https://opentui.com/docs/getting-started/runtime-support/).
The prior chat estimates were preliminary effort ranges, not a release deadline.
This migration extends the 1.0 usability scope and does not change the authorized
live-model spending limit or interrupt the current approval-work fixes.

### Opt-in OpenTUI application integration — 2026-11-14

`--renderer opentui` now connects the actual BuiltApp, provider router, private
credential store, session repository and loaded plugin handlers to native
conversation and semantic plugin windows. Explicit settings forms have their
own operation and window, so Main's pending question does not block editing a
connection. Loaded plugin views retain host-validated actions, revisions and
ownership. The host adapts plain legacy text without executing plugin frontend
code. The canonical placement editor, saved rules and full window tree are
shared with the application. This closes the earlier preview-only integration
gap; Ink remains the default.

The Linux source and relocated native application checks exercise real profile
add/edit/cancel/discovery/selection, private credential and proxy storage, a
pending Main question plus independent draft, foreground interruption without
cancelling a separate form, and actual session/profile/layout restoration after
restart. Requests use a bounded loopback HTTP provider through the ordinary
router. No live-model endpoint or paid test budget is involved. The native
archive carries the renderer bundle, native library, parser WASM and workers;
release CI now requires the actual relocated application flow on all four
declared platforms. Adding that gate does not establish that its first remote
matrix has passed.

Remaining frontend gates include the discoverable Arrange/window finder,
selected replacement controllers, full appearance/render overrides, legacy
conversation copies, complete wire-protocol parity and independent request
windows for UI-tool approvals/questions that currently share Main's inbox.
Immediate command cancellation must also propagate to its exact internal tool
operation instead of only cancelling the surrounding UI handler.
Native terminal/protocol coverage, embedded CPU onboarding and broader real-model
self-development quality remain open. These application checks do not establish
stable 1.0 readiness.

### Historical self-hosting repair diagnostic — 2026-11-13

Follow-up command-presentation diagnostic: builtin `exec` and `exec_output` now
send readable stream sections to the model while retaining raw structured results
and host-derived exit-status receipts. One captured failed-test result shrinks
from 12637 to 7090 bytes; this is a formatting measurement, not a quality or billing
result. A fresh expanded-tool Gemma run on the same historical task made 30
requests and changed only `plugins/todos/hooks.ts`, then stopped at the provider's
4096-token output limit. Independent acceptance still fails six of seven checks;
typecheck passes. All 807 baseline files, 21 local workspace aliases, frozen
acceptance files and fixture Git HEAD were audited. This is another failed repair,
not evidence of self-development readiness. Retained artifacts are under
`dist/self-host-readable/`.

The default strategy now permits one bounded recovery from a provider `length`
finish, discarding all calls in that response and recording a replay-safe context
boundary. The retry consumes an ordinary step under unchanged output/token limits.
Ten regressions cover effect admission, replay/resume, permissions, budgets,
interruption and storage failure. In a fresh historical Gemma diagnostic, recovery
occurred once and execution continued, but the task still failed at 60 steps:
78 requests, six compactions, four production files changed, six of seven
acceptance checks still failing, and an introduced type error. All 807 baseline
files, frozen inputs, 21 workspace aliases and fixture HEAD were audited. Artifacts
are under `dist/self-host-output-recovery/`. This proves recovery was exercised,
not task-quality improvement. Next investigate the observed edit-argument,
ambiguous-match and stale-snapshot failures and verify complete repairs. Stable
1.0, broader model coverage, onboarding and OpenTUI remain incomplete.

Guarded-edit feedback follow-up: malformed ranges/missing guarded hashes now fail
before approval, and match errors distinguish counts/bounds with explicit UTF-16
units. Replaying three saved failures on original source confirms that their
`oldText` matches once when the original read range is retained; operator replay
is not a model repair. In a fresh Gemma condition the original seven checks reach
6P/1F with types passing, but the 60-step turn still fails (73 requests). A separate
bounded continuation also fails at 60 steps (72 more requests), retaining 6P/1F.
The remaining original failure is project-specific Todos persistence. These are
partial results, not successful self-development or a causal quality comparison.
Both episodes audit all 807 tracked files against allowed changes and preserve
original acceptance files, configuration, Git HEAD and 21 local dependency aliases; see
`dist/self-host-edit-feedback/`.

The model's patch also hardcodes some invalid-field indices. A separate ten-case
audit of the original exact-field requirement passes only three cases on that
patch and all ten on the independent reference. These are separately maintained
regressions in `packages/app/test/task-plan-validation.test.ts`; they do not alter
the frozen seven-test diagnostic score. Complete repair must satisfy the actual
input-validation requirement, not only those seven examples. Repeated invented
edit ranges and incomplete/generalized repairs remain next investigation targets.

Portable snapshot-reference follow-up: builtin `read` and supported Callix
`read_symbol` results now provide `editRef`, copying the exact existing guards as
one string. Explicit anchors remain supported, references grant no permissions,
and malformed/conflicting/stale or wrong-path references are rejected. Session
replay, workspace isolation, policy and native Callix tests pass. The full suite
has 1475 passing tests plus three optional skips; an explicitly enabled real
Callix navigation run passes all 21 cases.

A fresh historical Gemma condition copies issued references in all three edit
calls (two applied, one stale rejection, no invented numeric ranges). Nevertheless
it fails after 35 requests/27 steps on a second length finish: 6F/1P on the original
acceptance, failing types, 0P/10F on the separate exact-field audit. The manual
reference passes 7/7 and 10/10 respectively. Audits cover 807 tracked files, frozen
inputs/configuration, unchanged Git HEAD and 21 local workspace aliases; artifacts
are under `dist/self-host-edit-ref/`. This is mechanism evidence, not improved
repair quality or stable self-development.

These matched diagnostics explicitly cap output at 4096 tokens. The standard
`TokenBudget` reserve at the same 32768-token window is 8192 before provider
ceilings or explicit overrides. Next evaluate that separately labeled default
reserve condition without raising the cumulative task allowance or rewriting the
failed diagnostic's result. Stable 1.0 and the broader remaining scope stay open.

The separately labeled standard-reserve run sends 60 main requests with an 8192
limit and 21 summary requests with a 2048 limit under the same 1.2M cumulative
allowance. It reaches 60 steps, with nine compactions and one length recovery:
5P/2F on the original suite, 10P/0F on the separate exact-field audit, but failing
types. Four source files change; all 807 baseline files, frozen inputs/config,
HEAD and 21 workspace aliases are audited. Artifacts remain under
`dist/self-host-default-output/`. The task is still incomplete; this is not a
causal comparison with earlier random model runs. Seven of 20 edit attempts fail
because the model omits path while supplying a reference that already encodes it;
effective-path derivation before permission review is the next concrete tool issue.

An independent deterministic regression also exposed a completion-policy hole:
an edit erased earlier executed-check obligations, so unrelated passing lint
could hide an earlier failed test. The policy now retains non-refused attempts
within the turn and requires each same check to pass after the latest edit.
Pre-edit refusal-only checks retain their prior exception, while mixed executed/
refused obligations still receive Do-not-rerun guidance. Four regressions and the
full 1479-test suite pass. This closes that false-completion path; it does not make
arbitrary recognized commands a correctness proof or mark the model repair done.

Reference-only target follow-up: `edit` now derives omitted path from `editRef`
before native pre-tool hooks, rechecks rewritten inputs and supplies canonical
paths to native file-policy hooks. Provider arguments/metadata survive replay;
the journal separately records the effective target and host projection marker.
Real checkpoint/rewind and scope-guard tests pass. Additional regressions reproduce
symlink guard evasion and native operations following a changed symlink after
approval. Native execution now stays bound to the approved canonical path and
rejects a changed resolution before its file service. Full suite: 1494 pass, three
optional skips; the explicit native/navigation/core run passes all 36 cases.

Two new historical model conditions still fail without editing: Gemma makes 24
requests then hits bounded empty-completion failure; DeepSeek, using default
reasoning and request timeout in a separately labeled condition, makes 11 requests
then fails text summarization. Both retain 6F/1P, pass types and fail all ten
separate exact-field cases; references pass 7/7 and 10/10. Audits cover all 807
tracked files, frozen/config inputs, HEAD and 21 local aliases. Artifacts are under
`dist/self-host-ref-target/` and `dist/self-host-ref-target-deepseek/`. They predate
the final approval-path binding correction and do not exercise model edit usage.

Content-free DeepSeek stream statistics show summary retries ending in length or
tool_calls, including the final rejected tool-call finish. No summary tool was
executed. The default summarizer now requests explicit disabled-tool mode through
all four bundled protocols and rejects tool events even with a misleading `stop`
or `length` finish. Local protocol and compaction-retention tests pass; the full
suite passes 1514 tests with three optional skips. A proposed live replay of the
saved transcript was rejected by automatic approval review because that context
could be relayed through Ollama to a cloud model with unverified handling and
billing. No replay request ran. Obtain explicit approval for that payload/egress
before replaying it, then investigate provider compliance and bounded
reasoning/output handling. These observations do not establish a completed
repair or broad model quality.

Compositor was asked to repair the actual Todo scope/status defects in an isolated
f1557fb source snapshot, with the two immutable acceptance files from the later
manual repair. Workspace dependency aliases point into that snapshot, preventing
the current fixed packages from accidentally satisfying its tests. The negative
control fails six of seven checks; a separate manually repaired reference passes
all seven. This is a known historical task, not an unseen benchmark.

Four live DeepSeek-v4.1-flash runs through loopback Ollama failed without editing
source. The first two exhausted a 240000 cumulative-token allowance; default
200-line read pages did not establish a task-quality gain. A separate 1200000-token
condition failed when a summary merge did not shrink. After adding one bounded
merge correction round, the same larger-limit condition completed five
compactions but reached its 60-step limit with 51 reads across 17 paths and no
edit. The independent acceptance checks still fail six of seven. These are
failures, not self-development success; model variation and the changed allowance
do not establish a causal quality improvement.

The default reader now returns 200 lines with a continuation offset, retaining
explicit larger ranges and exact edit anchors. Summary correction preserves the
original transcript on repeated failure. Both mechanisms have deterministic
regressions. Next investigate repeated research after compaction and validate
actual source edits and verification on the unchanged task. Evidence is in
`dist/self-host-task-state/`, including all four trajectories and a comparison.
No OpenAI request or spending-guard change occurred; Ollama monetary billing is
unavailable. Stable 1.0 and sustained self-hosted development remain open.

A follow-up adds bounded host tool observations that survive independently of
the natural-language summary and stay hidden from the chat UI. Deterministic
checks cover false summaries, repeated compaction, replay/resume, output bounds,
failed calls and history restoration. A live DeepSeek run retained one record
through each of six compactions, but still reached 60 steps without edits.
Gemma made four-file changes in a separate 60-step run, with five acceptance
failures and failing types. A separately bounded continuation through saved-session
resume also failed those checks, including repeated rejected no-op edits.
Neither episode is a completed repair or a quality gain attributed to the new
record. Tests/configuration and dependency isolation remained intact, and no
model-authored patch was applied to the main checkout. Evidence is retained in
`dist/self-host-task-state/evidence-receipts-comparison.json`; both model families
and the failed initial/continuation results remain visible. Next investigate
repeated failed edits and preservation of useful implementation progress.

One later Gemma continuation uses early argument admission: four identical exact
edits are rejected before `tool.check` or permission review, preserving whitespace
normalization for unguarded calls. It still reaches 60 steps with five acceptance
failures and failing types. Its six allowed source changes remain isolated; tests,
configuration, Git HEAD and workspace dependency aliases are intact. This is a
separate continuation from a later partial patch, not a paired comparison or a
successful repair. Evidence is in
`dist/self-host-task-state/attempt-edit-validation-gemma-resume/`. The new validator
improves admission semantics; broad live model repair quality remains unproven.

A separate expanded coding diagnostic uses a new clean snapshot, 14 single-agent
tools, automatic project instructions/skills/references, native Callix navigation
and `project_check`. The entire evaluator process has a minimal environment,
including SDK-owned subprocesses. Zero-model preflight discovers 59 npm scripts,
runs real typecheck and locates `ToolContext` through the native semantic index.
The original six-failure baseline and separate seven-pass reference remain intact.
One live attempt incorrectly restricted edits to package sources while excluding
Todos plugin code; its four refusals are retained as a test-harness scope error.
A separate run explicitly authorizes Todos production TypeScript and excludes
test/spec files. It uses semantic navigation once and changes two source files,
but exhausts its token allowance with the same six acceptance failures and failing
types. Neither run uses `project_check` autonomously. More available tools alone
do not establish a quality gain. Frozen tests/configuration and all 21 workspace
aliases remain intact; evidence is in `dist/self-host-expanded/`.

This investigation also exposed a real extension composition defect: structurally
valid class-based tools lost prototype methods when copied. A disk-plugin
regression reproduces that failure; core now retains class/private receivers,
non-enumerable methods and metadata getters while preserving native function
identity and ordinary object behavior. The loader also types optional validators
and rejects non-function declarations without blocking legacy peers. Real
load/reload/admission tests cover these contracts. These are extension fixes,
not successful model-authored repairs or stable 1.0 completion.

### Offline CPU coding diagnostic — 2026-11-13

The maintained local CPU evaluator verifies an existing pinned Qwen cache, owns
its loopback runtime and runs the actual app with an explicit focused tool
composition. Preflight rejects absent behavior and accepts the scripted reference
using the unchanged checkout-case grader. Four working-tree configurations were
observed twice: general instructions, missing-edit feedback, coding instructions,
and coding completion feedback. All scored 0/2 on this known task. Files covered
by preservation assertions survived; runtime records confirmed CPU and cleanup.
No paid model call was used. These are development diagnostics, not held-out
quality gains or evidence of Claude Code parity.

The coding-instruction runs exposed an unchecked completion path: without a saved
plan, a model could write an unrelated file and claim checks passed without
executing them. A manually authored harness repair now requests a successful
recognized check after the latest built-in write/edit for the coding preset.
Started background jobs do not count until matching terminal output, and passed
checks before a later edit are stale. Deterministic regressions cover opt-out,
general behavior, failed/unfinished/killed jobs and project_check cooperation.
The live post-repair attempts still failed and did not perform a successful edit;
they do not establish live repair success or directly exercise that write gate.

An independent installed-binary probe rejects the previous archive's unchecked
completion, then verifies the new archive's bounded failure and a real-check
success while preserving the user draft and checker. It is now part of every
native release smoke. This demonstrates completion-policy behavior, not autonomous
model coding ability. See [offline CPU diagnostics](evals.md#offline-cpu-development-diagnostic)
and [coding completion checks](core-customization.md#coding-completion-checks).

On the local Qwen 3 1.7B checkout case at `1c1c7b5`, four identical-text
edits failed, neither project checks nor other writes ran, and the model
claimed a successful fix. The independent grader still got 18 for an expected
12 after nine model requests. The coding completion policy now requests a
correction or an explicit unchanged outcome when all built-in mutation attempts
failed. App regressions exercise repeated false completion, a reported blocker
and recovery through a changed file and a successful check.

A second live attempt used the updated policy, clarified edit instructions
and a fixture containing only its original four files. It spent all 12
admitted requests on discovery. Eight grep calls treated `@.` as a literal
working directory. The grader again got 18. This attempt never proposed
completion. Callix now recognizes that exact working-directory argument when
the primary project has no literal entry of that name. App tests cover the
primary and attached projects, a real directory with that name, and invalid
symlink targets. In the final live run, all four searches used the default
directory and four reads reached the two implementation files. All six edit
requests omitted both `path` and `editRef`. The model exhausted 12 requests
without a successful edit or a project check. The independent result remained
18. The runs used different host code and do not measure a quality improvement.

The six targetless calls in the last checkout attempt contained only
`oldText` and `newText`. Those were the editor's only top-level required
fields. Its path-or-reference requirement depended on a root JSON Schema
`anyOf`. The pinned Qwen chat template renders the Ollama function structure,
and the locally inspected Ollama root parameter representation has no field for
that alternative. The native editor now advertises a required string `target`
alongside both text fields. Each local CPU transport receipt records those
required fields for comparison with the tool calls the model produced.

In a fresh local checkout attempt all 12 HTTP requests advertised
`target`, `oldText` and `newText` as required. Qwen selected `math.mjs` and
changed addition to subtraction. The independent behavior check passed, and
the protected package file and tests retained their original bytes. Five
subsequent edits repeated the replacement and found no matching text. The
model exhausted its request allowance without executing the project checks,
so the overall case failed. The core now includes the path of an earlier
successful identical replacement in that specific no-match error when the
corresponding tool result remains in the turn. This result does not prove the
file is still current or that any tests passed. A separate local greeting
case on the required-selector schema also used all 12 admissions. It made
nine searches and three reads, left the source unchanged, and failed both
the original checks and the independent behavior grader. Neither episode
qualifies as a complete autonomous task.

A further CPU checkout run on clean `c458dc7` repaired the arithmetic and then
used `write` with just the existing checkout function. That discarded its import.
The agent ran `npm test` twice and both executions failed on the missing
`discount` binding. The native writer now rejects a verbatim excerpt submitted
as a whole-file overwrite unless intentional extraction is explicit. A regression
replays the operator fix and the erroneous write, then runs the real project
check and the original independent grader.

The next live run took a different path. It used `edit` to introduce a duplicate
`checkout` declaration, duplicated the incorrect discount function, and ran `npm test`
twice. Both attempts failed on the duplicate declaration. The 12-request limit
was reached and the independent behavior check failed. This live run did not
exercise the excerpt guard. Both runs preserved the protected tests and package
file. See the current [write contract](core-customization.md#whole-file-writes).

## Acceptance gates

| Gate | Required evidence | Current assessment |
| --- | --- | --- |
| Real development | Repeated end-to-end bug fixes, feature work, refactoring and plugin development on realistic repositories; independent behavior checks, preserved user changes and successful project verification | Live Compositor-authored fixes, a guided plugin review and a multi-file form refactor have independent artifact checks. The form episode also exposed a harness typing defect and reported it truthfully. Sustained self-hosted development and broader task coverage remain unverified. |
| Model independence | Contract tests for every supported protocol, plus repeated real-model development runs across different model families. Unknown capabilities, invalid tool calls and weak tool use must degrade with bounded recovery | HTTP fixtures cover the supported transports. The 0.8.0 known-task diagnostic scores 6/8 across Gemma and DeepSeek, with both families scoring 3/4. Saved-profile OpenAI evaluations are available. Broad live model quality remains incomplete. |
| Tool cooperation | File discovery, semantic/text navigation, precise edits, test execution, shell jobs and delegation reach verified artifacts without unnecessary retries or denied-action bypass | Individual tools and regression suites exist. The 0.8.0 two-family diagnostic exposes repeated denied scratch-test execution and a turn token allowance refusal before completion. End-to-end efficiency and recovery need wider evidence. |
| Long-running execution | Context pressure/compaction, interruption, steering, queued work, restart/resume and failures at effect boundaries preserve the task, scope and truthful completion state | One live known task passed process-death/resume/explicit-compaction checks. A second known task recovered from a failed summary and passed three automatic compactions in a configured 8192-token window with independent artifact checks. A controlled live API truncation probe also passed. Multi-hour development and broader repositories remain required. |
| Extension quality | A developer creates, installs, enables, configures, updates and removes a useful composite plugin through Compositor. Public APIs remain compatible; disposal/reload and custom storage work in native archives | Git review passed source and exact archive certification on all four native platforms at c98b3ce. Project checks 0.1.1 passed the same platform scope at f102fef after fixing macOS project-path aliases. A completed autonomous initial plugin delivery and broader extension coverage remain required. |
| User workflow | The real terminal supports keyboard/mouse navigation, concurrent plugin/settings work and pending approvals/questions, with cancellation and narrow-window behavior verified | Real PTY scenarios cover concurrent management and a complete 48×18 question/management/answer flow with draft preservation. Broader daily-use and terminal coverage remain incomplete. |
| Trust and resource control | Permission, scope, secret handling and source-injection scenarios preserve boundaries. Model calls, retries, workers and shell processes have enforceable budgets and cleanup | Existing guards and tests provide evidence for specific boundaries. Permission rules are not an OS sandbox. Threat-model review and broader adversarial sessions remain open. |
| Release quality | All required tests, documentation, plugin certification, four-platform native builds and installed-archive smoke pass for the exact candidate. No known critical workflow failure remains | [v0.8.0](https://github.com/Neko1313/agent-compositor/releases/tag/v0.8.0), revision 4b5b297, passes candidate and tagged four-platform build/install checks, all 32 tagged runtime reports and checksum verification of all six public assets. Public Linux 0.7.4→0.8.0 upgrade preserves settings, prior binary and session context. Setup, independent conversation tabs and workflow PTY evidence matches public shipping files. Broader 1.0 gates remain open. |

Each gate needs links to source, commands, immutable revisions and retained run
artifacts. A narrow passing check cannot close a broader gate. Missing,
contradictory or non-reproducible evidence leaves the gate open.

The [check/report cooperation test](../packages/app/test/check-report-cooperation.test.ts)
runs actual Vitest through `project_check`, reads its generated JSON through
`test_report`, repairs the controlled fixture and repeats both tools. It checks
that a failing check remains a failure, the second report reflects the repaired
tests and an unrelated user file survives. This is a deterministic tool pipeline
with zero model requests; the test host supplies the repair. It does not establish
autonomous diagnosis or close the broader tool-cooperation gate.

## Evaluation rules

- Judge actual artifacts and independent behavior, not the agent's completion
  text or a success marker printed by an arbitrary command.
- Freeze tests only when the task requires that. Otherwise permit useful test
  additions while independently executing the original checks and extra probes.
- Keep grading sources and credentials outside the model workspace. Clear host
  credential, proxy and preload values from project-check processes; this is
  environment hygiene, not filesystem or OS containment.
- Record model, provider protocol, budgets, request counts, token usage,
  failures and repetitions. Separate deterministic integration scripts from
  autonomous live-model runs and development cases from unseen evaluations.
- Preserve failed trajectories and explain rubric corrections or source changes.
  Do not call a run an unbiased improvement comparison when the task, rubric,
  instructions, model or implementation changed between measurements.
- A comparison with another agent needs comparable tasks, model access, budgets,
  permissions and grading. Until those are measured, do not claim Claude Code
  parity or universal quality across arbitrary models.

See [evaluation commands and limitations](evals.md),
[extension certification](plugin-testing.md),
[execution contracts](core-customization.md) and [release gates](releases.md).

## Current development focus

The initial `test-reports` backend tool reads real local Vitest/Jest JSON,
derives assertion totals and returns bounded failure records through normal
canonical-path permissions. Its independent package checks include explicit
activation/removal, malformed input, UTF-8 byte bounds, symlink denial and
cancellation. The source package now also provides a manually implemented
`/test-report` panel with explicit reads, failure selection, scoped defaults,
restart and concurrent-agent/draft-preservation checks in the actual PTY.
The composite lifecycle exercises the tool, command, view and configuration
across install/reload/restart/update/rollback/disable/re-enable/remove.
The maintained terminal case now requires `[x]` and Alt+Q to settle the owned
operation while preserving the main model/draft, and requires reaching the final
diagnostic line and returning to the path in a 60×24 split. The host keeps late
publications hidden until an explicit plugin command/action. Opt-in host paging
is an additive catalog0.24 field; legacy input routing stays unchanged.
These checks do not establish autonomous plugin authoring. The required host repairs ship in [0.7.4](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.4).
The [independent report-plugin 0.1.1 release](https://github.com/Neko1313/agent-compositor/releases/tag/plugin/test-reports/v0.1.1)
at 4358ed1 passed source and all four native archive certifications and tagged
publication. Five public certificates, 141 evidence references and the public
Linux archive passed independent checks, including 13 actual report/package
behavior cases without a model request.
A fresh live Compositor authoring attempt used a minimal task-specific profile
with ordinary read/write/check tools and no reference implementation in its
workspace. Three admitted requests only read repository context; the fourth
request exceeded its predeclared serialized-body envelope before admission.
No candidate files were written, all protected files survived and the package
oracle correctly failed. The attempt does not establish autonomous initial
plugin delivery. Do not infer model quality from this bounded attempt, expand
its budget retrospectively, or count the manually implemented package as
agent-authored. Full plugin/UI authoring, sustained development and the wider
model/task matrix remain open.

A bounded Sol editing turn through Compositor added visible CI-panel busy
feedback using one guarded edit and two model requests. The host supplied a real
read snapshot; the agent had only the scoped edit tool and correctly stated that
it did not run tests. Three frozen success/failure/cancellation checks failed on
the original code and passed independently after the edit. All 735 protected
files and the oracle survived unchanged. The real PTY flow also verifies visible
feedback during a subprocess, status removal after cancellation, preserved old
results, concurrent main-agent work and restart behavior. This is one small known
UI development case with supplied context, not autonomous investigation, initial
plugin delivery or proof that the broader usability gates are closed. The busy
feedback ships in the independent
[CI-plugin 0.1.1 release](https://github.com/Neko1313/agent-compositor/releases/tag/plugin/ci-review/v0.1.1);
the immutable 0.1.0 archive remains unchanged.

Preparing that first update exposed a certification gap: native archives could
omit previous-release transitions even though source release checks required
them. Artifact certificates now also require upgrade/rollback evidence against
their platform's pinned previous archive. A regression rejects missing scenarios,
wrong versions/hashes and reused evidence from another platform. The CI scenario
uses real 0.1.0 release bytes, normal marketplace install/enable/update/rollback,
two restarts, retained settings/draft and actual tool/command probes without model
requests. Revision 9a2314e passed source and all four native candidate gates,
Node 22/26 CI and documentation checks. Its
[tagged publication workflow](https://github.com/Neko1313/agent-compositor/actions/runs/43123691496)
also passed. Five public certificates, 136 evidence references and four archive
checksums were independently checked. Public Linux bytes passed the actual
manager's install/update/restart/rollback/restart flow through a local verified-byte
mirror, preserving settings and draft without downloading during rollback.
Visual review caught stale screenshot capture and early cancellation
acknowledgment in the bench; both now synchronize on the actual rendered state.

Initial CI-plugin authoring through Compositor exposed two evaluation-fixture
settings mistakes, then a runtime compaction gap. The latest user request was
retained for the main model but omitted from auxiliary summaries; scaffold
examples were repeatedly mistaken for the actual task and its approval state.
The source repair passes the exact request separately to every summary segment
and merge, with context accounting and fail-closed handling if it cannot fit.
Deterministic regressions and one controlled live summary probe pass. A full
development rerun from an empty candidate under the repaired runtime was
subsequently attempted at fbd69d6. It stopped before request admission at the
authorized USD guard after six main steps, three compactions and thirteen
reported requests, without writing candidate files; all 726 protected files
and both frozen oracles survived. This budget-curtailed attempt does not establish
initial delivery. A guided completion from the saved CI candidate finished in seven
model steps, passed the frozen ten-case oracle and strict compilation, and
preserved all 725 protected files. This is a continuation of existing code, not
a successful autonomous initial delivery. Independent review then repaired
stale repository results, mismatched run IDs, incomplete bounded JSON records
and the UI hook timeout. The integrated `/ci` candidate passes source PR
certification, lifecycle/update/rollback checks and the actual PTY concurrent
configuration/run/job/log/cancellation/restart flow. Two actual read-only
GitHub CLI requests through the saved proxy also pass with zero model requests.
The exact fbd69d6 candidate passed [source and all four native installed-archive
certification jobs](https://github.com/Neko1313/agent-compositor/actions/runs/43102853382);
five certificates and 131 evidence files were independently verified. The
[subsequent tagged run](https://github.com/Neko1313/agent-compositor/actions/runs/43104978351)
failed a PTY synchronization assertion, so publication was skipped. The scenario
now waits for the specific refresh response to render before issuing another
request; its previous process-start/old-result predicate could accept stale UI.
The corrected real PTY flow and full local source certification pass at 8757290.
The corrected [14655ca candidate](https://github.com/Neko1313/agent-compositor/actions/runs/43106650734)
passed source and all four native archives, with five certificates and 131
evidence files independently verified. The failed unpublished tag was moved to
that certified revision after checking release absence; the subsequent
[tagged verification and publication](https://github.com/Neko1313/agent-compositor/actions/runs/43107581688)
passed. [CI review 0.1.0](https://github.com/Neko1313/agent-compositor/releases/tag/plugin/ci-review/v0.1.0)
is published independently. A public Linux x64 download through the saved proxy
passed checksum verification, inactive installation, explicit activation, `/ci`
without a model request and disable. This supplements native archive checks; it
does not establish public installation on every user's machine.
This repair is not part of immutable v0.7.1.

Further actual-core regressions exposed task-reference replacement by host
completion/recovery feedback during compaction. An explicit harness-origin
marker now keeps those messages as working context while preserving the actual
user task for summaries and permission review; real steering still changes the
task. This includes literal user text beginning with the harness's wording.
One oversized message can be folded when it is the only remaining middle entry,
subject to the existing reduction/failure guards. Automatic-compaction, replay
and permission-context regressions pass. The origin repair ships in 0.7.2.
The maintained installed-binary regression was added later at 026e605 and passed
[a separate four-platform candidate](https://github.com/Neko1313/agent-compositor/actions/runs/43110702555).

A later source fix extends task preservation to plugin-owned automatic follow-ups.
Controlled regressions first reproduced an automatic build notification replacing
the actual task for permission review and compaction. Queue ownership now marks
that message as host feedback, with journal provenance preserved on replay;
initial delegated tasks and literal user steering still count as requests.
Session request previews also exclude host feedback. The repair ships in
[v0.7.3](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.3).
Its [tagged native matrix](https://github.com/Neko1313/agent-compositor/actions/runs/43128862671)
passes an installed-binary background/replay scenario on all four platforms,
with the actual task retained in two permission reviews and every auxiliary
summary. A separate startup witness checks immediate EOF without a model request
and initialization before the first plain-session model request. Public Linux
bytes pass the compaction/background/replay probes after an installer upgrade
from 0.7.2 with state and the old binary preserved. These are controlled local
transport cases, not broad long-session or adversarial-model coverage.

Local Qwen3 1.7B CPU diagnostics at 0b48eca used three fixed small tasks with
two repeats each. Default thinking passed 4/6 strict cases; explicit
`reasoning_effort: none` passed 2/6, both with minimal instructions and with the
stock agent harness. All protected fixtures survived. Preemptive refusal of the
known forbidden write was safe but did not exercise the rubric's actual host
denial requirement. The edit cases exposed output-limit stops, an unnecessary
rewrite that lost a trailing newline, and empty successful-looking final turns.
These are controlled small-model diagnostics, not autonomous development or a
broad model-family quality result.

A fresh Sol bug-fix run through Compositor then repaired empty final responses
in the replaceable finish policy: the existing two bounded continuations ask
for a useful answer, then fail if the model remains silent. Disabled verification
and replacement policies remain supported. Six model steps/requests completed
with the frozen five-case acceptance suite and typecheck passing independently;
all 732 protected files survived. The integrated change passes 1106 maintained
tests with three optional skips. A live replay with the unchanged stock-harness cases and grader at ca84b9e
passed 3/6, with zero empty successful turns versus two before the repair. One
edit passed exactly; another correctly reported failed guarded-range edits.
This fixes silent feedback, not general editing quality. Remote release
certification remains separate; this is another known development case, not
1.0 completion.

At c31c430 the unchanged local cases passed 4/6 with 19 requests and preserved
fixtures. Both precise edits still failed through redundant writes dropping a
newline. The actionable missing-hash diagnostic was not triggered in this replay,
so these results do not establish that it improves live model recovery.

Git review revision
[c98b3ce](https://github.com/Neko1313/agent-compositor/commit/c98b3cee4a47f2f61930287c5a8d8d45c23b3ba3)
passed [full source and four native installed-archive certification](https://github.com/Neko1313/agent-compositor/actions/runs/43067043375).
The downloaded certificates, evidence hashes and embedded archive identities were
independently checked; native macOS keyboard/focus and cancellation screenshots
were inspected. This manual candidate run did not publish a plugin release.
Project checks' concurrent candidate exposed a real macOS path-alias rejection;
the selected project root and package path now both use host canonical resolution.
An aliased-directory integration test also rejects an outside package link even
when its directory is attached to the host. The corrected Project checks 0.1.1 revision
[f102fef](https://github.com/Neko1313/agent-compositor/commit/f102fef0ff7ed57a981486fee5558855ed918a8a)
passed [source and all four native archive jobs](https://github.com/Neko1313/agent-compositor/actions/runs/43075940358).
Independent checks validated its exact source/package identity, evidence hashes,
archive checksums and embedded release metadata. macOS ARM64 success/narrow and
Intel cancellation screenshots were inspected. These are deterministic/tool and
real-terminal cases; they do not establish autonomous model development quality.
The candidate run skipped publication and does not certify later source revisions.


A subsequent multi-file form refactor used `project_check` to discover and run
real project verification scripts. The model preserved the frozen acceptance
file and controlled user draft, passed 68 behavioral checks and explicitly
reported a compiler failure caused by the acceptance fixture's unsupported
`String.isWellFormed` type. An equivalent fixture assertion restored compiler
compatibility; independent checks passed without changing the authored source
or making a paid rerun. This is development and truthful-error-reporting evidence,
not an all-green autonomous episode under the original defective harness.

The published [v0.7.2 patch](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.2)
is bound to immutable revision
[888bf8c](https://github.com/Neko1313/agent-compositor/commit/888bf8ce7ebb3e075290a3e257c21cbf986c1c4d).
Its [Node 22/26 CI](https://github.com/Neko1313/agent-compositor/actions/runs/43108749292),
[documentation checks](https://github.com/Neko1313/agent-compositor/actions/runs/43108749491),
[four-platform candidate](https://github.com/Neko1313/agent-compositor/actions/runs/43108759727)
and [tagged publication](https://github.com/Neko1313/agent-compositor/actions/runs/43110063150)
passed. Two macOS Intel attempts failed on DNS: first during artifact upload
after successful smoke, then during the Callix download before compilation.
Those failures were retained; a rerun of the failed job completed all required
checks and publication. No failed functional assertion was hidden by retries.
An independent public Linux update from 0.7.1 verified installer/archive checksums,
preserved the previous binary and application state, and passed the context
regression on the publicly installed executable. This is a release checkpoint,
not completion of the broader development/model/long-session gates.

The earlier published [v0.7.1 patch](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.1)
is bound to immutable revision
[7e8e389](https://github.com/Neko1313/agent-compositor/commit/7e8e38989d2d88780f76aee7cbab1d62621747c5).
Its [Node 22/26 CI](https://github.com/Neko1313/agent-compositor/actions/runs/43078608479),
[documentation checks](https://github.com/Neko1313/agent-compositor/actions/runs/43078608245),
[build-only four-platform candidate](https://github.com/Neko1313/agent-compositor/actions/runs/43078638205)
and [tagged four-platform verification and publication](https://github.com/Neko1313/agent-compositor/actions/runs/43079898942)
passed. This patch fixes interrupted-turn settlement/cancellation, accepted
background follow-ups, project-root aliases and CI terminal interaction, and
ships bounded installer downloads. These are verified runtime/distribution fixes;
they do not close broader model, self-development or long-running gates.
An independent Linux x64 check downloaded the published installer and assets,
verified checksums and upgraded an isolated 0.7.0 installation to 0.7.1 through
the saved tool proxy. The old binary and application-state sentinel survived.
This public-download check supplements the four native CI install checks; it
does not establish public installation on every user's machine.

The earlier published [v0.7.0 milestone](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.0)
points to immutable revision
[21d7934](https://github.com/Neko1313/agent-compositor/commit/21d79342183a9f3262efbe7d9925ba71085b9539).
Its [Node 22/26 CI](https://github.com/Neko1313/agent-compositor/actions/runs/43053396437),
[documentation checks](https://github.com/Neko1313/agent-compositor/actions/runs/43053396720)
and [release verification, four native build/install jobs and publication](https://github.com/Neko1313/agent-compositor/actions/runs/43054146510)
all passed. The release contains four platform archives, the installer and checksums.
Independent plugin archive publication and the broader 1.0 gates remain separate.

The previous immutable candidate
[a9f99c9](https://github.com/Neko1313/agent-compositor/commit/a9f99c99009f082f64cd66e9f9ffca4e4da1a5d2)
has [green CI](https://github.com/Neko1313/agent-compositor/actions/runs/43046489076)
and [four-platform candidate build/install smoke](https://github.com/Neko1313/agent-compositor/actions/runs/43046640227).
That build-only workflow did not publish a new application release.


The first work toward this goal strengthens the evaluation foundation: explicit
preserved fixtures, independently rerun original checks, correlated verification
results, sanitized grader/shell environments and saved OpenAI profiles with a
persistent request-admission budget. These make subsequent quality work
measurable. They do not close the 1.0 acceptance gates.

Next, expand beyond small fixes to multi-file feature work and refactoring, then
exercise interruption/resume, context pressure, parallel agents and plugin
creation as complete development workflows. Use failures in those runs to drive
runtime and tool changes, and verify those changes against unchanged criteria.

A second authoring episode produced the [Project checks](../plugins/project-checks/README.md)
plugin through Compositor. Its unchanged six-test acceptance suite and five
agent-added regressions passed, but the turn ended at the conservative USD guard
before a final response. Independent review found and corrected metadata bounds,
settings scope leakage, command usage, cancellation placement and hook-expiry
cleanup. The original candidate and traces remain separate from the reviewed
integration. A later live guided review iteration from the original candidate
completed in 22 model steps with two automatic compactions and passed all 18
checks plus typecheck on independent rerun. Its reviewed settlement logic is
integrated. This is known-task review evidence; the completed autonomous initial
authoring gate and broader task/model coverage remain open.

Git review adds a concrete tool/panel/configuration workflow and exposed a host
subprocess cancellation leak, now covered by real process-group tests. The next
runtime work adds concurrent guarded UI tool execution with separate operation
state, cancellation, permissions and journal correlation. Source tests and a real
Git-panel PTY scenario verify that refreshing and cancelling a real subprocess
leave the held agent active. This evidence does not cover every plugin or a live
model. Explicit UI command routes now open new panels during a turn; other
commands retain their queued prompt behavior. A live known checkout task now
passes a process-death/resume/explicit-compaction scenario with independent
grading. A later ledger task exposed an oversized-tail recovery gap and a
non-shrinking merge failure. The revised compactor recovered the saved task
through three automatic compactions at a configured 8192-token window. Frozen
files and independent validation, deduplication, sorting and nonmutation checks
passed. A separate live API probe forced the first auxiliary output cap to 32
tokens and verified an identical-segment retry ending successfully. These are
bounded development/fault-injection cases, not natural million-token or multi-hour
sessions. Broader sessions and remaining-platform certification stay open.
