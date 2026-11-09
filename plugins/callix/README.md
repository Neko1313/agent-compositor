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

## Precise navigation and guarded edits

`code_query` now supports `outline`, `read_symbol` and bounded reverse `impact`
in addition to the existing graph queries. Query an exact ID when names are
ambiguous; `path` is an exact project-relative file filter, not a suffix match.
`references` includes indexed calls and alias-resolution edges. Resolver status
and metrics remain visible: an empty graph result never proves that dynamic or
unresolved usages do not exist.

A typical semantic edit uses these tools:

1. Find a definition or file outline, then select its symbol ID.
2. `code_query {"action":"read_symbol","pattern":"<id>"}` returns the source
   syntax-node slice and an `edit` object with path, expectedHash, range and strict.
3. Pass **all** anchor fields to the normal `edit` tool, adding exact oldText and
   newText. For a local expression, use the returned symbol range to disambiguate
   identical expressions elsewhere in the file.
4. Re-read on a stale-snapshot error, then run relevant checks.

Callix spans use one-based UTF-8 byte columns and an exclusive end; model edit
ranges use UTF-16 offsets. The adapter validates/converts them against the actual
UTF-8 snapshot, including non-ASCII prefixes and CRLF. Modifiers outside the
syntax-node span, such as `export`, are retained. A missing/ambiguous/unlocated
symbol returns candidates or an error. A source body that cannot fit its budget
has **no edit anchor**; increase the budget or select a smaller symbol.

Ordinary `read` also returns an anchor for its returned line range, so known-path
literal edits can use grep + ranged read without building a graph. Hash checks
and exact range matching reject stale, out-of-range and ambiguous changes.
Guarded edits never fall back to whitespace normalization. All edits retain the
normal permission/service/secret-guard/checkpoint path, and guarded inverses are
recorded without sending their full content back to the model. Writes/edits are
serialized across cores in one process. External editors are outside that lock;
the hash is checked at mutation preparation, not an OS-wide atomic transaction.

## Bounded output, freshness and cost

Graph results default to compact symbol locations and about 2000 estimated JSON
tokens. Set `maxTokens` (256..16000), `limit`, `kinds` or `detail:"raw"` explicitly.
`nextCursor` continues a graph page and is rejected when its snapshot/filter
changes. Text/file search supports `offset` / `nextOffset`. Budgets reduce whole
records and preserve returned edge endpoints. Truncation and resolver metadata
are explicit, not silently sliced strings.

`metrics.estimatedTokens` and bytes describe the compact JSON payload using the
application's UTF-8-weighted heuristic, not provider billing. Cache state and
query duration are included; `indexMs` records the original build cost rather
than charging it again on each warm query. Actual input/output/cache token usage
comes from provider events. Core tool transcripts use compact JSON and a valid
truncation envelope above 128 KiB, rather than cutting through JSON or an anchor.

Warm exact-ID/adjacency queries use maps instead of scanning every node.
Concurrent consumers share an index build; cancelling one does not cancel the
others. Source timestamps/file membership and ignore configuration are checked;
a source change during analysis causes a bounded retry, not a stale result tagged
as current. Disk caches include root, effective executable/resource configuration
and binary identity. Extra agent ignore rules filter graph results and stored
nodes; the native CLI still discovers/analyzes the root under its own rules.

File search respects Git inventory and agent ignores, and uses nested gitignore
rules outside Git. Escaping symlinks, deleted entries, binary and oversized text
files are excluded. Regex search streams ripgrep in argument-safe batches;
literal search has no ripgrep dependency. Search scanning is bounded to 32 MiB
and approximately 10 seconds, with `scanLimited` requiring a narrower scope.
Pagination discards skipped matches rather than retaining them all in memory.

## Deep tests and comparisons

```sh
npm run test:callix
npm run eval:navigation
npm run eval:navigation:live
```

`test:callix` requires the installed pinned binary (or CALLIX_TEST_BIN) and covers
real aliased callers, UTF-8/CRLF spans, exact edits and permission denials as well
as races, stale snapshots, pagination, ignored files, cache provenance and
cancellation. The regular suite skips optional native cases when absent.
Release smoke also tests actual packaged symbol reading and guarded editing with
PATH empty, so native-platform releases exercise the new contract.

`eval:navigation` generates a controlled project and compares broad text + full
file read, text + ranged read, and graph + symbol read. All protocols verify the
same edited function, untouched neighbor and caller paths. The report includes
schema/argument/result estimates, repeated-input estimates and cold/warm latency.
`eval:navigation:live` runs the same guarded-edit task on the configured Ollama
models, capturing provider-reported usage and actual tool trajectories. Set
NAV_MODELS, NAV_OUTPUT or CALLIX_TEST_BIN to change the run. See
[the evaluation guide](../../docs/evals.md#navigation-method-comparison) for
measured results and limits; these are comparisons of methods, not branded
assistant benchmarks.
