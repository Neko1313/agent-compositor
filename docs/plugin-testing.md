# Plugin testing model

Status: enforced fail-closed certification model for native plugin releases. The
v2 schema, requirement catalog, exact-case runner and publication/catalog gates
are implemented. Existing green convenience suites still do not establish full
readiness. Current packages have bound component/trait profiles and lifecycle,
domain, UI and model cases where applicable. Missing required bindings or
evidence block certification; readiness always belongs to an exact source,
reference configuration and artifact platform. See the committed release
summaries under `reports/certification` for historical verification evidence.

## Three distinct responsibilities

1. **Host contract:** the kernel enforces activation, scope, permissions on its
   guarded tool paths, ownership, version locks and package lifecycle. Run the
   shared contract suite against the host. Each plugin must also exercise its own
   contributions through that lifecycle.
2. **Plugin behavior:** the package fulfills its documented purpose, handles bad
   inputs and failures, and cleans up its effects. Test the actual package through
   public host contracts. Authors provide domain-specific fixtures and assertions.
3. **Agent effectiveness:** instructions, skills and agent services guide a real
   model to the intended outcome. Scripted providers test orchestration; they do
   not establish real model quality. Model-dependent changes need separate live
   evidence on the declared supported model configuration.

Native trusted modules have host execution powers. Permission tests cover the
host-mediated operations the plugin uses; they do not establish an OS sandbox
for arbitrary Node.js code.

## Determine requirements before writing tests

Declare components: command/hook, tool, skill, UI view/controller, agent service,
MCP and composite package. Declare behavioral traits: mutates external state,
network I/O, subprocesses, persisted state, interactive input, private input and
model-dependent behavior. Requirements are the union of component and trait
profiles. A composite package cannot select only its easiest profile.

A passive text panel does not need a password-form test. A synchronous formatter
does not need a network-timeout test. Applicability follows the declared behavior
and public contracts, with review; arbitrary trusted code prevents fully reliable
automatic capability inference. Missing required bindings block certification.
A non-applicable case needs a concrete reviewed reason. It must not be represented
as a skipped test or a passing no-op.

## Mandatory host and package lifecycle

| ID | Required observation |
| --- | --- |
| `host.activation` | Discovery/install does not import or execute disabled code; no owned tools, skills, views or MCP contributions appear. |
| `host.scope` | User and project choices persist; project decisions take priority; unrelated projects remain unaffected. |
| `host.source` | A selected source cannot be replaced by a different discovered copy with the same name. |
| `host.policy` | Denied host-mediated operations do not invoke the implementation or start its external work. |
| `host.update-integrity` | Wrong identity/version/checksum, unsupported compatibility and invalid candidates leave the existing installation intact. |
| `host.rollback` | A verified previous package and its state can be restored; modified backups are rejected. |
| `package.activate` | After explicit activation, the actual documented command/tool/service/view/skill works. |
| `package.reload` | Reload twice and exercise it again: no duplicate effects, registrations or background jobs. |
| `package.restart` | A fresh process uses the selected package/version and restores the documented configuration/state. |
| `package.disable` | After disable/reload, owned contributions disappear and callbacks/processes/listeners stop. |
| `package.reenable` | Re-enable restores behavior without stale connections or duplicated work. |
| `package.remove` | Removal clears owned runtime contributions and retains independent user settings. |

Host guarantees use adversarial fixture packages in the shared SDK suite. Package
lifecycle cases use the actual plugin and its declared observable behavior. Passing
the shared SDK fixture does not substitute for exercising the actual package.

## Mandatory behavior by component

| Profile | Required cases |
| --- | --- |
| Command/hook | Recognized trigger produces the expected effect; unrelated input passes through; repeated invocation has the documented result; a thrown failure does not corrupt the host or leave partial state. |
| Tool | Useful successful result/effect; invalid and missing arguments; guarded permission denial with zero effects; dependency failure; truthful failure result; cancellation/timeouts for asynchronous work. |
| Skill | Description discovered only while enabled; correct body/resources loaded; source precedence; successful real task; irrelevant request does not activate the workflow; missing inputs lead to clarification. |
| Passive UI view | Actual content and empty/error states render; enable/disable/reload removes/restores the correct view; narrow and normal terminal sizes remain usable. |
| Interactive UI/controller | Real keyboard and pointer path; focus; submit/cancel; restart/reload with an interaction pending; drafts and private input obey the controller contract. |
| Agent service | Explicit provider selection; correct task result and routing; dependency failure; cancellation and budget termination; policy/journal invariants for the replaced service; honest incomplete/failure output. |
| MCP | Valid RPC to a local fixture; malformed config rejected; namespaced identities; initialization/remote errors; timeout/disconnect; denied call starts no process; changed config reconnects; disable/close stops processes. |
| Composite | Exercise all selected components together, then repeat after update, rollback, disable/re-enable and restart. |

These are obligations, not suggested test-file names. Each obligation needs a
runnable case and concrete assertions. Existing integration cases can satisfy
multiple obligations when they actually observe all of those outcomes.

## Mandatory traits

- **Mutation:** expected diff/artifact; an invalid or denied operation leaves
  external state unchanged; partial failure has documented recovery semantics.
- **Network:** deterministic local service; success, error status, malformed
  response, unavailable service and bounded timeout; cancellation stops work.
- **Subprocess:** real local process; failure/exit, cancellation, timeout and
  disposal; no child remains after lifecycle teardown.
- **Persisted state:** fresh state, reload/restart restoration, invalid state and
  supported schema migration; no cross-project leakage.
- **Private input:** input reaches only its intended receiver and is absent from
  model messages, ordinary logs and public event payloads.
- **Model dependence:** task cases and live evaluation described below.

## Test case contract

Define each case before implementation:

- Stable ID and requirement IDs it proves.
- Plugin component/traits, host API and supported platform applicability.
- Initial files/configuration/state and local dependency behavior.
- User request or event sequence, including the selected scope.
- Required result/effects and explicitly forbidden effects.
- Objective oracle: tool result, file diff, process/event observation, real UI
  interaction, or behavior of an exported artifact.
- Step/time/tool-call budgets; model/token limits when applicable.
- Execution binding to the actual test and required evidence artifacts.

An assistant's success message is not an oracle. Artifact graders need a negative
control: the same checker must reject a deliberately wrong/missing artifact or
false-success response. Sensitive effects use deterministic assertions; a model
judge cannot override a failed scope, permission or privacy invariant.

Bindings must identify executed cases, not just a broad suite path. A matching
filename, a test-name label or a declared requirement ID alone does not prove
assertion quality; that remains a review obligation. The runner must verify that
every required binding executed and passed, rather than accepting one passing
test anywhere in a file.

## Agent and skill evaluation

A task set includes:

1. An intended task with enough information and a verifiable outcome.
2. A nearby irrelevant task where the workflow should not activate.
3. Missing required input: ask a targeted question before acting.
4. A tool/dependency failure: report it honestly and preserve state.
5. A denied operation: stop that operation without a substitute that bypasses
   the restriction.
6. Untrusted tool/document content attempting to change scope or instructions.
7. Cancellation and a tight budget: terminate without continued side effects.

Use scripted cases for deterministic orchestration and policy checks. Changes to
instructions, skill content or model-driven decisions also require live runs on
the supported reference model configuration before release. Publish the model
identity/date/configuration, exact task-set digest, repeat counts, outcomes and
cost/budget. Repeated live runs measure variability; one successful example is
not certification of general reliability.

Declare the task-success floor and baseline comparison before running evaluation.
Do not invent a universal percentage for every domain, silently drop failing
cases or hide outages as passes. Critical invariant failures always block release.
A regression against the previous released behavior needs resolution or an
explicitly reviewed change in the intended contract. First releases establish the
baseline; they cannot claim historical compatibility from synthetic old versions.

## Required execution stages

| Stage | Obligations |
| --- | --- |
| Local iteration | Metadata/type checks, changed behavior cases and relevant deterministic integration cases. |
| Pull request | Shared SDK contract plus all applicable deterministic plugin cases. Host API changes run affected consumers, conservatively all plugins when impact cannot be bounded. |
| Release candidate | Complete required matrix; package lifecycle; real UI checks for UI profiles; model evaluation for model-dependent changes; previous-release upgrade/migration/rollback when a previous supported version exists. |
| Built artifact | Install the exact produced archive and repeat the artifact-facing contract/behavior smoke on every declared supported platform. When a previous release exists, upgrade from its pinned platform archive and roll back on every platform too. Source-only tests do not count as artifact verification. |
| Catalog promotion | Require successful evidence for that plugin version and those exact artifact checksums. Promoting a catalog entry never substitutes for testing it. |

The first release has no previous plugin artifact: mark the previous-release
migration requirement not applicable with that factual reason, but still run the
host's update/rejection/rollback fixtures and the package's fresh-install cases.
Compatibility promises need explicit host/API/platform coverage; a single current
host test cannot establish support for all earlier hosts.

## Readiness and evidence

Required cases have one status: passed, failed, missing, blocked or reviewed
not-applicable. Required skips, empty runs, missing evidence, unsupported required
platforms and external-service outages do not produce a green release gate.
Optional exploratory tests are reported separately. A flaky required case blocks
release until fixed or the contract is explicitly changed; rerunning until green
does not erase failures.

Record plugin version, source/artifact checksums, host/tooling versions, platform,
test-plan and fixture digests, model configuration where relevant, and per-case
results with logs/screenshots/traces. Source tests and artifact tests remain
separate evidence. Reuse evidence only for matching content and declared context.

Publication requires all applicable requirements passed and no unresolved
critical failure. There is no averaged readiness score that compensates for a
failed mandatory requirement.

## Implementation and adoption

The executable requirement catalog is `packages/loader/src/testing.ts`. V2 plan
validation lives in the loader; `tools/plugins/certify.ts` executes the derived
matrix, and `tools/plugins/gate.ts` verifies it again before publication and
catalog promotion. CI automatically discovers current and newly added native
packages. Host changes conservatively exercise all consumers. Required gaps
produce a nonzero exit status; there is no migration bypass granting readiness.

The shared host fixtures cover inactive import, scope/source selection, guarded
permission denial, invalid versions, checksum/API rejection, retained API revocation
and verified rollback (including modified installed and backup contents).
Every current native package has a real installed-package lifecycle case and an
archive counterpart. The latter is a useful baseline, not all domain coverage.
The artifact gate derives the full non-model matrix again: source-only cases do
not count as archive evidence. UI observations must still use the real terminal.

A preceding plugin tag requires its pinned artifact matrix and upgrade scenarios.
Bind `release.upgrade` and `release.rollback` with `kind: "upgrade"` for source
release certification and separate `kind: "artifact"` cases for native archives.
Both results must identify the previous version and that platform's pinned
SHA-256; a Linux previous-archive receipt cannot satisfy a macOS certificate.
Source-only upgrade evidence does not substitute for native archive transitions;
a forgotten null previousVersion cannot silently waive that requirement. A release
certificate requires committed inputs. Promotion validates the immutable plugin
tag even when the working tree is developing a later version. Reports bind actual
code, plans, fixtures/tooling, platform and archive checksums, with checked evidence
files. Model evidence must match its predeclared reference policy and task digest.

Current native packages bind every derived requirement to executable cases.
`tools/plugins/behavior/` contains package-specific oracles for local HTTP,
CONNECT proxies, stdio MCP, native workers, files, migrations, workflow services,
private forms and authoring. These assert the actual effects and failure paths;
they do not infer success from a hook returning without an exception. Composite
cases repeat the component assertions after reload, a fresh process, a synthetic
contract-preserving update, rollback and re-enablement. That synthetic successor
is an installation fixture, not evidence of historical release compatibility.

Nine UI profiles use `tools/visual/plugin-check.mjs` through the real PTY bench.
The scenario proves the loaded source/extracted candidate identity and retains
terminal output, input, screenshots and a per-action report. It exercises visible
content, input/focus, narrow layout, dismissal and process restart; interactive
panels also use their actual actions. Composer attachments preserve editor input.
For workflows, both source and artifact visual cases additionally run the dynamic
run/stage table scenario with the exact same selected package. Its report must
include expansion/join, pause/resume, result inspection, keyboard, filter,
tab pointer/keyboard and narrow-table observations. Both legacy-journal and table evidence is retained;
a passing legacy-only view does not cover the newer workflow interface.

Six model profiles use `tools/plugins/live-scenario.ts`. Every task starts in a
fresh isolated project and runs the actual plugin against the predeclared Ollama
reference, three repetitions of each package's declared task set. The current
auto-approve and btw sets contain eight scenarios; the other sets contain seven.
Graders inspect generated files,
explicitly activated generated commands, workflow results, approval verdicts and
preserved/compacted context. Negative controls reject wrong outputs, unsafe
approvals, unchanged starters, unauthorized activation and lost goals. A failed
required repetition fails the entire run; thresholds are never reduced afterward.
`trajectory.json` retains requests, responses, actual usage, errors and task results.
Token and call budgets are enforced. Billing is recorded as unavailable when the
bridge exposes no monetary usage; it is not reported as zero cost.

Immediate command cancellation must target that command's operation through
`core.cancelOperations(owner)`. Interrupting the foreground turn must leave an
independent command running. The btw live cancellation case uses the actual
application/core command path, then requires cancellation settlement and no
answer notification; aborting the fixture's foreground signal cannot test it.

For local exploration, run a non-publishable evaluation with:

```sh
bun tools/plugins/live-scenario.ts plugin-author --standalone
VISUAL_OUTPUT=dist/plugin-visual/mcp node tools/visual/plugin-check.mjs mcp
```

Standalone evaluation is diagnostic evidence, not a release certificate. Use
`plugin:certify -- <name> --stage release` on the committed candidate for publication.
The live runner defaults to a local Ollama bridge. Set `PLUGIN_LIVE_OLLAMA_URL`
for another bridge and optionally `PLUGIN_LIVE_OLLAMA_TOKEN` for its bearer
credential. The release workflow requires the corresponding repository variable
and optional secret for model-dependent packages. Missing reference service or
credentials blocks that release rather than substituting a scripted model.

`npm run plugin:audit -- --stage release` checks binding completeness only;
`plugin:certify` executes them. A green audit, source test, local model trajectory
or Linux archive cannot certify unexecuted platforms. All four declared archive
platforms, immutable source inputs and any actual preceding release remain
publication requirements. The portable Claude compatibility example is not an
independently released native package and does not acquire native certification
through its catalog presence.

This is a testing/review boundary, not a security attestation against malicious
repository maintainers or test authors: trusted tests can lie about assertions.
The controlled workflow checks content and result completeness; reviewers must
still verify profile declarations, oracles and real runtime/model/UI observations.
JSON certificates are not cryptographic signatures. No earlier host-version or
unexecuted platform/model compatibility is claimed.
