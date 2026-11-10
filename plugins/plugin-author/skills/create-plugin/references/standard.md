# Plugin standard 1

Treat a plugin as an independently versioned package, containing any combination
of agent logic, UI, tools, skills and MCP. Native first-party releases declare
`"compositor":{"standard":1,"apiVersion":1}`, use SemVer, include README.md,
CHANGELOG.md and a plugin.test.json plan, and document runtime requirements.

The starter is a draft. Add request-specific behavioral tests before publishing;
a successful structure check does not prove release readiness. Certification needs
schemaVersion:2 with accurate component/trait profiles, supported platforms, the
preceding plugin version, and individually bound cases. Derive the required union
from every component, rather than selecting only an easy profile. Missing cases
block PR/release certification. A legacy schemaVersion:1 convenience plan cannot
certify a release.

Each case identifies requirements, initial setup, expected and forbidden effects,
time budget and an exact Vitest file/full-name binding or a real scenario script.
Real PTY/model/migration/archive scenarios use the certification context/result
protocol; their reports must match the source, plan, task-set, platform and archive.
Model-dependent packages declare reference policy and grading criteria before live
runs. Scripted providers, empty runs, skips and passing siblings are insufficient.
A composite retains all component obligations. Do not invent case bindings or
report success for tests whose oracles have not been implemented.

Source checkouts provide `plugin:check`, `plugin:test` (convenience suites),
`plugin:certify -- <name>`, `plugin:audit -- --stage release`, and stage-specific
release/archive certification. The release/catalog workflow rechecks complete
content-bound evidence. An installed application needs its own development/test
environment; do not claim repository-only runners are bundled in the app.

Test actual behavior, invalid input, permissions and cancellation as applicable.
For UI changes exercise the real PTY/input path; for MCP exercise real local RPC
and cleanup. For agentic behavior define concrete task inputs, expected effects
or evidence, and bounded time/steps. Keep deterministic CI cases separate from
live-model examples. Compound packages must retain every component through the
install/update/disable/re-enable/remove lifecycle.

All filesystem plugins start off. Installation does not enable one. After checks,
the user selects `/extensions enable <name> --project` or `--user`, then `/reload`
between turns. Project decisions override user defaults. Exact capability
allowlists remain binding; never replace them to activate your plugin. Provider
selection remains separate and requires restart when changed.

Runtime/skill/contract changes need an independent plugin version and changelog.
In the Compositor source repository, do not hand-bump these fields for routine
changes: use meaningful Conventional Commits (`fix`, `feat`, and `!` or
`BREAKING CHANGE:` with migration details). After pushes to main, the automated
release PR derives versions and changelogs from affected package/bundled files,
synchronizes development catalog entries, and runs CI/documentation checks.
`plugin:prepare` previews the plan from a clean committed checkout; generated
metadata does not replace certification or publish archives. External repositories
provide their own version/release automation.

Catalog refresh and plugin update are
separate explicit actions. Managed updates lock source/version/content; never
edit an existing published version in place. `/extensions rollback <name>` can
restore a verified backup after an update; reload applies it. Release tags use
`plugin/<name>/v<version>` and do not release the host app. The marketplace installer supports local/pinned Git sources and SHA-256-pinned
platform archives. Release CI emits marketplace-entry.json; the repository
maintainer applies it with plugin:catalog and commits that catalog update
separately. Bundled packages must be installed in the chosen scope before normal
activation, preserving their version across host upgrades.
