# Releases

## Distribution contract

The workflows pin GitHub Actions to immutable commits for checkout 7.0.1,
setup-node 7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2,
setup-bun 2.2.0 and git-cliff-action 4.9.1. The JavaScript actions use their own
Node 24 runtime and require Actions Runner >=2.327.1; this is separate from the
Node version used to build and test the application. Hosted runners satisfy
that requirement. Artifact digest mismatches fail the release download step.
Bun 1.4.4, native Callix 1.7.0 and git-cliff 2.14.2 remain explicit tool pins.

The Linux test job uses `ubuntu-24.04`, matching the native release baseline,
with Node 26 and 22.19.0. It does not inherit distribution upgrades through the
rolling `ubuntu-latest` label. Linux validation jobs install ripgrep 15.1.0 from its official GitHub release
through `node tools/release/ci-ripgrep.mjs`, verify a pinned SHA-256 and the binary
version, then add the isolated installation to `GITHUB_PATH`. This avoids Ubuntu
package mirrors and `sudo`; installation failure still stops tests rather than
skipping search coverage. The installer retains the upstream MIT license. Native
archive jobs retain their declared platform-specific prerequisites.

Release archives support Linux glibc 2.38+ (x64/arm64) and macOS (x64/arm64).
Windows and Linux musl are not currently supported by the installer. The shipped
Monty native module needs glibc 2.38+; the complete Linux bundle is tested on
Ubuntu 24.04. Ubuntu 22.04 is not a supported full-bundle target.
Each archive contains `compositor/compositor`, external standard plugins,
mascot APNG assets, public host API modules, Monty's platform-specific worker,
and a pinned native Callix executable with its upstream license/provenance.
The Bun runtime is compiled into the executable. Keep the archive's directories
together; copying only the executable drops the supplied plugin distribution.

User and project plugin directories take precedence over the distribution's
supplied packages. Since v0.4.0, plugins remain inactive until explicitly enabled
in user or project scope; installation alone never activates them. The repository
marketplace ships offline with the distribution. Existing explicit activation
settings are preserved. Use `/extensions enable NAME --project` (or `--user`)
and `/reload`, including for the optional `mascot` and `plugin-author` packages.
Plugin versions/releases and catalog versions are independent of the host.
See [plugin standards](plugin-standard.md) and [mandatory testing](plugin-testing.md).
Plugin version/changelog preparation is automated by the release PR workflow;
application version preparation below remains separate. Plugin publication
extracts only the selected version's notes and retains all certification gates.
Monty's bridge needs Node.js 22+ or `AGENT_NODE_BIN`. Callix 1.7.0 is bundled
under `plugins/callix/bin/`; the installer needs no separate Callix download.
`CALLIX_BIN` and plugin settings still override the bundled executable. The
already-published v0.1.1 archive predates this addition and needs explicit setup.
Native third-party plugins may declare additional runtime dependencies.

Independent plugin archives retain license notices for dependencies selected by
the bundler and separately copied native runtime packages. Unrelated workspace
dependencies, including the documentation site, are excluded so they do not
inflate plugin installation inventories. Native Callix provenance and its
upstream license remain alongside its executable.

The POSIX installer uses curl, tar, awk and sha256sum (or macOS shasum).
`--prefix` defaults to `$HOME/.local`; `--version` selects a release tag or
`latest`. `COMPOSITOR_INSTALL_PREFIX` supplies the default prefix;
`COMPOSITOR_RELEASE_BASE_URL` can point to a release mirror with the same URL
layout. A checksum mismatch stops installation before extraction.
Checksums validate download integrity, not publisher identity or signatures.

Installations live in unique directories under
`PREFIX/share/agent-compositor/`, with `PREFIX/bin/compositor` pointing to the
active binary. Updates switch that link and retain older versions. Application
state is never copied or removed. To uninstall, remove that symlink and the
`PREFIX/share/agent-compositor` distribution directories; user state remains in
its configured home. The installer does not edit shell profiles or use sudo.

## Build and smoke test

Run these commands on the target platform with Node.js >=22.19.0 (Node 26 in
release CI) and Bun 1.4.4:

```sh
npm ci
npm run build:release
npm run release:smoke
```

Building downloads the platform-specific official Callix 1.7.0 archive and
checks its pinned SHA-256 before extracting only the binary and upstream MIT
license. `plugins/callix/bin/release.json` records the source URL, platform,
version, archive digest and binary/license digests. No developer-local binary is
copied into releases. For an offline build, set `CALLIX_RELEASE_ARCHIVE` to the
matching official archive; the same pinned checksum is mandatory. Update the
pins in `plugins/callix/distribution.mjs` when upgrading Callix.

The archive is written to `dist/release/compositor-PLATFORM.tar.gz`.
The smoke test serves a local release mirror and model endpoint, rejects a
corrupt checksum, installs from a versioned URL and `latest`, checks default
plugin discovery outside the repository, executes a headless model request and
the packaged Monty bridge, and checks state preservation across reinstall. It
also checks Callix provenance, version and license, then invokes `code_query`
through the installed compositor against a two-file TypeScript project. The
check requires a resolved cross-file call with `CALLIX_BIN` cleared and PATH
empty, proving use of the bundled binary.
It requires no provider credentials or external model service.

## Changelog and publishing

[git-cliff](https://git-cliff.org/docs/) reads Conventional Commits and renders
`cliff.toml`. Its npm dependency is pinned so local and CI output use the same
version. `feat`, `fix`, `docs`, `perf`, `refactor`, `test` and maintenance commits
are grouped; breaking changes are highlighted. Release bookkeeping commits are
excluded. It generates notes; it does not build binaries or publish assets.

1. Update the root and `packages/app/package.json` versions together, then run
   `npm install --package-lock-only`.
2. Run `npm run changelog:preview` to inspect pending changes. Generate the next
   entry with `npm run changelog -- --tag vX.Y.Z`.
3. Run type checking and tests, commit the release changes, and push `main`.
4. Create and push an annotated tag matching the package versions:

   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

The release workflow runs the quality suite before building on four native
runners. Every archive passes the installer/model/Monty smoke test on its own
platform. Only then does git-cliff generate the tagged release notes. CI creates
a draft, uploads all four archives, `install.sh` and `SHA256SUMS`, and publishes
it once uploads finish. A manually dispatched workflow with a blank
`release_tag` builds and verifies without publishing. To rebuild an existing
unpublished tag through a repaired pipeline, dispatch the branch with
`release_tag=vX.Y.Z`. Publication requires the package version to match that
tag and every source file to match its commit, except this release workflow
and `tools/release/smoke.mjs`. The publish job checks out the immutable tag for
release notes and installer content. All four native build and smoke gates
still apply; downloaded CI artifact digests are verified before publication.

If publication fails after creating a draft, inspect the failed run and draft
before retrying. The workflow intentionally refuses to overwrite an existing
release. Never move a published version tag; fix the issue in a new version.

## Unpublished v0.6.0 candidate

The v0.6.0 tag was not published: native smoke checks exposed a journal payload
containing a live AbortSignal in a custom repository. Bun rejects cloning that
capability. The corrected core serializes detached JSON records before the
journal service chain, retaining fail-closed writes and live execution signals.
The corrected release is [v0.6.1](https://github.com/Neko1313/agent-compositor/releases/tag/v0.6.1),
which passed all four native build and installer smoke gates. v0.6.0 stays
immutable and is ignored by git-cliff so its unpublished feature/fix commits
appear in the v0.6.1 release notes.

## v0.1.1 dependency audit

The original v0.1.1 Zod 3 dependency was flagged by npm audit for
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
a memory-exhaustion issue during validation of oversized collections. The
published fix requires Zod 4.6.6 or later. The subsequent dependency refresh
migrates the validators to Zod 4.6.7 while preserving frozen event contracts;
the refreshed dependency tree reports zero advisories. See the
[dependency review](dependencies.md) for versions and validation.
