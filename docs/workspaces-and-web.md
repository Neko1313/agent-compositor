# Internet tools and multiple projects

The standard harness can search/read the internet and work with several attached
projects in one conversation. These remain optional capabilities: omit the `web`
plugin or the standard `agent-harness` contribution when choosing another
composition. The fixed tiling manager is unchanged.

## Attach a path

References accept relative paths, parent paths, absolute paths and home paths:

```text
Compare @~/proj-api with @~/proj-client
Inspect @"~/another project/src/config.ts"
Read @/srv/project/README.md
Compare @../shared/schema.json with @src/schema.json
```

Double-quoted references accept JSON escapes; single quotes also support spaces.
`@.` lists the primary project. A directory reference lists at most 200 files,
following project ignore rules, and includes its bounded project instructions.
A file reference supplies UTF-8 content or a supported image. Attachment text is
bounded by the existing context limit; each image remains capped at 10 MB.
The editor completes local, absolute and home paths. Tab accepts a suggestion;
Enter submits a typed reference unless a suggestion was explicitly selected.
Completing a directory lets you continue its path. Browsing completion suggestions
alone does not attach a path to the agent.

An explicit file reference grants access to that file. An explicit directory
reference grants access to its descendants. Symlink targets are checked against
the canonical scope; a link does not grant access to an unselected location.
Read permission denials still apply to attachments, and normal tool policy still
applies to reads, edits, writes, shell commands and network calls. Attaching a
project does not implicitly approve its mutations.

You can also manage the session's selected paths without sending a model request:

```text
/workspace
/workspace add ~/proj-api
/workspace add "~/another project"
/workspace remove ~/proj-api
```

The primary project cannot be removed. Removing an extra directory removes grants
beneath it; already included conversation content remains in the transcript.
These filesystem paths are distinct from numbered tiling workspaces.

Start with multiple directories or configure the default scope:

```sh
compositor --cwd ~/proj-api --add-dir ~/proj-client --add-dir /srv/shared
```

```json
{
  "workspacePaths": ["~/proj-client", "/srv/shared"]
}
```

`--add-dir` is repeatable. Relative paths are resolved against the primary project,
and `~` uses the configured user home. Session grants are journaled through
`workspace.changed` and restored by interactive and headless resume. Missing saved
attachments are skipped on resume. New startup configuration grants remain active.

`read`, `write` and `edit` accept absolute and home paths inside the selected scope.
`exec`, `glob`, `grep` and `code_query` accept `cwd` to select an attached project:

```json
{"cwd":"~/proj-api","pattern":"**/*.test.ts"}
```

Callix's file and graph queries report their project directory, so relative result
paths remain unambiguous. An absolute or home `path` can select an attached
subdirectory or file; semantic project navigation needs a containing directory
grant. Each project's index/cache keeps its own fingerprint.

Ephemeral task agents inherit selected paths. Their model-authored prompts can
reference already selected files but do not create new user grants. Independent
agents can choose `cwd` on creation and run concurrently in different projects:

```json
{"action":"create","name":"api","cwd":"~/proj-api","worktree":false}
```

`worktree:false` works directly in that project. With worktrees enabled, Git uses
the selected repository; merges return to that repository. Project selection is
validated at creation and stored with the agent for restoration. Additional
explicit scope is inherited without exposing an isolated worktree's parent
checkout automatically. Independent agents retain their own conversations and
scope after creation.

## Search and read the internet

With the standard `web` plugin loaded, `web_search` works without an API key using
DuckDuckGo's [non-JavaScript search](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript). It returns provider/query metadata, titles, source URLs
and bounded snippets. `web_fetch` reads the selected HTTP(S) source and returns
its URL, title, bounded text and up to 50 outgoing links. The harness tells the
model to read relevant sources and cite their URLs instead of inventing results.
`/web` shows search setup; permission rules continue to govern network calls.

Search selection in `.agent-compositor/web.json`:

```json
{"provider":"duckduckgo"}
```

For Brave, export `BRAVE_SEARCH_API_KEY` and optionally set `{"provider":"brave"}`.
For SearXNG, enable JSON format and configure:

```json
{"provider":"searxng","searchUrl":"https://search.example.org/search"}
```

Existing `searchUrl` configurations still select SearXNG. Without an explicit
provider, a Brave key selects Brave; otherwise DuckDuckGo is used. An explicitly
selected provider's failures are reported rather than silently selecting another.
A human challenge or unexpected HTML is an error, never a fabricated empty result.
DuckDuckGo HTML is a public search interface rather than a guaranteed search API;
Brave/SearXNG are available when a deployment needs another backend.

HTTP reads keep a 15-second request deadline, a 1 MB response limit, a 50000-character
text limit, HTTP(S)-only URLs without embedded credentials, and explicit redirect
target approval. Page/search content is marked untrusted. Fetching reads server
HTML/text/JSON; it does not execute client-side JavaScript or automate a browser.
No paid search account, browser service or proxy is created automatically.

## Public boundaries and verification

`WorkspaceAccess`/`WorkspaceEntry` are exported by `@agent-compositor/tools`.
Core exposes its workspace, host grant/remove methods and input origin; model-authored
references/commands cannot grant new paths, including when prompts are queued. Model tools receive
read-only scope discovery and a checked `resolvePath` capability in `ToolContext`.
The core/resolver, native navigation provider and trusted plugin filesystem facade
share that scope. Replacement resource tools retain their own path semantics;
local scope enforcement belongs to the standard file implementation. Trusted JS
still runs in-process, not an OS sandbox.

Catalog 0.19 adds `workspace.changed` and the reviewed optional `cwd` field on
`service.agent.control`. Legacy inputs retain their prior behavior and version.
The 0.17 signature baseline is preserved; its compatibility test explicitly checks
and removes only this reviewed optional field before comparing the old signature.

`packages/app/test/web-workspaces.test.ts` covers real assembly, path expansion,
file-only scope, project search/shell/write permissions, symlinks, resume,
delegation, concurrent agents, search providers and denied network calls.
`npm run visual:workspaces` drives the real PTY through completion, quoted paths,
external reads, loopback search/fetch and restart/resume at 60 columns.
`VISUAL_EXECUTABLE` selects an installed distribution. The HTTP fixture is local;
separate live probes document actual public-search/source availability.
