# git-review

Read-only review of the current project's Git working tree and index. The
`/git-review` command opens a panel without calling a model or running Git until
an action is selected. Refresh status includes normal untracked files; Working
diff compares the worktree with the index; Staged diff compares the index with
HEAD. Close removes the panel without changing the conversation draft.

The model tool `git_review` accepts `action: "status" | "diff"` and an optional
boolean `staged`. Successful results contain `output`, `exitCode: 0`, and a
truthful `truncated` flag. Failures and denied actions remain errors. This package
has no staging, commit, checkout, fetch, arbitrary command or path interface.

## Requirements and activation

Git must be on PATH and the selected project must be a Git repository. Install from the development marketplace, then explicitly enable it in the
project:

```text
/extensions install git-review@agent-compositor --project
/extensions enable git-review --project
/reload
/git-review
```

Discovery alone does not activate code. An existing `enabledPlugins` or tool
allowlist must permit the package/tool. The host owns pane placement and normal
tool permissions. UI actions use the same `git_review` permission path as model
calls; opening the panel does not grant execution. Trusted plugins run in the
host and are not an OS sandbox.

Disable with `/extensions disable git-review --project`, then `/reload`.
Managed catalog installation, update, rollback and removal use the normal
Extensions manager; installation leaves the package inactive. The development catalog contains this package. Production archive publication
remains subject to the normal four-platform certification gates.

## Scoped configuration

Choose **Configure output** in the panel to set a project or global limit. Save
applies it to subsequent reviews; Cancel preserves the previous value. The form
shows the effective project limit after saving, including any project override
that masks a global value. The form
allows up to five minutes to answer. SDK callers can also configure
`git-review.json` with
`{"maxChars":16000}` in project or global scope. `maxChars` must be an integer
between 4000 and 64000. Invalid configuration fails visibly. Output truncation is
reported in both tool results and the panel, which additionally limits its rows.
There are no plugin credentials or automatic background subprocesses.

Git calls follow the operation and plugin cancellation lifetime and wait for
owned subprocess cleanup before returning. Calls have an eight-second timeout and use fixed argument arrays, no pager,
no optional index locks, no fsmonitor, external diff driver or textconv. Diff and
status ignore submodules. Output is Git's textual representation, including its
normal filename quoting; this is not a structured filename parser. Large output,
missing Git, cancellation and non-repository errors do not establish success.

## Verification

```bash
npm run plugin:check -- git-review
npm run plugin:test -- git-review
npm run plugin:certify -- git-review
npm run plugin:certify -- git-review --stage release
```

The plan covers actual status and separate staged/unstaged changes, index
preservation, disabled external Git drivers, output bounds, invalid settings,
permission denial and exact command routing. Lifecycle checks include inactive
installation, double reload, a fresh process, scoped settings, synthetic update
and rollback, disable and removal. Process cases exercise real cancellation,
timeout and disposal. UI certification uses the actual PTY for keyboard/mouse
operations, configuration save/cancel/restart and narrow-window draft preservation.
Archive certification repeats the checks against the exact installed artifact.

The last displayed review is session-local and remains available after closing
and reopening the panel; reload/restart resets it. Scoped output settings persist.
An already-open panel can review Git while the agent works, through the same
guarded tool path. **Cancel review** cancels only that review and waits for its
subprocess to stop; **Close** also cancels it and prevents completion from
reopening the panel. Ctrl+C in the focused panel cancels its active tool without
interrupting the agent. Ordinary `/git-review` command submission still queues
behind an active agent turn, so open the panel before starting that turn.
