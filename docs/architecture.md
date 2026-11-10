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
asynchronous work.

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

`AppUI` sends protocol frames to `renderer-ink`; input returns through that same
protocol. The renderer draws and translates input. It does not own agent state
or execute extension modules. [UI controller contracts](ui-controllers.md) and
[appearance hooks](ui-theming.md) describe the two extension mechanisms.

## Persistence and independent work

The default store journals conversations in project-scoped private storage.
The session repository contract replaces history, journaling, search and resume
together. Settings and window metadata have separate storage services.

Task children and independent agents have separate execution contexts.
Independent agents can also use Git worktrees. Workflow stages coordinate
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
