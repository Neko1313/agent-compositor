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
when one exists. Model policy (reference provider/model, public configuration,
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
start at their manifest's initial version. Existing higher development versions
are preserved during the transition to automation.

`.plugin-release.json` records the bootstrap snapshot and each prepared source
baseline. Generated version/changelog commits do not cause another release PR;
new runtime changes accumulate until the open PR is refreshed or merged. The
catalog metadata version advances once per changed batch. Published archive
entries remain pinned until the separate certified catalog promotion below.

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
