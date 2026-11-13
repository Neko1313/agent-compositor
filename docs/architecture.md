# Architecture map

Compositor separates execution, extension contracts and rendering. Start with
the [package map](reference/packages.md) to locate implementations, then use
this page to follow the active product path.

## Application assembly

`packages/app/src/main.ts` selects terminal, plain or headless mode.
`buildApp` in `packages/app/src/build.ts` resolves configuration and storage,
composes model profiles and policy, loads explicitly enabled extensions and
creates the active `AgentCore`.

```text
Configuration + scoped selections + provider profiles
                         |
                      buildApp
                         |
          AgentCore + services + extensions
                 /                  \
           Headless                  AppUI
                                       |
                              Versioned JSONL protocol
                                       |
                                 Ink renderer
```

`packages/core` contains the active multi-turn engine. `packages/agent` is a
historical reference loop and pane demo. `packages/plugins` is a compatibility
facade over the shared `packages/loader` implementation.

## An agent turn

A submitted prompt flows through `prompt.submit`, input preparation, effective
tool selection and instruction composition. `service.agent.run` selects the
turn strategy. The default strategy streams the model, executes tool batches
through policy, manages context pressure and checks whether the task can finish.

Tools use `tool.call`, `tool.check` and service contracts. Model transport, tool
scheduling, context preparation, compaction and journal writes have replacement
services. [Core customization](core-customization.md) documents selection and
the capabilities a replacement strategy receives.

## Events and extensions

The Zod event catalog defines inputs, response forms, aliases and versions.
The runtime dispatches onion handler chains ordered by tier and priority. Hooks
can pass through, await a downstream result, transform an event, answer it or
deny an operation. Runtime budgets and lifecycle signals bound cooperative
asynchronous work. User management actions in the TUI travel through `ui.press`
and `ui.change`, independently of the model prompt queue and tool turn. The
built-in managers use replaceable `service.extension.control` and
`service.marketplace.control` chains for explicit user operations, keeping model
history and foreground cancellation intact. Plugin file changes requested while
busy are staged until explicit application at idle; plugin reload remains a
composition boundary.

Immediate manifest commands use the separate `command.invoke` path in both the
TUI and headless core. Only the loaded owner handles an explicit user command;
it can notify, call guarded tools or open a view. Command operations have their
own lifetime, cancellation and auxiliary usage accounting. Their start/settlement
events do not rewrite the running model's task or insert a queued prompt. See
the [command contract](plugin-standard.md#immediate-user-commands).

The `$` API exposes host services through these contracts. Private controller
requests carry editor and dialog state only to the selected implementation.
They are not broadcast as ordinary event payloads.

The loader validates metadata before importing active code. Filesystem packages
remain inactive until explicit user or project selection. A composite package
owns all of its hooks, tools, skills, UI and MCP declarations through reload,
disable and removal. See [the plugin standard](plugin-standard.md).

## UI and tiling

The tiling manager owns the window tree, resolved geometry, workspace membership,
focus routing and drag/resize. Decorations and contents can be replaced within
those rectangles. Editor, approval, question, form, placement and history
controllers have selected implementations with input, rendering, state and
teardown contracts.

Portable plugin views may include a catalog 0.27 semantic table: labeled columns,
stable rows, ordinary actions and expandable details. Producers own expansion and
filter state and republish when data changes. AppUI chooses aligned or stacked
rows for the viewport; the core retains a labeled text fallback. The contract
does not depend on Ink or grant a plugin permission to execute frontend code.
Catalog 0.28 adds semantic tabs with producer-owned selection and ordinary action
IDs. AppUI resolves wrapped tab geometry, cell hit ranges and keyboard navigation;
plugins do not need to manufacture padded strings or terminal coordinates.

`AppUI` sends protocol frames to `renderer-ink`; input returns through that same
protocol. The renderer draws and translates input. It does not own agent state
or execute extension modules. [UI controller contracts](ui-controllers.md) and
[appearance hooks](ui-theming.md) describe the two extension mechanisms.

The opt-in `--renderer opentui` frontend binds the actual application through
renderer-neutral conversation snapshots and semantic plugin sources. The host
retains provider/session/permission ownership and the same tiling engine; the
renderer receives views and revision-checked actions. Explicit UI operations
own separate abort signals and private form windows, so they can coexist with a
pending model question. An optional host-owned window-navigation source exposes
stable Arrange actions and a private, revision-checked window inventory. Native
input capture commits focus before subsequent keys/paste, while resident editors
remain mounted. Opening a declared UI route retains navigation ownership until
its current surface or form is ready; changing selection cancels that opening.
The deterministic preview omits this capability and keeps its development keys.
This adapter is still migrating toward the full
replacement and wire-protocol coverage described above; Ink remains the default.

Streaming text updates are composed on a 16 ms timer instead of rebuilding the
Markdown transcript for every provider delta. The catalog's `assistant.text`
precursor is still available to plugins; the UI consumes the subsequent rewritten
text notification. Input and lifecycle changes draw immediately and flush pending
text, including turn completion. The Ink renderer enables incremental output.
Native composer images reserve their cell rectangle without also decoding a
portable text-art copy or serializing the RGBA payload into an unused input-view
cache key. The portable image path remains available to its other consumers.
The interactive alternate screen disables terminal autowrap to keep glyph-width
differences from scrolling the entire layout. Autowrap is restored for external
editors and terminal cleanup. Unicode shaping remains terminal-dependent.
Resize clearing is included in synchronized output before Ink clears its previous
frame, avoiding a blank intermediate paint on terminals supporting DEC 2026.
See the [performance bench](../tools/visual/README.md#render-performance) for
observed input/hover latency, output volume and terminal-state comparisons.

## Persistence and independent work

The default store journals conversations in project-scoped private storage.
Configured journal failures stop further execution and are surfaced live; a
terminal success requires a write acknowledgement. Replay closes unfinished
tool exchanges with explicit unknown-outcome results without repeating effects.
The session repository contract replaces history, journaling, search and resume
together. Settings and window metadata have separate storage services.

Task children and independent agents have separate execution contexts.
Independent agents can also use Git worktrees. Their Saved activity views read
explicit snapshots from each child app's session repository router, so custom
backends and worktree scopes match execution. Filtering, paging and expandable
records stay in the host UI; inspecting journal data does not mutate model context
or invoke a provider. Closing a view invalidates pending reads. Workflow stages coordinate
bounded workers through a persistent dependency graph. Multiple views of one
conversation do not create additional agents.

Background shells are owned by their originating core. The host reports process
completion and provides a bounded follow-up queue; the optional
[background-jobs plugin](../plugins/background-jobs/README.md) chooses wake or
notification delivery. Waiting does not keep a model stream open. Commands and
output retain normal shell permissions, and closing the core drains its workers.

## Boundaries to preserve

- Standard host-mediated tool calls retain policy, workspace checks and accounting.
- Explicitly selected missing implementations report errors rather than silently changing providers.
- Reload disposes owned callbacks, processes and controllers and restores supported state.
- Trusted JavaScript runs in-process. Runtime guards and Monty Python execution are not OS isolation for arbitrary shell or native plugin code.
- Generated references describe the current sources; historical design proposals remain labeled as history.

Journal writes use detached JSON snapshots before dispatching
`service.session.append`. Live execution payloads remain available to hooks,
while local and custom repositories receive the same serializable record shape.
Serialization failures stop effect admission just like storage failures.
