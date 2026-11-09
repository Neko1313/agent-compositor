# Dependency maintenance

Reviewed on 2026-11-10 against npm stable dist-tags and official upstream
releases. Prereleases are excluded. All 25 external direct dependencies are
listed below; internal workspace package versions are unchanged. Root and
standalone Monty/mascot lockfiles were refreshed, including compatible
transitive updates. `npm outdated --json` is empty after the refresh.

| Dependency | Before (installed) | Current | Purpose |
|---|---|---|---|
| @types/node | 24.19.2 | 26.6.6 | Node development types |
| @types/upng-js | 2.1.5 | 2.1.5 | APNG development types |
| @vitest/coverage-v8 | 5.1.0 | 5.1.0 | Coverage tooling |
| @xterm/xterm | 6.0.0 | 6.0.0 | Real PTY visual bench |
| git-cliff | 2.14.2 | 2.14.2 | Changelog tooling |
| playwright | 1.65.0 | 1.65.0 | Browser verification |
| tsx | 4.23.15 | 4.23.15 | Development TypeScript runner |
| typescript | 5.9.3 | 7.0.2 | Compiler/typechecking |
| vitest | 5.1.0 | 5.1.0 | Test runner |
| zod | 3.25.76 | 4.6.7 | Config, manifests and event validation |
| ajv | 8.20.0 | 8.20.0 | Plugin JSON Schema validation |
| marked | 17.0.6 | 18.1.3 | Terminal Markdown lexer |
| react-devtools-core | 8.0.0 | 8.0.0 | Ink development integration |
| string-width | 8.3.0 | 8.3.0 | Terminal cell measurement |
| jsonc-parser | 3.3.1 | 3.3.1 | Configuration parsing |
| undici | 7.30.2 | 8.12.4 | Model/tool proxy transport |
| ink | 8.0.0 | 8.0.0 | Terminal renderer |
| react | 19.3.1 | 19.3.1 | Renderer components |
| @types/react | 19.3.0 | 19.3.0 | React development types |
| ink-testing-library | 4.0.0 | 4.0.0 | Renderer tests |
| ignore | 7.0.14 | 7.0.14 | Ignore-aware search |
| omggif | — | 1.0.10 | Bounded GIF89a frame decoder |
| @types/omggif | — | 1.0.5 | GIF decoder development types |
| upng-js | 2.1.0 | 2.1.0 | Original APNG mascot decoding |
| @pydantic/monty | 1.5.0 | 1.5.0 | Replaceable native sandbox |

## Compatibility changes

- Node >=22.19.0 is required for development/source execution because Undici 8
  raises its minimum. CI tests both the minimum and Node 26 LTS. The compiled
  core still includes its runtime; Monty retains its separate Node bridge.
- TypeScript 7 requires explicit ambient Node types in the shared tsconfig.
  The repository uses its CLI, not the removed legacy compiler JavaScript API.
- Zod 4 uses explicit record key/value schemas. Refined questionnaire schemas
  use `safeExtend`; uniqueness validation and defaults remain intact. Legacy
  omitted unknown event payloads remain explicitly optional. Public schema
  conversion replaces private introspection and opaque generated placeholders
  for all 83 events. Runtime-only refinements still require Zod validation.
- Undici 8 changes HTTP proxy defaults. Explicit `proxyTunnel: true` preserves
  CONNECT for both model and tool traffic. HTTP fixture tests verify payloads,
  headers, bypass and streaming cancellation; Bun retains its native proxy path.
- Marked 18 trims trailing block blank lines; existing terminal rendering tests
  and the real PTY presentation scenario verify the supported Markdown subset.
- Compatible transitive updates include Vite 8.3.7 and Rolldown 1.2.18. Parent
  dependency constraints remain authoritative; unrelated transitive major
  versions are not forced through overrides.

See the [Zod migration guide](https://zod.dev/v4/changelog),
[TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
[Undici migration guide](https://github.com/nodejs/undici/blob/v8.12.4/docs/docs/best-practices/migrating-from-v7-to-v8.md)
and [Marked 18 release](https://github.com/markedjs/marked/releases/tag/v18.0.0).

## Native tools and CI

Bun 1.4.4, Callix 1.7.0, git-cliff 2.14.2 and Monty 1.5.0 were already the
latest stable releases. Callix keeps its verified platform archive hashes.
Harness² upstream HEAD remains `6868817518876de8fd170c6a8354daca273b6191`; its
Python package is 0.1.0 with no runtime dependencies and requires Python
>=3.12,<3.14. Its adapter was checked in an isolated Python 3.13 environment.
System Git/ripgrep/Python/uv are host prerequisites, not vendored dependencies;
this refresh does not mutate user-wide tool installations.

CI actions are pinned to immutable commits for checkout 7.0.1, setup-node
7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, setup-bun 2.2.0 and
git-cliff-action 4.9.1. JavaScript actions use Node 24 internally and require
Actions Runner >=2.327.1. Hosted runners satisfy this independently of the
application Node matrix. Artifact digest mismatches fail release verification.
See [release maintenance](releases.md) for native platform constraints.

## Verification

- Typechecking and the full suite: 518 passed, 3 optional native cases skipped
  in the generic run; 25 explicit native Callix tests passed separately.
- Scripted evals 5/5 and tool-selection evals 3/3; marketplace validation and
  proxy smoke passed. These do not establish live provider reliability.
- Event generation, all input/response schema samples and compatibility
  regressions passed. npm audit reports zero vulnerabilities (previously one
  high Zod advisory); this is an advisory database result, not a security proof.
- The real PTY visual scenario passed layout, input, plugins and persistence;
  captured screenshots were visually inspected. OSC 22 behavior in this bench
  is browser emulation, not GNOME Terminal pointer support.
- Linux x64 release build and installer smoke passed, including default plugins,
  bundled Callix edits, checksum rejection and workflow execution. Other native
  targets require their release runners. No release was published.

Upgrades should refresh all manifests and lockfiles together, inspect upstream
migration notes, run these checks and review generated contracts. Keep exact
native pins/checksums and do not use forced peer resolutions to hide conflicts.

The subsequent Ghost media integration adds omggif 1.0.10 and its types 1.0.5
(verified npm stable tags). Decoding is pure JavaScript and requires no FFmpeg
binary in releases. See the [media plugin](../plugins/mascot/README.md) for
GIF compositing, decoder budgets, source-clock playback and SIXEL support.
