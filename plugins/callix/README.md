# Callix code navigation provider

Uses the **native Callix 1.7+ binary**, without Python bindings or a daemon.
An enabled plugin starts warming the primary project's graph and navigation maps
immediately on session start/reload, without waiting for a model request or the
file-watch debounce timer. Startup does not wait for analysis. A semantic
query runs or joins `callix analyze <project> --quiet`, parses schema version 1
JSON, and reuses the graph. Source files, resolver configuration, dependency
manifests/lockfiles and ignore rules invalidate it. Prose and diagnostic logs do
not. `refresh: true` forces analysis and is normally unnecessary. There is no
automatic dependency installation. Set `background:false` for lazy synchronous
indexing on the first semantic query instead of startup warming.

## Invocation and slow-index diagnostics

The model-facing tool is **`code_query`**, not `callix`. For example:

```json
{"action":"status"}
```

`status` never starts analysis or waits for an active native build. It reports
`available`, the selected executable, and `state`: `unavailable`, `not-indexed`,
`indexing`, `ready`, `stale` or `error`. Active builds include elapsed time and
attempt number; errors retain the last failure. A ready graph also has node and
relation counts. Inspect this result when navigation seems stuck.

Start navigation with `{"action":"definition","pattern":"MyFunction"}` or
`{"action":"outline","path":"src/file.ts"}`, then use an exact returned
symbol ID for relationships or `read_symbol`. `path` is an exact file filter.
The tool's on-demand help includes complete argument examples.

With background operation enabled, a semantic call waits up to `queryWaitMs`
(default 10000 ms, configurable 50..600000). A slow call returns
`pending:true`, `complete:false`, its requested action and current index state.
This is not a semantic answer. The owned build continues; use `glob`, `grep` or
`read` for immediate work, inspect status later and repeat the original query
once ready. Avoid busy polling or repeated forced refreshes. Errors do not
remove the tool or disable text search. Session end, reload, disable and close cancel and
drain outstanding work. Removing an attached project's workspace grant also
cancels its retained native query. With `background:false`, calls remain synchronous up to
the analysis deadline. The deadline covers all source-change retry attempts,
rather than restarting the whole timeout for each attempt.

If `code_query` is absent, first install/enable this plugin in the intended scope
and `/reload` between turns. A model cannot activate code by inventing a tool name:

```text
/extensions install callix@agent-compositor --project
/extensions enable callix --project
/reload
```

An external assistant does not automatically inherit Compositor's tools. It must
use its configured integration or invoke the native executable by an available
path; the plugin-local binary need not be installed on the shell's `PATH`.

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
{"executable":"/path/to/callix","timeoutMs":120000,"queryWaitMs":10000,"maxOutputBytes":268435456}
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

`maxOutputBytes` bounds the full native graph before query filtering, separately
from the model-facing `maxTokens` budget. It defaults to 256 MiB (allowed range
1024..268435456 bytes); earlier versions defaulted to 64 MiB. A narrow `path` or
`limit` does not reduce the graph built by the native analyzer. Large graphs
still need memory for the parsed graph and adjacency maps. Explicit smaller
limits are honored on new builds; an overflow reports the byte limit and
recovery guidance. Graphs above the maximum require a smaller attached project
root or text tools. No partial graph is cached or advertised as complete.

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
as current. Disk caches include root, effective executable and binary identity;
changing timeout/output limits reuses a valid graph. Earlier v3 caches containing
resource limits remain readable without reanalysis. Builds with different limits
have separate cancellation/deadline ownership. Attached projects have separate disk-cache directories so
switching projects does not evict another project's persisted index. The v3
fingerprint rebuilds older caches once under the new source-input rules.
Extra agent ignore rules filter graph results and stored
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

### Attached projects

`glob`, `grep` and `code_query` accept `cwd` for an attached project, including
`~/path`. Absolute/home `path` filters select an attached directory or a file
inside a selected project. Returned results include the resolved `cwd`; relative
result paths belong to that project. A single-file attachment permits `read`,
while project navigation requires its containing directory to be attached.
