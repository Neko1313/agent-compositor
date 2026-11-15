# Process resource monitor

`/resources` opens an independent live CPU/memory window. It does not expose an
agent tool, automatically invoke a model, run a subprocess, or read project files. It stays usable
while the main agent works. Enable the `resources` plugin through Settings or the
extension manager; invoke `/resources` to start sampling.

CPU is process CPU time divided by elapsed wall time. **100% means one busy core**;
multiple cores can exceed 100%. RSS is resident process memory; heap usage is the
JavaScript heap. Metrics include agents running inside the same process and
exclude child shell processes, external model servers and other applications.
They are not per-agent attribution or a machine-wide utilization estimate.

On Linux, **Snapshot children** separately measures currently live descendants
and sums their RSS. **Child CPU** also samples descendants while that tab is
active and shows an approximate CPU history; the first reading needs a second
sample. Both use procfs without a helper command and are unavailable on other
platforms. The CPU estimate compares matching process IDs and start times against
system CPU counters; it uses the same one-core 100% scale as the process graph.
It excludes the Compositor process itself. New or exited processes make the
interval incomplete, and processes that both start and exit between samples can
be missed without detection. CPU hotplug or unavailable counters leave an
interval without a value. Incomplete intervals are labelled and omitted from
the graph. A process that disappears or cannot be read, or the
limit of 512 descendants or 128 threads per process, also marks a reading
incomplete. RSS may count shared memory more than once. External model servers
that are not descendants remain excluded.

The CPU and Memory tabs show a scaled time-series plot of the latest samples with
numeric axes and units. Each `*` is a real observation. Sampling targets one second
between completed updates. The horizontal axis is sample order, not a promise of
exactly spaced timestamps. History retains at most 120 samples in memory; the plot
shows the newest samples that fit. Narrow windows reduce the plot width; use
Alt+f or PageUp/PageDown for the complete controls.

**Graphics** optionally adds a colored version of the same observations. Use
PageUp to reach it in a small window; the numeric text chart stays available.
Missing or incomplete intervals remain gaps, and the vertical scale follows the
same data as the text chart. Terminals without image support show an explanatory
text alternative. Graphics is off initially and is kept only for the current
plugin instance; switching it does not ask a model.

**Send latest sample to agent** explicitly queues the latest complete observation
for the current conversation. CPU and memory describe the Compositor process;
Child CPU is an approximate descendant interval. The request includes units and
these limits, not a per-agent or machine-wide diagnosis. A missing CPU interval
or incomplete child interval is not sent. The agent runs the request after its
current turn under normal permissions and budgets; interruption pauses queued
follow-ups until an explicit continuation. Closing or unloading the plugin can
revoke an undelivered request. This action can trigger a model request; opening
or sampling the monitor does not.

Pause/Resume freezes or resumes automatic measurement. Sample now takes a reading
while paused and retries a failed sample; on Child CPU it also reads descendants.
Clear history resets the in-memory
window. The first CPU interval after open/resume/hidden time is unavailable until
another reading; no zero is invented. Closing, hiding, disabling or unloading
stops sampling. Reopening keeps this process's samples; restart/reload starts
fresh. No samples or pause preferences are written to disk. Older hosts without
tabs receive a Switch chart action.

Child CPU history remains visible across pauses and tab changes, but its current
reading cannot be sent until a new complete interval has been measured after
resuming, showing the window or returning to the Child CPU tab.
Process CPU history is also retained, but its current reading is cleared on
pause, hide, reopen or counter failure; sharing waits for a new interval.

The plugin uses existing text-view and visibility contracts; the text plot
remains portable and the optional image uses the host's raster support.
