# Build an agent that works your way

Agent Compositor is an open runtime for LLM agents. Combine a model, tools,
instructions and extensions into a working environment, with a tiling terminal
interface for conversations, agents and plugin panels.

The kernel is domain-independent. Coding is one possible composition; a different
professional workflow can select its own capabilities. The fixed tiling manager
owns windows and focus. Public contracts let extensions replace agent behavior,
tools, model integration, UI controllers and session storage.

## Start with a working agent

[Install Compositor and configure a model](getting-started.md), then run your first
task. Filesystem plugins start inactive: install and explicitly enable the ones
you want in user or project scope.

- [Using the agent](agent-features.md): sessions, permissions, context and budgets.
- [Internet and attached projects](workspaces-and-web.md): search, sources and filesystem scope.
- [Settings and storage](state-and-network.md): connections, credentials and proxy configuration.
- [Find and enable extensions](marketplace.md): the offline catalog, installation and updates.

## Make it your own

Follow [your first plugin](first-plugin.md) to create a command, load it and check
its behavior. One package can combine hooks, tools, UI, skills and stdio MCP.

- [Author plugins with the agent](plugin-authoring.md).
- [Browse the plugin reference](reference/plugins.md).
- [Replace kernel strategies](core-customization.md).
- [Replace UI controllers and conversation storage](ui-controllers.md).

## Understand and contribute

Read [the architecture map](architecture.md) for the active application path and
package boundaries. [The contributor guide](contributing.md) explains local
development, verification and the documentation workflow.

This site follows the **main branch**. Features described here can be newer than
your installed release. Check [release maintenance](releases.md), the
[CLI reference](reference/cli.md), and each plugin's independently versioned page
when comparing installations. The [design history](INDEX.md) contains historical
milestones; its dated entries are not the current feature inventory.
