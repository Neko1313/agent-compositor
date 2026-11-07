# Event catalog

> Generated from `packages/events/src/catalog/`. Do not edit by hand — run `npm run gen`.
> Catalog version: **0.1.0**. "Don't break plugins": frozen shapes change only via new event versions.

| Event | Since | V | Fires when | Response forms | Aliases |
|---|---|---|---|---|---|
| `session.start` | 0.1.0 | 1 | Once per loaded plugin before the first prompt, and again after that plugin reloads. Carries the session composition (the udev moment: the module sees the device). | `next` | `classic.SessionStart` |
| `session.reload` | 0.1.0 | 1 | Plugin set changed. In-memory plugin state is recreated; reload is a state-recovery point. | `next` | — |
| `session.end` | 0.1.0 | 1 | Session ends, or /clear, /resume, /branch runs. | `next` | `classic.SessionEnd` |
| `session.compact` | 0.1.0 | 1 | The conversation is about to be compacted. | `next`, `skip` | — |
| `prompt.submit` | 0.1.0 | 1 | A prompt is submitted. Rewrite text/context via next(), or drop it. | `next`, `drop` | — |
| `prompt.compose` | 0.1.0 | 1 | The system prompt is being assembled. Respond with ordered sections. | `sections` | — |
| `skill.prompt` | 0.1.0 | 1 | A skill's text is expanded for the model. | `next`, `text` | — |
| `tool.call` | 0.1.0 | 1 | A tool is about to run. Return { result } to answer it, { deny } to refuse, or pass the (rewritten) event to next(). | `next`, `deny`, `result` | `classic.PreToolUse` |
| `tool.check` | 0.1.0 | 1 | Pre-execution decision, after tool.call and rules. Resolves to the allow/ask/deny decision. | `next`, `decision` | — |
| `tool.describe` | 0.1.0 | 1 | Once per tool, when its description is first sent to the model. | `next`, `description` | — |
| `turn.start` | 0.1.0 | 1 | A turn begins. | `next` | — |
| `turn.step` | 0.1.0 | 1 | One request is about to go to the model. Async-generator hook: may yield intermediate values. | `next` | — |
| `turn.complete` | 0.1.0 | 1 | A turn ended. May show a line under the answer. | `next`, `text` | `classic.Stop` |
| `agent.offer` | 0.1.0 | 1 | A subagent type is offered to the model. | `next`, `withhold` | — |
| `agent.spawn` | 0.1.0 | 1 | A subagent or teammate is about to start (or resume). May pick its model or deny. | `next`, `deny` | — |
| `ui.render` | 0.1.0 | 1 | A render site is about to be drawn. Return an element tree. Writing plugin state during render is forbidden. | `tree` | — |
| `ui.press` | 0.1.0 | 1 | A Button the plugin drew was pressed. | `next` | — |
| `ui.focus` | 0.1.0 | 1 | Focus is about to move to another pane/control. | `next` | — |
| `ui.invalidate` | 0.1.0 | 1 | Damage tracking: the plugin marks changed regions of its pane. | — | — |

## Domains

- **session**: `session.start`, `session.reload`, `session.end`, `session.compact`
- **prompt**: `prompt.submit`, `prompt.compose`
- **skill**: `skill.prompt`
- **tool**: `tool.call`, `tool.check`, `tool.describe`
- **turn**: `turn.start`, `turn.step`, `turn.complete`
- **agent**: `agent.offer`, `agent.spawn`
- **ui**: `ui.render`, `ui.press`, `ui.focus`, `ui.invalidate`
