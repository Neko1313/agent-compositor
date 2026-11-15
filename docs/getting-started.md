# Get started

Install Compositor, connect a model, and run a task. The native application runs
on Linux with glibc 2.38 or later and macOS, on x64 and arm64.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Neko1313/agent-compositor/main/install.sh -o install-compositor.sh
sh install-compositor.sh
export PATH="$HOME/.local/bin:$PATH"
compositor --version
```

The installer verifies archive checksums and retains your settings and sessions.
Run it again to update. You can also download and extract an entire archive from
[GitHub Releases](https://github.com/Neko1313/agent-compositor/releases).
Keep the executable beside its bundled plugin and dependency directories.

## Connect a model

Current development builds open **Get started** on a fresh interactive launch
without an explicitly configured model. Published 0.7.4 predates this guide.
The guide itself runs locally without a model or inference server. You can skip
it and reopen it with `/setup` or **Settings → Setup guide**. Skip is remembered
privately for your user; plain/headless runs and explicit session resumes do not
open it automatically.
If the saved setup status is malformed or from an unsupported version, startup
continues and the guide warns about it. The existing file is left untouched
until you explicitly finish or skip the guide.
An invalid saved model selection is ignored at startup; it does not prevent the
guide from opening when no other model has been configured. Saving a new model
selection replaces that invalid selection.

**Set up model** lets you choose an existing connection or create one using five
fields: profile ID, endpoint, model ID, optional API key, and save scope. Keys are
masked and kept in the private credentials file. **Advanced settings** opens the
full editor. Saving does not issue a completion or test the connection; model
discovery/testing is an explicit action.

Start `compositor` and open **Settings**, or use `/settings`, to add a provider
connection. Select a model and supply credentials when your provider requires
them. Ollama, OpenAI Responses, Anthropic, Gemini and compatible gateways have
connection presets. A running Ollama endpoint or an accessible external model
service is required to answer ordinary prompts.

You can also select a compatible endpoint for one launch:

```bash
AGENT_BASE_URL=http://127.0.0.1:11434/v1 AGENT_MODEL=your-installed-model compositor
```

Replace `your-installed-model` with an actual model ID exposed by that endpoint.
Use [provider settings](state-and-network.md) for private credentials, profile
selection and network configuration.

## Run your first task

Launch from the project you want to work in:

```bash
cd /path/to/your/project
compositor
```

Enter a task such as “Explain this project's structure and entry points.” Enter
submits or queues a message; Tab steers a running turn. Ctrl+C interrupts the
current turn. Tools that need permission show their concrete action for review.
Use `/history` to find and resume saved conversations.

To work with another project in the same session, use `/workspace add PATH` or
start with `--add-dir PATH`. Read [workspace access](workspaces-and-web.md) before
granting more scope.

## Enable useful extensions

In the setup guide, **Choose recommended tools** asks what work you plan to do
and lets you select optional project checks, test reports, change review, web
research, a resource monitor, side conversations and automatic approval review. Coding initially suggests
project checks; research suggests web access. The resource monitor and side
conversation and approval review are unchecked until you select them. The monitor does not call a
model; side conversations require agent-hub and use the configured model.
If agent-hub is unavailable, the guide warns before and after selection. Check
`disabledPlugins` and any `enabledPlugins` allowlist in `agent-compositor.json`,
enable agent-hub there, and restart the app; `/btw --once` remains available for
an independent one-shot answer without a side-conversation window. The one-shot
answer also uses the configured model.
Approval review is opt-in for each session: after installing it and applying
plugin changes, use `/auto on` to enable model-assisted review and `/auto off`
to return to manual approvals. Reviews use a model and uncertain or high-risk
actions can still require your decision. See [auto review](agent-features.md#auto-review).
Only checked additions are installed if needed and enabled for the project.
**View tool status** shows which suggested plugins are currently active, have
been selected but need changes applied, remain active until reload, or are not
active. The list reflects application state and does not contact a model.
Downloads may be needed, and existing installations, versions and active plugins
are retained. The guide does not change explicit plugin restrictions or tool
permissions. Restricted recommendations are unchecked, explain the relevant
`enabledPlugins` or `disabledPlugins` setting, and are not installed even if
selected. Other selected recommendations can still be installed. Use **Apply plugin changes** before **Start chatting**; reload waits
for an active agent when necessary. If you disable a selected plugin through
Extensions before applying changes, the open guide in that session updates
without taking focus and no longer waits for that plugin to load.
When the guide is opened or refreshed, it also detects recommended plugins
enabled outside the guide that are not loaded yet, including selections made in
another session. Completion checks the current state even if the open view has
not refreshed, and refreshes it when changes are pending. If a disabled
recommended plugin is still active, apply changes to unload it before completing
setup. Skip remains available if a plugin cannot load or unload.
If a recommended tool is still pending after reload, the guide says so; check
the reload result for errors or open Extensions to change the selection.
Failures remain visible so you can retry or
continue without optional tools. If a download succeeds but enabling fails,
the guide reports the installation and the enable error; inspect the current
state in Extensions before retrying. No model is invoked
by these setup steps.
If an installation is interrupted, the guide stops before starting the next
selection. An operation already in progress may have completed; reopen `/setup`
or Extensions to inspect what was installed or enabled before retrying.

Since host v0.4.0, bundled filesystem plugins start inactive. Installation and
activation are separate, and `/reload` applies plugin changes between turns.

```text
/marketplace
/extensions install web@agent-compositor --project
/extensions enable web --project
/reload
```

The `web` plugin adds search and page fetching. Other optional packages include
Callix for code navigation, Monty for generated Python, workflows, and the Ghost
companion. [Browse their setup and requirements](reference/plugins.md).

Use `--user` for shared user defaults. Project selections override user defaults;
a configured capability ceiling still applies. Monty's optional worker requires
Node.js 22 or later; the core native executable starts without Node.js or Bun.

## Run without the terminal UI

```bash
compositor -p "Explain this project" --output-format json
```

Text, JSON and streaming JSON output are supported. See the generated
[CLI reference](reference/cli.md) for flags and the
[agent feature guide](agent-features.md) for limits and configuration.

## Troubleshoot setup

- A connection error: verify the endpoint, selected model, credentials and proxy in Settings.
- A missing command or tool: confirm its owner is installed, enabled in the effective scope and reloaded.
- Missing native graphics: the companion needs terminal protocol support; a compact status is the fallback.
- Source development: use the [contributor guide](contributing.md) instead of the native installer.
