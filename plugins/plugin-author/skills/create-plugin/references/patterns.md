# Working extension patterns

`plugin_dev init` writes command/tool/panel/skill/service starters. Edit the
behavior for the user's request rather than handing back the default message.

## Prompt command (hooks.ts)

```ts
export default {
  'prompt.submit': async (event, $) => {
    if (event.text.trim() !== '/project-status') return;
    const settings = await $.storage.config('project-status.json');
    await $.ui.notify(settings.message ?? 'Project status ready');
    return {drop:'project-status handled'};
  },
};
```

Add /project-status to manifest commands so completion and command discovery
can find it. Return undefined for unrelated prompts. Do not invoke a model just
to render a deterministic command.

## Model-callable read tool (tools.ts)

```ts
export default [{
  name: 'project_status',
  description: 'Read the project status configured by the user',
  parameters: {type:'object',properties:{}},
  describe: () => ({tool:'project_status',readOnly:true}),
  execute: async (ctx) => {
    ctx.signal.throwIfAborted();
    return {ok:true,data:await ctx.settings('project-status.json')};
  },
}];
```

For a mutating or network operation, describe its actual path/URL/command and
propagate cancellation. Do not label arbitrary execution read-only.

## Portable panel

```ts
async function show(_, $) {
  await $.ui.view('status', 'Project status', {
    lines:[{text:'Ready',tone:'success'}],
  }, {site:'sidebar',size:0.25,focus:false});
}
export default {'session.start':show, 'session.reload':show};
```

The compositor controls placement. Add ui.press handling for actual actions;
rendered labels alone are not clickable controls. Use $.ui.remove('status') to
remove a contribution. A mascot-like contribution can use
attachment:{site:'composer',width:18,rows:6,label:'Ready'} and a bounded raster;
native pixel output depends on the terminal's graphics capability.

## Private editor controller (main module)

```ts
export const controllers = {
  editor: ({state}, {signal}) => {
    let text = state?.text ?? '';
    return {
      snapshot: () => ({text,cursor:text.length}),
      preferredRows: () => 3,
      render: () => ({hint:'F2 sends',lines:[{text}]}),
      handle(input) {
        signal.throwIfAborted();
        if (input.kind === 'text') text += input.text;
        if (input.kind === 'key' && input.key === 'f2') {
          const submitted = text; text = '';
          return {type:'submit',text:submitted};
        }
      },
      dispose() { text = ''; },
    };
  },
};
```

Select it with ui.controllers.editor set to the plugin name and restart. A real
editor also needs the requested editing/navigation behavior. Keep draft/input
private; do not broadcast it in render events.

## Agent instructions provider

```ts
export default {
  'service.agent.instructions': async () => ({
    value:'Assist with the selected workflow using observed tool results.',
  }),
};
```

Declare provides:["service.agent.instructions"] and select the plugin through
serviceProviders. Replacing service.agent.run instead owns orchestration: inspect
its installed schema and use the supplied turn context, normal tool scheduling,
signals and budgets. Providing instructions alone does not replace the loop.
