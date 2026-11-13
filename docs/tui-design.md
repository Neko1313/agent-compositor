# Terminal interface principles and review

The TUI is an Operate surface: users must understand the active task and act
without losing their context. Preserve the i3-like window model, terminal cell
geometry, character graphics and replaceable plugin presentation. Web typography,
DOM accessibility and SVG-icon advice cannot be applied literally to Ink cells.

The 2026-11-10 review used Impeccable 4.3.1 and tui-visual-check. Independent
assessment A reviewed design and heuristics; B collected detector/PTY evidence
without seeing A. A separate controls review examined editing and focus. The
baseline scored 27/40 on Nielsen's heuristics. This is a baseline opinion, not an
automatic score or a measured post-change usability result. The archived critique
is under `.impeccable/critique/`; it records provenance and all ten scores.

## Decisions by segment

| Segment | Principle and implementation |
|---|---|
| Windows/workspaces | Project each saved split into readable child rectangles (24 columns, 6 rows). Collapse toward content focus only when both children cannot fit. Ratios and trees stay unchanged, directional keys reach hidden panes, and widening restores geometry. Composer focus preserves fullscreen. Arrange exposes the key map beside the selected window; the Windows finder identifies open/closed views and workspaces, and restores the existing conversation identity. Navigation keeps resident drafts, form cursors and undo state intact. |
| Transcript/Markdown/tools | Keep the verified message hierarchy, Markdown and compact tool states. Prefer whole-word wrapping even when the previous word occupies less than half a row. Keep literal command/input characters distinct from rendered assistant Markdown. |
| Composer/slash/status | Name an approval or question explicitly. Show waiting status and interaction-specific shortcuts. Keep the hint row when context details do not fit. Toolbar hitboxes only exist for visible complete labels; wrapped workspace tabs retain mouse access. |
| History | Keep local search/preview/resume and current/archive markers. Call an empty current session New chat. Pin the search-field label; scroll long values inside its remaining width, rather than dropping the label or placeholder beginning. |
| Providers/auth/proxy | Shared form focus, required markers and validation provide consistent native editing. Offscreen actions are reachable and scrolled into view. Show effective routing separately from when-enabled settings; diagnostics are explicitly disclosed and keep host credential redaction. |
| Questions/approvals | Shift+Tab reverses navigation; text fields have real cursor editing and horizontal viewports. Approval identity and scopes stay pinned while all action details scroll. Enter defaults to deny; Y/A/P/N and mouse controls remain explicit. |
| Placement | Use visible focus, reversed Tab, field-specific guidance and safe Escape. Closing an in-flight save does not claim to cancel its side effect. Preserve user-controlled placement and plugin overrides. |
| Todos/agents/workflows/mascot | Apply readable projection, whole-word wrapping, action navigation and overflow cues through shared contracts. Preserve task order, independent agent behavior, workflow lifecycle and supplied mascot assets. |

The [configured OpenTUI frontend](02-ui.md#experimental-opentui-application-frontend)
keeps Alt+W Arrange, F2 Windows and Alt+0 Main stable as its window strip scrolls
horizontally. Its workspace bar precedes navigation and the window strip; occupied
workspaces carry a literal `*` marker as well as the palette distinction. Nine
fixed-width workspace targets remain available at 38 columns. The strip contains
only open windows on the current workspace, including collapsed tiles; the finder
retains the complete inventory. Empty-workspace guidance points to F2. Arrange
names the selected window and zoom state, with exit, typing
and Windows access readable at narrow widths. Its modal input ownership protects
resident editors and pending questions/approvals. The native finder searches only
titles and public command names; its query is bounded to 512 UTF-16 units. Queries
and private form values stay outside model messages and journals. Route activation
requires a fresh view from the current owner; cancellation or a new selection
invalidates an older opening. Navigation preserves the saved window tree, ratios
and closed-window state. The deterministic preview retains its separate key map.

## Shared plugin contract

Catalog 0.17 adds optional `colors.selectionText`, `UiTextView.hint` and
`UiTextView.input.label`. Existing plugins remain valid. A selected row uses the
foreground/background token pair, including rich cells. Mono uses explicit RGB
values because bold ANSI black may be rendered as bright black by terminals;
using ANSI gray behind it can make the text invisible despite different names.

Semantic action navigation uses unique action IDs across the complete view, not
only visible rows. Focused actions scroll into view. Overflow reports the visible
range and Page Up/Down/fullscreen controls. `ui.render` receives the full semantic
lines plus scroll metadata, so replacement styling does not remove offscreen
keyboard access. Search fields keep their local literal prefix outside that
rendered body. Native forms and composer/approval text render literally.

Plugins can replace views and hints, supply field labels and theme tokens, and
continue to control placement through the existing services. No plugin-specific
layout rules or mandatory Ghost behavior were added to core.

## Verification and limits

`npm run visual:ux` exercises the actual app in an isolated POSIX PTY at 100x30,
80x24 and 60x24, including hidden-pane focus, fullscreen composer, offscreen
provider actions, reverse form navigation, long-command approval and monochrome
selection. Its print-only tool fixture is always denied. The compiled binary
uses the same loopback model contract. Existing history/settings/questions/
workflow/presentation and broad interaction scenarios remain maintained.

The web detector was attempted once against the Ink frontend and returned zero
findings without scannable markup coverage. It is not an accessibility clearance.
No DOM overlay on the xterm diagnostic host is presented as product evidence.
Native GNOME Terminal pointer/font behavior, screen readers and live providers
were not measured. The inspection found real word-wrap, search-prefix and ANSI
selection issues; targeted functional confirmation followed the two main visual
batches rather than continuing cosmetic polishing.
