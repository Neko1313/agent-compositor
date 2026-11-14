# UI appearance and view plugins

The compositor supplies a readable default terminal UI. Plugins can override
its appearance and replace named text views without importing Ink or touching
window management. Placement rules and manual drag/resize remain authoritative.

Architecture update (2026-11-10): only the tiling mechanism remains fixed.
This guide describes the current appearance/view API, not the complete target
replacement surface. Editor, dialog, placement and history behavior can now be
selected through private [UI controllers](ui-controllers.md). Appearance hooks
remain the portable decoration/view layer. See [the accepted replacement contract](03-contracts.md#replacement-contract--accepted-target).

## Change the theme

The removable `ui-theme` plugin provides `/theme slate|amber|mono`. It saves
the selection in `.agent-compositor/theme.json` and restores it at startup and
plugin reload. Slate uses the built-in defaults. Removing the plugin removes
its appearance contribution when plugins are reloaded.

Portable appearance applies to Ink and the opt-in OpenTUI application frontend.
Each frontend keeps its own defaults for omitted fields. OpenTUI updates native
widgets in place, including the parked editor, private standard controls and
Finder; changing a theme does not replace their input owners. The bundled amber
and mono themes specify explicit selection foreground/background pairs so the
selection remains readable with either frontend's defaults. The separate
`ui.render` status override supplied by this plugin still applies to Ink;
OpenTUI public render overrides remain a migration gate.

Tools no longer occupy an empty window at startup. In Ink, `Alt+t` opens detailed
tool activity. In OpenTUI, F2 Windows can open canonical Tools, while Arrange
`t` creates another Tools view. The conversation displays compact tool activity.
Ctrl+J inserts a newline; Shift+Enter also works in terminals that distinguish
it from Enter. Enter sends the complete draft. Up/Down browse this run's prompt
history when outside a multiline edit or while already browsing history.

## Configure appearance

Publish a contribution from a lifecycle or command hook:

```ts
export default {
  "session.start": async (_event, $) => {
    await $.ui.configure({
      colors: { accent: "#e5bd85", titleBackground: "#30291f",
        selectionBackground: "#4a3b28", selectionText: "#f3f7fa" },
      chrome: { borderStyle: "round", controls: "focus" },
      presentation: {
        agentLabel: "Compositor", toolDetails: false, hints: true,
      },
    });
  },
};
```

`$.ui.configure` emits `service.ui.configure` through the normal hook chain.
The event catalog validates the payload. Colors accept `#rrggbb` or standard
Ink ANSI color names, never terminal escapes.

Each call **replaces this plugin's contribution**. Missing fields inherit
earlier contributions or defaults. The most recent publisher wins per field.
`$.ui.configure(null)` removes only the caller's contribution; plugin unload
does the same. Contributions are runtime state: persist choices explicitly
if needed, as the `ui-theme` plugin does.
An invalid publication leaves the last valid contribution and its precedence
unchanged. Reload and Core replacement remove expired contributions; lifecycle
hooks may publish the new plugin instances' choices again.

Colors: `text`, `muted`, `accent`, `success`, `warning`, `danger`, `border`,
`titleBackground`, `selectionBackground`, `selectionText`. Use an explicit RGB
foreground/background pair for predictable selection contrast; bold ANSI black
may become bright black in the terminal palette.

Chrome: `borderStyle` (`single`, `round`, `double`), `controls` (`focus`,
`always`). Focus mode also shows buttons on title hover. Styles retain the
same title and border hit areas.
OpenTUI places `[F][x]` in the top title/border row of panes at least fourteen
cells wide. Their painted three-cell regions zoom or close that exact pane;
the remaining title cells retain drag behavior. Closing hides a request or
conversation rather than answering, approving or cancelling it.

In the shipping terminal's **WINDOW MODE**, title controls are temporarily shown
on every visible window so arrangement actions remain discoverable. Leaving the
mode restores the configured `controls` policy. The host-owned Windows finder
uses the selected theme, but its private filter and navigation do not pass
through `ui.render`. Existing plugin views continue to use the normal hook.

Presentation: `userLabel`, `agentLabel`, `welcome`, `toolDetails`, `hints`,
`showTools`. The last option requests opening/closing the initial Tools window
at publication time; it is not a replacement for placement rules.

In OpenTUI, labels decorate transcript roles without renaming panes or changing conversation
identities. Welcome text appears only in an empty conversation. Labels and
welcome are literal text; control and bidirectional formatting characters are
made visible, while welcome may contain line breaks. `hints: false` hides optional
host guidance; actionable decisions, mode/state indicators and explicitly
provided plugin/controller content remain available.

In OpenTUI, `toolDetails` adds bounded argument text to observed Main tool calls.
Only positively identified calls from the current Core binding enter this
projection. UI operations and ambiguous historical calls are omitted, human-input
tool arguments are redacted, and raw result bodies never enter these rows.
Reopening or resuming retains committed user/assistant history without inferring
the origin of old tool groups. Current live tool result receipts supply success
or error state; unknown completion is not presented as verified success.
For the structured shell tools, a nonzero exit is an error, a background launch
is a neutral started observation, and a completed poll can report that the
process is still running. Generic tool invocation success does not establish
that a command or project check passed; output prose is never parsed for success.

An explicit `showTools` publication can reopen canonical Tools after a user
closes it. Existing placement, workspace and zoom are preserved when it is
already open, and other Tools copies are unaffected. Unrelated patches,
`null` and unload do not replay this intent. Closing the currently focused Tools
requires the normal focus fallback; other publications do not take focus.

## Replace a view

This section describes Ink's existing render override path. Public `ui.render`
and `ui.invalidate` adaptation for OpenTUI remain separate migration work;
appearance support does not expose private controllers or editor checkpoints
to these hooks.

The app invokes the existing `ui.render` hook. Keep the catalog's
`{ tree: ... }` response envelope, with a portable text view inside:

```ts
export default {
  "ui.render": (event, $) => {
    if (event.site !== "status") return;
    return {
      tree: {
        lines: [
          ...event.props.lines.slice(0, 1), // retain workspace controls
          { text: "My workspace · / commands", tone: "muted" },
        ],
      },
    };
  },
};
```

Sites: `conversation`, `tools`, `help`, `status`, and
`plugin:<plugin-name>/<local-surface-id>`, such as `plugin:todos/tasks`.
`event.props.lines` contains the complete lines for semantic plugin views, with
`scrollOffset`, `scrollable` and host-owned `fieldRows` metadata. Other sites
provide their default visible rows. The host clips/scrolls replacement semantic
views, preserving keyboard access to offscreen actions. Props also include
title/status and plugin identity where applicable. `event.viewport` reports
drawable content columns and rows, excluding window chrome.

An explicit `placement: {focus: true}` on `$.ui.view` also focuses an existing or
reopened pane in its current workspace. It does not retile an existing pane or
undo a user's move/resize. Saved placement rules with `focus: false` remain
binding. Ordinary updates without an explicit focus request keep current focus.

Lines accept `text`, `tone`, `bold`, `selected`. Tones are `text`, `muted`,
`accent`, `success`, `warning`, `danger`; selected rows use the selection
background and foreground. Optional view `hint` supplies the focused-panel
shortcut line; editable input metadata can supply a `label` (default Search).
Output is sanitized, wrapped and clipped to the viewport.
Returning `undefined` or `$.next()` continues the chain. Invalid views or
thrown errors preserve the default. The first valid tree returned by the
hook chain wins, following normal tier ordering.

Results are cached until visible inputs change. After changing private
plugin state outside rendering, request a refresh:

```ts
await $.emit("ui.invalidate", { site: "status" });
```

Currently invalidation refreshes all visible views; regions are hints.
Async results for an obsolete viewport, theme or plugin instance are
discarded. Render hooks are read-only: state writes and UI mutation services
are rejected, including after an `await`. Update state in another hook and
invalidate afterward.

Text input, approval/question dialogs and placement settings use selected private
controllers; see [their behavior contracts](ui-controllers.md). With the standard
controllers they inherit the theme. Replacing status text does not remap workspace or
Plugins click coordinates. Preserve the first status row when overriding it.
This text contract does not load arbitrary React components into the renderer.

## Wire contract and verification

This wire path describes Ink. OpenTUI currently consumes guarded in-process
ports and data-only snapshots; complete wire adaptation remains a migration gate.

Protocol 0.5 adds optional resolved `chrome` and `hovered` frame properties.
Renderers receive concrete colors and cells; they do not execute plugins.
Older frames without chrome retain renderer defaults.

Use the project's `tui-visual-check` skill. The real app runs with isolated
tasks/config and a scripted provider. The bench covers mouse layout, task
updates, placement persistence, plugin appearance/status override, theme
restoration, narrow terminals, slash suggestions and multiline input.
It does not verify a live model or every native terminal.

## Expandable semantic tables

Development catalog 0.27 adds optional `UiTextView.table`. Existing `lines` views
are unchanged. Pass table data rather than padding column strings in a plugin:

Check `$.ui.supports?.('table') === true` before publishing a table from an
independently distributed plugin. Current hosts expose this read-only capability
method; unknown features return false. Older hosts may omit the method. Keep a
text view for those hosts; a plugin's bundled dependency version does not identify
the capabilities of the running host.

```ts
await $.ui.view('runs', 'Runs', {
  lines: [{text: 'Recent runs', bold: true}],
  table: {
    columns: [{label: 'Run', width: 18}, {label: 'State', width: 12}],
    rows: [{
      id: 'unit-tests', cells: ['Unit tests', 'passed'],
      action: 'expand:unit-tests', expanded: true,
      details: [
        {text: 'All configured unit checks passed.'},
        {text: '[ Open report ]', action: 'report:unit-tests'},
      ],
    }],
    empty: 'No runs yet. Start a configured check to see results.',
  },
});
```

The host aligns columns when the viewport fits their preferred widths and stacks
labeled fields in a narrow pane. Expanded details wrap without truncation. Click
a row or use Up/Down and Enter; row actions and detail actions use ordinary
`ui.press`. Expansion, filters and updates belong to the producer: handle the
action, update state and publish a new view. A stable row ID is not an automatic
command or a model prompt. Table rows require unique IDs and one cell per column.
Tables support up to eight columns, 200 rows and 100 detail lines per row.

`ui.render` receives semantic `props.table` alongside `props.lines`; a replacement
view can preserve or replace the table. Plain surface text includes labeled rows
and expanded details. No arbitrary frontend code is loaded. This table contract
is independent of Ink; a future renderer can consume the same data directly.

## Semantic tabs

Development catalog 0.28 adds optional `UiTextView.tabs` for plugin panes. Check
`$.ui.supports?.('tabs') === true` before using it from an independent package;
table support alone does not imply tab support. Existing views without tabs are
unchanged. A view can combine tabs, ordinary lines and a table:

```ts
await $.ui.view('jobs', 'Jobs', {
  tabs: [
    {id: 'all', label: 'All', action: 'filter:all', selected: true},
    {id: 'running', label: 'Running', action: 'filter:running'},
    {id: 'unavailable', label: 'Unavailable', action: 'filter:off', disabled: true},
  ],
  lines: [{text: 'Choose a job to inspect its progress.'}],
});
```

Click a tab, select its action with Up/Down and Enter, or switch directly with
Left/Right in the focused pane. Left/Right wraps and skips disabled tabs, starting
from the producer's selected tab. If none is selected, it starts from the last
focused tab action. This keeps navigation correct when returning to a pane whose
selection differs from its previous keyboard focus. The
producer receives the ordinary `ui.press` action and republishes the chosen
`selected` state; the host does not run a model or infer filter behavior. Disabled
tabs have no click target. Selected tabs use accent, bold and underline; keyboard
focus uses the normal selection background independently of selection.

Tabs wrap onto additional rows in narrow panes; a label wider than the pane is
elided. Keyboard switching scrolls an offscreen tab into view. Labels are literal
text, not inline Markdown. Up to twelve tabs are allowed, with unique IDs and
actions, labels up to sixty characters and at most one selected tab.
`ui.render` receives `props.tabs`, and plain surface text identifies the selected
tab. Renderers still receive resolved cells, not executable tab components.

## Animated plugin panes

The optional default [mascot plugin](../plugins/mascot/README.md) demonstrates
raster panes and semantic reactions. `UiTextView.raster` accepts bounded base64
RGBA8 frames alongside action rows. The terminal renderer scales frames into
true-colour half blocks; `ui.render` can replace raster views as well as text.
`ui.visibility` lets producers suspend timers while a pane is hidden or closed;
`$.ui.remove(id)` removes a plugin's own pane from every workspace.

Other plugins can emit `ui.reaction` with `source`, `kind`, `id`, and `active`.
Matching start/end IDs preserve simultaneous activities. Actual manual approval
and question dialogs publish these signals too; independent agents forward only
activity metadata through `agent.activity`, excluding prompts and tool arguments.

## Composer attachments

A portable view can supply `attachment: {site:'composer', width:18, rows:6,
label:'Ready'}`. This adds bounded art beside the standard human editor rather
than a tiled plugin window. Optional rows is 1–8 (default4). Text is literal;
a raster uses negotiated native pixels and is masked out of the editable grid.
Unsupported image terminals and constrained viewports retain a compact status.
Protected dialogs/completions keep their input space. The draft and input
handler are never replaced by decorative content.

Multiple producers use stable registration order with the latest selected;
normal `ui.visibility` events suspend earlier/compact animations. Unload or
`$.ui.remove` detaches the contribution. The contract has no mascot-specific
logic. Native image changes can repaint independently of unchanged text/layout.
The renderer owns all graphics control sequences. See the
[Ghost plugin](../plugins/mascot/README.md) for GIF/APNG packs and Kitty/SIXEL
capabilities and limitations.
