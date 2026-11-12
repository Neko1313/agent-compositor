# Process resource monitor

`/resources` opens an independent live CPU/memory window. It does not expose an
agent tool, invoke a model, run a subprocess, or read project files. It stays usable
while the main agent works. Enable the `resources` plugin through Settings or the
extension manager; invoke `/resources` to start sampling.

CPU is process CPU time divided by elapsed wall time. **100% means one busy core**;
multiple cores can exceed 100%. RSS is resident process memory; heap usage is the
JavaScript heap. Metrics include agents running inside the same process and
exclude child shell processes, external model servers and other applications.
They are not per-agent attribution or a machine-wide utilization estimate.

The CPU and Memory tabs show a scaled time-series plot of the latest samples with
numeric axes and units. Each `*` is a real observation. Sampling targets one second
between completed updates. The horizontal axis is sample order, not a promise of
exactly spaced timestamps. History retains at most 120 samples in memory; the plot
shows the newest samples that fit. Narrow windows reduce the plot width; use
Alt+f or PageUp/PageDown for the complete controls.

Pause/Resume freezes or resumes automatic measurement. Sample now takes a reading
while paused and retries a failed sample. Clear history resets the in-memory
window. The first CPU interval after open/resume/hidden time is unavailable until
another reading; no zero is invented. Closing, hiding, disabling or unloading
stops sampling. Reopening keeps this process's samples; restart/reload starts
fresh. No samples or pause preferences are written to disk. Older hosts without
tabs receive a Switch chart action.

The plugin uses the existing text-view and visibility contracts; its graph is
portable terminal cells, not a native image/video or OpenTUI implementation.
