---
target: Agent Compositor terminal UI, all segments
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/neko/project/agent-compositor/packages/app/src/ui.ts"
target_fingerprint: "sha256:543a40572752e2359a0e062bf8a10aacec405950d06944c998ff57a29c726eff"
target_path: /home/neko/project/agent-compositor/packages/app/src/ui.ts
timestamp: 2026-11-09T13-57-20Z
slug: packages-app-src-ui-ts
closed: true
---
Method: dual-agent (A: /root/design_review; B: /root/evidence_review), plus an independent controls review.

# Agent Compositor TUI critique

Baseline: 3113f84. Mode: Operate. Preserve the i3-like tiled terminal, character art, native keyboard/mouse semantics and replaceable plugin presentation. This is scoped refinement, not a replacement visual world.

## Design health

| Heuristic | Score /4 | Baseline issue |
|---|---:|---|
| System status | 2 | Approval and question waits retain Working/composer hints |
| Real-world match | 3 | Raw diagnostics and layout jargon leak into ordinary use |
| User freedom | 3 | Strong cancellation/drafts, inconsistent field navigation |
| Consistency | 3 | Shared windows; divergent contextual hints |
| Error prevention | 2 | Long permission descriptors can lose their beginning |
| Recognition | 2 | Hidden plugin actions and overflow are poorly signposted |
| Efficiency | 4 | Keyboard, mouse, slash, tiling, persistence and workspaces |
| Minimalism | 3 | Narrow auxiliary panes fragment otherwise useful content |
| Error recovery | 3 | Good validation; incomplete narrow feedback |
| Help | 2 | Global shortcuts do not describe focused plugin panels |
| Total | 27/40 | Concentrated functional and responsive defects |

## Specificity and strengths

The windowed multiagent workspace is authored for this product, not interchangeable dashboard decoration. Restrained colors, compact tool statuses, Markdown, persistent tiling and reversible questionnaires support actual work. These are preserved.

## Priority findings

1. P1 approval clarity: fixed eight-row dock and tail-only wrapping hide action identity/leading arguments. Preserve tool and reviewable descriptor, provide scrolling and explicit scopes, title the interaction and report the waiting state. Source: ui.ts requestApproval/dockHeight/draw. Evidence: dist/ux-review-a/broad/15-ghost-approval.png.
2. P1/P2 responsive panes: parent-only split thresholds can create 8-column Todos panes at 100 columns. Clamp readable child minima and collapse only when necessary without changing saved ratios; preserve keyboard access to hidden panes. Sources: windows.ts, shared visibility. Evidence: dist/ux-review-b/history/history-100x30.png.
3. P2 plugin action discovery: keyboard arrows operate only on visible hit rows and wrapped actions can become duplicate stops. Navigate the complete action set, scroll focused controls into view, show overflow and contextual hints. Sources: ui.ts paint/input, models.ts. Evidence: dist/ux-review-b/settings.
4. P2 input consistency: reverse Tab, actual cursor editing, compact required-field/validation/scroll feedback and safe Escape need standardization. Sources: question.ts, form.ts, plugin-panel.ts. Independent control-source review confirms defects.
5. P2 diagnostics and contrast: disabled proxy labels read as currently proxied, raw JSON competes with primary actions, and mono selected muted text can share its background. Use effective routing summaries, progressive diagnostics and a replaceable selection foreground.

## Segment decisions

| Segment | Decision |
|---|---|
| Windows/workspaces/status | Preserve tiling; readable projection, waiting state and contextual guidance |
| Transcript/Markdown/tool results | Preserve verified structure; shared focus/contrast and readable measure |
| Composer/slash | Preserve multiline and discovery; reflect the actual active interaction |
| History | Retain search/preview/resume; improve initial labels, compactness and field guidance |
| Providers/auth/proxy | Shared form/action improvements; effective routing and optional diagnostics |
| Questions/approvals | Genuine editing, reverse navigation, scoped reviewable permission decisions |
| Placement | Clear configuration labels, reverse navigation, safe exit during asynchronous save |
| Todos/agents/workflows/mascot | Shared pane/action/overflow rules; preserve plugin behavior and graphics |

## Cognitive load, personas and emotional journey

Moderate load: contextual guidance, technical-label translation and competing narrow panes. Power users lose flow when the focused panel displays composer instructions; first-timers cannot distinguish approval waits from execution; keyboard/low-vision users need visible focus, readable selection and discoverable off-screen controls. The high-stakes approval moment is the principal trust valley. Completing reviewed questionnaires and restored sessions is reassuring.

## Detector and evidence

Independent B attempted the shipped detector once against packages/app/src: exit 0, [] findings, no rule/file locations. Ink terminal-cell TypeScript is not scannable web markup; this does not establish accessibility cleanliness. No xterm-host overlay was injected, since its DOM is not the product's control semantics. Fallback is fresh actual PTY cells, keyboard/mouse input and inspected PNGs. Native GNOME pointer/font/screen-reader behavior and live provider reliability remain unmeasured.

A: dist/ux-review-a/{broad,settings,questions,history,presentation,workflows}; 47 fresh captures, six reports ok. B: dist/ux-review-b/assessment-b.md and pty-report.json; 20 fresh captures at 100x30/80x24/60x24. Both assessments used isolated projects, scripted providers and separately owned browsers/servers; cleanup completed.

Questions skipped: the user explicitly requested applying principles and edits to every segment, authorizing implementation and subagents. No new priority approval is required. Fix critical information/focus defects first, then shared consistency and diagnostics.
