# Your first plugin

Create a local `/hello` command that displays a notification without calling a
model. This example uses the public prompt and UI contracts and the real disk
loader. Its source is exercised by `npm run docs:check`.

## Create the package

In your project, create `plugins/hello/plugin.json`:

```json
{
  "name": "hello",
  "version": "1.0.0",
  "trust": "trusted",
  "main": "hooks.js",
  "commands": [{"name": "/hello", "description": "Show a greeting"}]
}
```

Create `plugins/hello/hooks.js` with this exact example:

<!-- include-example: tools/docs/examples/hello/hooks.js -->

```javascript
export const hooks = {
  'prompt.submit': async (event, $) => {
    if (event.text.trim() !== '/hello') return;
    await $.ui.notify('Hello from your plugin!');
    return {drop: 'hello command handled'};
  },
};
```

<!-- end-example -->

Returning nothing passes an unrelated prompt down the handler chain. Returning
`drop` consumes the command so the model does not answer it as ordinary text.
Await notifications and other asynchronous host operations before completing
the hook. Trusted modules execute in the host process; install code you trust.

## Enable and reload

Start Compositor from that project, then run:

```text
/extensions enable hello --project
/reload
/hello
```

Local development directories can be enabled directly. Marketplace packages must
be installed in the chosen scope first. If your configuration has an explicit
`enabledPlugins` ceiling, it must permit this package too.

You should see “Hello from your plugin!” without a model request. `/hello-other`
and ordinary messages should continue through the usual prompt path.

## Check its lifecycle

Edit the greeting, run `/reload` between turns and invoke `/hello` again. Restart
Compositor and confirm the project selection persists. Then disable it:

```text
/extensions disable hello --project
/reload
```

The command and hook should disappear from the active composition. Re-enable
and reload to use it again. For packages intended for distribution, add the
standard metadata, README, changelog and mandatory test plan described in the
[plugin standard](plugin-standard.md).

## Extend the example

Use [plugin authoring](plugin-authoring.md) to create packages with the agent,
[the event catalog](events.md) to find hooks, and
[the composition cookbook](../plugins/plugin-author/skills/create-plugin/references/composition.md)
to combine commands, tools, panels, skills and MCP under one lifecycle.
