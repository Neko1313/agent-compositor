# Ghost companion

Default, optional plugin. The supplied ten APNG animations remain unchanged in
`assets/`; `upng-js` decodes and composites their frames. The TUI renders them as
true-colour half-block cells, preserving animation in terminals without an image
protocol. At small window sizes the image loses detail; enlarge the pane or use
fullscreen. The plugin uses no model calls and changes no permission decisions.

- `/mascot on|off`: show or disable, saved across sessions.
- `/mascot pause|resume`: stop or resume motion, also saved.
- `/mascot reload`: reread configuration and animation pack.
- Click **Pause / Resume** or **Pet Ghost** in the pane. Pet plays `done` briefly.
- Move, resize, switch workspace and save placement through the existing window
  controls and **Plugins** panel. Closing the pane stops animation until reopened.

Reactions observe turn/tool/subagent events, actual approval and question dialogs,
plan-mode signals, and metadata forwarded from independent background agents.
Manual dialogs take priority, followed by tool work and waiting for agents.
Completion and errors play briefly. Concurrent actors have separate activity IDs.
Hidden panes and headless sessions do not run an animation timer. Unload/close
releases timers. Pausing motion still allows static state changes.

## Replace the mascot

Disable `mascot` with the existing extension settings and load your own plugin,
or replace its animation pack in `.agent-compositor/mascot.json`:

```json
{
  "enabled": true,
  "paused": false,
  "pack": "assets/my-companion",
  "animations": { "idle": "rest.apng", "thinking": "work.apng" },
  "tools": { "my_search_tool": "searching" },
  "reactions": { "my-plugin:compiling": "editing" }
}
```

Omit `pack` to use the bundled assets. Pack paths must stay within the project;
animation paths must stay within that pack, including after resolving symlinks.
Unmapped states use `<state>.apng`. Available states: `idle`, `thinking`,
`searching`, `editing`, `planning`, `waiting_subagents`, `question`, `approval`,
`done`, `error`. Missing/bad states fall back to idle, then a text status; a warning
is shown once per state. Reload after changing configuration or files. PNG inputs
are bounded to 2 MiB, 512×512, 120 frames, and 8 million total pixels. Published
RGBA frames are sampled to at most 96×96; the renderer fits them to the viewport.

## React to another plugin

Publish a semantic activity signal; no mascot-specific dependency is required:

```ts
await $.emit('ui.reaction', {
  source: $.plugin, kind: 'searching', id: 'index-build', active: true,
});
try {
  // Existing operation.
} finally {
  await $.emit('ui.reaction', {
    source: $.plugin, kind: 'searching', id: 'index-build', active: false,
  });
}
```

Omit `active` for a short reaction, for example `done`. Custom `kind` values can
be mapped with `reactions`. Match `source` and `id` when ending an activity.
Observers must not influence the action being observed.

The generic UI APIs are also available to replacement plugins:
`$.ui.view(id, title, {raster: {width, height, rgba, alt}, lines}, placement)`,
`$.ui.remove(id)`, `ui.visibility` (site, visible, attached, columns, rows), and
`ui.render` overrides. `rgba` is base64 RGBA8, limited to 128×128 with an exact
byte count. Other components need not know about Ghost or APNG.
