# Python workflows

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
