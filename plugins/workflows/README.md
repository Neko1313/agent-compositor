# Dynamic background workflows

In the TUI, `/workflows` uses an explicit UI route and remains available while the
agent works. It does not enter the model prompt queue. The line-based interface
retains its prompt-command handler.

Ask the agent to create a workflow, then open `/workflows` to watch it. The
replaceable workflows plugin exposes `workflow_run` with start/list/status,
pause/resume/retry/stop. The tool and UI share the selected
`service.workflow.run` provider, including separately bundled releases.
Start returns immediately; the conversation stays usable.

New runs default to `completion: "wake"`: completion or failure queues one
follow-up in the agent session that started the run, after its current turn.
The parent can finish its turn or keep talking with the user instead of polling.
`completion: "notify"` only shows a user notification; `"none"` is silent.
Set this in start arguments or `workflows.json`. Explicit stop only notifies;
it does not automatically ask the agent to restart cancelled work. Pause is
not a terminal event. Retry/resume creates a new delivery generation and uses
the session that requested it. Run status exposes `generation`,
`deliveredGeneration` and any `completionError`.

The completion envelope contains run ID/status, never stage output. The agent
reads results through `workflow_run status` and treats them as untrusted data.
Delivery uses the host's bounded, deduplicated follow-up queue and normal agent
permissions/budgets. Interruption pauses automatic follow-ups until the user
continues, while already launched workflow stages keep progressing. No model
requests are spent merely waiting; worker execution and the completion turn still
consume their normal budgets. Unload/close cancels live workers and revokes
delivery. Old completed journals are not replayed as new notifications on restart;
interrupted runs require explicit resume. This feature requires an updated host
with `$.background()` and `service.agent.enqueue` support.

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

Current development hosts show a live semantic table of runs with state and
progress. Click a run or use Up/Down and Enter to expand it, then **Inspect stages**
to enter its stage table. **All runs** returns to the overview. **View** cycles
All, Running and Needs attention (paused, failed or stopped). Narrow panes stack
labeled fields; Alt+f opens a full-width table. Run and stage lists use pages of
100 items with Previous/Next controls, including workflows with 500 stages.

Click a stage to expand its agent ID, dependencies, prompt, output/error and retry
action. Only the selected stage includes its full detail payload; long prompts
and results are split into bounded lines rather than silently shortened. The
table shows current/last activity, attempts and accounted tokens (which can be
estimates). Closing the panel suppresses background redraws; `/workflows` reopens
it. **Legacy Python journals** opens the separate journal view; Refresh stays in
that view and **Dynamic workflows** returns. Hosts without `$.ui.supports('table')`
retain the earlier text interface. The new table uses catalog 0.27.

Pause stops new scheduling
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
workflows. Status accepts `waitMs` up to 30000 for bounded interactive inspection;
normal background completion does not require polling.

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

### Aggregate token budget

`workflow_run start` also accepts `maxTokensTotal` (default 120000; range
100..10000000). Parallel stages reserve disjoint portions of this allowance;
each receives at most `maxTokensPerStage` and the unreserved remainder. Reported
stage usage releases unused reservation. Failed/interrupted attempts without
complete usage conservatively consume their allocation, including on recovery;
retries do not reset the counter. `tokensCharged` is the persisted budget ledger,
not a provider bill. Exhaustion prevents another stage from starting. Start a
new run with an explicitly chosen budget after inspecting completed effects;
completed results are not silently revalidated or replayed as new work.

Choose configured cheaper stage profiles for bounded investigation where useful.
Their normal requests and context summaries keep the selected profile. Child
usage is included in the parent session's usage. Reviewer calls belong to the
parent reviewer budget; independent persisted agent sessions have separate
budgets. Provider caching is configured per profile (see
[agent features](../../docs/agent-features.md#prompt-caching-and-efficient-tool-use)).
