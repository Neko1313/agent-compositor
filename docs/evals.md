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
A failed case produces a nonzero exit code. Add tasks with observable
results for new plugins; separate training examples and held-out cases with
`split`. Do not optimize a harness against test answers or copy grading data into
the execution workspace.

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
commands. Verification requires a successful `exec` result paired with the
matching tool call ID, exit code zero and the expected marker. An orphan result,
wrong command or unsuccessful exit cannot establish verification. Independent
behavioral probes still check correctness beyond that marker.

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

The mechanical report is `dist/navigation-benchmark/report.json` / `report.md`.
In the recorded fixture, broad grep + full read returned about 34880 heuristic
tokens, bounded text + ranged read 376, and Callix 834. All preserved the neighbor
function and resolved the same two fixture callers. Callix made four calls vs
five for text. Its cold navigation path took about 78 ms; warm symbol/caller
queries took roughly 2..6 ms. These single-machine timings are illustrative.
The repeated-input estimate also includes schema and argument cost; it excludes
unknown model reasoning, provider framing and cache pricing. Efficient text
navigation was cheaper on this small known-path task. Graph navigation should be
chosen for semantic identity/relationships, not imposed on every literal edit.

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

## Offline CPU development diagnostic

With `ollama` on PATH and an existing local model cache, run:

```sh
npm run eval:local-cpu -- --cache dist/local-qwen-eval/models \
  --preset coding --repeat 2 --output dist/local-cpu-development-fresh
```

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
