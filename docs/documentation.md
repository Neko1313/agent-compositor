# Keep documentation current

Documentation is part of a behavior change. Its source stays beside the code,
is reviewed in the same pull request, and is published from the main branch.

## Canonical sources

| Content | Edit here |
| --- | --- |
| Guides, architecture and contracts | `docs/` |
| Plugin setup and lifecycle | The owner's `plugins/NAME/README.md` |
| Plugin release history | The owner's `plugins/NAME/CHANGELOG.md` |
| Terminal controls | `packages/app/README.md` |
| Visual verification | `tools/visual/README.md` |
| Event reference | `packages/events/src/catalog/`, then `npm run gen` |
| CLI, plugin and package references | Their source inputs, then `npm run docs:gen` |
| Site configuration, navigation and link adaptation | `website/` and `tools/docs/structure.mjs` |

The site copies canonical pages into ignored `website/.content/` at build time.
Never edit that projection or `website/build/`. Edit links on each page lead to
the canonical repository source. Links to published Markdown pages stay within
the site; links to source code and other repository files lead to GitHub.

Each topic has one canonical explanation. Other pages link to it. README files
give an entry point and setup; generated inventories summarize source metadata.
`MEMORY.md` records project decisions and historical verification, not the current
user manual. Dated milestones in the documentation index remain history.

## Work on a change

1. Find the canonical page before editing behavior. `npm run docs:impact -- BASE_REF` lists affected areas.
2. Update instructions, examples, defaults, limitations and migration notes together with the code.
3. Update source metadata and run `npm run gen` and `npm run docs:gen` when a contract, CLI option or plugin changes.
4. Run `npm run docs:check`. Inspect the preview for navigation and readability when changing presentation.
5. Include documentation impact and verification in the PR. Explain why docs are unaffected for an internal-only change.

The impact map routes changed paths to maintained pages. It is an advisory
review aid, not proof of semantic correctness. Required CI checks enforce
generation, examples, coverage of maintained modules and the site link graph.
The PR reviewer checks the explanation of behavior.

## Preview locally

```bash
npm run docs:gen
npm run docs:dev
```

Open `http://localhost:3000/agent-compositor/`. The site has a sidebar, page
contents, light/dark modes and a search index built from the documentation.
Local search is generated during the production build; to verify it:

```bash
npm run docs:build
npm run docs:serve
```

The preview uses the production `/agent-compositor/` base path. `docs:dev`
watches canonical page directories and refreshes the content projection after
Markdown changes. A new directory or navigation change can require restarting
the preview. Stale generated references are reported until you run `docs:gen`.

With the production preview running, `npm run docs:browser` checks desktop and
mobile navigation, keyboard search and theme switching using Playwright. It
retains screenshots and a report under `dist/docs-browser/`. Supply another base
URL as its argument to check a deployed site. An existing compatible Chromium
can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Test examples and generated references

The first-plugin tutorial includes a marked code block tied to a file under
`tools/docs/examples/`. The documentation check compares that block to its source
and executes the actual package through installation selection, command handling,
reload and disable. Keep useful examples small and runnable with controlled
dependencies. Do not run arbitrary shell fences or model-generated snippets as
part of a generic documentation build.

CLI help comes from the real application entry point. Plugin identities,
versions and descriptions come from manifests. Package identities come from
workspace metadata. These generated pages are committed, so a source change
without regeneration fails instead of silently publishing an older reference.

The event catalog has its own committed generator and compatibility checks.
Example configuration must match the current runtime's supported options; the
composition schema intentionally leaves some subsystem settings loosely typed.

## Add a page or module

Add the canonical Markdown page to the appropriate section in
`tools/docs/structure.mjs`. Every `docs/**/*.md` file must appear in that inventory.
The inventory also publishes all native plugin READMEs and changelogs. New
packages and plugin manifests change generated inventories automatically.

Add a source-to-page association in `tools/docs/coverage.json` for a new package
or capability. The coverage check rejects an undocumented package or missing
target; it cannot judge the quality of the page's prose.

## Publication and version scope

`.github/workflows/docs.yml` checks every push to main and every pull request.
Only main-branch pushes and explicit main-branch dispatches deploy. The deploy
job uses GitHub's Pages environment and OIDC; no personal access token is stored
in the repository. GitHub Pages must be configured to build with Actions.

The public URL is [neko1313.github.io/agent-compositor](https://neko1313.github.io/agent-compositor/).
This site describes main, not an immutable application release. Plugin pages
show their independent versions. Introduce release snapshots when maintaining
multiple supported host versions actually requires different documentation;
avoid copying all documentation for every plugin patch.

## Writing conventions

Use a tutorial for a first complete task, a how-to for a specific operation,
a reference for exact contracts, and an explanation for architecture and reasons.
Keep current behavior separate from proposals and dated decisions. State the
tested scope of a claim. A passing scripted fixture is not evidence of universal
model quality or native terminal support.
