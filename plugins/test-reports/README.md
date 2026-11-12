# Test reports

`test_report` reads a saved Vitest or Jest JSON report and returns complete
assertion counts plus a bounded list of failures. `/test-report` opens an
interactive report panel. Reading does not run tests, install dependencies,
request a model or change the report. Explicitly saving defaults changes only
the selected configuration scope.

## Enable

From a checkout with the package available in the local plugin market:

```text
/extensions enable test-reports --project
/reload
```

For a remote package, install its published version through `/marketplace` before
activation. Source availability does not imply a published archive exists.
See [plugin lifecycle](../../docs/marketplace.md).

## Inspect reports alongside the agent

Open `/test-report`, enter a path in the panel and choose **Read report** or
press Enter. Opening the panel does not read a file. The summary shows complete
counts; click a failure or press Up/Down to inspect its diagnostic. Tab cycles
Read report, Configure report defaults and Close; Enter activates the highlighted
action. Ctrl+U clears the panel path. Esc closes this panel; Alt+I returns to the
message composer. PageUp/PageDown scroll through long diagnostics and back to
the path field, including in a narrow split; scrolling does not change the path.

The panel and its configuration form work while the main agent is running.
Cancel read cancels only the report operation. Closing via the panel's Close
action, titlebar `[x]` or Alt+Q also cancels its operation. These actions preserve
the main agent and do not send the message draft. Previous results remain available during a new read and after a failed or
cancelled read, explicitly labelled **Last loaded** with their original path.
Reopening the panel retains results within the current session. A process restart
restores saved defaults and starts with no loaded report; read explicitly again.

**Configure report defaults** saves a starting path, maximum failures and maximum
output bytes for this project or all projects. Project settings override global
settings. The form reports the effective limits after saving. Unsaved path edits
stay local to the panel. Saving defaults resets the panel path to the effective
starting path but does not read it. Cancel leaves saved defaults unchanged.

```json
{"path":"reports/tests.json","maxFailures":10,"maxBytes":12000}
```

These are the defaults for scoped `test-reports.json`. Omitted tool limits use
the saved effective values; explicit tool arguments override them. The tool still
requires its own `path`. Unknown or invalid settings fail with an error and can
be repaired through Configure report defaults.

Use a host containing the canonical custom-tool path fix (`ef0c26b`) and host
scroll keys (catalog 0.24), both newer than public v0.7.3. The package's
alias-denial and paging checks require these host features. A plugin archive
alone cannot update an older host's permission handling or input routing.

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
