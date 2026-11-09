# Callix code navigation provider

Uses the **native Callix 1.7+ binary**, without Python bindings or a daemon.
The first semantic query runs `callix analyze <project> --quiet`, parses schema
version 1 JSON, and keeps the graph in memory. A changed source file, manifest,
lockfile, addition or deletion invalidates the cache; `refresh: true` forces it.
There is no analysis at startup and no automatic dependency installation.

## Bundled distributions and source setup

New compositor release builds include Callix 1.7.0 for Linux x64/arm64 and macOS
x64/arm64. The executable lives in `plugins/callix/bin/callix`, alongside its
upstream `LICENSE` and `release.json` provenance. CI verifies the archive's
pinned SHA-256 and tests actual cross-file navigation after installation.
Loading the plugin never downloads software. The older compositor v0.1.1
published archive predates bundling and needs the explicit setup below.

When working from source, run `node plugins/callix/install.mjs` to download the pinned
1.7.0 release, verify its SHA-256, and install it under this plugin's `bin/`.
Linux x64/arm64 and macOS x64/arm64 are supported. This is an explicit setup
step. A downloaded archive can be
reused with `--archive /path/to/release.tar.gz` and is verified identically.

Binary selection remains: `CALLIX_BIN` → `executable` setting → plugin-local
`bin/callix` → `callix` on PATH. Native packaging does not change provider
selection, user/project overrides or the ability to disable this plugin.

Alternatively install the binary from the [official release](https://github.com/Callix-Tools/callix/releases/tag/v1.7.0)
on PATH, or set `CALLIX_BIN` to its absolute path. You can also configure
`.agent-compositor/callix.json`:

```json
{"executable":"/path/to/callix","timeoutMs":120000,"maxOutputBytes":67108864}
```

The `code_query` tool supports `symbols`, `definition`, `references`, `callers`,
`callees`, `dependencies`, and `status`. Use a returned symbol ID to disambiguate
names. Results preserve relation positions and graph metadata describing resolver
completeness. An empty relation list is not proof that no usages exist when
resolution is degraded. Graphviz/Mermaid exports remain a CLI capability;
navigation reads the underlying JSON graph directly.

`glob` and `grep` use lightweight project discovery/text search through the same
`service.project.query` contract. They do not trigger graph analysis. Calls use
argument arrays, bounded stdout/stderr, a timeout and agent cancellation.

To replace the backend, install a plugin declaring
`"provides":["service.project.query"]` and implementing that event. Set the
application configuration:

```json
{"serviceProviders":{"service.project.query":"my-navigation"}}
```

The Callix plugin's model tools still call the selected provider. Add
`"disabledPlugins":["callix"]` as well if the replacement supplies its own tools.
Guard hooks continue to run for selected providers. Missing binaries, failures,
unsupported graph schemas and timeouts return tool errors, without silently
pretending another backend produced Callix results.

For the optional real-binary integration test:

```sh
CALLIX_TEST_BIN="$PWD/plugins/callix/bin/callix" npm test -- packages/app/test/callix.test.ts
```

It analyses a temporary TypeScript project and checks a resolved cross-file
call. The regular suite tests cache invalidation, errors and provider replacement
without requiring a local Callix installation.
