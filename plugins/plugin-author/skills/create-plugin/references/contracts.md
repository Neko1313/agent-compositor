# Native plugin contracts

A local extension is a directory containing `plugin.json` and a hook/controller
entry, `tools.ts`/`tools.js`, skills or MCP declarations. Components can be combined
in one package; pure data/MCP packages need no executable entry. Default project location:
`.agent-compositor/plugins/<name>`. Installed/user plugins may override bundled
plugins of the same name; choose a distinct name for a new capability.

```json
{
  "name": "project-helper",
  "version": "0.1.0",
  "trust": "trusted",
  "main": "hooks.ts",
  "commands": [{"name":"/project-helper","description":"Open project helper"}]
}
```

Hook entries default to hooks.ts, index.ts, index.js, index.mjs. For tools-only
plugins omit main and provide tools.ts or tools.js. TypeScript and ESM are
supported by the installed host. JS dependencies must be available beside the
plugin or bundled; npm package installation is not automatic on reload.
`plugin_dev init` links the public host SDK (including core, session, events,
hooks, tools and app/controller types) from the installation used to create the
plugin. Keep that installation while
using its SDK links. You may add type imports without runtime dependencies.

A hook receives `(event, $)`. No result continues normally. `{drop:reason}`
consumes a recognized prompt command; `{text:replacement}` rewrites a prompt.
For middleware use `const downstream = await $.next(rewrittenEvent)` and return
its result or a compatible response. Read the exact installed schema using the
events guide; do not guess names or response shapes.

Useful APIs: `$.session.id/cwd`, `$.signal`, `$.state.get/set`,
`$.storage.config(name)`, `$.storage.configure(name,value,scope)`,
`$.ui.notify`, `$.ui.view`, `$.ui.remove`, and `$.emit(canonicalEvent,input)`.
Settings are scoped; do not overwrite raw global settings or store credentials
in prompts. Hooks use shared permission/cancellation services. Trusted modules
can also use host Node APIs; the trust label is not an OS sandbox.

A tool exports a default array (or named tools) of objects with name,
description, parameters (JSON Schema), describe(args) and async execute(ctx,args).
Use truthful descriptors for permission matching, pass ctx.signal to I/O, and
resolve filesystem paths with ctx.resolvePath. ToolContext supplies request,
fetch, settings, cwd, sessionId and undo. Native tool result: `{ok:true,data}` or
`{ok:false,error}`. A tool name collision does not replace the built-in tool;
explicit replacement uses `toolProviders:{"read":"my-plugin"}`.

For a trusted native tool that needs a process, discover the installed
`service.exec.run` schema before calling `ctx.request`. Its payload requires the
owning `plugin` name as well as `cmd`, optional `args` and `timeoutMs`; raw tool
requests do not inject that name. Use fixed argument arrays, truthful tool
descriptors and a finite timeout. The host propagates `ctx.signal`, reaps owned
processes before settling, and revokes them on unload. Do not race execution
against an early cancellation result that leaves the process running. A hook's
`$.exec.run` supplies its owner and operation signal automatically.

Native plugin skills live in `skills/<skill>/SKILL.md`; name and description go
in YAML frontmatter. The registry advertises only descriptions and loads full
bodies using the skills tool. User/project skills have priority over plugin
skills. Only loaded plugins contribute; disable/remove/reload updates discovery.

Native manifests also accept `mcpServers` and `resources`. MCP config files and
inline declarations use the common native/Claude stdio reader. See the
[composition guide](composition.md) for schema, ownership and release resources.

Runtime replacements declare provides (for example service.agent.instructions)
and are selected via `serviceProviders`. Private UI replacements export named
controllers and are selected via `ui.controllers`; session repositories export
a named sessionRepository factory and are selected by sessionProvider. These
configuration selections are read at startup. They must preserve cancellation,
private input, journal ownership and the normal policy path. Tiling remains
host-owned. Use public controller types or installed event schemas for details;
do not patch compositor internals to implement a local extension.

Session start initializes state. Session reload reconstructs it after composition
changes; in-memory plugin state may be reset. Export dispose() from hook/tool
modules for timers, subprocesses and connections. Do not mutate state during
ui.render. Use bounded hookTimeouts only where the actual operation needs them.
