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
Tests use Vitest 5 and require Node >=22.12; local commands match CI. Cloud
credentials are unnecessary for CI. The GitHub Actions workflow itself was not
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
