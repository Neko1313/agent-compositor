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
