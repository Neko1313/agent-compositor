# Wisp Soul companion

The default optional plugin uses pixel silhouettes redrawn from the user's Wisp Soul storyboard. It attaches
to the human message composer, without creating a window or participating in the
tiling tree. It makes no model calls and changes no permission decisions.

On terminals at least 60 columns × 24 rows, six text rows sit beside the editor.
At smaller sizes, during slash completion, or while a protected dialog/settings
form is active, the host keeps the editor/dialog space and a compact state label.
Animations run at 250 ms only when this contribution is selected and expanded;
headless, compact, paused and hidden states do not advance frames. Transient
results still expire, and activity changes still update the static status.
`NO_COLOR` and `TERM=dumb` also stop motion. Colors use semantic theme tones.

- `/mascot on|off`: enable or remove the attachment, saved across sessions.
- `/mascot pause|resume`: stop or resume motion, also saved.
- `/mascot pet`: briefly play the happy state.
- `/mascot reload`: reread settings and reset the event observer.

Settings use the shared plugin configuration scopes (`mascot.json`); commands
save project overrides. Existing `enabled`, `paused`, `tools` and `reactions`
settings continue to work. APNG pack settings are now legacy and produce an
informational notice; the default no longer decodes or renders images. The old
APNG assets/decoder remain available for compatibility and generic raster tests.

The activity reducer observes turns, tools, concurrent subagents, actual human
dialogs, planning signals and independent-agent metadata. Dialog reactions take
priority, then active tools and waiting for agents. Completion/errors are brief.
Unloading/replacing the plugin removes its contribution and timers.

## Replace or extend

Disable `mascot` in extension settings and load another plugin, or contribute a
portable text view using the same generic API:

```ts
await $.ui.view('spirit', 'My companion', {
  attachment: {site: 'composer', width: 12, label: 'Ready'},
  lines: [{text: '  hello', tone: 'accent'}],
});
await $.ui.remove('spirit');
```

The host owns text editing, focus, submission and human dialogs. Attachments do
not receive the draft or replace the input handler. Up to eight rows of text (four by default, or attachment.rows) are painted
literally, using bounded width (4–20 cells) and the shared theme. Wisp uses
18×12 monochrome pixels packed into 18×6 terminal cells with half-block glyphs,
including cutout eyes, a bent flame tip and state-specific decorations. Raster,
actions and embedded input fields are not interactive in this decorative slot.
A replacement registered after another contribution takes the slot; earlier
producers receive `ui.visibility` with `visible:false` and resume when selected
again. Existing contribution updates do not change that order. Visibility keeps
the normal `plugin:<name>/<surface>` identity; expanded size reports four rows,
compact size one row and zero art columns. `attached:false` ends the attachment.
No window placement or saved workspace geometry is created for composer views.

Other plugins can still emit `ui.reaction` with `source`, `kind`, optional `id`
and `active` to announce work. Map custom tool names/states in `tools`, and
custom `<source>:<kind>` signals in `reactions`. Supported states are idle,
thinking, searching, editing, planning, waiting_subagents, question, approval,
done and error. Source artwork calls waiting_subagents `waiting`.

`npm run visual:mascot` verifies the actual PTY input path, animation, pause,
compact mode, draft preservation, disable and restart. It requires a Unicode
terminal font; appearance of individual glyphs depends on the font. The generic
raster/Kitty protocol remains available to other UI views.
