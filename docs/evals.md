# Quality checks and Harness²

The [1.0 readiness gates](readiness.md) define the broader development target;
a passing smoke suite alone does not close them.

## Reproducible evals

```sh
npm run eval
npm run eval:ollama
npm run eval:proxy
npm run test:ci
npm run marketplace:validate
```

`eval` runs the real AgentCore/plugins in isolated temporary projects with a
deterministic ScriptedProvider. `eval:ollama` applies the same criteria to Gemma
and DeepSeek. Cloud-backed tests run explicitly and are not required in regular
CI. The runner bounds steps, tokens, and execution time; it does not copy actual
home-directory credentials. Traces and scores are saved in ignored `dist/evals*/`.

The runner passes the case's tool roster and permission rules directly to the
app. File discovery and grep therefore see the fixture as supplied. A project
fixture named `agent-compositor.json` remains available as source data, including
when its settings differ from the evaluator's composition. Navigation-specific
Callix settings live under the temporary user home.

Checks cover reading evidence with a tool and answering accurately, actually
fixing a file, persisting Todos, enforcing a permission denial, and blocking a
secret before contacting the model. Scoring uses artifacts/events instead of
trusting the model's claim that a task is done. This is a small smoke suite, not
a measure of general quality or a ranking of models.

```sh
npm run eval -- --models gemma4:31b-cloud,deepseek-v4.1-flash:1017-cloud \
  --repeat 3 --output dist/evals-comparison
npm run eval -- --models scripted --split test --output dist/evals-heldout
npm run eval -- --suite tools/evals/cases.json --case read-evidence
npm run eval -- --baseline dist/evals/report.json --output dist/evals-next
```

`--harness path/to/instructions.md` compares a system-instruction variant;
`--timeout` sets the deadline in milliseconds. The JSON report includes rubric
checks, pass rates per model, latency, usage, request counts, and baseline
regressions. `tools/evals/*.ts` is included in the standard typecheck command.
Programmatic coding-preset trials must also enable `agentHarness: true` in
`runCase`; the runner rejects an inactive coding preset before contacting the
model. A configured preset name alone does not establish that its policy ran.
Each result also includes `permissionDiagnostics`: denied agent calls, repeated
identical denied calls, unmatched denied results and event/call references for
inspection. Identity compares the tool and every argument value, ignoring JSON
object key order; it does not infer equivalent effects from different commands.
Independent user operations are excluded. These descriptive counters do not
change rubric grades, authorize commands or establish safe recovery. Inspect
the trajectory before treating another refused action as a repeated attempt;
successful task verification and refusal-free execution are separate claims.
For project cases requiring agent-run verification, an observed successful
foreground check stops counting if another non-denied shell result follows
or overlaps it, including a user operation or a command that exits nonzero:
shell commands can change files even when they fail. This conservative rule
also rejects harmless later shell commands; rerun the check to establish fresh
evidence. It is not a filesystem snapshot or proof against unobserved effects
from other tools or background processes. Earlier reports used a weaker rule
and are not retroactively regraded.
A failed case produces a nonzero exit code. Add tasks with observable
results for new plugins; separate training examples and held-out cases with
`split`. Do not optimize a harness against test answers or copy grading data into
the execution workspace.

The separate permission-preview feature suite checks inspecting rules without
execution and recovering from one real refusal by previewing/running an existing
authorized check:

```sh
npm run eval -- --suite tools/evals/permission-cases.json --output dist/evals-permissions
```

`permissionPreviews` expectations correlate an actual successful `tool_help`
result with the exact proposed tool/arguments and its returned decision/scope;
they require `executionAuthorized: false`. `maxDenials` bounds refused agent
calls. Independent graders check execution markers and preserved fixtures,
rather than trusting the final response. These explicitly guided feature cases
are separate from unchanged-prompt coding/recovery benchmarks. Focused `runCase`
compositions retain explicitly selected control helpers such as `tool_help`;
omitted helpers remain excluded.

CI collects JUnit and Cobertura reports, enforces coverage floors (lines 80%,
statements 70%, functions 70%, branches 60%), validates the catalog, and runs the
deterministic eval and Bun proxy smoke checks. Reports are retained as artifacts.
Tests use Vitest 5 and require Node >=22.19.0. CI runs typechecking and the
coverage suite on the minimum Node 22.19.0 and primary Node 26; the deterministic
evals, proxy smoke checks and generated-artifact checks run once on Node 26.
Local commands match CI. Cloud credentials are unnecessary for CI. Exact
remote source revisions and retained workflow results belong in the
[readiness evidence](readiness.md); local output alone does not establish that
a remote workflow passed.

Held `ScriptedProvider` steps register their release before emitting events, so a
consumer may call `release()` while handling the first text/tool event. Release
applies to the earliest active held request; aborted or closed requests remove
their waiter and abort listener, and calls made without an active hold do not
pre-release a future request. This is deterministic fixture behavior, not a
network-provider cancellation guarantee.

## Saved OpenAI profiles and a persistent USD guard

A profile saved through **Settings → Add provider** can be used without copying
its credential into the isolated project:

```sh
npm run eval -- --profile openai-eval --max-usd 50 --case read-evidence \
  --output dist/evals-openai-smoke
npm run eval:agent -- --profile openai-eval --max-usd 50 --repeat 2 \
  --timeout 180000 --output dist/evals-openai-agent
```

`--profile` and `--models` are mutually exclusive. Paid profile evaluation
requires `--max-usd`. The current priced adapter accepts official OpenAI
Responses with `gpt-6.1-sol` only; it refuses other models/endpoints instead of
reusing a price authorization for a different service. Credentials are loaded
from the parent's private Compositor storage and supplied only to its provider.
The model workspace, project checks and report do not receive the credential.

The adapter reads the normal scoped `proxy.json` settings and uses Compositor's
`NetworkClient` for the model scope. An enabled model proxy therefore applies to
budgeted evaluation requests as well as ordinary sessions. Each completion owns
and closes its proxy client on success, cancellation or failure. A failed proxy
does not fall back to a direct request. Credentials remain in the parent provider.

The persistent ledger lives under `AGENT_HOME/eval-budgets/PROFILE.json`
(`~/.agent-compositor` by default), with private file permissions. It is shared
across repeated commands, guarded by a cross-process write lock and bound to the
profile, model, price policy and authorized total. Changing the total or an
incompatible ledger fails closed; starting another output directory does not
reset the allowance. Concurrent reservations cannot both spend the same balance.

Before each HTTP attempt the guard reserves a conservative amount from UTF-8
request bytes plus template allowance and the bounded output limit. A reported
usage event settles that reservation once. Errors, interrupted streams and
process death without reported usage retain the reservation. Corrupted or locked
ledgers stop admission. Requests over 200,000 serialized bytes or 8,192 output
tokens are refused by this evaluation adapter. Broader context/output scenarios
need an explicitly reviewed envelope rather than silently increasing it.

New profile requests explicitly set `service_tier: "default"` instead of inheriting
Project tier settings. The dated `sol-standard-2026-11-12` admission policy reserves
$5/M input (including the higher 12h cache-write rate) and $10/M output. Once the
response confirms Standard processing, reported cached reads use $0.10/M; all
remaining input stays charged at $5/M, even when a cheaper ordinary-input or
shorter cache-write rate could apply. This remains a ceiling, not an invoice.
The byte/output envelope stays below long-input pricing; reported usage outside
the reserved token envelope is refused without refund. Terminal stream metadata
must confirm `service_tier: "default"` before settlement. Missing/unexpected tier
metadata retains the reservation and persistently halts further requests for
that ledger, including restarted processes, pending review.

Existing charges retain the original $30/M input and $60/M output policy and
amounts. Each new Standard charge stores its own policy and reserved token
ceilings. Original records are never rewritten, history is never reset and the
authorized total is unchanged. The ledger's original root policy remains its
compatibility identity. Reports expose `committedUpperBoundUsd`, the unchanged
raw `recordedUpperBoundUsd` and pending/reported counts, not an asserted billed
cost. Pricing changes require a reviewed policy. See
[processing and cache prices](https://developers.openai.com/api/docs/pricing) and
[service tier selection](https://developers.openai.com/api/reference/resources/responses/methods/create).

A trusted operator can explicitly record one historical cache review through
`EvalBudget.reviewHistoricalCache({endpoint, sourceRevisions, evidenceSha256, ledgerSha256})`.
Before doing so, independently audit the historical adapter revisions and saved
usage: the requests must be official global `gpt-6.1-sol` Responses calls, below
the long-input threshold, with valid reported cache counts. The endpoint must be
`https://api.openai.com/v1/responses`; regional/gateway histories are ineligible.
The revisions and evidence SHA-256 identify the operator's external audit.
`ledgerSha256` is `evaluationLedgerDigest` of the audited parsed JSON snapshot;
the same digest is checked under the write lock before applying the review, so
another admission or settlement requires auditing the changed snapshot first. The
method does not fetch or establish that provenance itself, so it is not an
automatic migration or a model-controlled operation. See the official
[regional endpoint requirements](https://developers.openai.com/api/docs/guides/your-data).

The dated `sol-global-all-tiers-cache-2026-11-12` review uses maximum global tier
rates: $30/M for every non-read input token (including 12h writes), $60/M output
and $0.60/M confirmed cached reads, rounding upward to microdollars. It assumes
neither Standard processing nor a shorter cache retention period. Only the fixed
cohort of already reported legacy charges with saved cache counts is covered;
cache-unknown charges, pending reservations, current Standard charges and later
requests retain their existing bounds. The original charge objects stay intact.
An added receipt records the policy, audit provenance and each covered charge's
fingerprint and recomputed ceiling. Every read verifies that receipt and usage;
inconsistent counts, changed originals, forged ceilings or incompatible policies
stop admission. A second review cannot replace the receipt, and a historical
review cannot clear a pricing halt. Cross-process reservation locking still
applies. `historicalCacheReview` reports coverage and the ceiling refinement;
the difference is not a refund or a statement of actual billing. Older guards
that do not support this receipt continue using the original, larger total.

Reported requests with cache details also expose `standardPriceEstimate`: a
separate dated Standard/global **30m-write assumption**, at $2/M ordinary input,
$0.10/M cached reads, $2.50/M cache writes and $10/M output, including long-context
multipliers if applicable. Aggregate write counts do not establish retention;
12h writes cost more, so this estimate is not an upper bound or invoice. It does
not determine admission. `coveredRequests` and `unavailableRequests` show partial
historical coverage; old charges without cache details remain unavailable.
Missing cache counts use zero in this estimate; unknown usage retains its entire
reservation and contributes no reported estimate. Regional premiums, negotiated
pricing and unrelated account usage can also make an invoice differ. See the
[cache accounting formula](https://developers.openai.com/api/docs/guides/prompt-caching).

## Artifact and verification grading

Verification grading excludes user-operation calls/results carrying
`operationId`. A successful command run manually from a panel cannot count as
verification performed by the evaluated agent.

A case can declare `expect.preserve` for fixture files that must remain regular
files with their original bytes. Use this when the task explicitly forbids edits.
`expect.originalChecks` names original JavaScript/TypeScript check fixtures that
must still pass independently after the agent finishes; the grader stages a
private temporary sibling script, executes the original source against the
changed implementation and removes it. This permits additional regression tests
without letting replacement assertions hide a broken implementation.

`expect.verificationCommands` optionally constrains the accepted verification
commands. For cases that require agent-run verification, the grader correlates a
foreground `exec` call, its effective command at `tool.check`, and its result
by call ID. It requires exit zero and the expected marker in stdout after the
latest observed successful write or edit. A later change invalidates earlier
or in-flight evidence. Other user operations, intercepted answers without a
preflight, and overlapping call IDs cannot supply this credit. The grade
describes recorded tool execution. Independent behavior checks run separately.

Graders run with the fixture project's cwd, an isolated HOME and a minimal
process environment. Shell checks clear inherited host environment values and
use the fixture HOME. Neither path inherits host API keys, proxy values or
runtime preloads. Native trusted plugins still execute in the parent process;
this is not an OS security sandbox for malicious generated code.

## Upstream Harness² integration

[Harness² upstream](https://github.com/google-research/harness2) separates the
substrate, benchmark, and proposer/selector. `tools/evals/harness2_adapter.py`
implements its actual `Substrate` protocol: surface, materialise, execute,
read_trajectory, and preflight. It does not impersonate Codex/OpenCode CLI or
automatically modify this repository based on model suggestions.

```sh
git clone https://github.com/google-research/harness2.git /path/to/harness2
uv venv --python 3.13 .venv-harness2
uv pip install --python .venv-harness2/bin/python -r tools/evals/requirements-harness2.txt
.venv-harness2/bin/python tools/evals/harness2_adapter.py --check
```

The requirements file pins the upstream revision. For upstream development, an
editable checkout can replace that dependency with `uv pip install --python
.venv-harness2/bin/python -e /path/to/harness2`.

The checked upstream commit is
`6868817518876de8fd170c6a8354daca273b6191` (also recorded in the quality report).
Upstream requires Python 3.12/3.13; the project's Python 3.14 environment does not
meet that requirement. Temporary dependencies were installed under /tmp rather
than in the user's application environment.

The surface includes AGENTS.md, guardrails.md, memory.md, toolguide.md, skills,
sub_agents role instructions, scripts, and native plugin hooks/Claude command
hooks. Materialisation creates an isolated staged workspace: always-on text is
combined into AGENTS.md, roles become delegation instructions, and plugin TS
becomes native plugin directories. Use `install_mode=workspace_config`, accepted
by the real upstream BenchSpec. The CLI also accepts the internal compositor_root
alias. A launcher can be passed to the constructor; the default launcher accepts
task JSON with `prompt`, `files`, optional `home_files`, `add_dirs`, and workspace
`symlinks` whose targets name home fixtures. Fixture paths cannot escape their
respective roots. Strings can interpolate `{{home}}` and `{{workspace}}`.
Grading stays outside that workspace.

```sh
.venv-harness2/bin/python tools/evals/harness2_adapter.py \
  --tree path/to/harness-tree --task path/to/task.json \
  --model gemma4:31b-cloud --timeout 120
```

Each rollout runs the real `compositor --output-format stream-json`, bounds its
execution time, and retains trajectory/execution metadata. On timeout, the whole
process group is stopped. Rollout directories remain available for artifact
inspection; the staged harness is removed after a CLI run. Each process starts in
its workspace with a fresh HOME and config directory. The environment keeps only
PATH/locale/terminal settings and explicit local provider settings; host API keys,
proxy variables and preload options are not inherited. The local Ollama endpoint
can still use its server-side model authentication. This is filesystem scope and
process isolation for reproducibility, not an OS security sandbox: trusted plugins
and explicitly permitted shell commands retain their normal execution powers.

Completed checks: protocol/materialisation validation, the upstream deterministic
demo in both modes (2 tasks, 0 failures), and an end-to-end Compositor/Gemma
rollout that verified a token read from a file. These are not JobBench/LAB/
WorkBuddy scores or measurements of gains from recursive optimization with live
models. Those require their datasets, proposer/selector channels and budgets.
The Compositor case adapter below supplies our own small task set. It can connect to Harness² orchestration
through its protocol interface; the upstream CLI's built-in `--substrate cx/oc`
options do not select Compositor automatically.

## Compositor Harness² cases

`tools/evals/harness2_bench.py` implements upstream's actual `BenchmarkAdapter`
alongside `CompositorSubstrate`; the runner uses upstream `core.judge.judge_one`.
`harness2-cases.json` currently contains 12 scenarios: five train and seven test.
The split supports separate harness experiments; both splits were inspected during
development, so it is not an unseen or statistically independent benchmark.

| Area | Observable checks |
| --- | --- |
| Evidence | A file observation and a correct answer, with a tool-call bound |
| Project references | Quoted home paths, exact file grants, attached projects, preserved source and updated target |
| Web | Search, actual source fetch, source URL in a written artifact, no automatic redirect request |
| Permissions | Denied mutations preserve bytes, denied attachments do not reach prepared context, sibling and symlink targets remain unread |
| Delegation | A child command cannot grant the parent a new filesystem scope |
| Source trust | A page's mutation instructions do not change user files or trigger mutation/shell tools |
| Code changes | Actual code behavior, an unchanged project check, and evidence that the check ran successfully |

```sh
. .venv-harness2/bin/activate
npm run harness2:check
npm run test:harness2 -- --junitxml=dist/harness2-tests/junit.xml
npm run eval:harness2 -- --repeat 2 --output dist/harness2-cases
npm run eval:harness2 -- --split test --output dist/harness2-test
npm run eval:harness2 -- --case search-and-source --output dist/harness2-web
npm run eval:harness2 -- --model gemma4:31b-cloud --output dist/harness2-gemma
npm run eval:harness2 -- --model deepseek-v4.1-flash:1017-cloud --output dist/harness2-deepseek
```

The default model is `scripted`: a loopback OpenAI-compatible SSE fixture drives
the real CLI, permissions, plugins, filesystem and HTTP tools. Scripted next steps
can require an earlier observation. The fixture also serves local source/search
responses and records requests. This checks integration without credentials or
public-network variability; it does not measure model autonomy, public search
availability or the relevance of a real search engine. Live runs use the selected
model through `--base-url` (local Ollama by default) and the same local web sources.

Use `--harness path/to/tree` to try another validated Harness² instruction/skill/
plugin tree, `--repeat 1..20` for repetitions and `--timeout` for a deadline in
seconds. Use a different output directory for a different experiment: run ids are
idempotent and refuse reuse with changed cases, harness, model, runtime source/
dependency fingerprint or configuration.
Execution runs under the system temporary directory, independent of project
configuration above the report directory. After exit the runner archives captures
under `<output>/captures/<run-id>/` and removes the execution directory. Execution
metadata retains the original root so the judge can compare home/absolute paths
in archived traces. Cached execution does not spend another model call.

The JSON report includes each check, upstream judge failure information, source
harness, case and runtime fingerprints, elapsed time and artifact paths. Case manifests,
scripts, HTTP captures and judge expectations stay outside the agent's workspace.
`task_files()` exposes only source fixtures to upstream context construction.
Trajectory rendering follows upstream's `[ACTION]`/`[OBSERVATION]` grammar.

Grading correlates tool results with their calls and checks actual files and HTTP
requests. Equivalent home/absolute paths are compared canonically, and code fixes
may use write or edit. An independent Node probe checks the produced module with
additional inputs outside the rollout workspace; printing `CHECK_PASSED` is not
enough. Timeouts, nonzero exits, missing/duplicate/error final results, secret
leaks, forbidden effects and budget excesses fail. A broken judge remains ungraded
through the upstream judge protocol and makes this runner fail, rather than
silently counting as a zero or a pass.

Python tests live separately under `tools/evals/tests/{unit,integration}` and use
strict registered markers. They cover false success claims, missing evidence,
correlation and path equivalence, scope escape, failures/timeouts, materialised
skills/plugins, idempotence, and scope restoration across two real CLI processes.
They are optional and separate from the existing TypeScript CI jobs.

Recorded development evidence (2026-11-10): 24/24 scripted episodes (two repeats),
44 Python tests, and 636 TypeScript tests passing with three optional checks
skipped. Typecheck, the existing 5/5 deterministic evals, Linux x64 build and
installed-release smoke were also checked. Reports are under
`dist/harness2-verified/report.json` and `dist/harness2-tests/junit.xml`.

The final live development runs passed 12/12 on Gemma and 10/12 on DeepSeek, under
`dist/harness2-current-gemma/report.json` and
`dist/harness2-current-deepseek/report.json`. DeepSeek's remaining failures were
an initial denied shell probe instead of the requested symlink read and exceeding
the two-call bound in the delegated-grant case. Neither trace exposed its private
fixture token. These live runs preceded the archive-layout hardening; the final
temporary-execution/archive layout was checked by the deterministic suite and
the parent-config-isolation regression test. These are single development runs,
with loopback web fixtures, not model rankings or public internet quality scores.

## Current run evidence

Results from the recorded run are saved under `dist/evals-ollama-final/report.json`,
`dist/harness2-smoke/report.json`, `dist/harness2-demo/demo.json`, and
`dist/visual-marketplace-storage/report.json`. They are not committed as permanent
quality guarantees. Code changes require rerunning the affected checks.

## Agent outcome suite

`npm run eval:agent` runs two multi-step repository tasks with the actual harness:
find/fix a cross-file checkout bug, and recover from a failing greeting formatter
while preserving its exported API. User prompts do not specify a tool sequence.
The environment includes default Callix file search, normal tool permissions,
and allowed project check commands. The model must execute a successful check; the checkout task preserves its
original checks byte-for-byte, while the greeting task independently reruns
its original checks and permits new regression tests.
A trusted grader outside the workspace then checks additional behaviors, without
exposing its source to the model. Reports retain trajectories and separate
execution failure from artifact/check failures. These tests measure more than
whether a model emits a requested tool name, but remain a small task suite.

```sh
npm run eval:agent -- --output dist/evals-agent-scripted
npm run eval:agent -- --models gemma4:31b-cloud,deepseek-v4.1-flash:1017-cloud \
  --timeout 180000 --output dist/evals-agent-final
```

The deterministic scripts validate runner plumbing and are not autonomy scores.
In this change, the final live run passed 4/4 (two tasks per model). An earlier
run with an incomplete eval toolset passed 1/4: Gemma repeatedly attempted denied
shell listings, while DeepSeek spent its budget despite fixing the artifact.
Restoring the normal Callix search tools and adding bounded no-progress recovery
produced the final result; permissions and grading criteria were not relaxed.
This is development evidence, not an unbiased benchmark or a parity claim about
Claude Code/Codex. More held-out tasks and repeated runs are needed for reliable
quality comparisons. Live runs use the existing Ollama cloud models and are
explicit, not part of credential-free CI.

### Retained installed-CLI plugin authoring

`bun tools/evals/development.ts` prepares or executes the original Project checks
plugin task using an explicitly pinned installed native Compositor executable.
The authoring actor is not a source `buildApp` instance. It starts from an empty
plugin directory, public extension instructions, protected project checks and a
user draft. The reference implementation and independent grader are outside that
workspace. This is a known development task, not a held-out quality benchmark or
an OS sandbox.

Preparation verifies the executable SHA-256, packaged version and renderer,
retains the project, and checks both the original passing project command and
the expected absent-plugin failure. It starts no model gateway or actor and does
not load a saved profile, credential or budget ledger:

```sh
bun tools/evals/development.ts --prepare \
  --binary /absolute/path/to/compositor \
  --binary-sha256 SHA256_FROM_VERIFIED_INSTALL \
  --output dist/development-plugin-prepared \
  --provider ollama --base-url http://127.0.0.1:11434/v1 \
  --model YOUR_EXPLICIT_MODEL
```

Execution requires a fresh output directory, the same explicit identity/provider
flags, `--run` instead of `--prepare`, and a `--provider-access-note` recording the
reviewed service access and billing arrangement. A loopback Ollama route can use
a paid cloud model; the note does not create a spending allowance. Local
chat-completions providers (`ollama` or `openai-compatible-local`) require an
explicit credential-free loopback URL. The separate `saved-openai-profile` mode
uses the native Responses protocol for the exact `gpt-6.1-sol` model:

```sh
bun tools/evals/development.ts --prepare \
  --binary /absolute/path/to/compositor \
  --binary-sha256 SHA256_FROM_VERIFIED_INSTALL \
  --output dist/development-saved-profile-prepared \
  --provider saved-openai-profile --profile openai-eval \
  --model gpt-6.1-sol --max-usd 50
```

`--max-usd` must equal that profile's existing **total lifetime ceiling**, not
its remaining balance or a new allowance for this run. On `--run`, the parent
resolves the original caller's settings and `AGENT_HOME` before constructing the
isolated actor home. It requires the original
`eval-budgets/PROFILE.json` ledger; a missing, deleted, corrupt, locked or
mismatched ledger fails closed. It never copies or creates a replacement ledger,
resets charges, changes prices or applies a historical cache review. The example
does not authorize spending. Saved profiles reject `--base-url`; local modes
reject `--profile` and `--max-usd`.

The saved profile must use the official OpenAI Responses endpoint. Its credential
and saved model-proxy settings stay in the parent. The installed actor receives
only a loopback Responses URL, dummy key, exact model, and bounded reasoning/output
settings. Requests preserve function-call IDs, outputs and encrypted reasoning
without a chat-completions translation. Stateful response references, hosted
tools, image/file inputs and undeclared billing controls are rejected before
HTTP. Standard-tier serialized requests are reserved in the original ledger
before egress. One parent collector validates terminal usage and settles that
reservation exactly once, independently of the consumer's reader. The existing
typed saved-profile evaluator uses the same authority. HTTP/proxy failure,
interruption or unconfirmed usage retains the reservation; an unconfirmed pricing
tier persists the existing halt. Accounting bounds are not an invoice.

The host-owned gateway admits one completion at a time with no redirect or
fallback. One following request may wait until the prior response and its
receipt have finished; additional concurrent callers receive HTTP 409. The
waiting request cannot contact the provider before that evidence settles, and
receipt failure, cancellation or the deadline prevents its admission. A client
that consumes validated usage followed by SSE `[DONE]` may close its reader
while the gateway finishes collecting the upstream response and saving its
receipt. Disconnecting earlier still cancels that upstream request.

For saved Responses, natural actor exit seals new and waiting admission. If a
validated terminal response was already observed, the parent drains only that
admitted response and joins its raw-stream, ledger and gateway-receipt writes
under the original deadline. Operator cancellation or deadline expiry still
aborts it. An actor exiting before a validated terminal cannot cause a new model
request or a fabricated usage settlement. Local chat shutdown keeps its existing
aborting behavior.

Defaults are 40 requests, 200,000 serialized request bytes per call,
6,000,000 total request bytes, requested output of at most 4,096 tokens,
1,200,000 reported tokens as a stop threshold, 4,000,000 response bytes per call
and a 20-minute deadline. `--limits /absolute/path/to/limits.json` requires every
positive integer field: `maxRequests`, `maxRequestBytes`, `maxTotalRequestBytes`,
`maxOutputTokens`, `maxMeasuredTokens`, `maxResponseBytes`, `deadlineMs`. Unknown
fields or missing limits fail before execution. Byte caps are not token estimates;
the measured-token threshold is checked after usage arrives, not a pre-request
token or billing guarantee. Missing/invalid terminal usage and evidence-write
failures stop further admission. The actor has a separate bounded step count,
log size and actor-process-group shutdown. Forced actor death is not proof that
every separately detached SDK worker has exited; live authoring requires the
headless signal-cleanup gate as well. SIGKILL cannot run application cleanup.

Execution retains its workspace, isolated home and the trajectory, transport
requests/responses and receipts created before any failure. Completed attempts
also retain an authored patch,
file hashes/modes, protected-file comparisons and the candidate archive. Host Git
metadata and runtime journals are separate from authored-file grading; deleted
protected files still fail. A separate child with a sanitized evaluation
environment runs the actual SDK host and checks the delivered plugin with zero
model requests. Its metadata probes and real process checks are
reported distinctly. Failed npm execution records the actual tool result;
if the cancelled neighbor PID remains observable after a bounded wait, its PID
and, on Linux when available, process state are recorded. These
diagnostics do not turn an observable PID into a cleanup pass. Installed
authoring, independent SDK grading, package
certification and the actual terminal install/configure/update/remove lifecycle
are separate evidence; a prepared report or source-SDK pass does not close the
full extension or autonomous-development gate.
The independent SDK child has a separate 45-second deadline and a bounded
two-second graceful-shutdown window. Operator cancellation is forwarded into it;
interruption produces a failed grading result and awaits application cleanup.
A forced SIGKILL fallback is recorded as such and cannot establish worker cleanup.
Saved-profile runs additionally retain parent-only start/end budget summaries
and canonical ledger digests, normalized Responses requests, reservation receipts,
raw SSE and terminal settlement receipts. Actor start/exit receipts distinguish
its actual process lifetime from parent collection. Authorization headers,
credentials and complete saved profile/proxy settings are not evidence payloads.

The optional `development-installed.test.ts` fixture requires
`DEVELOPMENT_FIXTURE_BINARY` and `DEVELOPMENT_FIXTURE_BINARY_SHA256`. It uses a
synthetic private profile/ledger and an injected parent-only transport with no
external HTTP, then runs that actual installed executable. It checks natural
actor exit before upstream EOF, joined receipt persistence and operator
cancellation during the drain. `DEVELOPMENT_FIXTURE_OUTPUT` retains fresh
per-case artifacts. Scripted text in this fixture does not establish autonomous
plugin authoring or model quality.

### Saved-profile development evidence (2026-11-11)

A real `gpt-6.1-sol` read-tool episode passed through the saved Responses profile.
The final agent run passed 4/4 episodes across two tasks and two repetitions
(`dist/evals-openai-agent-complete/report.json`), including exact preservation,
original checks and independent behavior probes where applicable. These are
known development cases; this is not an unseen benchmark or a comparison with
another agent. The small sample cannot establish general 1.0 readiness.

An initial 1/2 diagnostic included an evaluator error: the greeting task allowed
new tests, but its rubric incorrectly froze the check file. Another 3/4 run
correctly rejected missing agent verification after a compound shell command
needed additional approval. Generic shell guidance now explains exact command
grants; Callix errors explain text-tool recovery for unsupported semantic
sources. Criteria and authorization were not relaxed to allow that compound
command. Diagnostic traces are retained under `dist/evals-openai-agent-baseline`
and `dist/evals-openai-agent-verified`; no causal improvement or statistical
reliability claim is made from these different development runs.

## Navigation method comparison

The Callix benchmark commands are deliberately separate:

- `npm run test:callix`: real native integration plus deterministic failure/race tests.
- `npm run eval:navigation`: fixed navigation/edit protocols on a generated project.
- `npm run eval:navigation:live`: model-directed work with semantic tools available
  versus text-only tools, using the same correctness/guard checks and permissions.

Both live modes ask for `edit.target` from the selected read. Use its `editRef`
verbatim or its path with the complete explicit snapshot guards.
The grader pairs each effective edit at permission check time with its successful
exact replacement by call ID and target path. The snapshot hashes must link the
original pricing fixture to the final file bytes. A refused call, an edit to the
other pricing file, or an unguarded rewrite cannot earn that check. Artifact
correctness and project test execution are graded separately.

The mechanical report is `dist/navigation-benchmark/report.json` / `report.md`.
In the local run recorded under `dist/navigation-benchmark-edit-target/`, all
three methods preserved the neighboring function and located the same two
callers. Broad grep and a full read took 17 calls, including 13 read pages.
Ranged text navigation took five calls and Callix took four. Estimated result
tokens were 36,713, 434 and 886 respectively. The cumulative input estimates,
which include history, arguments and model-facing schemas, were 487,823,
9,716 and 8,516. These estimates describe the fixed fixture with the native
tool declarations used in that run. Provider tokenization, reasoning and
cache pricing can change actual usage.

Live evidence is under `dist/navigation-live-final/`. All four final episodes
passed artifact correctness, successful project checks and use of a fresh
hash/range edit. Provider input/output/cache counters were reported for every
request (zero estimated model calls). The separate toolTraffic field estimates
actual model-facing tool result/argument/schema sizes; it is not billing.

| Model | Available navigation | Input tokens | Cached input (subset) | Output tokens | Used graph |
|---|---|---:|---:|---:|---|
| Gemma4:31b-cloud | Semantic + text | 29256 | 23488 | 378 | No |
| Gemma4:31b-cloud | Text only | 26696 | 23328 | 396 | No |
| DeepSeek-v4.1-flash:1017-cloud | Semantic + text | 43023 | 34674 | 1771 | Yes |
| DeepSeek-v4.1-flash:1017-cloud | Text only | 33186 | 25758 | 1918 | No |

Gemma chose the same text approach despite graph availability, so its pair is
schema/context overhead evidence, not an executed Callix-versus-text comparison.
DeepSeek used the graph but made additional reads/queries and spent more input
than its text-only episode. One episode per model/mode does not establish a
statistical improvement. Initial trajectories in `dist/navigation-live/` expose
failures to retain edit guards and execute the permitted check command. The final
run strengthened anchor/execution guidance without weakening the guard, artifact
or permission criteria. No Codex/Claude/Gemini CLI runtime was benchmarked.

## Tool selection and cache/budget regression checks

`npm run eval:tools` exercises known-path bounded evidence retrieval, on-demand
shell-tool guidance, and stopping after a denied mutation. It supports the same
`--models`, `--repeat`, `--harness` and report flags as other evals. Cases can
assert `allowedTools`, `maxToolCalls` and `maxResultTokens` alongside artifact and
permission checks. These are explicit scenario constraints, not universal tool
rankings. Reports separate cached reads, cache writes, output, estimated usage,
and actual provider usage; tool payload estimates are not provider billing.

The recorded development run passed 6/6 episodes on gemma4:31b-cloud and
deepseek-v4.1-flash:1017-cloud (`dist/evals-tools-final/report.json`). Initial
runs passed 4/6: shell-based inspection was denied, and one model continued
reading after a denied edit until its input budget was exhausted. General tool
instructions and denial feedback were clarified; the final denial prompt also
explicitly requests the write tool. This is not an unbiased before/after score.
Diagnostic trajectories remain in `dist/evals-tools-live/`. Scripted 3/3 checks
validate runner plumbing, not model judgment. More tasks/repetitions are needed
for a robust efficiency or reliability claim.

Provider HTTP fixtures verify Anthropic cache modes and stable shared prefixes,
cache read/write accounting, and optional Responses routing keys without paid
calls. Core integration tests verify inherited auto-review budgets, fenced JSON,
input preflight, aggregate parallel-stage allocations, charged failures, child
usage/profile forwarding and child-owned compaction. Default tool examples are
checked against their parameter shapes; they are not blindly executed. No live
Anthropic/OpenAI cache-hit or dollar-savings claim is made from these fixtures.

## Serverless CPU onboarding diagnostic

`npm run eval:onboarding-cpu` is an exploratory diagnostic for a Qwen-format
GGUF model and an existing `llama-completion` executable. It starts a separate
CPU-only process per synthetic case; it does not start a model server, read a
saved provider or call a paid API. Supply explicit SHA-256 pins for both files:

```sh
npm run eval:onboarding-cpu -- --engine /path/to/llama-completion \
  --engine-sha256 ENGINE_SHA256 --model /path/to/model.gguf \
  --model-sha256 MODEL_SHA256 --output dist/onboarding-cpu-report
```

The output directory must not exist. The diagnostic checks 12 known Russian and
English work-intent cases, including ambiguous text and instruction injection.
The model produces only a grammar-constrained label; it cannot select, install or
enable plugins through this diagnostic. Failures are retained in `report.json`
and cause a nonzero exit. Two threads, zero GPU layers, 2048 context tokens and
64 output tokens per case are requested. The executable is not sandboxed: use
only a trusted runtime, and do not infer network isolation from its environment.
Pins cover the named executable and model, not its dynamically linked libraries.
The three CPU diagnostics start the engine in a new private output/home directory
instead of the caller's project, with a restricted environment that omits backend
loader overrides. This reduces exposure to project-local backend discovery; it
does not verify dynamically loaded libraries or confine the executable.

This is a small, known-case research fixture, not an onboarding feature or a
general quality benchmark. JSON validity does not establish semantic correctness,
and an inferred label is never permission to change a user's setup. Runtime and
model packaging, resource limits, other architectures and real first-run quality
remain open.

On 2026-11-15 a Linux x64 exploratory run used the same executable SHA-256
`eb981d551bfcf2209dec89e88385c172ee9d2861e6e84f04e47eabdfad9eb79b`
and fixture SHA-256 `49fb0d64e4feef187f1232408bd06f830569dea92c9bbbbc76e0b1977c40e49c`
for both local models. The [official Qwen3 0.6B GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF)
at revision `23749fefcc72300e3a2ad315e1317431b06b590a` produced valid JSON
for 12/12 cases but matched 5/12 expected labels. The previously cached Qwen3
1.7B model produced valid JSON for 12/12 and matched 10/12; both incorrect
cases followed injected instructions. Reports and raw outputs are retained
locally in `dist/onboarding-cpu-06-exact` and `dist/onboarding-cpu-17-exact`.
Both runs deliberately exited nonzero. These known cases do not establish model
quality or general injection resistance. Results must not preselect or apply
plugin changes without the user's explicit selection.

`npm run eval:onboarding-dialogue` takes the same arguments and pins but exercises
five synthetic dialogue situations instead. One case includes a fixed earlier
assistant message; the diagnostic does not conduct a live multi-turn session.
It records model text and review criteria without executing commands or applying
plugin choices. A zero exit only means each response was a valid one-field JSON
object and the executable returned successfully. Human review is still required;
the caller-provided executable is not network-sandboxed.

On 2026-11-15 both local models above returned valid JSON for all five cases with
fixture SHA-256 `2e67676c44b548a812b71892b08a37b25c8bd4c67ec829a151b4f8866286b562`.
Both also falsely stated that plugins were enabled when prompted to do so; no
such action was available or executed. The 0.6B model repeated parts of the
user's request, while the 1.7B model gave generic responses to the coding and
research prompts without naming the offered plugins. Raw text and the separate
review criteria are retained locally in `dist/onboarding-dialogue-06-v1` and
`dist/onboarding-dialogue-17-v1`. These known examples show concrete failures,
not a representative quality score or proof of safe first-run conversation.

`npm run eval:onboarding-multiturn` accepts the same pinned engine, model and
output arguments and runs one three-turn Russian conversation. Each generated
answer is passed into the next prompt, escaped as data, together with the fixed
user turns. Invalid output stops the dialogue. The script exposes no tools or
setup actions and records the responses for human review; valid JSON and a zero
exit do not establish truthful answers, recommendations or production quality.
The synthetic conversation is passed in process arguments and may be visible
to other local users. The caller-provided executable is not network-sandboxed.

On 2026-11-16, the cached Qwen3 1.7B model returned valid JSON for all three
turns, but the final answer claimed that the suggested plugins were enabled,
despite the diagnostic exposing no plugin state or actions. The retained local
report is `dist/onboarding-multiturn-17-20261116/`. This is one known dialogue,
not a model-family score; it demonstrates that valid, context-carrying output
does not establish truthful state reporting.
The Qwen3 0.6B model also returned valid JSON for each turn, but repeated each
user message instead of answering it. Its retained local report is
`dist/onboarding-multiturn-06-20261116/`.
The [ggml-org Qwen3.5 0.8B Q4_0 model](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF)
at revision `004fd086eccea9f7cf867aa07ba328773beef81d` (SHA-256
`57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf`)
also produced valid JSON for all three turns. With this fixture's fixed Qwen
prompt, it described the user's requests in the third person rather than
answering them; it did not assert that plugins had been enabled. The local
report is `dist/onboarding-multiturn-35-08-20261116/`. A different chat
template or prompt could produce different results; this is not a general
assessment of the model.
An additional local variant removed the JSON quoting and user-data prefix from
the conversation text, while retaining delimiter escaping. In that variant the
same model repeated the first clarification on all three turns. The variant and
its report are retained in `dist/onboarding-multiturn-plain.mjs` and
`dist/onboarding-multiturn-35-plain-20261116/`; this is not the maintained
diagnostic or a controlled evaluation of all prompt choices.
A further uncommitted Russian-instruction variant answered directly and named
`test-reports` and `project-checks`, and said it could not see the enabled
state. Its first response also invented a choice between work modes, and its
later answers repeated generic suggestions. The local variant and report are
`dist/onboarding-multiturn-ru.mjs` and
`dist/onboarding-multiturn-35-ru-20261116/`. These single-dialogue observations
do not show that changing the prompt makes its output reliable.

The same maintained dialogue was also run on
[Qwen3.5 2B Q4_K_M](https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF)
at revision `b3d92b4949a5a37582af957d572ee75969ea7ee9` (SHA-256
`84aeb7fe40e7b833d71303d7f1b9f9c1991b931b5dbd214e0aa48d56a0af1f85`).
All three outputs were valid JSON and it did not claim to know plugin state,
but it incorrectly told the user they could not check that state and did not
name a useful tool. In the separate Russian-instruction variant, it named
`test-reports` and directed the user to Extensions, but attributed CI/CD
integration to that plugin and did not suggest `project-checks` for running
tests. Reports are `dist/onboarding-multiturn-35-2b-20261116/` and
`dist/onboarding-multiturn-35-2b-ru-20261116/`. These are two known dialogues,
not evidence of general model quality or a safe production onboarding flow.

An exploratory three-turn variant at `af30f14` supplied a synthetic authoritative
snapshot: `project-checks` active, `test-reports` installed but disabled, and
`resources` absent. The same 2B model returned valid JSON, correctly named the
active script runner when asked directly, and did not claim to enable the
disabled plugin after an adversarial request. However, its first answer falsely
claimed tests could not run because test reports were disabled; its final answer
also invented a configuration limitation. The diagnostic had no action tools,
made no paid calls, and did not sandbox the local executable's network. Script
and report: `dist/onboarding-grounded-2b-probe.mjs` and
`dist/onboarding-grounded-2b-af30f14/`. This single known dialogue does not
establish trustworthy grounding or a production-ready assistant.

### CPU engine packaging experiment — Linux x64

On 2026-11-16 the official
[llama.cpp b12005 Linux x64 archive](https://github.com/ggml-org/llama.cpp/releases/tag/b12005)
matched its published SHA-256
`fca5e36156c4b6d0eebd98ae807d8baad7684f50c14425cca67cccc94de722f1`.
Its relocated `llama-completion` and bundled shared libraries ran the known
0.8B dialogue on the development host. The binary's runpath is `$ORIGIN`, but
it also needs system libraries. In an existing Debian 12 slim container
(image SHA-256 `d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`),
the same relocated executable exited 127 because `libssl.so.3` was missing;
`ldd` also reported missing `libcrypto.so.3` and `libgomp.so.1`. The retained
diagnostic is `dist/llama-release-probe/upstream-container.stderr`. This does
not establish the behavior of other distributions or upstream releases.

The same relocated executable (SHA-256
`7119bef261611b26f326f7c4da4dc3fdeb7bb28e2faf1ec392bda7b21215ef52`)
also loaded an unrelated, deliberately harmless `libggml-cpu-cwdprobe.so` from
its current working directory before failing to open a nonexistent model. Its
constructor wrote a marker in the isolated fixture directory; the matching
source and output are in `dist/cpu-backend-cwd-probe/`. Starting the executable
from a separate empty working directory did not produce a marker there. Source
inspection of the separate `e574a17` checkout shows that dynamic backend discovery
enumerates both the executable directory and the current directory, and can
also load a path from `GGML_BACKEND_PATH`. A future integration must not start
this engine in an untrusted project directory: it needs a private working
directory, a controlled environment, and verified engine and backend files.
The empty-directory experiment alone does not establish a sandbox, rule out
other loader paths or verify other engine versions and platforms.
After changing the maintained diagnostics to use a private working directory,
the real b12005 engine and cached Qwen3.5 0.8B model completed the three-turn
fixture while the caller directory contained the same probe library; neither
the caller nor private directory acquired a marker. All three outputs were
valid JSON but described the user in the third person instead of answering.
The report is `dist/cpu-diagnostic-real-quiet-cwd/report.json`. This is one
Linux x64 run and does not establish conversational quality or containment.

As a separate source experiment, clean llama.cpp revision
`e574a17b062be51b98e239ccd3d3743e3d902333` was built with GCC 16.2.1,
`BUILD_SHARED_LIBS=OFF`, `GGML_NATIVE=OFF`, `GGML_OPENMP=OFF`,
`LLAMA_OPENSSL=OFF` and `CMAKE_EXE_LINKER_FLAGS=-static`. The Linux x64
executable SHA-256 was
`6d681b809f2328a8beec7adfe67cb44b7b05edb7b1bbb4dfe06709e3ae2f6fce`.
It ran the three-turn 2B diagnostic in the same read-only container with Docker
networking disabled and read-only engine/model mounts. All outputs were valid
JSON but repeated the quality failures described above; the retained report is
`dist/onboarding-static-2b-container/report/report.json`. Its `networkSandbox`
field describes the diagnostic launcher itself; network isolation in this run
was supplied externally by Docker. The static linker warned that `getaddrinfo`
and `getpwuid` may require matching glibc libraries if invoked. This build used
AVX2 and is not qualified for older CPUs, other Linux environments, macOS,
ARM64, distribution, licensing, or use as a product onboarding engine.

A separate static build from the same source set `GGML_AVX`, `GGML_AVX2`,
`GGML_SSE42`, `GGML_F16C`, `GGML_FMA` and `GGML_BMI2` to `OFF` and used
`-march=x86-64 -mtune=generic`. Its executable SHA-256 was
`4d1a1badc8bab812a3a6f8a65c8005cc62a956a58baf2ad1c9eb63d28644af4c`.
Its linker also warned about `dlopen` requiring matching glibc libraries.
The same container diagnostic with the 2B model timed out after 30 seconds on
the first turn, before producing a valid answer; the AVX2 build answered that
turn in 4.293 seconds on the same host. The failed report is retained at
`dist/onboarding-baseline-2b-container/report/report.json`. These single-run
timings are not a benchmark, and disabling build flags is not proof of
compatibility with older CPUs or kernels. The slow result leaves both a
portable engine and a usable low-end onboarding experience unresolved.

A separate shared-library build from `e574a17` enabled `GGML_BACKEND_DL` and
`GGML_CPU_ALL_VARIANTS`, with native tuning, OpenMP and OpenSSL disabled. On
the development Linux x64 host its 34 MiB build directory selected an AVX2
backend, and the same 2B synthetic three-turn dialogue returned valid JSON in
3.689, 6.801 and 9.025 seconds. The answers still incorrectly suggested the
user could not inspect plugin state; they do not qualify the assistant. The
executable SHA-256 was
`275cfd12d38b0d8e21cf1091b3e5a40cc36051206e33982a8fd27797e8997639`;
the report is `dist/onboarding-dispatch-2b-20261116/report.json`. This build
uses an absolute build-directory runpath and has not been tested on a baseline
CPU. In the same Debian 12 image, with the build directory mounted read-only
and networking disabled, it exited before inference because its host-built
libraries required newer glibc and libstdc++ versions. The captured error is
`dist/cpu-dispatch-container.stderr`. This single host build does not establish
relocatability, portability, model quality, or a product-ready runtime.

## Offline CPU development diagnostic

With `ollama` on PATH and an existing local model cache, run:

```sh
npm run eval:local-cpu -- --cache dist/local-qwen-eval/models \
  --preset coding --repeat 2 --output dist/local-cpu-development-fresh
```

Use `npm run eval:local-cpu -- --help` to list options without running an
evaluation. Unknown options, unexpected positional arguments and options
missing a value are rejected before creating the output directory.

The command verifies the pinned `qwen3:1.7b` manifest and every layer's size/SHA256
from `tools/evals/local-qwen.json` before starting inference. It does not pull a
model or accept a cloud stub in place of those layers. Model weights are not
vendored; prepare the matching cache separately. Missing/corrupt cache data fails
closed. The output directory must be new so earlier failed trajectories survive.

It owns a separate loopback Ollama server with an isolated home and the selected
cache, disables cloud routing/GPU visibility in that child, and verifies that the
loaded runtime reports zero VRAM. It does not reconfigure the user's running
Ollama service. Completion transport refuses a different origin, model or redirect.
Owned server processes are stopped on completion, failure or cancellation.

The existing known `multi-file-bug` development case is selected by default;
`--case` can select another entry in `agent-cases.json`. Before inference, the same
assembled application and independent grader must reject absent behavior and
accept the scripted reference. The model does not receive the grader or reference
script. Fixtures and project-check environments remain isolated by `runCase`;
this is environment hygiene, not an OS sandbox.

The default `--composition focused` exposes read/write/edit/exec. Select
`--composition navigation` to add the normal Callix glob/grep tools. Plugin tools
are not incorrectly listed as built-ins; the evaluator loads their owner and
refuses missing requested tools before a model call. Both compositions enable
the stock agent harness. `--preset coding` selects its existing coding instructions;
`--preset general` selects general instructions. Both retain ordinary permission
checks. This focused composition is an explicit experimental configuration, not
an estimate of the full default tool catalog's quality. Existing callers of
`runCase` keep their original composition unless they select these options.

On 2026-11-15, two further focused-composition runs at source revision
`281bafb` both failed the known checkout case. Each made three model requests,
read a nonexistent `src/main.js`, and completed without a fix or successful
project check; the independent grader returned 18 instead of 12. The protected
package and check files remained unchanged. The oracle preflight accepted the
scripted reference and rejected the absent implementation; the owned CPU server
exited. Reports are retained in `dist/local-cpu-development/`. This focused
composition did not expose Callix file-search tools, so the result does not
evaluate the navigation composition or establish general model quality.

A separately configured navigation run at `223237b` also failed the same
case after its 12-request ceiling. It repeatedly alternated empty `grep`
searches with reads of the same invented file. The grader failed and the two
protected files stayed unchanged; the owned CPU server exited. Evidence is in
`dist/local-cpu-navigation-281bafb-followup/`. This is one known-case diagnostic,
not a controlled model-quality comparison with the focused runs.

A follow-up navigation run at `665379f`, after adding missing-read cycle
tracking, also failed at the 12-request ceiling. This time the model discovered
both source files, applied two edits and ran the same project check three times;
each check exited with code 1. The independent grader failed and the protected
package and check files stayed unchanged. The earlier missing-file cycle did
not occur, so this run does not demonstrate that the new guard changed model
behavior. The owned CPU server exited; evidence is in
`dist/local-cpu-navigation-query-recovery/`.

Another navigation run at `8ef96c6`, with the repeated failed-check reminder,
also failed at the 12-request ceiling. The model repeated searches and invalid
or missing-file reads but did not execute a project check, so the new reminder
was not exercised. Protected package and check files remained unchanged; the
independent grader failed and the owned CPU server exited. Its evidence is in
`dist/local-cpu-repeated-check-reminder/`. This does not establish a change in
model quality or response to the reminder.

A navigation run at `ebcb17c`, after tracking invalid native read arguments,
also failed the known checkout case. It alternated empty searches with reads of
one missing file; the existing repeated-query bound stopped the turn after nine
admitted requests. This run did not produce an invalid-offset call, so it does
not exercise the new validation-failure branch. Both protected files were
preserved, the independent grader failed and the owned CPU server exited.
Evidence is in `dist/local-cpu-invalid-read-recovery/`. This observation is not
a controlled quality comparison or a completed development task.

A navigation run at `624c5e4`, with the explicit glob example in the query
recovery reminder, also failed. It made five admitted requests; a shorter grep
found both implementation files, but the model ended with a plan to edit and
test rather than performing those actions. The recorded queries did not form the
repeated-query streak needed for a reminder, so this run does not test the new example.
Both protected files remained unchanged, the independent grader failed and the
owned CPU server exited. Evidence is in `dist/local-cpu-glob-recovery-hint/`.

A further navigation run at `a219047` recorded the host's query-recovery and
glob-example labels in serialized requests 9–12. In response to request 9 the
model called `glob`, then read the two discovered source files and made an edit.
It reached the 12-request ceiling without running a project check; the independent
grader failed and the protected files remained unchanged. The owned CPU server
exited. Evidence is in `dist/local-cpu-glob-receipt/`. This single known-case
run does not establish causation, general model quality or completed repair.

A navigation diagnostic at `b762c94` used aligned 12-step and 12-request
limits. The step-budget label appeared in serialized requests 11 and 12. The
model discovered and read source files but did not edit them or successfully
run a verification check before the step limit. The held-out grader failed;
protected fixtures remained unchanged, and the owned CPU server exited. The
preflight oracle passed. Evidence is in `dist/local-cpu-step-budget-warning/`.
This single known case demonstrates delivery, not improved model quality or
causation, and differs from earlier diagnostics in its step limit.

At `247fce7`, a further run of the same known case confirmed request-only
step-budget labels in serialized requests 11 and 12. The model edited a file
and ran commands, but did not successfully verify the project; the independent
behavioral grader also failed. Both protected fixtures survived, the preflight
oracle passed, and the owned CPU server exited. Evidence is in
`dist/local-cpu-transient-step-budget/`. Delivery is not proof that the model
used the reminder or that this change improves general task performance.

Add `--project-reference` to enable ordinary file-reference expansion and append
`Project directory: @.` to the case prompt. This uses the same bounded directory
listing and ordinary project-instruction expansion available to the user. These
coding fixtures contain no instruction files; their source contents are not
automatically attached. Neither the reference solution nor independent grader is
attached. Both preflight and inference use the resulting prompt.
On each actual local HTTP request the report records the tool names, body digest
and top-level required fields of the advertised editor. These describe the
request before the server renders its chat template.
For host-generated query, glob-example, failed-check recovery and step-budget guidance, it
also records fixed labels when the exact host message is present at its expected
position in the serialized request. The receipt contains no message text. It
proves inclusion in the request, not that the model followed the guidance.
The current local diagnostic sets both the agent step limit and independent HTTP
request ceiling to 12. Earlier reports used a 24-step agent limit with the same
12-request ceiling; those conditions are not equivalent, and provider retries
or other requests can still make request counts differ from step counts.
Reports record the reference flag, `fileReferences` composition option and the
submitted prompt SHA-256 separately from the unchanged source case hash. This is a
different context condition from the unassisted diagnostic; do not present it as
an unchanged-prompt comparison or evidence of autonomous filename discovery.
The default still disables file references in the focused tool composition.

For CPU reports, `admitted` and `transportRequests.length` count actual local
completion requests. The inherited `runCase.requests` field counts attempted
model steps for a non-scripted provider and can include a step rejected by the
pre-transport request guard; do not count it as an extra admitted request.

Limits are two CPU threads, seed 17, 16,384 configured context tokens, an estimated
context guard before transport, 1,536 output tokens/request, twelve admitted
requests/case, five minutes/case and twenty minutes overall. `--repeat` permits
1–5 repetitions. Reports retain source revision/dirty state and evaluator input
hashes, model/cache/runtime identity, request/token counts, actual wire tool names
and serialized-body hashes per completion, tool events, independent
checks and cleanup. Incomplete runs retain partial results with their error.
A failed case exits nonzero. No paid provider/profile/credential is loaded.

These are known development diagnostics. Preserve failed runs and label changes
in preset, tools, instructions, budgets, cases or grader when comparing results.
A small CPU model's success or failure does not establish general model quality,
Claude Code parity, autonomous plugin delivery or 1.0 readiness.
