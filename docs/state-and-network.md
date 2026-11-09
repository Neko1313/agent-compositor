# Project storage and networking

## User data

By default, the application separates shared configuration from runtime state:

```text
~/.agent-compositor/
  agent-compositor.json        # global application settings
  mcp.json, proxy.json, ...    # global component settings
  plugins/                    # user extensions
  marketplaces.json          # user marketplace registrations
  credentials.json           # private credentials
  approvals/                 # saved project approvals
  plugin-state/<plugin>/      # plugin memory with scope=global
  projects/<directory>-<hash>/
    project.json              # canonical cwd and migration version
    sessions/                 # session JSONL and metadata
    agents.json, worktrees/   # independent agents
    todos.json                # tasks
    workflows/                # code and replay journals
    turn-checkpoints/         # code/conversation snapshots
    layout.json, model.json   # local preferences
    memory.md                 # private memory for this project
    plugin-state/<plugin>/    # JSON state with scope=project
    session-state/<id>/<plugin>/
    cache/<plugin>/           # rebuildable indexes
<project>/.agent-compositor/
  agent-compositor.json      # project settings
  mcp.json, proxy.json, ...   # shared project overrides
  plugins/, skills/          # project extensions/instructions
  marketplaces.json         # project marketplace registrations
```

The identifier includes the canonical path and its hash, so directories with the
same name do not share sessions. Git worktrees have separate cwd/state.
Independent agents inherit application profiles and component settings from their
parent; local settings take precedence while runtime task/memory state remains
separate. Moving a checkout to a different path creates a new project identity.
`AGENT_HOME` selects an alternative user root; `AGENT_STORAGE_MODE=project`
explicitly enables the previous portable mode. XDG global configuration is also
supported. Application configuration precedence is user root → XDG → project
walk; component settings use global → project → private local preferences.
JSON objects are merged; arrays are replaced.

On first startup, runtime files from the old `<cwd>/.agent-compositor` directory
are copied into the new store without deleting the originals. A marker prevents
reimporting stale state. Migration covers sessions, agents, Todos, layout/model,
checkpoints, workflows, and legacy extension metadata. COMPOSITOR.md is copied to
private memory.md. Old directories remain available for inspection or backup.

Global AGENTS.md/CLAUDE.md/GEMINI.md in the user root, files in the project root,
and its `.agent-compositor` directory contribute instructions. Skills support
global and project directories. `# note` saves private project memory;
`#global note` saves global memory owned by the memory plugin. Shared COMPOSITOR.md
files remain in the project; new notes do not overwrite them.

## Plugin API

```ts
const config = await $.storage.config('my-plugin.json');
await $.storage.set('progress', { completed: 3 }, 'project');
const progress = await $.storage.get('progress', 'project');
await $.storage.set('preferences', { compact: true }, 'global');
await $.storage.set('cursor', { row: 4 }, 'session');
await $.storage.set('symbols', { items: [] }, 'cache');
```

JSON values are written atomically, bounded by the host write budget, and
namespaced by plugin. `get` returns undefined for missing keys. Operations pass
through `service.storage.config/read/write` and can be intercepted by hooks.
Writes during `ui.render` are forbidden. Traversal and symlink escapes are
rejected. `$.storage.paths` exposes home/state/project. `$.state` remains temporary
in-memory state; use storage to persist values across sessions.

Legacy `$.fs.read/write('.agent-compositor/...')` redirects runtime writes to
private state, with reads falling back to old/project/global files for
compatibility. Arbitrary Node fs calls are not rewritten automatically:
ToolContext provides `stateDir`, `settings(name)`, and `fetch` for native plugins
to use explicitly.

## Keeping Callix current

Callix saves its JSON graph and fingerprint in `cache/callix/index.json`.
The fingerprint is checked before reading the graph; a valid cache is reused after
restart. An active session debounces background refreshes after external source
edits, Git HEAD/index/refs changes in the working tree, and `project.changed`
events after write/edit. `.git`, state, node_modules, and build/dist directories
are excluded from source indexing. Systems without recursive watch still have
tool hooks and fingerprint checks on query. Indexing does not run as a continuous
polling loop.

```json
{ "background": true, "debounceMs": 750 }
```

These are callix.json settings. `background: false` leaves only refresh on query.
Processes, timers, and watchers are released on unload/close; background indexing
errors go to telemetry. During continuous edits, the index may lag until a
rebuild finishes; queries check the fingerprint rather than assuming an old graph
is current.

## Proxy routing

The replaceable default `network-proxy` plugin reads proxy.json and configures
the shared client through `service.network.configure`. Routing defaults to off.
Configuration is validated before model requests and network tools; an invalid
enabled proxy must not silently fall back to a direct connection.

```json
{
  "enabled": false,
  "url": "http://127.0.0.1:7890",
  "noProxy": ["localhost", "127.0.0.1", "::1"],
  "models": true,
  "tools": true
}
```

Set your endpoint, then use `/proxy on`; `/proxy status` and `/proxy off` display
and change the mode. Status hides the password in the URL. Local preferences are
stored in private state; the example endpoint is not enabled automatically.

Node uses Undici ProxyAgent/CONNECT; Bun uses its native fetch proxy support.
Native OpenAI/Anthropic/Gemini/OpenAI-compatible protocols and streaming are
preserved. Provider OAuth/refresh/quota and web tools use the same route.
Shell/MCP receive HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY for clients that support
those variables. Global process.env is unchanged. An explicit MCP server/command
env can override them. Arbitrary HTTP code in third-party plugins is not
intercepted automatically: use ToolContext.fetch or the client's own settings.
Socks and OpenAI-to-Anthropic protocol translation are outside this implementation.

Ollama remains available at `http://127.0.0.1:11434/v1`. This environment was tested
with `gemma4:31b-cloud` and `deepseek-v4.1-flash:1017-cloud`: the local Ollama
serves the API while inference runs in the cloud. OpenAI/Anthropic can be
configured later through the existing provider profiles and credentials using
the same transport.

## Native provider and proxy settings

Click **Settings** in the workspace bar, or run `/settings`, `/providers` or
`/models`. **Add provider** offers Ollama, OpenAI Responses, Anthropic, Gemini
and an OpenAI-compatible gateway. Enter a profile ID, base URL, model ID and
optional API key. **Test & discover models** calls the provider's model-list
endpoint without issuing a completion; choose a returned ID or enter one
manually when a gateway does not expose that endpoint. Existing profiles offer
edit, test, model selection and removal. Changing the ID in the editor creates
a copy. Removing a profile hides it for this project and retains its credentials.

Forms support mouse focus, Tab/Shift+Tab and arrow navigation, editable text,
masked passwords, toggles and selectable options. Ctrl+A replaces a whole field;
Ctrl+U clears it. Enter advances text fields or activates a selected button.
Escape cancels without saving. Connection testing does not save a draft.
`/login <profile>` opens a masked API-key form unless the profile already has a
configured OAuth device flow. The existing environment-variable login remains
available. Blank key/password fields retain existing credentials; use the
explicit removal switch to clear a stored value.

**Network proxy** opens the proxy form directly; `/proxy` and `/proxy configure`
do the same. Configure an HTTP(S) CONNECT endpoint, optional username/password,
separate model/tool switches and bypass hosts. SOCKS is not supported. Model
list requests use the same network client and proxy policy as completions.
`/proxy status`, `/proxy on` and `/proxy off` remain available.

Choose project or global scope when saving. Project connections and proxy
settings are stored in the private project state directory; global defaults use
`~/.agent-compositor/providers.json` and `proxy.json`. Project overrides take
precedence over global defaults. API keys use the private `credentials.json`
file. Authenticated proxy URLs are private settings, never shared repository
files. Writes are atomic with mode 0600. Model selection is restored from the
private `model.json`. Form drafts and API keys do not enter prompts, chat history or render hooks.
Form results bypass catalog events; proxy configuration is still consumed by
the existing storage/network service hooks. Displayed proxy status redacts URL
credentials. Visual bench inputs use fake credentials: its `input.jsonl` is a
raw keystroke diagnostic and must never be used with real secrets.

Trusted plugins can request the same native form with `$.ui.form(request)`.
The request contains a title, optional description, text/password/url/select/
toggle fields and actions. It returns `{action, values}` or `null` on cancel.
Password fields cannot declare a nonempty initial value. The host owns the
modal, masking, scrolling and draft lifecycle. Set an appropriate manifest
`hookTimeouts` budget (the built-in editors use 300000 ms) when awaiting input. Headless hosts reject forms
unless an application explicitly installs a form handler. Form results travel
through a private host callback rather than `service.*` events. Similarly,
`$.storage.configure(name, value, 'project' | 'global')` writes private component
settings through a trusted host callback. These two APIs are unavailable to
sandboxed/render-only plugins and cannot run inside `ui.render`.
