# Dynamic background workflows

Ask the agent to create a workflow, then open `/workflows` to watch it. The
replaceable workflows plugin exposes `workflow_run` with start/list/status,
pause/resume/retry/stop. The tool and UI share the selected
`service.workflow.run` provider, including separately bundled releases.
Start returns immediately; the conversation stays usable.

A plan contains named stages with self-contained prompts and `dependsOn` IDs.
Ready stages run concurrently, dependency outputs are passed as data, and a
`when: {stage, includes}` condition can skip a branch. An `expand: true` discovery
stage returns a JSON array of `{id,title,prompt}` items. They become worker stages;
existing downstream dependants join the entire new fan-out before running.
`workerPrompt` adds common constraints. The model authors the plan; the host
validates IDs, dependencies, cycles, expansion limits and resource budgets.

```json
{
  "action":"start", "title":"Audit and verify", "concurrency":2,
  "stages":[
    {"id":"discover","prompt":"Identify independent audit units","expand":true},
    {"id":"verify","prompt":"Cross-check the findings and report verified issues","dependsOn":["discover"]}
  ]
}
```

The UI shows run state, progress, current stage activity, attempts and accounted
tokens (which can be estimates). Click a stage to inspect its agent ID,
dependencies, prompt, output/error and retry action. Pause stops new scheduling
while active agents finish. Stop cancels active agents. Retry re-executes only a
selected failed/stopped stage and retains completed dependencies. A stage can
choose a configured provider `profile`; its context and token budgets are separate.

Private run snapshots live under `workflows/runs/<id>.json`, written atomically
with serialized updates. A process lease prevents duplicate ownership. After a
crash, running stages are marked pending and the run is paused; resume is explicit.
Completed stages are reused, not checked against subsequent repository edits.
Interrupted operations may have external side effects: inspect them before
retrying. Start a fresh run after material changes invalidate old results.

Defaults: concurrency 2 (maximum 8), 100 stages (maximum 500), 60000 tokens and
10 minutes per stage, at most 32 model steps per stage, four active workflows per
process. Override start arguments or `workflows.json` defaults with `concurrency`,
`maxStages`, `maxTokensPerStage` and `stageTimeoutMs`. Existing stricter agent
budgets and tool permissions apply. Workers cannot launch nested background
workflows. Status accepts `waitMs` up to 30000 to avoid rapid model polling.

This is an in-process background scheduler, not a detached operating-system
service. App shutdown/reload cancels active workers and preserves a paused run.
It never starts old work automatically. Saved results do not provide exactly-once
external effects or resolve conflicting parallel file edits; isolate independent
work or use separate worktrees.

## Python/Monty compatibility


Workflows now run through `service.sandbox.run` (Monty by default):

```python
files = await task("Inspect the repository files")
await log("Inspection complete")
review = await task("Review this result: " + files)
review
```

Use Python source with a final result expression, sequential `await task(...)`
calls, and optional `await log(...)` or `print(...)`. Every successful task is
recorded under `.agent-compositor/workflows/<hash>/journal.json`, alongside
`code.py`. Identical reruns replay the recorded prefix; a failed step is retried.
Sandbox execution has a five-minute wall deadline and Monty's interpreter limits.

Replay caches task results, not external side effects. Task prompts must remain
deterministic and self-contained; replay does not run the child again to check
whether the repository has changed. Old JS journals remain on disk for inspection
but are not executed. A Python-specific code hash prevents mixing languages.

`/workflows` opens the run list. Replay uses the saved Python source and the same
normal tool/permission flow. Install Monty as described in
[the provider setup](../monty/README.md), or select another compatible provider.
