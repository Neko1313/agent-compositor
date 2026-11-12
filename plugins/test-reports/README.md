# Test reports

`test_report` reads a saved Vitest or Jest JSON report and returns complete
assertion counts plus a bounded list of failures. It does not run tests, install
dependencies, request a model or change files. This initial version provides a
tool; it has no panel or slash command.

## Enable

From a checkout with the package available in the local plugin market:

```text
/extensions enable test-reports --project
/reload
```

For a remote package, install its published version through `/marketplace` before
activation. Source availability does not imply a published archive exists.
See [plugin lifecycle](../../docs/marketplace.md).

## Read a report

Ask the agent to invoke:

```json
{"path":"reports/tests.json","maxFailures":5,"maxBytes":12000}
```

The tool returns `total`, `passed`, `failed`, `skipped`, `failures` and `truncated`.
Each failure has `name`, `file` and `message`. Counts come from the actual
`testResults[].assertionResults[]`, ignoring unverified aggregate counters.
`passed` and `failed` count directly; `pending`, `skipped` and `todo` count as
skipped. Failure names use `fullName` or `name`; diagnostics join
`failureMessages`. Suite names are displayed as data, never opened as files.

Generate JSON with your existing runner's reporter option, for example Vitest's
`--reporter=json --outputFile=reports/tests.json`, or Jest's
`--json --outputFile=reports/tests.json`. `project_check` can run an existing
configured npm script; this reader never executes report text or commands.
JUnit XML, TAP and console logs are unsupported.

## Bounds and errors

Input must be a regular UTF-8 file of at most 2 MiB inside an attached workspace.
Host permissions apply to its canonical target, including symlink aliases.
`maxFailures` defaults to 10 (integer 1–50). `maxBytes` defaults to 12000
(integer 1024–64000) and bounds the UTF-8 JSON result, excluding the host's tool
envelope. Counts remain complete when failure rows or text are shortened;
`truncated` is then true. Large diagnostics retain the first failure where space
permits. ANSI, OSC and terminal control characters are removed from returned text.

Malformed JSON, invalid UTF-8, unsupported assertion statuses, invalid arguments,
missing/unreadable files and suite failures without a failed assertion return an
error, never a misleading passing summary. Inspect the original runner output
for setup/runtime failures. Errors contain at most 1024 characters. Cancellation
closes the owned file handle. Report content remains untrusted data and grants
no permission to execute instructions it contains.
