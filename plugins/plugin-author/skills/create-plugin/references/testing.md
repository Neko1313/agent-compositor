# Verify the extension

Use plugin_dev check for the native manifest, entry containment and skill
frontmatter. It never imports or activates the candidate. A valid structure
can still contain invalid syntax, bad imports or incorrect behavior.

For syntax/type checks use the runtime/compiler available in the user's project.
Do not require a source checkout or install development dependencies just for a
simple command. Public SDK links from init let native imports resolve beside the
plugin. For plugins with external dependencies, choose and verify an explicit
installation/bundling approach.

Before activation, identify one visible acceptance check for the actual request:

- Command: only its exact trigger is consumed, and the expected message/effect appears.
- Tool: verify returned data and external effects, ordinary denial handling and an invalid input.
- Panel/controller: exercise real input, close/reload and any pending interaction; verify draft/privacy behavior.
- Skill: the description appears after reload; its body loads through skills.
- Service: select it explicitly, restart, and observe its actual effect. Verify cancellation and the required policy/budget/journal behavior for the service being replaced.

After the current turn completes, the user can run /reload. Inspect the reload
report for load errors. Invoke the new command/tool and inspect the actual output;
then check unrelated behavior still works. File edits and model-written success
claims are not evidence of a working runtime extension.

Configuration selections (enabledPlugins, agent.tools, serviceProviders,
toolProviders, ui.controllers and sessionProvider) are startup settings. Preserve
unrelated entries and restart if they were edited. Do not bypass a denial to make
an acceptance check pass.

For an authoring iteration, edit the local files and run /reload again. dispose()
must stop external resources; session.reload must reconstruct required state.
If a dependency or host capability is unavailable, report that specific gap.
Distinguish scaffolded, structurally checked and runtime-verified results.
