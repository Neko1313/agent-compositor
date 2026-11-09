# Releases

## Distribution contract

Release archives support Linux glibc 2.38+ (x64/arm64) and macOS (x64/arm64).
Windows and Linux musl are not currently supported by the installer. The shipped
Monty native module needs glibc 2.38+; the complete Linux bundle is tested on
Ubuntu 24.04. Ubuntu 22.04 is not a supported full-bundle target.
Each archive contains `compositor/compositor`, external standard plugins,
mascot APNG assets, public host API modules and Monty's platform-specific worker.
The Bun runtime is compiled into the executable. Keep the archive's directories
together; copying only the executable drops the supplied plugin distribution.

User and project plugin directories take precedence over the distribution's
defaults. Disable or replace defaults through the existing extension settings.
Monty's bridge needs Node.js 22+ or `AGENT_NODE_BIN`. Callix is a separate optional
executable configured with `CALLIX_BIN`; it is not downloaded by the installer.
Native third-party plugins may declare additional runtime dependencies.

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

Run these commands on the target platform with Node.js 22+ and Bun 1.4.4:

```sh
npm ci
npm run build:release
npm run release:smoke
```

The archive is written to `dist/release/compositor-PLATFORM.tar.gz`.
The smoke test serves a local release mirror and model endpoint, rejects a
corrupt checksum, installs from a versioned URL and `latest`, checks default
plugin discovery outside the repository, executes a headless model request and
the packaged Monty bridge, and checks state preservation across reinstall.
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
it once uploads finish. A manually dispatched workflow builds and verifies
without publishing when run against a branch.

If publication fails after creating a draft, inspect the failed run and draft
before retrying. The workflow intentionally refuses to overwrite an existing
release. Never move a published version tag; fix the issue in a new version.

## v0.1.1 dependency audit

The existing Zod 3 dependency is flagged by npm audit for
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
a memory-exhaustion issue during validation of oversized collections. The
published fix requires Zod 4.6.6 or later. This release does not migrate the
public schema contracts to Zod 4; that dependency upgrade remains outstanding.
