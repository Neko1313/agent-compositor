# Quality checks and Harness²

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
regressions. A failed case produces a nonzero exit code. Add tasks with observable
results for new plugins; separate training examples and held-out cases with
`split`. Do not optimize a harness against test answers or copy grading data into
the execution workspace.

CI collects JUnit and Cobertura reports, enforces coverage floors (lines 80%,
statements 70%, functions 70%, branches 60%), validates the catalog, and runs the
deterministic eval and Bun proxy smoke checks. Reports are retained as artifacts.
Tests use Vitest 5 and require Node >=22.19.0. CI runs typechecking and the
coverage suite on the minimum Node 22.19.0 and primary Node 26; the deterministic
evals, proxy smoke checks and generated-artifact checks run once on Node 26.
Local commands match CI. Cloud credentials are unnecessary for CI. The GitHub Actions workflow itself was not
run remotely during this work.

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
and allowed project check commands. The model must execute a successful check;
a trusted grader outside the workspace then checks additional behaviors, without
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
