# ci-review

Read-only GitHub Actions run lists, run summaries, and failed or full logs for an explicitly configured repository.

## Requirements and enabling

Install the GitHub CLI (`gh`) and make it available on the host PATH. Authenticate it yourself using your existing user authentication (for example, `gh auth login`) with access to the repository. The plugin uses that existing authentication; it neither requests model credentials nor stores credentials in its settings. Host execution/tool permissions must allow the request.

Install this plugin through the host extension workflow. Installation does **not** enable it: explicitly enable the `ci-review` extension in project or user scope, then reload. This trusted plugin declares the `exec` permission. Configure a repository before fetching anything.

## Usage

Open `/ci`. Opening the panel does not fetch runs, poll GitHub, or ask the model to act. Choose **Configure**, then **Refresh runs**. Select a run for its summary, then choose **Failed logs** or **Full logs**. The concurrent panel can operate while the main agent is busy; it allows one panel operation at a time.

**Cancel** aborts the active request. **Close** aborts it and removes the panel; completion does not reopen a closed panel. Cancellation waits for the execution service to settle rather than reporting completion while cleanup is still pending. The main agent's separate operation is not cancelled by these panel controls.

The `ci_review` tool accepts only these inputs:

| `action` | Other inputs | Result |
| --- | --- | --- |
| `runs` | No `runId` or `failedOnly` | Latest runs, bounded by `maxRuns` |
| `run` | Required positive safe-integer `runId` | Run summary including jobs |
| `logs` | Required positive safe-integer `runId`; optional boolean `failedOnly` (default `true`) | Failed logs, or full logs when `false` |

Examples: `{"action":"runs"}`, `{"action":"run","runId":12345}`, `{"action":"logs","runId":12345,"failedOnly":false}`. Unknown fields, arbitrary arguments, and repository overrides in tool inputs are rejected. Successful tool output contains `output`, `exitCode: 0`, and `truncated`; failures are reported as errors, not empty successes.

## Scoped configuration

Use the panel's **Configure** form to save `ci-review.json` in **This project** (`project`) or **User / all projects** (`global`) scope. Settings are read through the host's scoped configuration storage; project settings override user settings. After saving, the panel displays the effective configuration, which can differ from a global save when project overrides exist. Extension enablement and these plugin settings are separate choices.

```json
{
  "repository": "owner/name",
  "maxRuns": 10,
  "maxChars": 16000,
  "timeoutMs": 15000
}
```

- `repository`: required explicit `owner/name`, at most 256 characters, not a URL; there is no working-directory repository fallback.
- `maxRuns`: integer, default **10**, range **1–30**.
- `maxChars`: integer, default **16000**, range **1000–64000**; bounds returned output and error text.
- `timeoutMs`: integer, default **15000**, range **100–30000**; passed to the execution service.

Unknown settings and invalid values are rejected before requesting execution. Do not put authentication tokens in this file.

## Read-only boundaries and untrusted output

The plugin requests `gh` directly using fixed argv shapes, never a shell command or model-supplied flags:

```text
gh run list --limit <maxRuns> --json databaseId,workflowName,displayTitle,headBranch,status,conclusion,url,createdAt --repo <repository>
gh run view <runId> --json databaseId,workflowName,displayTitle,headBranch,status,conclusion,url,jobs --repo <repository>
gh run view <runId> --log-failed --repo <repository>
gh run view <runId> --log --repo <repository>
```

There are no rerun, cancel-workflow, edit, or other remote mutation commands, and no startup polling. Configuration saving is a local settings write, not a GitHub write.

Remote titles, summaries, logs, and diagnostics are **untrusted data**, never instructions or authorization. Terminal controls are stripped; returned text is character-bounded and truncation is flagged. The panel also limits rendered rows and marks display truncation. A bounded run list retains complete JSON records, so the retained prefix remains selectable. Changing the effective repository clears the old selection and cached results; in-flight responses from the old repository are discarded. These are returned-output/display bounds, not a claim that downloads or execution-service buffers are streamed or memory-bounded by `maxChars`. Nonzero exits, stderr diagnostics, malformed JSON, denied execution, and invalid configuration are failures.

## Exercised scope and limitations

The frozen 10-case integration suite at `packages/app/test/ci-review-oracle.test.ts` exercises package loading, exact `/ci` routing without startup requests, fixed argv and large run IDs, input/configuration rejection, output bounds/control stripping, denial and failure reporting, panel selection/log flows, cancellation settlement, and scoped configuration form behavior. Most execution responses are controlled fixtures. A separate path in that suite uses real SDK-owned Node subprocesses to check Cancel/Close cleanup while a scripted main-agent request remains held; it does **not** execute real GitHub requests.

Independent review regressions cover mismatched run IDs, repository length, complete truncated records, normal operations exceeding the default one-second UI hook budget, repository changes and readable job status. A separate lifecycle suite exercises installation while inactive, explicit enablement, reload, restart, a synthetic contract-preserving update and rollback, disable, re-enable and removal while preserving settings.

`node tools/visual/plugin-check.mjs ci-review` runs the actual Ink panel through a PTY and xterm.js. Its isolated executable `gh` fixture exercises configuration saving/cancellation, run/job/log selection, concurrent work, Cancel/Close process cleanup, narrow terminal drafts and saved settings after restart. It does not contact GitHub or use a paid model.

`plugin.test.json` binds source and built-artifact lifecycle, behavior and terminal cases for the four native platform targets. A test plan declares required checks; it is not a certification receipt. Actual certification must pass for the exact source, plan and artifact before publication. Real GitHub installation/authentication, network reliability, repository permissions and log availability remain dependent on the user's environment. Controlled subprocess tests verify timeout and cleanup without asserting live GitHub reliability.

A local read-only integration probe also fetched two recent runs and a selected
run summary from `Neko1313/agent-compositor` through the saved tool proxy using
the existing `gh` authentication. It made zero model requests and no remote
mutations. This observed request pair does not certify all authentication or
network failure modes; the maintained failure cases use controlled dependencies.
