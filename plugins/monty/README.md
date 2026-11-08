# Monty sandbox provider

The repository's `npm ci` installs the pinned dependency as a plugin workspace.
The bridge needs Node.js (20+ for the SDK, 22+ for this repository), including
when the compositor is compiled with Bun. `AGENT_NODE_BIN` selects its executable.
For an independently copied plugin, run `npm ci --prefix plugins/monty --workspaces=false`.
The application loads the plugin without importing the native dependency;
Monty is started lazily for each execution. Missing dependencies return an
actionable tool error. Neither the core nor other plugins import Monty.

`run_python` supplies Python source and optional JSON inputs to
`service.sandbox.run`. The final expression is the output; `print` is captured.
The default backend uses the pinned pure-Monty worker from `@pydantic/monty`,
with no directory mounts, OS callback, shell, network or environment access.
This sandbox runs Python; it does not isolate arbitrary host shell commands.
Trusted TypeScript plugin modules still run on the host.

Defaults: 32 MB interpreter memory, 10 seconds interpreter execution per feed,
100 recursion depth, 1000 suspensions, no sleep, 64 KB captured print output,
and a 30-second wall deadline. Callers can set `timeoutMs` (100–300000) and
`memoryBytes` (1–128 MB). Limits apply to interpreter allocation, not the
complete host process RSS. RPC messages are limited to 1 MB and total worker
output to 2 MB. Timeouts and cancellation terminate the bridge's entire process
group, including the native worker on supported POSIX systems.

Trusted host callers may explicitly supply a `functions` record. Each callback
receives `(args: unknown[], signal: AbortSignal)`. Generated code can only call
these named capabilities. Callbacks must observe cancellation and enforce their
own permissions. They are process-local values, not a wire format.

The `workflows` plugin supplies `task` and `log`; task subagents use the normal
permission chain and inherit cancellation. Python does not gain shell access
from having a task callback. A child can request shell tools subject to the
ordinary permission gate; those tools still run on the host.

To replace Monty, implement `service.sandbox.run` in another provider plugin and
set `serviceProviders` in application configuration:

```json
{"serviceProviders":{"service.sandbox.run":"other-sandbox"}}
```

The contract returns `{value:{output,stdout}}` or `{deny:"reason"}`. Use
`disabledPlugins: ["monty"]` as well if the replacement supplies its own tools.
No installed provider means execution fails closed.
