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
| Real development | Repeated end-to-end bug fixes, feature work, refactoring and plugin development on realistic repositories; independent behavior checks, preserved user changes and successful project verification | Small development suites and one live Compositor-authored production fix have passed independent checks. A sustained self-hosted development workflow and broader task coverage remain unverified. |
| Model independence | Contract tests for every supported protocol, plus repeated real-model development runs across different model families. Unknown capabilities, invalid tool calls and weak tool use must degrade with bounded recovery | HTTP fixtures cover the supported transports. Saved-profile OpenAI evaluations are available. A broad live quality matrix remains incomplete. |
| Tool cooperation | File discovery, semantic/text navigation, precise edits, test execution, shell jobs and delegation reach verified artifacts without unnecessary retries or denied-action bypass | Individual tools and regression suites exist. End-to-end efficiency and recovery need wider scenario evidence. |
| Long-running execution | Context pressure/compaction, interruption, steering, queued work, restart/resume and failures at effect boundaries preserve the task, scope and truthful completion state | One live known task passed process-death/resume/explicit-compaction checks. A second known task recovered from a failed summary and passed three automatic compactions in a configured 8192-token window with independent artifact checks. A controlled live API truncation probe also passed. Multi-hour development and broader repositories remain required. |
| Extension quality | A developer creates, installs, enables, configures, updates and removes a useful composite plugin through Compositor. Public APIs remain compatible; disposal/reload and custom storage work in native archives | The reviewed Git review plugin passes source, lifecycle, real UI and installed-archive certification on Linux x64. Other platforms and a successful autonomous authoring session remain required. |
| User workflow | The real terminal supports keyboard/mouse navigation, concurrent plugin/settings work and pending approvals/questions, with cancellation and narrow-window behavior verified | Real PTY scenarios cover concurrent management and a complete 48×18 question/management/answer flow with draft preservation. Broader daily-use and terminal coverage remain incomplete. |
| Trust and resource control | Permission, scope, secret handling and source-injection scenarios preserve boundaries. Model calls, retries, workers and shell processes have enforceable budgets and cleanup | Existing guards and tests provide evidence for specific boundaries. Permission rules are not an OS sandbox. Threat-model review and broader adversarial sessions remain open. |
| Release quality | All required tests, documentation, plugin certification, four-platform native builds and installed-archive smoke pass for the exact candidate. No known critical workflow failure remains | v0.6.1 passed its release gates. That evidence predates future changes and does not prove the gates above. |

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
integration. This does not satisfy the completed autonomous authoring gate.

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
