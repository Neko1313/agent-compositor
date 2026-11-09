# Ghost companion

Default, optional plugin using the ten original APNG animations in `assets/`.
Frames retain their original 228×228 resolution and timing. No model calls are
made and no permission decisions are changed.

The terminal renderer probes for Kitty Graphics Protocol support. Supported
terminals display full RGBA pixels with transparency; other terminals retain a
true-color half-block fallback. This mechanism is available to every UI plugin,
not just Ghost. `AGENT_GRAPHICS=off` forces fallback; `AGENT_GRAPHICS=kitty`
forces graphics when detection cannot run. Auto mode falls back inside tmux or
screen, whose passthrough is not implemented. Sixel/iTerm2-only terminals use
the fallback. Native terminal support and scaling behavior depend on the client.

The supplied APNG files accidentally mark dark outlines/eyes transparent while
retaining their RGB. For this built-in pack, `restoreInk` restores those existing
dark pixels within 12 source pixels of the opaque sprite; the source files are
unchanged. Set `"restoreInk": false` for exact source transparency. Custom packs
default to no repair, and may explicitly opt in. A dark transparent matte far
from the sprite remains transparent. This repair follows the supplied storyboard
and does not synthesize new poses or frames. Repair needs the original hidden
RGB; packs that clear that data should keep repair disabled.

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
RGBA frames keep their original resolution; the renderer fits them to the viewport.

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
`ui.render` overrides. `rgba` is base64 RGBA8, limited to 512×512 with an exact
byte count. Other components need not know about Ghost or APNG.

## Graphics transport and verification

Wire protocol 0.6 adds optional `render.raster`, negotiated through the `Raster`
capability. The text grid is always present for compatible fallback renderers.
Only the terminal renderer constructs escape sequences; plugins publish bounded
RGBA, never raw terminal control strings. Rendering hooks can replace or remove
the raster using the existing `ui.render` contract.

Image payloads are zlib-compressed, chunked, cached (at most 64 inactive/active
frame entries unless more are simultaneously visible), and placed after Ink
commits a frame. Placement follows window layout, disappears on hidden
workspaces, close or suspension, and is freed on exit. Original six-frame APNG
motion is preserved; the implementation does not invent intermediate poses.

`VISUAL_GRAPHICS=kitty npm run visual:check` validates the actual PTY commands
with the browser bench's diagnostic protocol emulator. It verifies transmission
and placement, not a particular terminal emulator's GPU implementation. See
[the bench guide](../../tools/visual/README.md).
