# Compositor plugin standard 1

A plugin is an independently versioned package. Agent services/hooks, tools,
UI, skills and stdio MCP can be combined in that package. Installing a package,
activating it, selecting a replacement provider and updating its version are
separate decisions. The compositor owns tiling; domain behavior belongs in plugins.

## Package contract

First-party native packages contain:

- `plugin.json`: identity, independent SemVer, trust, entry/components and
  `"compositor":{"standard":1,"apiVersion":1}`.
- `README.md`: purpose, requirements and observable usage.
- `CHANGELOG.md`: an entry for the current plugin version, including migrations.
- `plugin.test.json`: v2 profiles, individually bound mandatory cases and optional
  convenience suites. The test plan is metadata, never a runtime import.
- The required hooks/tools, `skills/`, MCP declarations and declared `resources`.

API version 1 names the current public host contracts. Unsupported standards or
API versions fail metadata validation before executable import. A missing
`compositor` declaration remains accepted for legacy/third-party packages; it is
not sufficient for a first-party release. Trust describes host execution powers,
not an OS sandbox. Dependency installation is explicit and requires a lockfile;
package scripts are disabled during normal marketplace installation.

Keep credentials out of packages, model-visible instructions and fixtures. Use
scoped settings, cancellation signals and truthful tool descriptors. Tools and
MCP calls pass through normal policy. Replacement services/controllers require
explicit selection and must preserve policy, privacy, journal and budget behavior.
`dispose()` stops subprocesses, connections, timers and listeners; reload restores
required state without depending on the previous module instance.

A successful tool result may include optional `modelText` with its structured
`data`. This supplies a model-facing text view while callers/UI keep the data.
See [presentation bounds and journal compatibility](core-customization.md#model-facing-tool-text)
before using it; omitted text preserves the legacy representation.

Tools may provide a pure synchronous `validate(args)` callback returning an error
string or `undefined`. The host checks detached effective arguments after tool
rewrites and before permission review or execution. Validators neither perform
effects nor grant authority; retain execution-time safeguards. See
[argument admission and compatibility](core-customization.md#tool-argument-admission).
The disk loader preserves this callback across load/reload and rejects a provided
non-function value as a plugin load error. It checks the field without invoking
the validator; malformed owners do not block unrelated valid or legacy tools.
Tools may also be class instances. Composition retains inherited `describe`,
`execute` and `validate` methods bound to the original instance, including private
state, and copies their declared metadata even when supplied by getters. Ordinary
object tools and native function identity keep their behavior.

## Finite query tools

Tools may opt in to repeated-observation recovery with `loopGuard: "query"` on
their `ToolSpec`. Use it only for finite read-only queries. Omit it for status
polling, streams and effectful operations. It does not grant read permission or
change the model-facing schema; ordinary descriptors and policy still apply.
Legacy tools without this optional field keep their behavior. See the exact
[recovery window and limits](core-customization.md#repeated-query-recovery).

## Immediate user commands

Declare `"execution":"immediate"` on a command to handle an explicit user
control independently of model turns. The host dispatches `command.invoke`
with `{plugin,name,text,args}` to its loaded owner. For example:

```json
{"name":"/control","description":"Change session controls","execution":"immediate"}
```

Handle `command.invoke` in the plugin; validate `args` before taking action.
The loader rejects immediate declarations without that handler.
Arguments are literal text, not shell input. A notification is enough for a
short control; a handler may explicitly publish a view for richer interaction.
No UI component, prompt hook, model request or conversation entry is implied.
This works in the TUI and through `AgentCore.submit`/`steer`, including while
the model runs or user prompts are queued. Agent-origin follow-ups do not use
this user-control path. Unmarked commands retain their existing prompt behavior.

The core tracks at most four simultaneous commands separately from user tools,
with five-minute deadlines, owner-scoped cancellation and shutdown cleanup.
Hook deadlines still apply. Tools use ordinary permissions and independent
user operations; auxiliary model usage consumes session/command budgets rather
than the active model turn's allowance. `command.operation` reports start and
settlement. `AgentCore.invokeCommand(text, callerSignal?)` returns false for an unregistered
control; failures of registered controls are errors, never fallback prompts.
The optional `AbortSignal` cancels only this invocation and its foreground tool
and auxiliary-model work. An already-aborted caller is rejected before handler
admission. Cancellation preserves Main and other invocations, including commands
from the same owner; ordinary permission checks and accounting still apply.
Explicit `$.background()` work and an already-started background exec retain their
documented independent lifetime. Cancellation does not roll back completed effects.
Embedders supply loaded `{name,plugin}` registrations through `userCommands`.
`AgentCore.hasImmediateCommand(text)` checks that live owner registry without
invoking a handler, for input dispatchers that preserve setup ordering while
keeping controls independent of the model queue.
These additive contracts require catalog 0.25 or later.

Catalog 0.26 adds `service.agent.open` for an explicit user control to open a
persisted shared-workspace conversation, or reopen one by `id`. Optional `prompt`
starts its independent turn; `name` labels a new agent. The result contains `id`
and `sessionId`. Agent-hub must be enabled. The host verifies user provenance,
retains ordinary workspace/permission/budget limits, and focuses the agent's
own Reply field. It does not interrupt or append a prompt to the main turn.
Models cannot use this service to change the user's focus. Existing agent and
tool contracts are unchanged.

## Commands that open UI

Catalog 0.27 adds optional semantic tables to `UiTextView`; omitted tables preserve
the existing text-view contract. Columns, unique rows, expanded details and
ordinary action IDs are renderer-independent. See [expandable tables](ui-theming.md#expandable-semantic-tables).
Catalog 0.28 adds optional [semantic tabs](ui-theming.md#semantic-tabs). Independently
distributed packages must feature-detect `$.ui.supports?.('tabs')` and retain an
appropriate older-host view; the SDK version inside a bundle is not a host feature probe.

An optional command route, `"ui":{"site":"main"}`, sends a TUI command directly
to the existing `ui.press` chain. For plugin `project-helper`, the event is
`{site:"plugin-project-helper-main",key:"command:/project-helper arguments"}`.
The host qualifies the local site with the loaded owner's name. Local site IDs
use lowercase letters, digits and hyphens, begin with a letter and have at most
64 characters. Arguments remain literal text, not shell input.

Handle that event in `ui.press`, validate arguments, and render progress/errors.
The TUI runs these explicit UI commands during an agent turn, without entering
prompt hooks, model context or the prompt queue. Successful opens focus the
declared surface on its workspace. Commands without either immediate execution or this route retain
normal queued prompt behavior. Keep a `prompt.submit` handler for the line-based
interface and older hosts. Do not opt conversation-changing/model-prompt commands
into this route. Tool calls from the handler still use `$.agent.tool` and its
ordinary permissions, independent cancellation and operation limits.

Only loaded plugins contribute command routes; activation/reload controls when
they appear. The route does not grant execution or activate a plugin. See
[authoring contracts](../plugins/plugin-author/skills/create-plugin/references/contracts.md)
for an example.

Do not combine `execution` and `ui` on one declaration. An immediate handler can
open its own view; the `ui` field preserves the older surface-specific route.

## Activation and scope

All filesystem plugins start off. A bundled package or an installed directory is
available code, not consent to execute it. Inactive packages contribute no hooks,
tools, UI, skills or MCP servers, and executable modules are not imported.
The repository's `agent-compositor` marketplace ships as an offline catalog with
the application. Bundled packages are an inactive cache: install a package in
the chosen scope before enabling it, so its locked version survives host upgrades.
Local development directories can be enabled directly in project scope. Refreshing that catalog and updating installed plugins are
explicit operations; application startup does not fetch remote code.

```text
/marketplace
/extensions install mascot@agent-compositor --project
/extensions enable mascot --project
/reload
/extensions disable mascot --project
/reload
```

The TUI **[Plugins]** manager connects catalog search, scoped installation,
explicit enable, update checks and application without requiring slash commands.
Management remains available while the agent runs or waits for an answer. TUI
updates, rollbacks and removals requested while busy remain deferred in memory
until **Apply plugin changes** (or `/reload`); running package files are retained
until idle. See [the terminal flow](../packages/app/README.md#manage-plugins-while-the-agent-works)
for cancellation, restart and queued-application behavior. The line-based
interface retains its existing turn-based command handling.

Deferred file operations belong to the requesting management signal. Aborting
that signal discards its unapplied update, rollback or removal. Replacing a
queued action transfers that queue entry to the latest caller. Saved installation
and activation choices have their ordinary persistence. The source-only
[OpenTUI preview](02-ui.md#opentui-conversation-prototype) uses this lifecycle
and applies its pending changes automatically after Main becomes idle.

`--project` changes this project; `--user` changes the user's defaults across
projects. Project decisions override user decisions, including project enable
over user disable. A user-scoped grant selects shared code; a project-local copy
of the same name needs an explicit project decision and cannot silently shadow it.
Activation records bind the chosen code directory; a missing installation does
not silently switch to another discovered copy. Installation always leaves a new package off in its chosen
scope. Updating or rolling back preserves activation decisions. A configured
`enabledPlugins` list remains an exact capability ceiling; `disabledPlugins`
remains binding. Directory discovery and `--plugins` do not grant activation.

Kernel implementations of the base loop/file tools, session/model/settings and
management commands remain available to bootstrap the app. They are not packages
from the marketplace. Existing explicit composition/tool selections can also
restrict these host adapters. The low-level PluginLoader SDK is a loading
primitive; the application supplies the activation policy before calling it.

Project activation and version locks live in the project's private storage state
(`storage.paths.state/extensions-state.json`); user decisions live under the
configured Agent home. Installed project code lives in `.agent-compositor/plugins`.
Project selections survive restart and do not affect another project. When the
workspace itself is HOME, project installations use private project storage to
keep them separate from user installations. Legacy locations remain readable. Filesystem
edits to active local development plugins still use `/reload`; managed release
updates must use a new version.

## Mandatory certification

The [plugin testing model](plugin-testing.md) is enforced by schemaVersion 2
plans and `plugin:certify`. The package standard and host API remain version 1;
the test-plan schema evolves independently. Legacy schemaVersion 1 plans can
still run with `plugin:test`, but cannot certify a release.

Every plan declares component and behavior profiles, supported platforms,
`previousVersion` (null only for the first independent release), and `cases`.
The runner derives the union of mandatory requirements from every selected
profile. Missing bindings, skipped/failed cases, no evidence, duplicate names,
retries/flaky passes, and mismatched source/artifact contexts block certification.
There is currently no author-controlled waiver or skip-to-pass mechanism.
Applicability is expressed by accurate component/trait declarations, reviewed
with the implementation. Metadata checks reject obvious omitted command, tool,
skill, agent-service and MCP profiles; arbitrary trusted code still needs review.

A case has a stable ID, requirement IDs, kind, initial setup, expected/forbidden
effects, a timeout, and an execution binding. A `vitest` binding names a repository
file and the exact full name from its JSON report (ancestor titles separated by
spaces). A `scenario` binding names an executable Bun script and arguments.
Scenario scripts use `tools/plugins/scenario.ts`: read `scenarioContext()`, make
real assertions, save observations under the supplied output directory, then call
`finishScenario()`. UI/live/upgrade/artifact cases require scenarios. Binding
labels do not replace assertion review.

```sh
npm run plugin:check -- notify-done
npm run plugin:test -- notify-done          # legacy convenience suites, not a release gate
npm run plugin:certify -- notify-done       # mandatory deterministic PR matrix
npm run plugin:audit -- --stage release    # inventory missing bindings; nonzero if incomplete
npm run plugin:certify -- notify-done --stage release
npm run plugin:build -- notify-done
npm run plugin:certify -- notify-done --stage artifact --artifact path/to/candidate.tar.gz
```

See `plugins/notify-done/plugin.test.json` for a working deterministic example.
All current native packages have v2 profiles and actual installed-package
lifecycle, domain, UI and model scenarios where applicable. Binding completeness
is not execution: certificates still require passing results for the exact source,
reference configuration and every declared archive platform.

PR certification runs adversarial shared host contracts and every applicable
bound deterministic case. Release certification requires clean committed inputs,
mandatory real PTY/model cases and the preceding tagged release's upgrade/rollback
when one exists. Native archive certification repeats upgrade/rollback from the
previous platform archive using artifact cases bound to the same release
requirements; previous-version/hash evidence must match that platform's pins.
Model policy (reference provider/model, public configuration,
task-set checksum, repeats, success floor and baseline) is declared before running;
scripted providers cannot satisfy it. Exact model/config/task metadata and
objective observations accompany live results. Fixture task definitions without
an executing grader/transcript are missing coverage, not passing evaluations.

Archive certification securely installs the exact candidate, verifies its embedded
source/plan/tooling identity, and repeats the applicable deterministic/UI behavior
matrix against that candidate. A single successful install/operation is only the
baseline and cannot replace the remaining component cases. The common scenario
checks inactive installation, useful operation, repeated invocation, double reload,
fresh-process restart, disabling, re-enabling and removal preserving independent
settings. It does not invent plugin-specific migration or model-quality evidence.

Results live in `reports/certification/<plugin>/<stage>/<platform>/` as a strict
certificate, readiness report, JUnit/JSON diagnostics and hashed observations.
Source, package, plan, host API, Git snapshot, platform and archive digest are
bound to the evidence. Tests use isolated homes/projects and local dependencies;
positive fixtures explicitly opt in. Do not enable packages in production just
to make test setup easier.

## Independent versions and releases

The host, marketplace metadata and each plugin have separate versions. For
first-party packages in this repository, a push to main runs
`plugin-release-preparation`, which creates or refreshes the
`automation/plugin-releases` pull request. It prepares plugin SemVer, changelogs,
relative development catalog versions and the generated plugin reference from
committed history. Routine contributions do not hand-edit those release fields.
A published catalog `version` must match the released artifact. The working
tree may be ahead of a pinned published entry; new plugins can be developed and
tested before being listed. Relative development entries must match their source
manifest. Normal CI reports versions pending automatic preparation; the generated
release PR uses strict version checks. No host version bump is needed to publish
a compatible plugin update.

Commit messages supply the release intent: `fix(callix): ...` selects a patch,
`feat(callix): ...` a minor, and `!` or a `BREAKING CHANGE:` body a major. Other
runtime changes default to patch. The highest level in a batch wins per plugin.
Affected files, rather than the optional commit scope, select the plugin. Include
migration details in the breaking commit body and review the generated notes.
Documentation/test-only changes do not bump versions. Changes to bundled
workspace inputs, selected runtime lockfile dependencies and distribution
packaging do. Unrelated documentation-site dependencies do not. New plugins
start at their manifest's initial version. Their first release history begins
with the manifest's introduction commit; earlier shared-code and packaging
changes do not become notes for a package that did not yet exist. Later bundled
changes remain included. Existing higher development versions
are preserved during the transition to automation.

`.plugin-release.json` records the bootstrap snapshot and each prepared source
baseline. Generated version/changelog commits do not cause another release PR;
new runtime changes accumulate until the open PR is refreshed or merged. The
catalog metadata version advances once per changed batch. Published archive
entries remain pinned until the separate certified catalog promotion below.
For an affected relative development entry, preparation also copies the source
manifest's description when provided, so marketplace search describes the same
behavior as the prepared package. Published archive descriptions remain pinned
with their released versions until catalog promotion.

For local diagnosis, use a clean committed checkout:

```sh
npm run plugin:prepare             # inspect the deterministic plan
npm run plugin:prepare -- --write  # apply it locally, normally done by the bot
```

The generator refuses a dirty checkout and does not stage unrelated developer
work. GitHub Actions must be allowed to create pull requests. The workflow keeps
default token permissions read-only, requests write permissions only for its
preparation job, and explicitly dispatches CI and documentation checks on the
generated commit: events created with `GITHUB_TOKEN` do not start those workflows
automatically. No separate personal token is needed. The PR still needs normal
review/merge; preparation does not create tags, publish artifacts or substitute
for release certification. Tag validation rejects a plugin with source changes
still pending automatic version preparation.
External plugin repositories provide their own release automation.

Use an annotated `plugin/<name>/v<version>` tag after verification. The independent
`plugin-release` workflow validates identity/version, runs the plugin's behavior
and lifecycle tests, enforces the complete release matrix, builds and certifies
four native archives, then publishes that plugin's release with checksums. It never
moves the application's `latest` release. Manual workflow dispatch builds only.
Release notes contain only the selected version's changelog entry.

Before creating a tag, manually dispatch `plugin-release.yml` on `main` with
`candidate_name` and `candidate_sha`. The SHA must be the full 40-character commit
of a pushed, clean source snapshot that includes this candidate workflow support.
The metadata step uses explicit Bash pipeline failure handling: a rejected
source stops verification even when its output is also saved with `tee`.
Pending automatic version preparation still blocks certification; merge its
generated PR first. All release checks, mandatory UI/live cases and the four
native archive checks remain required. For example:

```sh
candidate_sha=$(git rev-parse HEAD)
gh workflow run plugin-release.yml --ref main \
  -f candidate_name=project-checks -f candidate_sha="$candidate_sha"
```

This creates no tag or release. Download the `plugin-source-evidence` and
`plugin-<runner>` workflow artifacts to review certificates, screenshots and
archives. The separate `quality-plugin-source` and `quality-plugin-<runner>`
artifacts retain diagnostics even after failed certification. They are excluded
from the publication download set. `source.json` records the resolved commit, mode and intended plugin
identity; a candidate's intended tag need not exist. `source-commit.txt` records
the resolved SHA independently of the selected revision's metadata helper,
including when validating an older existing tag. Packaging jobs use the exact
verified SHA, even if a branch or tag later moves. Manual validation of an
existing tag remains available with `tag=plugin/<name>/v<version>`; do not combine
it with candidate inputs. Publication requires a tag push and rejects a tag that
no longer points to the verified commit.

```sh
npm run plugin:build -- todos
npm run plugin:smoke -- todos
```

Artifacts are platform-specific archives under `dist/plugins/<name>/<version>`.
Callix includes its verified native dependency; Monty includes its worker modules.
Public SDK imports are bundled and runtime resources retained. Release artifacts
are available independently. The marketplace installer consumes local/pinned Git
packages or platform archives pinned by SHA-256. Native release archives use
ustar with regular files/directories; extraction rejects links, special entries,
path escapes and duplicates, with bounded download/decompression sizes.
Other marketplaces may use a Git source object with a plugin tag or commit and a
`path` selecting its package. Official archive entries require certification. Relative entries inherit the
catalog's pinned snapshot. Installed applications use a matching self-contained
bundled snapshot; newer first-party versions require a published archive entry
instead of incomplete raw sources. Commit/version locks are recorded per installed plugin.

The release also publishes `certification.tar.gz` with the matching evidence and
`marketplace-entry.json`, containing all four artifact
URLs and checksums. Apply that reviewed entry with
`npm run plugin:catalog -- path/to/marketplace-entry.json path/to/certification/<name>`;
it revalidates complete evidence against the immutable plugin tag, retains it under
`.claude-plugin/certification/<name>/<version>/`, and updates only that
entry (or adds a newly released plugin) and increments the independent catalog
metadata version. Development can continue at a later version while an earlier
release is being promoted. Commit/push the
catalog change and its retained evidence explicitly. Official archive entries without
matching certification also fail marketplace validation, including manual catalog edits. Users can then refresh the catalog and update that
plugin without updating the host. Existing relative entries remain usable as
bundled snapshots/development sources before their first independent release.

## Explicit updates and rollback

```text
/marketplace update agent-compositor
/extensions check-updates
/extensions update todos --project
/reload
/extensions rollback todos --project
/reload
```

Catalog refresh does not replace code or change activation. `check-updates` reads
the current catalog without importing plugin code. Install/update validates the
manifest identity, catalog version, compatibility and resource/MCP paths first.
The installed state records the plugin version, source/ref/commit and SHA-256
content lock. Same-version changed content is rejected; downgrades require
rollback. Invalid candidates leave the installed version intact.

Successful updates retain the previous package and lock. Rollback verifies that
backup against its content lock before restoring it and preserves activation.
After reload, old resources are disposed and the restored version supplies all
components. Removal is explicit, keeps a backup and does not delete independent
user settings. Removing a marketplace registration retains installed plugins.
The marketplace UI requires selecting its confirmation toggle before submitting
Remove marketplace; Cancel or an unchecked confirmation retains the registration.

On Bun, loading a filesystem plugin clears that package's canonical-path module
cache before importing its hooks and tools. Relative dependencies inside the
package then refresh together, and both entry points share their new instance.
Linked host SDK modules outside the package retain their identity. A changed
manifest alone does not establish that new code is running; verify the updated
plugin's behavior. This package-local refresh is tested on Bun. Node's ESM
relative-dependency cache has different behavior and is not covered by that claim.
