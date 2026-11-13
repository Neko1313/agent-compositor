# Contribute to Compositor

Use the same repository for implementation, tests and documentation. Repository
documentation and comments are written in English.

## Set up development

Install Node.js 22.19.0 or later, Bun and ripgrep, then:

```bash
npm ci
npm run start -w @agent-compositor/app
```

See [dependency maintenance](dependencies.md) for supported tool versions and
[provider settings](state-and-network.md) to configure your model. Examples and
tests use controlled providers where possible; running checks does not require
putting real credentials in fixtures.

## Choose the verification scope

```bash
npm run typecheck
npm test -- packages/core/test/loop.test.ts
npm run marketplace:validate
```

Use the affected package tests while iterating. `npm run test:ci` runs the full
TypeScript suite and coverage checks. For terminal behavior, follow
[the real PTY visual bench](../tools/visual/README.md). Read
[evaluation guidance](evals.md) for scripted versus live model evidence and
[plugin certification](plugin-testing.md) for extension release requirements.

The Node 26 CI job also runs `npm run visual:opentui-app` and
`npm run visual:opentui-managers` with the bench's Chromium browser. Native
release jobs repeat those commands against an archive
extracted outside the checkout on each declared platform, retaining its report,
terminal captures and executable/asset identities. The command uses isolated
profiles and a local HTTP fixture; no live API key or paid request is required.

## Update documentation with behavior

When a change affects usage, configuration, a public contract, installation or
operational limits, update the corresponding canonical page in the same change.
Use `npm run docs:impact -- BASE_REF` to identify related pages from your Git diff.
Record a concrete explanation in the PR when no documentation change is needed.

```bash
npm run gen
npm run docs:gen
npm run docs:check
```

Commit changed generated references alongside their inputs. The site build
rejects broken repository links, document links, anchors and stale reference
output. The example check verifies the first-plugin code through the actual app.

Read [documentation maintenance](documentation.md) for source ownership, previews
and the publication workflow. A successful site build checks mechanics; reviewers
also assess whether explanations match the changed behavior.

## Submit and release

Keep a focused diff, include the checks actually performed and explain observable
behavior and material limits. Use meaningful Conventional Commits: `fix` for
patches, `feat` for additions, and `!` / `BREAKING CHANGE:` for incompatible
changes. Include migration details in breaking commit bodies. Plugin versions,
changelogs and matching development catalog metadata are prepared automatically
in a release PR after main-branch pushes; do not hand-edit them for routine work.
Read the [plugin standard](plugin-standard.md#independent-versions-and-releases)
for review, preparation state and certification.

The main CI validates application behavior. The documentation workflow builds on
pushes and pull requests, and publishes successful main-branch builds to GitHub
Pages. Native application and independent plugin releases retain their separate
[release gates](releases.md).

For the broader development target, use the [1.0 readiness gates](readiness.md).
`npm run typecheck` also checks the evaluation runner, grading, profile and
budget helpers. See [evaluation commands](evals.md) before running live models;
scripted integration checks and real model-quality evidence serve different
purposes.
