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
uv pip install --python .venv-harness2/bin/python -e /path/to/harness2
.venv-harness2/bin/python tools/evals/harness2_adapter.py --check
```

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
task JSON with `prompt` and `files`. Grading stays outside that workspace.

```sh
.venv-harness2/bin/python tools/evals/harness2_adapter.py \
  --tree path/to/harness-tree --task path/to/task.json \
  --model gemma4:31b-cloud --timeout 120
```

Each rollout runs the real `compositor --output-format stream-json`, bounds its
execution time, and retains trajectory/execution metadata. On timeout, the whole
process group is stopped. Rollout directories remain available for artifact
inspection; the staged harness is removed after a CLI run.

Completed checks: protocol/materialisation validation, the upstream deterministic
demo in both modes (2 tasks, 0 failures), and an end-to-end Compositor/Gemma
rollout that verified a token read from a file. These are not JobBench/LAB/
WorkBuddy scores or measurements of gains from recursive optimization with live
models. Those require a separate BenchAdapter, proposer/selector channel, dataset,
and budgets from upstream. The adapter can connect to Harness² orchestration
through its protocol interface; the upstream CLI's built-in `--substrate cx/oc`
options do not select Compositor automatically.

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
