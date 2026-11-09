# Ghost media companion

The optional default plugin plays the original Ghost APNGs inside the human
message composer. It does not create an agent or a separate tiled window.
Other plugins can replace it through the shared composer/raster UI contract.

## Image output and terminal support

The renderer probes actual capabilities, independently of the file format:

- Kitty graphics: full RGBA source pixels, transparency and cached frame uploads.
- SIXEL: an adaptive palette of up to 256 colours, queried physical cell size,
  and alpha composited against the queried terminal background. The renderer
  erases stale placements before text/layout changes; normal frame updates
  replace their own rectangle without a blank flash.
- Other terminals: a compact status, with `images unavailable` in the composer
  title. The default does not turn a GIF into a low-resolution text character.

`AGENT_GRAPHICS=auto` is the default. `kitty` explicitly selects Kitty output;
`sixel` selects SIXEL (cell metrics/background replies are still required for
safe placement); `off` disables image output. Auto detection is disabled inside
tmux/screen because passthrough is not implemented. SIXEL terminals can answer
the direct cell-size query, or text-area pixel/cell queries (as VTE does).
Font-size changes re-query geometry. Source frame changes bypass React/Ink when
text and layout are unchanged; actual terminal throughput still determines how
many frames are visible. No FFmpeg executable is needed at runtime.

A terminal is a rendering client, not a universally addressable framebuffer.
Full pixel playback requires a graphics protocol. FFmpeg's libcaca output is
text rendering too; it cannot add image support to an arbitrary terminal.
See the [Kitty protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/),
[VTE SIXEL property](https://gnome.pages.gitlab.gnome.org/vte/gtk3/property.Terminal.enable-sixel.html)
and [FFmpeg CACA documentation](https://www.ffmpeg.org/ffmpeg-devices.html#caca).

GNOME Terminal can enable SIXEL through its profile when the VTE build includes
it; application probing must still confirm support. If the setting exists in
your installation, enable it for a chosen profile in the terminal settings or
with its `enable-sixel` GSettings key. This project does not modify user terminal
profiles automatically. Unsupported builds/settings stay in status mode.

## Playback and commands

- `/mascot on|off`: attach/restart or remove the companion; persisted.
- `/mascot pause|resume`: freeze source time or continue it; persisted.
- `/mascot pet`: briefly select the happy animation.
- `/mascot status`: show frame count, average **source** fps and image-slot state.
- `/mascot reload`: reread configuration and the pack.

GIF and APNG retain source frame timing and loop counts. The player uses elapsed
source time, skips late frames instead of accumulating rendering delay, freezes
when hidden/compact, and disposes timers on unload. Protected human dialogs and
slash completion keep their input space. NO_COLOR, TERM=dumb and pause stop
motion; activity/status changes and transient expiry still work. The text layer
permits up to 60 redraws/s, while pixel-only updates use the native image path.
This is not a guarantee of 60 visible fps in every terminal or connection.

The old Ghost source has six frames at 180 ms each (about 5.6 fps). A new renderer
cannot manufacture missing motion. Supply a higher-frame-rate APNG/GIF for a
smoother original animation; no poses are invented or cross-faded by default.

## Packs and replacement plugins

Settings use shared plugin configuration scopes (`mascot.json`); commands save
project overrides. Custom pack files are confined to the project, including
symlinks. Map any state to a GIF, APNG or PNG; decoding follows the file header:

```json
{
  "enabled": true,
  "paused": false,
  "pack": "assets/my-ghost",
  "animations": {"idle": "idle.apng", "thinking": "thinking.gif"},
  "tools": {"my_search": "searching"},
  "reactions": {"my-plugin:compiling": "editing"}
}
```

Unmapped names use `<state>.apng`. States are idle, thinking, searching, editing,
planning, waiting_subagents, question, approval, done and error. Missing/bad states
fall back to idle and then status, with one warning per state. Bounds are 2 MiB
input, 512×512, up to 600 frames and 8 million decoded pixels
per animation. Nonzero frame delays are preserved; unspecified zero delays use
100 ms for GIF and 10 ms for APNG. GIF
transparent patches, interlace (decoder), disposal 2/3, and loop metadata are
supported. Static images and finite loops stop at their final frame.

The bundled APNGs have unintentionally transparent dark outlines retaining RGB.
Their existing `restoreInk` repair is enabled automatically only for the exact
historical file fingerprints; new/replaced artwork is never repaired implicitly.
Custom packs also default off. Use
`restoreInk:false` for exact original transparency. GIFs never use this repair.

Replacement producers publish bounded frames with the portable API:

```ts
await $.ui.view('companion', 'My companion', {
  attachment: {site:'composer', width:18, rows:6, label:'Ready'},
  raster: {width, height, rgba: rgbaBytes.toString('base64'), alt:'Ready'},
  lines: [],
});
await $.ui.remove('companion');
```

The host owns drafts, focus, submission and dialogs. Native pixels occupy only
the reserved art rectangle, never the editable text. Slots use stable producer
registration order: the latest contribution is selected, older producers get
`ui.visibility` with `visible:false`, and resume when selected again. Image
motion only runs when the slot is expanded (>=60 columns, >=24 rows). Text-only
attachments remain supported. Plugin `ui.reaction` events and tool/subagent
activity still select states without influencing the observed action.

## Verification

`npm run visual:mascot` runs the real PTY app with the diagnostic Kitty emulator;
it verifies source dimensions, frame changes, pause, pet, resize, drafts, disable
and restart. The emulator is not certification of a physical terminal.
`VISUAL_MASCOT_GIF=/absolute/path/to/test.gif` selects a GIF in its isolated test
project. `VISUAL_EXPECT_MIN_FPS` sets an explicit test-only observation threshold;
reports distinguish observed changes from source fps. `node
tools/visual/sixel-reference-check.mjs` optionally checks encoded pixels against
ImageMagick's independent SIXEL decoder. SIXEL negotiation/cleanup and GIF
compositing/timeline behavior also have package tests. Native GNOME hardware
rendering has not been verified by these tests.
