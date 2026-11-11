# Agent harness architecture study November 2026

Dated research snapshot: 2026-11-11. Local baseline: `71397f88e1eabd995c3eba6173ee9307f470d37c`.

Agent harnesses differ most in how they preserve valid state across tool execution, cancellation, context reduction and restart. An extensible agent loop is useful, but it needs explicit contracts for message projection, resource ownership and effect settlement. Agent-compositor already has replaceable execution strategies and many of the visible features in the surveyed systems. The most concrete findings concern replay integrity and the durability of acknowledged progress.

This is design history and a source study, not the current product reference or an approved implementation roadmap. Current behavior remains documented in [agent features](agent-features.md), [core customization](core-customization.md), [UI and storage contracts](ui-controllers.md) and the plugin-owned guides.

## Scope and evidence

The comparison covers 18 systems. Each external source link below includes an immutable commit. Source branches can contain optional or experimental implementations; presence in a repository does not establish availability in a published binary. Pi's ordinary coding-agent CLI, its extension examples and the separate experimental applications in its monorepo must be evaluated separately.

External implementation and test sources were inspected. Their tests describe intended contracts; they were not executed as part of this study. Assertions were checked for the key findings rather than treating a test title as proof. For example, some OpenHands locking tests only assert result count, so the lock manager implementation is needed to establish the resource-acquisition mechanism.

Two deterministic local API probes were executed against the baseline. They used ScriptedProvider, an in-memory tool and an injected failing journal, with no remote model, shell tool or project file mutation. Their observations are recorded below. They establish the local behavior described, not the response of a particular external API.

## Feature vocabulary

| Layer | Questions that distinguish implementations |
| --- | --- |
| Turn execution | What is one turn or step? Which events close it? Can input arrive while it runs? |
| Model boundary | Which messages and tools are sent? Where are provider metadata, retries and usage normalized? |
| Tool admission | When are arguments validated, hooks applied and permissions evaluated? |
| Tool scheduling | Which calls may overlap? Are conflicts defined globally, by tool or by resource? |
| Context projection | Is the model request a view of durable history, or the same mutable message array? |
| Compaction | Which atomic groups survive? How are summaries, recent work and previous summaries combined? |
| Persistence | What must be stored before acknowledging a prompt or running an effect? What survives an abrupt process exit? |
| Cancellation | Does it cancel one prompt, a turn, queued work, child agents or the whole session? How are pending calls settled? |
| Delegation | What context, model, permissions, tools, budgets and lifetime does a child inherit? |
| Background work | Who owns the process? How is completion delivered and deduplicated? What happens after reload or restart? |
| Memory | Are notes, recalled conversations, skills and context summaries separate stores with separate write authority? |
| Extension boundary | Can an extension add tools, replace a strategy, replace a context engine or supply the entire harness? |
| Client protocol | Can clients reconnect, interrupt, answer approvals and identify the durable session without parsing terminal output? |

## Systems and implementation contracts

| System | Harness mechanism | Contract worth studying | Evidence |
| --- | --- | --- | --- |
| Codex | Typed Rust turn and tool runtime; parallel admission, approvals, sandbox attempts, child-agent ownership and context recovery. | Cancellation completes pending dynamic calls and excludes a late response from subsequent context. | [Source](https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/core/src/tools/parallel.rs) · [Tests](https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/core/tests/suite/dynamic_tool_cancellation.rs) |
| OpenCode | Effect services combine session storage, inboxes, execution ownership, scoped tool fibers and background subagent completion. | Completion observers survive a moved or evicted child and notify its parent once in the tested generation. | [Source](https://github.com/anomalyco/opencode/blob/63b42f6f02e4b74fae343eddbe567db2c53fcf21/packages/core/src/session/execution.ts) · [Tests](https://github.com/anomalyco/opencode/blob/63b42f6f02e4b74fae343eddbe567db2c53fcf21/packages/core/test/subagent-lifetime.test.ts) |
| Pi | A configurable agent loop separates internal messages from provider conversion; extension hooks, steering and follow-up queues surround each step. | Parallel tools emit completion events as they finish but persist results in source order; any sequential tool serializes the batch. | [Source](https://github.com/earendil-works/pi/blob/473515f9c297c75cf2c3ebb3ba027049ed836d27/packages/agent/src/agent-loop.ts) · [Tests](https://github.com/earendil-works/pi/blob/473515f9c297c75cf2c3ebb3ba027049ed836d27/packages/agent/test/agent-loop.test.ts) |
| Gemini CLI | A scheduler separates validation, policy, confirmation and execution; parallelizable calls form ordered waves. | Read-only defaults can be overridden by the call's wait_for_previous behavior; topic updates retain a special ordering rule. | [Source](https://github.com/google-gemini/gemini-cli/blob/e5d88fb2c036ce7e0c27131469cd963221b9d9e7/packages/core/src/scheduler/scheduler.ts) · [Tests](https://github.com/google-gemini/gemini-cli/blob/e5d88fb2c036ce7e0c27131469cd963221b9d9e7/packages/core/src/scheduler/scheduler_parallel.test.ts) |
| Qwen Code | AgentCore is complemented by a workflow interpreter, dispatch scheduler, journal, result validation and aggregate budgets. | Pause holds admission and result delivery; abort rejects queued dispatches and prevents a later resume of that scheduler. | [Source](https://github.com/QwenLM/qwen-code/blob/c238beb56fa3c65a0f62ad7a3b2cd14db978b998/packages/core/src/agents/runtime/workflow-orchestrator.ts) · [Tests](https://github.com/QwenLM/qwen-code/blob/c238beb56fa3c65a0f62ad7a3b2cd14db978b998/packages/core/src/agents/runtime/workflow-dispatch-scheduler.test.ts) |
| Mistral Vibe | A Rust state machine accepts commands and returns actions for the surrounding runtime; checkpoints capture validated engine state. | Checkpoint restoration rejects inconsistent tool identities, arguments, batch cardinality and program continuation state. | [Source](https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/harness/core/src/core/session.rs) · [Tests](https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/harness/core/src/core/checkpoint/tests/invariant_tests.rs) |
| Kimi Code CLI | Dependency-injected services connect a journaled machine engine to prompts, tool execution, compaction and permission policies. | Active-turn cancellation, queued-turn cancellation and disposal have distinct outcomes; disposal settles all pending turns. | [Source](https://github.com/MoonshotAI/kimi-code/blob/7490d07d358d1f6736cf87abf7a7ae22d6ea8897/packages/agent-core-v2/src/agent/loop/loopService.ts) · [Tests](https://github.com/MoonshotAI/kimi-code/blob/7490d07d358d1f6736cf87abf7a7ae22d6ea8897/packages/agent-core-v2/test/agent/loop/loop.test.ts) |
| Cline | SessionRuntime retains cross-run state while AgentRuntime owns one execution; model/tool hooks and prepareTurn form explicit boundaries. | Recovery avoids replaying a turn that already performed provider-executed tool activity; approval preparation precedes opted-in parallel execution. | [Source](https://github.com/cline/cline/blob/7796dc9ce12a6377796d1c265036c4038ff3fcb6/sdk/packages/agents/src/agent-runtime.ts) · [Tests](https://github.com/cline/cline/blob/7796dc9ce12a6377796d1c265036c4038ff3fcb6/sdk/packages/agents/src/agent-runtime.test.ts) |
| Kilo CLI | An OpenCode-derived Effect runner combines role policies, context preparation, tool materialization, snapshots and overflow recovery. | The tool registry is materialized for the selected agent's permissions. Shared ancestry does not establish parity with current OpenCode. | [Source](https://github.com/Kilo-Org/kilocode/blob/c0f975fa7013d99b83aa14e86d64104f2e0771c3/packages/core/src/session/runner/llm.ts) · [Tests](https://github.com/Kilo-Org/kilocode/blob/c0f975fa7013d99b83aa14e86d64104f2e0771c3/packages/core/test/session-runner-tool-registry.test.ts) |
| Grok Build | Rust session actors coordinate a sampler, ToolBridge, input queues, persistence acknowledgements and child execution. | Cancellation reaches the sampler and settles the originating request; deeper queued prompts can remain visible. | [Source](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/bridge.rs) · [Tests](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_session_tests/cancel_running_task_tests.rs) |
| Aider | Coder assembles selected files and repository context, parses an edit format, applies changes and feeds failures back through bounded reflection. | Editing has explicit parsing and application semantics, including malformed or incomplete SEARCH/REPLACE blocks. | [Source](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py) · [Tests](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_editblock.py) |
| mini-SWE-agent | A small model/environment loop records actions and observations; environment implementations own process execution and isolation. | Step, cost, time and repeated-format-error limits are distinct termination conditions; timeout observations can retain partial output. | [Source](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/agents/default.py) · [Tests](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/tests/agents/test_default.py) |
| Goose | An ordered re-entrant operation pipeline runs over persisted conversation state, with effect handling for tools, approvals, compaction and subagents. | Cancellation finalizes interrupted operations and open tool calls rather than merely dropping the active future. | [Source](https://github.com/aaif-goose/goose/blob/b7a5014e0c3e939adcdbf1c13e6ca395f6807329/crates/goose-agent/src/machine.rs) · [Tests](https://github.com/aaif-goose/goose/blob/b7a5014e0c3e939adcdbf1c13e6ca395f6807329/crates/goose-agent/tests/cancellation.rs) |
| Hermes Agent | A memory-provider lifecycle and a replaceable context engine are separate from the conversation loop and delegation backend. | Forked agents suppress memory writes and recall while retaining the pre-compression checkpoint path. | [Source](https://github.com/NousResearch/hermes-agent/blob/d5640d525a420a7d14570e85efe5e9db5249cc65/agent/memory_manager.py) · [Tests](https://github.com/NousResearch/hermes-agent/blob/d5640d525a420a7d14570e85efe5e9db5249cc65/tests/agent/test_memory_manager_fork_scope.py) |
| OpenClaw | The gateway selects registered harnesses and context engines; registration tracks ownership, capabilities and session cleanup. | Required reset failure is propagated after sibling cleanup settles; plugin ownership controls registry replacement. | [Source](https://github.com/openclaw/openclaw/blob/afa73f35c911300fb096043e713dc393ff2b7a32/src/agents/harness/registry.ts) · [Tests](https://github.com/openclaw/openclaw/blob/afa73f35c911300fb096043e713dc393ff2b7a32/src/agents/harness/registry.test.ts) |
| DeepSeek Harness | The agent loop, tools and context components are Cordis services; an event log is folded into a separately validated model-visible surface. | Invalid content replacements leave incremental state unchanged; tool-result rewrites preserve identity and non-content fields. | [Source](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/src/surface.ts) · [Tests](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/tests/surface.spec.ts) |
| Crush | A Go coordinator builds Fantasy-backed session agents; per-session dispatch, queues, cancellation and permission services remain explicit. | A session grant is bound to the issued command and request; fields supplied by an answering client cannot widen it. | [Source](https://github.com/charmbracelet/crush/blob/1b7582dbba81e0f716e50f20fe44bd04faf7251f/internal/agent/agent.go) · [Tests](https://github.com/charmbracelet/crush/blob/1b7582dbba81e0f716e50f20fe44bd04faf7251f/internal/permission/grant_scope_test.go) |
| OpenHands SDK | Conversation state is backed by an EventLog; the agent executes action batches and context condensers construct a view of the history. | Declared resources control locking; undeclared resources fall back to a tool mutex, while explicitly empty declarations permit concurrency. | [Source](https://github.com/OpenHands/software-agent-sdk/blob/5ff99f1b6ca28f7d16870b69f57a31351e59bcd0/openhands-sdk/openhands/sdk/agent/parallel_executor.py) · [Tests](https://github.com/OpenHands/software-agent-sdk/blob/5ff99f1b6ca28f7d16870b69f57a31351e59bcd0/tests/sdk/agent/test_parallel_executor_locking.py) |

Crush is included for architecture inspection as a source-available project; its FSL license must not be conflated with MIT or Apache-2.0. The OpenHands row concerns the current software-agent SDK rather than assuming that the older standalone CLI remains maintained. Claude Code and other proprietary engines cannot receive the same source-level treatment merely because their integration documentation is public.

## Turn state and effect execution

Three useful designs emerge from the inspected systems.

Pi keeps an understandable loop with explicit callbacks around context transformation, request preparation and tool calls. It has separate steering and follow-up queues: steering can enter at a step boundary, while follow-up work can keep the outer loop alive after it would otherwise stop. These are different scheduling promises.

Vibe exposes a state transition boundary. `HarnessSession.apply` works on a candidate state and commits it only if the command is accepted. The surrounding runtime performs actions and returns results. Its checkpoint validation covers engine state, including pending tools and program continuations, rather than treating a checkpoint as an arbitrary serialized object. [Vibe transition code][vibe-session] and [checkpoint invariants][vibe-checkpoints] are useful references for a replacement engine contract.

Goose builds an ordered operation pipeline over persisted conversation state. The pipeline includes operations for inference, tools, approvals, compaction, steering and stopping. Cancellation has a finalization path for operations and unresolved calls. That makes cleanup part of the execution protocol. See [Goose machine][goose-machine] and [cancellation cases][goose-cancel].

These patterns can coexist: an engine can have small internal transitions while exposing a higher-level asynchronous session API. Replacing the loop should preserve host-owned authorization, accounting, cancellation and result publication boundaries.

## Parallel tool scheduling

Four policies should not be collapsed into a single parallel flag.

| Implementation | Admission policy | Consequence |
| --- | --- | --- |
| Pi | A sequential configuration or any sequential tool makes the entire batch sequential. Otherwise prepared calls execute concurrently. | Simple batch-wide barrier; completed results are stored in declaration order. |
| Codex | Parallel-capable tools take a shared lock; exclusive tools take a write lock. | Parallel work and exclusive work use one admission gate. |
| Gemini and Cline | Ordered groups of adjacent parallelizable calls execute together. | Sequential calls separate concurrency waves. Gemini additionally interprets explicit wait behavior. |
| OpenHands | Tools declare resource keys; shared keys serialize. Locks are acquired in sorted order. Undeclared resources fall back to a tool-wide mutex. | Different files or sessions may overlap while calls touching the same declared resource wait. Correct declarations matter. |

The evidence is in [Pi's scheduler][pi-loop], [Pi's ordering tests][pi-loop-tests], [Codex's gate][codex-parallel], [Gemini's scheduling tests][gemini-parallel], [Cline's execution tests][cline-runtime-tests], [OpenHands' executor][openhands-executor] and [resource lock manager][openhands-locks].

Two orders must remain separate: UI completion order and the canonical order of the messages sent to the provider. Parallelism must also preserve argument validation and permission admission. Cline explicitly tests approval preparation before parallel execution.

Agent-compositor's default batch strategy is sequential. Its public batch context already supports a replacement strategy that calls `context.execute` concurrently, and the current customization tests exercise that path through the normal permission gate. The public ToolSpec has no resource-declaration contract equivalent to OpenHands. Resource-aware scheduling would be an additional contract, not a missing ability to replace the scheduler.

## Durable history and model context

An audit log and a model request serve different purposes. A log must retain enough information to explain what happened; a model request must satisfy provider structure and size constraints.

DeepSeek Harness makes the distinction explicit through its session surface. Events are folded into a model-visible sequence, and plugins may supply message projections. Replacements are validated before changing the incremental surface. A tool-result content rewrite cannot silently alter call identity or unrelated metadata. See [surface implementation][dsh-surface] and [surface validation cases][dsh-surface-tests].

OpenHands applies condensation through a view over events. Its tests preserve tool-batch atomicity: forgetting one observation can remove the corresponding batch from the view, including related observations, while leaving other batches intact. This avoids a request that retains calls without their matching results. See [batch atomicity cases][openhands-atomicity].

Pi stores a tree of entries and constructs the active context from the selected branch and compaction boundary. Branching a conversation is distinct from restoring files.

Agent-compositor has an append-only event journal and `replayTranscript`, plus a replaceable SessionRepository. It also has explicit context restoration and compaction events. The local replay observation below identifies a specific incomplete-call boundary that still needs a policy if stronger recovery is desired.

## Compaction and recovery

Compaction has at least five separate jobs:

1. Measure the next request, including tool schemas, instructions, media and output reserve.
2. Prune or offload repeatable large tool output while preserving call/result structure.
3. Summarize older work and preserve the recent working tail.
4. Recover from a provider's actual context overflow.
5. Update usage estimates and prevent a repeated-compaction loop.

OpenCode can prepare a summary in the background before it is needed. Its settings distinguish automatic compaction, reserve buffer and precomputation. The background summary must remain compatible with the history it replaces. [OpenCode compaction][opencode-compaction] is a useful implementation reference, rather than a promise of a universal latency improvement.

Gemini truncates history to a safe summarizer budget and has a fallback after a previous failed automatic summarization. [Gemini compression tests][gemini-compaction-tests] cover budget-driven truncation and failure behavior.

Goose distinguishes actual provider error kinds from text that resembles a context error. Its tests require no compaction merely because text looks like a context error, stop repeated context-error recovery, and compact tool pairs only at an appropriate boundary. Providers that own their context do not receive an additional Goose compaction operation. See [compaction lifecycle cases][goose-compaction-tests].

Cline has explicit handling for output truncation, context overflow and provider-executed tools. Its tests prevent compact-and-replay recovery from repeating a turn that already performed provider tool activity. This is a broader recovery issue than local tool execution. See [runtime recovery cases][cline-runtime-tests].

Agent-compositor already counts schema overhead and preserves a tool-result tail boundary during compaction. Its default implementation uses summary plus recent messages, enforces bounded summarizer inputs and rejects a non-shrinking summary. The current overflow detector uses message patterns. Typed provider failures and an explicit request-projection boundary are candidates for stronger recovery semantics; they are not prerequisites for using the existing compaction service.

## Cancellation and late results

Cancellation needs a terminal outcome for every admitted request. An AbortSignal alone does not settle a pending approval, close an open tool exchange or decide what happens to queued prompts.

The inspected systems make different policy choices:

- Kimi separates cancellation of the active turn from cancellation of a queued turn; disposal settles all active and queued turns. It preserves partial output with different interruption-reminder behavior for user and programmatic cancellation. [Loop cases][kimi-loop-tests].
- DeepSeek Harness exposes a keep-inbox choice and tests races around waking, cancellation, transition to idle and disposal. Its shutdown path drains buffered events. [Cancellation cases][dsh-cancel] and [shutdown persistence][dsh-shutdown].
- Grok's cancellation tests distinguish the originating prompt from deeper queued prompts, propagate cancellation to the sampler and wait for prompt settlement. Some paths retain later queued work. [Session cancellation cases][grok-cancel].
- Codex completes cancelled dynamic calls and excludes a terminated cell's late response from context. [Dynamic-call cases][codex-cancel].
- Crush tests that an idle cancellation cannot poison the next accepted prompt and that entry-time cancellation still publishes run completion. [Dispatch cancellation cases][crush-cancel].

Agent-compositor intentionally clears ordinary queued work on Stop and pauses automatic follow-ups after interruption. This differs from engines that retain deeper prompts; it is a policy choice. A future adapter needs to map cancellation scope explicitly rather than mapping every external stop command to one boolean.

Cancellation also has two relevant completion points: the user sees that interruption was accepted, and the runtime finishes draining started effects. Source code must be checked for both before claiming that the system is idle.

## Persistence and restart

OpenCode records an execution claim with the start event. Success, failure and deliberate user interruption release it; shutdown interruption preserves it for restart recovery. This separates durable intent from process-local execution ownership. [Execution ownership][opencode-execution].

A claim is not an exactly-once guarantee for arbitrary external effects. A process can fail after an external operation succeeds and before its result is durably stored. Recovery needs tool-specific reconciliation, an idempotency key or explicit user intervention at that boundary.

Vibe's runtime checkpoint is another distinct mechanism. It validates the internal state needed to resume the machine. It does not by itself establish a filesystem rollback or a transactional external operation.

Cline's checkpoint restoration separately addresses code and conversation. Its tests reject restoration after HEAD moved or the branch diverged, and its transaction captures recovery state before destructive restoration. [Restore cases][cline-restore].

Agent-compositor's current ordinary session journal is best effort. Workflow run snapshots have stronger, separate persistence and ownership rules. A future durable session mode should be a selected journal/execution policy, with explicit behavior when a write fails, rather than an undocumented change to all interactive sessions.

## Subagents and workflow orchestration

A child agent needs separate answers for context, authority and lifetime.

A fresh child can receive a small task-specific prompt. A fork can inherit a context snapshot, but copying all parent history may create both cost and instruction-boundary problems. Kimi constrains fork compatibility and tests request parity and interrupted child output. [Fork cases][kimi-fork].

Permissions and provider capabilities should be inherited only when the route and ownership remain appropriate. Hermes tests that the same-route child can inherit a sanitized capability map, while a provider or base-URL override keeps the default denial. [Capability inheritance][hermes-capabilities].

Detached work needs an owner beyond the foreground turn. OpenCode's completion observer survives movement or eviction of its child session. Agent-compositor's trusted background API similarly retains a plugin-instance lifetime and revokes it on unload. A stable session ID is insufficient if completion delivery still holds a disposed plugin instance.

Qwen's workflow scheduler treats pause as an admission/result-delivery gate, and abort as a terminal restriction on further scheduling. Its replay uses a chain of dispatch identities: an unchanged prefix may reuse validated results; the first miss invalidates the suffix. Budget admission is checked again at the dispatch boundary. [Orchestrator][qwen-workflow], [scheduler cases][qwen-scheduler-tests] and [budget ledger case][qwen-budget-tests].

Agent-compositor already has both a Python task-result journal and a DAG workflow engine. The former chains code and prompt hashes; the latter has stage dependencies, process leases, attempts, disjoint token reservations and completion generations. Its documented recovery pauses unfinished runs and requires explicit resume. Completed results are not automatically invalidated by later repository edits. Context identity or content-based freshness would be an additional policy; re-running a completed external effect is not a safe general freshness check.

## Memory and skill learning

Project instructions, user notes, current-session summaries, recalled conversations and learned skills should have separate lifecycles.

Hermes gives memory providers turn/session hooks and a pre-compression checkpoint contract. A required checkpoint failure must propagate before destructive compression; best-effort legacy providers keep different semantics. Forked agents suppress ordinary memory writes and recall but may participate in the checkpoint path. [Checkpoint contract cases][hermes-checkpoint] and [fork scope cases][hermes-fork].

This prevents an auxiliary worker from silently treating its temporary task as a lasting preference for the primary user. It also exposes a capability problem: a harness that controls its own native compaction must either satisfy the selected memory checkpoint contract or refuse that combination.

Agent-compositor's memory plugin provides explicit project/global notes and bounded prompt injection. Its task plan and skills systems address other kinds of retained information. These already count as memory features, but they are not equivalent to a provider lifecycle for automatic extraction, retrieval, provenance and forgetting.

## Extensions and execution authority

A tool plugin, a strategy replacement, a context engine and a complete external harness occupy different extension boundaries.

Pi exposes callbacks, tools, model providers, context processing and UI extensions. DeepSeek Harness composes services, including the loop. OpenClaw registers full harness implementations and tracks their plugin ownership. Its reset tests require sibling cleanup to settle before propagating required cleanup failure. [Harness registry][openclaw-registry] and [cleanup cases][openclaw-registry-tests].

Agent-compositor already exposes public turn, batch, context and journal services. Invocation-scoped context objects expire after a turn or hook timeout, and retained plugin APIs are revoked after unload. The customization and hook tests exercise these restrictions. These are host API boundaries; trusted JavaScript still runs in-process and is not an OS isolation boundary.

Policy approval and OS execution confinement must remain separate. A plan-mode prompt alone does not prevent mutation, and a tool permission decision alone does not confine an unrestricted subprocess. Exact command and request identity also matter: [Crush grant cases][crush-grants] verify that an answer cannot widen the issued grant.

## External clients and session managers

Codex app-server exposes persistent conversations, streamed events, interruption and approval handling through a documented protocol. ACP integrations provide another way to host an agent behind a client. These protocols can supply structured lifecycle information that a terminal manager would otherwise infer from text. [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

The manager layer still owns a different problem:

| Manager | Mechanism | Boundary |
| --- | --- | --- |
| Agent Deck | Session integration, terminal state and transcript inspection; background work classification. | A detected terminal state is weaker than an authoritative engine completion event. |
| Agent of Empires | Persistent agent sessions, worktrees, lifecycle tracking, container options and structured interfaces. | Workspace/process management remains distinct from the selected agent's reasoning loop. |
| Claude Squad | An instance binds a program to a tmux session, a branch and a worktree. | Filesystem separation does not imply coordinated budgets or automatic semantic task merging. |

See [Agent Deck background classification](https://github.com/asheshgoplani/agent-deck/blob/f7017710f879f2a232c1616ff43dded8247573e1/internal/session/background_work.go), [Agent of Empires worktree creation](https://github.com/agent-of-empires/agent-of-empires/blob/055fc40185d61b836949c40d70d830395f0f4817/src/git/worktree/create.rs) and [Claude Squad instance ownership](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/session/instance.go).

An adapter contract for Compositor would need stable session identity, lifecycle events, prompt/interrupt operations, approval exchange, capability negotiation, reconnect behavior and usage ownership. Parsing a terminal remains a compatibility path for engines without that interface.

## Agent compositor baseline

The active product engine is [packages/core/src/loop.ts](../packages/core/src/loop.ts). The smaller packages/agent loop is historical reference code and must not be used to infer current product gaps.

| Area | Existing implementation at the baseline | Remaining distinction from the references |
| --- | --- | --- |
| Replaceable execution | Public turn, batch, input/context and journal services; invocation-scoped capabilities. | A serialized transition/checkpoint engine is a possible alternative implementation. |
| Parallel tools | Sequential default; a replacement batch strategy can run calls concurrently through the permission gate. | ToolSpec has no declared-resource locking contract. |
| Context | Summary/tail compaction, schema overhead, pressure management and explicit restoration. | No separately selected, validated model-visible projection contract comparable to the DSH surface. |
| Session persistence | Replaceable repository, append-only events, history and replay. | Default writes are best effort; incomplete tool exchanges are not repaired by replay. |
| Independent agents | Separate cores, transcripts, permissions and budgets; optional worktrees. | External engine adapters need lifecycle and capability mappings beyond a pane. |
| Background work | Plugin-owned lifetimes, bounded deduplicated wake queue, shell completion events. | Ordinary sessions and OS jobs do not automatically become durable restartable services. |
| Workflows | DAG scheduling, leases, token reservations, stage recovery and completion generations; Python result-prefix replay. | Saved results do not establish repository freshness or exactly-once side effects. |
| Memory | Explicit project/global notes, skills, task plans and conversation history. | Automatic memory-provider extraction/recall/checkpoint authority is a distinct possible extension. |

Relevant local sources and tests:

- [Strategy contracts](../packages/core/src/customization.ts), [customization cases](../packages/core/test/customization.test.ts).
- [ToolSpec](../packages/tools/src/types.ts), [context compaction](../packages/context/src/compaction.ts).
- [Session repository](../packages/session/src/repository.ts), [replay](../packages/core/src/resume.ts).
- [Plugin lifetime cases](../packages/hooks/test/hooks.test.ts).
- [Workflow engine](../plugins/workflows/engine.ts), [Python journal](../plugins/workflows/tools.ts), [workflow limits](../plugins/workflows/README.md).
- [Memory plugin](../plugins/memory/hooks.ts).

## Reproduced local observations

Follow-up implementation on 2026-11-11 addresses both observations below.
Configured journal failures now stop execution and replay supplies interrupted
results for incomplete tool exchanges. The default store also serializes
concurrent appends within an instance. The observations retain their historical
baseline; see [current session behavior](agent-features.md#interactive-chat-history)
and [journal contracts](core-customization.md) for the updated guarantees.

### Journal failure can coexist with a completed tool and turn

The probe injected a SessionJournal whose create method succeeded and whose append method always threw. A ScriptedProvider requested one in-memory tool and then returned a final answer.

Observed result: 19 append attempts failed, the tool executed once, the core emitted turn.complete, state became idle and failure remained absent. No project file or external system was changed by the tool.

This matches the explicit catch in AgentCore.persistDefault: ordinary session storage is best effort. It means that completion in the live session is not evidence that the transcript or tool result was saved. The design choice is valid for an availability-oriented session, but a durable execution mode needs a different persistence/error contract. [Persistence implementation](../packages/core/src/loop.ts).

### Replay can send an unmatched tool call to the provider

The probe replayed a user prompt followed by one tool.call event with no tool.result, representing an interrupted event tail. replayTranscript returned a user message and an assistant message containing the unmatched call. AgentCore.resume then sent that unmatched call to ScriptedProvider with the continuation prompt.

The missing call ID remained `unfinished`. The probe establishes the incomplete request structure at the provider boundary; it did not contact a remote API or claim a specific vendor rejection.

A recovery policy should account for pending calls before the next request: synthesize an explicit interrupted result, reconcile a durably identified job, or stop for recovery. It should not silently re-run an unknown external effect. [Replay implementation](../packages/core/src/resume.ts), [wire conversion](../packages/provider/src/openai-compat.ts).

## Candidate design work

These are study conclusions for discussion, not accepted implementation tasks.

1. **Close replay integrity first.** Give every admitted tool call a terminal result or an explicit unresolved state. Check provider-visible history after cancellation, crash and context changes.
2. **Make durability a selected contract.** Distinguish best-effort chat storage from execution that requires durable admission and result records. Expose storage failure and recovery status when that mode is selected.
3. **Separate history from request projection.** Validate call/result groups, context replacements and provider metadata at the model boundary while retaining the audit history.
4. **Define concurrency metadata.** Allow tool implementations to declare execution mode and canonical resource keys; preserve deterministic transcript order and permission checks under custom schedulers.
5. **Specify cancellation scope and settlement.** Distinguish prompt, turn, child, workflow, queue and session shutdown. Define which work remains queued and which late results are excluded.
6. **Use typed recovery signals.** Bound retry/compaction and distinguish a retryable transport error, a context overflow, truncated output, an authorization failure and an already executed provider action.
7. **Keep memory and background ownership explicit.** Tie extraction, recall, completion delivery and retained APIs to the correct session, actor and plugin generation.
8. **Add external harness adapters through capabilities.** Keep tiling independent of engine choice; define the structured lifecycle needed to integrate engines through ACP, app-server or an engine-specific protocol.

## Reference reading order

For a new engine implementation, start with Pi's loop and Vibe's transition/checkpoint boundary. For tool scheduling, compare Codex's shared/exclusive gate with OpenHands' resource locks. For durable conversation state, compare OpenCode's execution claims, DSH's surface projection and OpenHands' event views. For orchestration, study Qwen's scheduler and replay alongside Compositor's existing workflow engine. For long-term memory, inspect Hermes' provider and fork-scope contracts. For whole-engine replacement, inspect OpenClaw's registry ownership and cleanup rules.


[vibe-session]: https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/harness/core/src/core/session.rs
[vibe-checkpoints]: https://github.com/mistralai/mistral-vibe/blob/b20313e01d6926d4191da89c32d5da11e3a0a060/harness/core/src/core/checkpoint/tests/invariant_tests.rs
[goose-machine]: https://github.com/aaif-goose/goose/blob/b7a5014e0c3e939adcdbf1c13e6ca395f6807329/crates/goose-agent/src/machine.rs
[goose-cancel]: https://github.com/aaif-goose/goose/blob/b7a5014e0c3e939adcdbf1c13e6ca395f6807329/crates/goose-agent/tests/cancellation.rs
[pi-loop]: https://github.com/earendil-works/pi/blob/473515f9c297c75cf2c3ebb3ba027049ed836d27/packages/agent/src/agent-loop.ts
[pi-loop-tests]: https://github.com/earendil-works/pi/blob/473515f9c297c75cf2c3ebb3ba027049ed836d27/packages/agent/test/agent-loop.test.ts
[codex-parallel]: https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/core/src/tools/parallel.rs
[gemini-parallel]: https://github.com/google-gemini/gemini-cli/blob/e5d88fb2c036ce7e0c27131469cd963221b9d9e7/packages/core/src/scheduler/scheduler_parallel.test.ts
[cline-runtime-tests]: https://github.com/cline/cline/blob/7796dc9ce12a6377796d1c265036c4038ff3fcb6/sdk/packages/agents/src/agent-runtime.test.ts
[openhands-executor]: https://github.com/OpenHands/software-agent-sdk/blob/5ff99f1b6ca28f7d16870b69f57a31351e59bcd0/openhands-sdk/openhands/sdk/agent/parallel_executor.py
[openhands-locks]: https://github.com/OpenHands/software-agent-sdk/blob/5ff99f1b6ca28f7d16870b69f57a31351e59bcd0/openhands-sdk/openhands/sdk/conversation/resource_lock_manager.py
[dsh-surface]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/src/surface.ts
[dsh-surface-tests]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/tests/surface.spec.ts
[openhands-atomicity]: https://github.com/OpenHands/software-agent-sdk/blob/5ff99f1b6ca28f7d16870b69f57a31351e59bcd0/tests/sdk/context/view/test_view_condensation_batch_atomicity.py
[opencode-compaction]: https://github.com/anomalyco/opencode/blob/63b42f6f02e4b74fae343eddbe567db2c53fcf21/packages/core/src/session/compaction.ts
[gemini-compaction-tests]: https://github.com/google-gemini/gemini-cli/blob/e5d88fb2c036ce7e0c27131469cd963221b9d9e7/packages/core/src/context/chatCompressionService.test.ts
[goose-compaction-tests]: https://github.com/aaif-goose/goose/blob/b7a5014e0c3e939adcdbf1c13e6ca395f6807329/crates/goose/src/agents/state_machine/tests/compaction_lifecycle.rs
[kimi-loop-tests]: https://github.com/MoonshotAI/kimi-code/blob/7490d07d358d1f6736cf87abf7a7ae22d6ea8897/packages/agent-core-v2/test/agent/loop/loop.test.ts
[dsh-cancel]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent-loop/tests/cancel.spec.ts
[dsh-shutdown]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent-loop/tests/shutdown-drain.spec.ts
[grok-cancel]: https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_session_tests/cancel_running_task_tests.rs
[codex-cancel]: https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/core/tests/suite/dynamic_tool_cancellation.rs
[crush-cancel]: https://github.com/charmbracelet/crush/blob/1b7582dbba81e0f716e50f20fe44bd04faf7251f/internal/agent/dispatch_cancel_test.go
[opencode-execution]: https://github.com/anomalyco/opencode/blob/63b42f6f02e4b74fae343eddbe567db2c53fcf21/packages/core/src/session/execution.ts
[cline-restore]: https://github.com/cline/cline/blob/7796dc9ce12a6377796d1c265036c4038ff3fcb6/sdk/packages/core/src/session/checkpoint-restore.test.ts
[kimi-fork]: https://github.com/MoonshotAI/kimi-code/blob/7490d07d358d1f6736cf87abf7a7ae22d6ea8897/packages/agent-core-v2/test/session/subagent/forkParity.test.ts
[hermes-capabilities]: https://github.com/NousResearch/hermes-agent/blob/d5640d525a420a7d14570e85efe5e9db5249cc65/tests/tools/test_delegate_capability_inheritance.py
[qwen-workflow]: https://github.com/QwenLM/qwen-code/blob/c238beb56fa3c65a0f62ad7a3b2cd14db978b998/packages/core/src/agents/runtime/workflow-orchestrator.ts
[qwen-scheduler-tests]: https://github.com/QwenLM/qwen-code/blob/c238beb56fa3c65a0f62ad7a3b2cd14db978b998/packages/core/src/agents/runtime/workflow-dispatch-scheduler.test.ts
[qwen-budget-tests]: https://github.com/QwenLM/qwen-code/blob/c238beb56fa3c65a0f62ad7a3b2cd14db978b998/packages/core/src/agents/runtime/workflow-budget-ledger.test.ts
[hermes-checkpoint]: https://github.com/NousResearch/hermes-agent/blob/d5640d525a420a7d14570e85efe5e9db5249cc65/tests/agent/test_pre_compress_checkpoint_contract.py
[hermes-fork]: https://github.com/NousResearch/hermes-agent/blob/d5640d525a420a7d14570e85efe5e9db5249cc65/tests/agent/test_memory_manager_fork_scope.py
[openclaw-registry]: https://github.com/openclaw/openclaw/blob/afa73f35c911300fb096043e713dc393ff2b7a32/src/agents/harness/registry.ts
[openclaw-registry-tests]: https://github.com/openclaw/openclaw/blob/afa73f35c911300fb096043e713dc393ff2b7a32/src/agents/harness/registry.test.ts
[crush-grants]: https://github.com/charmbracelet/crush/blob/1b7582dbba81e0f716e50f20fe44bd04faf7251f/internal/permission/grant_scope_test.go

