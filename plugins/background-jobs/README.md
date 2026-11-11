# Background jobs

Start a long command through `exec` with `background:true`. With this plugin
enabled, completion is delivered automatically: the current turn can finish,
the model connection closes, and the user can keep chatting. An OS process-close
event triggers delivery; there is no model-driven polling or waiting model call.

```json
{"command":"npm run build","background":true,"timeoutMs":3600000}
```

`exec` returns a `shellId`. The default subscription mode is `wake`: after that
shell completes, one deduplicated follow-up runs in its originating agent core.
It waits for the current turn; nearby completions can share a follow-up request.
A user interruption pauses queued follow-ups until the user continues. Agent
follow-ups use agent provenance and normal model/token/permission limits.

The completion message contains only shell ID, reason and exit code. It never
includes command output, command text or environment variables. The agent can
read output with `exec_output` and stop a process with `exec_kill`, through their
usual permission checks. Process output remains untrusted data.

## Activate

Requires the host background-job/follow-up contracts introduced in event catalog
0.20.0. Use this source checkout or a host release containing these contracts;
the older v0.4.0 distribution needs a host update as well as the new plugin.

```text
/extensions install background-jobs@agent-compositor --project
/extensions enable background-jobs --project
/reload
```

Like other filesystem plugins, this package starts inactive. Existing `exec`
background execution remains available independently of this plugin.

## Subscriptions

The `background_jobs` tool manages subscriptions; it does not spawn commands or
kill them outside the normal shell tools.

```json
{"action":"list"}
{"action":"status","id":"<shellId>"}
{"action":"subscribe","id":"<shellId>","mode":"notify"}
{"action":"unsubscribe","id":"<shellId>"}
```

Lists return the latest 20 job summaries by default, with `total` and `truncated`.
Use `limit` (1..128) when a larger history is needed. Output buffers are excluded.

`notify` posts a user notification without starting a model request. Unsubscribe
stops future delivery; it does not stop the command or undo an already dispatched
follow-up. Cancelled commands only notify, rather than automatically restarting
an agent that the user stopped. Timeouts/nonzero exits are reported truthfully and
can wake the agent to handle failure. Subscribing after a fast completion replays
its metadata; repeated subscriptions do not duplicate a delivered completion.

Configure shared or private project settings through `background-jobs.json`:

```json
{"autoSubscribe":true,"mode":"wake"}
```

Set `autoSubscribe:false` for manual subscriptions, or `mode:"notify"` to make
notification-only delivery the default. Invalid configuration is reported.

## Ownership and limits

Jobs belong to the live originating core, including when several agents share a
project. Other cores cannot read or kill them by guessing a shell ID. The host
allows 16 concurrent shells per core, approximately 128 retained completed jobs,
and a deadline of 1..86400000 ms. The `exec` default deadline is 120000 ms; set a
larger value for a long build. Each stdout/stderr buffer retains its last 512 KiB
and reports truncation. These shells provide host execution, not an OS sandbox.

Subscription history retains 128 entries in version-1 session storage. Reload
reattaches pending subscriptions to live jobs. Invalid/unknown state is rebuilt
from live host metadata; commands are never replayed to reconstruct state. A
fresh process cannot recover an OS child it no longer owns: stale pending IDs
become unavailable. There is no historical release migration claim for 0.1.0.

Disabling/reloading the plugin revokes its callbacks and queued follow-ups.
Host-owned commands continue independently; a reload restores subscriptions to
live commands. Use `exec_kill` to cancel one. Session clear/end and application
close stop/drain owned process groups and discard pending subscriptions. Revoking
an attached workspace stops its running commands. Single-shot headless runs close
their jobs when the app exits; this feature does not keep a daemon alive.

Stopping the agent pauses accepted queued wakes until the next explicit prompt,
whether a job completed before or after Stop. It discards ordinary queued user
prompts. An already running follow-up is interrupted and is not automatically
restarted. A delivered wake receipt means the host accepted the follow-up, not
that the model has reviewed or completed the job. Conversation clear and
application close discard pending wakes; new jobs after clear can wake the new
conversation normally.

Delivery/storage errors are surfaced rather than retried in a model loop. Wake
receipts are bounded and deduplicated in the live core; process output is fetched
only when requested. No success/speed/token-efficiency claim about every model
follows from the deterministic delivery mechanism.
