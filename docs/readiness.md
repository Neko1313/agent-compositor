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

Current source implements catalog 0.25 immediate commands independently of views,
headless `/auto on|off|status`, an explicitly requested `/auto history` view and
idempotent `/chat` restoration. Actual PTY checks cover a held model, unchanged
draft, repeated restoration, workspace return, narrow history scrolling and
restart. Core checks cover owner dispatch, failure isolation, tool permissions,
auxiliary usage, cancellation, unload and shutdown bounds. This is source-runtime
evidence; the immutable public 0.7.4 archive does not include these new contracts.
Embedded inference-assisted onboarding and further table/drill-down work remain
open. The development `resources` plugin provides a first standalone non-model
window: live process CPU/RSS charts, pause/manual sampling and bounded in-memory
history. It includes in-process agents but excludes child shells and model servers;
per-agent attribution and broader resource integrations remain open. The development agent overview now
uses catalog 0.27 semantic tables with expandable workspace/limits/activity,
state filters and responsive stacked fields. This is an initial reusable table
contract. The development workflows plugin adopts it for paginated run/stage
views, expandable results and state filters, preserving pause/resume and legacy
journals. The development UI now has reusable catalog 0.28 tabs for agent and
workflow state filters, with mouse/keyboard selection and narrow wrapping.
Per-agent conversation tabs now preserve separate drafts and histories, support
button/Enter submission and grouped navigation through all sixteen allowed agents,
and restore the selected pane with committed messages after restart. Source tests
and a compiled Linux x64 PTY scenario cover these paths with a loopback provider.
Saved activity now exposes persisted per-agent prompts, turn lifecycle/usage and
tool arguments/results/errors through filtered, paginated expandable records.
Refresh reads an explicit snapshot through the configured session repository.
Tests verify restart and complete long-record access. An extracted Linux x64 host
passes eight real-PTY history checks with an actual read tool call, a held main
stream and saved output restored after restart. Broader native UI coverage and
real-model verification of these newer views remain separate gates. Local extracted Linux
x64 archive checks now cover the agent overview with a held main model and the
bundled workflow table through bounded loopback providers. They exposed and fixed
host `/agents` immediate registration and explicit focus of existing/reopened
panes. Other native platforms and actual terminal graphics remain separate gates.
The newer source adds `/btw` side conversations
through catalog 0.26: an independent persisted agent with its own Reply field,
immediate opening/reopening, separate draft, focused-agent cancellation and
restart history. Source integration and real PTY checks cover those paths with
a held main model. It preserves the notification-only mode as `/btw --once`.
Native release/platform checks and fresh live classification/development gates
remain separate; this is not a published feature or a 1.0 readiness claim.

The current auto-review source also validates structured `approved: true|false|null`
decisions. Task-context low/medium approvals can proceed; refusals stop the call
without repeating a manual approval; uncertainty and review failures remain
manual. Deterministic integration checks cover the real hook/core handoff,
explicit host denies, audit failure, disable and interruption. The live reference
matrix now includes a bounded CI action and requires refusal of injected deletion
claims. That revised live matrix has not run, so these checks do not establish
classification quality on arbitrary models or readiness to publish the new auto
package. Ordinary clarification questions remain human decisions.
The plain/headless source now also preserves independent controls in pasted input,
queues Enter follow-ups, reserves Tab for steering, drains accepted commands on
EOF, and consumes human dialog answers separately from model prompts. Command
notifications and auxiliary usage appear in headless results; reported command
errors fail that invocation. Installed Linux archive checks include a real raw
PTY approval and actual CLI exit. These are local transport/protocol checks;
live-model development, native side-conversation UI and other-platform evidence
for this newer source remain separate requirements.

The current development source also provides a deterministic optional `/setup`
guide for first launch without a configured model. It configures an existing/new
provider through a short private editor, suggests explicit optional plugin choices,
preserves installed pins, applies reload through the normal UI path and returns
to the first task without losing a draft. A real source PTY flow verifies automatic
offer, persisted skip/completion, masked/private credentials, actual selected-plugin
installation and activation, narrow layout and one first task through a saved
loopback connection. The same eleven checks also pass against the compiled app
from a locally built and extracted Linux x64 archive (source e60ce22); screenshots
cover the private form, narrow guide and first task. No model is called during
setup itself. Other native platforms and embedded CPU-model quality remain open.
The local Linux x64 archive additionally passes installed-binary approval,
refusal and binding host-deny checks using its bundled reviewer and a local
protocol fixture. The maintained release smoke now requires this check on every
declared release platform. Other platforms have not yet run this new check;
this does not close the live-model classification gate.

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
installed Linux archive passes a five-response loopback recovery probe and all
six existing runtime probes. The new probe is mandatory in the native release
matrix; its other-platform results remain pending. Coverage passes 1286 tests
with three optional skips. These checks establish bounded tool behavior, not
general model competence. See [evaluation guidance](evals.md) and
[release verification](releases.md).

### Planned OpenTUI migration — 2026-11-13

The user explicitly requested adding migration to OpenTUI to the plan. OpenTUI
is the intended future terminal frontend, subject to the acceptance checks below;
this is not a claim that migration has started or that the current renderer has
been replaced. Preserve the agent core, provider adapters, permissions, tools,
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
   expandable details. Keep non-model commands independent of rendering.
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

Initial technical references are the official [OpenTUI components](https://opentui.com/docs/components/),
[image](https://opentui.com/docs/components/image/),
[video](https://opentui.com/docs/components/video/) and
[runtime/platform requirements](https://opentui.com/docs/getting-started/runtime-support/).
The prior chat estimates were preliminary effort ranges, not a release deadline.
This migration extends the 1.0 usability scope and does not change the authorized
live-model spending limit or interrupt the current approval-work fixes.

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

## Acceptance gates

| Gate | Required evidence | Current assessment |
| --- | --- | --- |
| Real development | Repeated end-to-end bug fixes, feature work, refactoring and plugin development on realistic repositories; independent behavior checks, preserved user changes and successful project verification | Live Compositor-authored fixes, a guided plugin review and a multi-file form refactor have independent artifact checks. The form episode also exposed a harness typing defect and reported it truthfully. Sustained self-hosted development and broader task coverage remain unverified. |
| Model independence | Contract tests for every supported protocol, plus repeated real-model development runs across different model families. Unknown capabilities, invalid tool calls and weak tool use must degrade with bounded recovery | HTTP fixtures cover the supported transports. Saved-profile OpenAI evaluations are available. A broad live quality matrix remains incomplete. |
| Tool cooperation | File discovery, semantic/text navigation, precise edits, test execution, shell jobs and delegation reach verified artifacts without unnecessary retries or denied-action bypass | Individual tools and regression suites exist. End-to-end efficiency and recovery need wider scenario evidence. |
| Long-running execution | Context pressure/compaction, interruption, steering, queued work, restart/resume and failures at effect boundaries preserve the task, scope and truthful completion state | One live known task passed process-death/resume/explicit-compaction checks. A second known task recovered from a failed summary and passed three automatic compactions in a configured 8192-token window with independent artifact checks. A controlled live API truncation probe also passed. Multi-hour development and broader repositories remain required. |
| Extension quality | A developer creates, installs, enables, configures, updates and removes a useful composite plugin through Compositor. Public APIs remain compatible; disposal/reload and custom storage work in native archives | Git review passed source and exact archive certification on all four native platforms at c98b3ce. Project checks 0.1.1 passed the same platform scope at f102fef after fixing macOS project-path aliases. A completed autonomous initial plugin delivery and broader extension coverage remain required. |
| User workflow | The real terminal supports keyboard/mouse navigation, concurrent plugin/settings work and pending approvals/questions, with cancellation and narrow-window behavior verified | Real PTY scenarios cover concurrent management and a complete 48×18 question/management/answer flow with draft preservation. Broader daily-use and terminal coverage remain incomplete. |
| Trust and resource control | Permission, scope, secret handling and source-injection scenarios preserve boundaries. Model calls, retries, workers and shell processes have enforceable budgets and cleanup | Existing guards and tests provide evidence for specific boundaries. Permission rules are not an OS sandbox. Threat-model review and broader adversarial sessions remain open. |
| Release quality | All required tests, documentation, plugin certification, four-platform native builds and installed-archive smoke pass for the exact candidate. No known critical workflow failure remains | [v0.7.4](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.4), revision 973012a, passed candidate and tagged four-platform build/install checks. It repairs canonical custom-tool permission targets, closed-plugin operation cleanup and opt-in editable-view paging. Public Linux 0.7.3→0.7.4 upgrade preserved state and the previous binary; installed context and background/replay probes passed. These establish this release checkpoint; broader 1.0 gates remain open. |

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
