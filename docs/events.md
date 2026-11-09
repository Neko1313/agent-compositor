# Event catalog

> Generated from `packages/events/src/catalog/`. Do not edit by hand — run `npm run gen`.
> Catalog version: **0.13.0**. "Don't break plugins": frozen shapes change only via new event versions.

| Event | Since | V | Fires when | Response forms | Aliases |
|---|---|---|---|---|---|
| `session.start` | 0.1.0 | 1 | Once per loaded plugin before the first prompt, and again after that plugin reloads. Carries the session composition (the udev moment: the module sees the device). | `next` | `classic.SessionStart` |
| `session.reload` | 0.1.0 | 1 | Plugin set changed. In-memory plugin state is recreated; reload is a state-recovery point. | `next` | — |
| `session.end` | 0.1.0 | 1 | Session ends, or /clear, /resume, /branch runs. | `next` | `classic.SessionEnd` |
| `session.compact` | 0.1.0 | 1 | The conversation is about to be compacted. | `next`, `skip` | — |
| `prompt.submit` | 0.1.0 | 1 | A prompt is submitted. Rewrite text/context via next(), or drop it. | `next`, `text`, `drop` | — |
| `prompt.compose` | 0.1.0 | 1 | The system prompt is being assembled. Respond with ordered sections. | `sections` | — |
| `skill.prompt` | 0.1.0 | 1 | A skill's text is expanded for the model. | `next`, `text` | — |
| `tool.call` | 0.1.0 | 1 | A tool is about to run. Return { result } to answer it, { deny } to refuse, or pass the (rewritten) event to next(). | `next`, `deny`, `result` | `classic.PreToolUse` |
| `tool.check` | 0.1.0 | 1 | Pre-execution decision, after tool.call and rules. Resolves to the allow/ask/deny decision. | `next`, `decision` | — |
| `tool.describe` | 0.1.0 | 1 | Once per tool, when its description is first sent to the model. | `next`, `description` | — |
| `turn.start` | 0.1.0 | 1 | A turn begins. | `next` | `turn.started` |
| `turn.step` | 0.1.0 | 1 | One request is about to go to the model. Async-generator hook: may yield intermediate values. | `next` | `turn.step.started` |
| `turn.complete` | 0.1.0 | 1 | A turn ended. May show a line under the answer. | `next`, `text` | `classic.Stop`, `turn.completed` |
| `agent.offer` | 0.1.0 | 1 | A subagent type is offered to the model. | `next`, `withhold` | — |
| `agent.spawn` | 0.1.0 | 1 | A subagent or teammate is about to start (or resume). May pick its model or deny. | `next`, `deny` | — |
| `prompt.steer` | 0.5.0 | 1 | A steering message is injected into the running turn (codex Tab semantics). | `next` | — |
| `prompt.queued` | 0.5.0 | 1 | A prompt arrived while the agent was busy; it will start when the turn ends. | `next` | — |
| `assistant.text` | 0.5.0 | 1 | One streamed assistant text delta. Renderers usually subscribe() instead; the chain event exists for plugins that log or rewrite. | `next`, `text` | — |
| `tool.result` | 0.5.0 | 1 | A tool call resolved (ok or error). Errors are values — the turn continues. | `next` | — |
| `turn.failed` | 0.5.0 | 1 | A turn ended in an error (model failure, stream error). Fail-operational: the session stays alive. | `next` | — |
| `turn.interrupted` | 0.5.0 | 1 | The user interrupted the turn. In-flight model stream and tools were aborted best-effort. | `next` | — |
| `turn.usage` | 0.5.0 | 1 | Token usage of a turn, cumulative across its model steps. Fires before turn.complete/failed so cost plugins can tally. | `next` | — |
| `subagent.start` | 0.5.0 | 1 | A subagent (fresh AgentCore, isolated transcript) started on a prompt. | `next` | — |
| `subagent.complete` | 0.5.0 | 1 | A subagent finished: ok with its final text, or failed with an error value (fail-operational). | `next` | — |
| `context.compacted` | 0.5.0 | 1 | The transcript was compacted: the middle was folded into a summary, system prompt and recent tail kept verbatim. | `next` | — |
| `context.compacting` | 0.9.0 | 1 | Before context compaction, allowing observers to save state. | — | — |
| `context.pressure` | 0.11.0 | 1 | Current request context budget, model limit source and estimated occupancy. | — | — |
| `service.model.capabilities` | 0.11.0 | 1 | Resolve effective context/output limits for the selected model. Replaceable by provider plugins. | `value`, `deny` | — |
| `service.agent.instructions` | 0.11.0 | 1 | Resolve replaceable base agent behavior and tool guidance before a turn. | `value` | — |
| `service.agent.finish` | 0.11.0 | 1 | Evaluate a proposed final answer; return complete or a concrete continuation instruction. | `value` | — |
| `service.ui.configure` | 0.7.0 | 1 | Replace this plugin's appearance contribution. Partial sections inherit defaults; null removes the contribution. User window placements remain authoritative. | `value` | — |
| `service.storage.read` | 0.9.0 | 1 | Read JSON in the calling plugin namespace; missing values return undefined. | `value` | — |
| `service.storage.write` | 0.9.0 | 1 | Atomically persist bounded JSON in the calling plugin namespace and selected scope. | `value` | — |
| `service.storage.config` | 0.9.0 | 1 | Read merged global/project/local plugin configuration. | `value` | — |
| `project.changed` | 0.9.0 | 1 | Files or Git state changed; consumers can invalidate and refresh project indexes. | — | — |
| `service.network.configure` | 0.9.0 | 1 | Configure this application network client; preserves protocol and streams, never changes global process environment. | `value` | — |
| `ui.visibility` | 0.8.0 | 1 | Plugin surface attachment and visible viewport changed; lets producers suspend hidden animations. | — | — |
| `ui.reaction` | 0.8.0 | 1 | Semantic activity signal for optional visual companions. Consumers must not change the operation being observed. | — | — |
| `service.ui.remove` | 0.8.0 | 1 | Remove this plugin surface from all workspaces. | `value` | — |
| `agent.activity` | 0.8.0 | 1 | Metadata-only activity of a background agent, for optional UI observers; excludes prompts and tool arguments. | — | — |
| `service.ui.inputTarget` | 0.8.0 | 1 | Label the current input destination. Routing remains owned by the plugin. | `value` | — |
| `service.ui.view` | 0.8.0 | 1 | Publish a semantic plugin view. Action rows receive ui.press on click; placement remains user controlled. | `value` | — |
| `service.agent.tool` | 0.8.0 | 1 | Run a user-invoked plugin tool through the normal permission and tool hook chain, without a model request. | `value` | — |
| `service.ui.surface` | 0.6.0 | 1 | Publish or update a plugin window with optional split/sidebar/inspector/status-bar placement hints; user rules control workspace, size and focus. | `value` | — |
| `ui.render` | 0.1.0 | 1 | A render site is about to be drawn. Return an element tree. Writing plugin state during render is forbidden. | `tree` | — |
| `ui.press` | 0.1.0 | 1 | A Button the plugin drew was pressed. | `next` | — |
| `ui.focus` | 0.1.0 | 1 | Focus is about to move to another pane/control. | `next` | — |
| `ui.invalidate` | 0.1.0 | 1 | Damage tracking: the plugin marks changed regions of its pane. | — | — |
| `service.fs.read` | 0.2.0 | 1 | $.fs.read(path): read a workspace-confined file (max 1 MB). | `deny`, `value` | — |
| `service.fs.write` | 0.2.0 | 1 | $.fs.write(path, content): write a workspace-confined file (max 10 MB). | `deny`, `value` | — |
| `service.exec.run` | 0.3.0 | 1 | $.exec.run(cmd, args?, opts?): run a workspace-confined subprocess (default 30 s timeout). | `deny`, `value` | — |
| `service.model.complete` | 0.2.0 | 1 | $.model.complete(request): call the configured model provider. | `deny`, `value` | — |
| `service.auth.login` | 0.2.0 | 1 | $.auth.login(provider?): run the auth flow of the configured auth capability. | `deny`, `value` | — |
| `service.ui.ask` | 0.5.0 | 1 | $.ui.ask / the ask_user tool: ask the human a question (optionally with choices). Headless sessions deny (fail closed). | `deny`, `answer` | — |
| `service.ui.notify` | 0.2.0 | 1 | $.ui.notify(message, level?): post a transient status message. | `deny`, `value` | — |
| `service.telemetry.log` | 0.2.0 | 1 | $.telemetry.log(event, data?): structured log line. | `deny`, `value` | — |
| `service.skills.load` | 0.5.0 | 1 | Load a skill by name from the configured registry. | `deny`, `value` | — |
| `service.project.query` | 0.8.0 | 1 | Replaceable project navigation provider: files, text, symbols, definitions and graph relations. Symbolic results include resolution metadata. | `deny`, `value` | — |
| `service.sandbox.run` | 0.8.0 | 1 | Replaceable isolated code execution. Host-supplied functions are process-local callbacks receiving (args, AbortSignal); never inferred from generated code. | `deny`, `value` | — |
| `service.permission.review` | 0.8.0 | 1 | Optional risk review only after permissions require approval. A reviewer may allow this exact call or return to manual approval; explicit denies cannot be overridden. | `deny`, `value` | — |
| `service.context.control` | 0.8.0 | 1 | Snapshot or restore conversation context. Restore is restricted to interactive controls outside model execution. | `deny`, `value` | — |
| `model.usage` | 0.8.0 | 1 | Per-request usage including auxiliary calls. Provider counts are preferred; estimated=true explicitly marks a fallback used for budgeting. | — | — |
| `service.usage.quota` | 0.8.0 | 1 | Read optional provider-reported account quota; unavailable is explicit, not estimated. | `deny`, `value` | — |
| `context.restored` | 0.8.0 | 1 | Conversation restored from a checkpoint; resets replay and renderer transcript. | — | — |
| `service.checkpoint.control` | 0.8.0 | 1 | List, inspect and restore turn checkpoints through a replaceable provider. | `deny`, `value` | — |
| `service.agent.control` | 0.8.0 | 1 | Manage independent persisted agents and optional Git worktrees; messages run asynchronously with separate budgets. | `deny`, `value` | — |
| `service.model.stream` | 0.8.0 | 1 | Shared streaming provider gateway for agent turns, compaction and plugin model calls. Return an AsyncIterable of provider events. | `deny`, `value` | — |
| `context.prepared` | 0.8.0 | 1 | Final user content after project context and explicit file references have been expanded. | — | — |
| `assistant.metadata` | 0.8.0 | 1 | Provider reasoning continuation metadata for faithful session replay. | — | — |
| `service.session.control` | 0.8.0 | 1 | List, search, name, fork, archive or resume local sessions. Resume requires an interactive host. | `deny`, `value` | — |
| `service.session.store` | 0.8.0 | 1 | Local session storage operations used by interactive session hosts. | `deny`, `value` | — |
| `service.shell.exec` | 0.5.0 | 1 | Core exec tool: run a shell command (session cwd, timeout, env). With background: true it returns immediately with a shell id and keeps running. | `deny`, `value` | — |
| `service.shell.execOutput` | 0.5.0 | 1 | Read a backgrounded shell's buffered output (BashOutput analog). | `deny`, `value` | — |
| `service.shell.execKill` | 0.5.0 | 1 | Terminate a backgrounded shell by id (KillShell analog). | `deny`, `value` | — |
| `service.agent.spawn` | 0.5.0 | 1 | Spawn a subagent: a fresh AgentCore (shared provider/permissions/plugins, isolated transcript) runs the prompt to completion and returns its final text. Core-resolved. | `deny`, `value` | — |
| `service.workflow.run` | 0.11.0 | 1 | Replaceable persistent workflow lifecycle: start, inspect, pause, resume, retry or stop. Host permissions remain in each worker. | `deny`, `value` | — |
| `service.todo.update` | 0.5.0 | 1 | Core todo tool: replace (or read) the process-scoped task list. | `deny`, `value` | — |
| `service.file.read` | 0.5.0 | 1 | Core read tool: paginated file read with truncation note. | `deny`, `value` | — |
| `service.file.readText` | 0.5.0 | 1 | Internal: raw full-text read (undo pre-image). null when missing. | `deny`, `value` | — |
| `service.file.write` | 0.5.0 | 1 | Core write tool: create or overwrite a file. | `deny`, `value` | — |
| `service.file.edit` | 0.5.0 | 1 | Core edit tool: exact (or whitespace-normalized) text replacement. | `deny`, `value` | — |

## Domains

- **session**: `session.start`, `session.reload`, `session.end`, `session.compact`
- **prompt**: `prompt.submit`, `prompt.compose`, `prompt.steer`, `prompt.queued`
- **skill**: `skill.prompt`
- **tool**: `tool.call`, `tool.check`, `tool.describe`, `tool.result`
- **turn**: `turn.start`, `turn.step`, `turn.complete`, `turn.failed`, `turn.interrupted`, `turn.usage`
- **agent**: `agent.offer`, `agent.spawn`, `agent.activity`
- **assistant**: `assistant.text`, `assistant.metadata`
- **subagent**: `subagent.start`, `subagent.complete`
- **context**: `context.compacted`, `context.compacting`, `context.pressure`, `context.restored`, `context.prepared`
- **service**: `service.model.capabilities`, `service.agent.instructions`, `service.agent.finish`, `service.ui.configure`, `service.storage.read`, `service.storage.write`, `service.storage.config`, `service.network.configure`, `service.ui.remove`, `service.ui.inputTarget`, `service.ui.view`, `service.agent.tool`, `service.ui.surface`, `service.fs.read`, `service.fs.write`, `service.exec.run`, `service.model.complete`, `service.auth.login`, `service.ui.ask`, `service.ui.notify`, `service.telemetry.log`, `service.skills.load`, `service.project.query`, `service.sandbox.run`, `service.permission.review`, `service.context.control`, `service.usage.quota`, `service.checkpoint.control`, `service.agent.control`, `service.model.stream`, `service.session.control`, `service.session.store`, `service.shell.exec`, `service.shell.execOutput`, `service.shell.execKill`, `service.agent.spawn`, `service.workflow.run`, `service.todo.update`, `service.file.read`, `service.file.readText`, `service.file.write`, `service.file.edit`
- **project**: `project.changed`
- **ui**: `ui.visibility`, `ui.reaction`, `ui.render`, `ui.press`, `ui.focus`, `ui.invalidate`
- **model**: `model.usage`
