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
| Release quality | All required tests, documentation, plugin certification, four-platform native builds and installed-archive smoke pass for the exact candidate. No known critical workflow failure remains | [v0.7.1](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.1), revision 7e8e389, passed Node 22/26 CI, documentation checks, all 29 plugin deterministic contracts and four-platform native build/install smoke before publication. Later self-hosting exposed task loss during compaction; its source repair is separate from this published checkpoint. The gate remains open. |

Each gate needs links to source, commands, immutable revisions and retained run
artifacts. A narrow passing check cannot close a broader gate. Missing,
contradictory or non-reproducible evidence leaves the gate open.

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

Initial CI-plugin authoring through Compositor exposed two evaluation-fixture
settings mistakes, then a runtime compaction gap. The latest user request was
retained for the main model but omitted from auxiliary summaries; scaffold
examples were repeatedly mistaken for the actual task and its approval state.
The source repair passes the exact request separately to every summary segment
and merge, with context accounting and fail-closed handling if it cannot fit.
Deterministic regressions and one controlled live summary probe pass. A full
development rerun from an empty candidate under the repaired runtime is still
required. A guided completion from the saved CI candidate finished in seven
model steps, passed the frozen ten-case oracle and strict compilation, and
preserved all 725 protected files. This is a continuation of existing code, not
a successful autonomous initial delivery. Independent review then repaired
stale repository results, mismatched run IDs, incomplete bounded JSON records
and the UI hook timeout. The integrated `/ci` candidate passes source PR
certification, lifecycle/update/rollback checks and the actual PTY concurrent
configuration/run/job/log/cancellation/restart flow. Two actual read-only
GitHub CLI requests through the saved proxy also pass with zero model requests.
Four-platform installed-archive certification and publication are still pending.
This repair is not part of immutable v0.7.1.

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

The published [v0.7.1 patch](https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.1)
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
