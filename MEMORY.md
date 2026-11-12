# Project memory

## Concurrent test-report panel and composite lifecycle — 2026-11-12

Extended the manual test-reports source with /test-report, an inline report path,
explicit Read report, complete counts, clickable/Up-Down failure selection and
scoped configuration. Tab chooses actions, Enter activates, Ctrl+U clears only
the panel path, Esc/explicit Close cancels the owned operation and closes the
panel; Alt+I returns to the composer. No file/model request happens just from
opening. Failed/cancelled reads retain labelled Last loaded results, never a
false fresh success. Settings save path/maxFailures/maxBytes for project/global;
project overrides global, omitted tool limits use effective defaults and explicit
arguments override them. Changed input IDs reset the actual terminal field after
saving; typing a new path resets and visibly selects Read. Invalid config can be
repaired without reading; failed saves preserve previous config and retry input.

Expanded independent certification profiles to hook/command/tool/view/interactive
UI with persistence/mutation. Source PR certification passed package/domain/panel
and composite lifecycle including synthetic update/rollback and all-component
restart/re-enable. Additional domain tests cover error recovery, empty/result
views, saved-scope isolation/migration, actual fresh-process restart and denied/
invalid/cancelled settings writes with recovery. The original thirteen frozen
report-domain observations remain separate. Tool input tests also cover scoped
limits and explicit overrides. All1151tests pass/3optional skips and types pass.
Generators ran; canonical package guide, readiness and bench guide updated.

Actual PTY at dist/test-reports-ui/pty-round2 passes16 observations: explicit
read, keyboard/pointer failure selection, missing-file retained results, saved
limits, concurrent main scripted model, preserved unsent draft, cancelling/closing
only the report operation, narrow resize and fresh-process restart. Relevant
screenshots inspected (failures/settings/concurrent/narrow/restarted). Cancellation
uses a controlled pre-tool dependency and awaits its settlement; it is not a disk
latency measurement or paid-model proof. Initial browser attempt found missing
expected cache revision; used the already installed compatible browser through
environment override. First real PTY attempt reached cancellation/close but the
scenario incorrectly assumed Ctrl+U clears the message composer. Retained draft
was correctly preserved, then appended to the test command. Corrected only that
fixture step to explicitly backspace the verified draft before a new command;
second run passed. Original failure logs/captures retained, not counted green.

Code inspection also found a separate open host concern: titlebar X/Alt+Q uses
WindowManager.close without a plugin close notification; async plugin completion
may reopen a hidden window. Reproduce through PTY and fix host ownership/visibility
before claiming universal close behavior. This panel's explicit Close/Esc paths
are verified; do not substitute them as proof for titlebar close while busy.
Public host0.7.3 still predates ef0c26b canonical custom-tool policy. Do not publish
test-reports ahead of a patched host/prepared source/native gates. Broader fresh
model-authored plugin delivery, model/task matrix, sustained sessions and trust
remain open; this manual panel/composite proof does not close1.0. No paid calls or
budget changes. Previous exacte7869ac CI43135737322 and docs43135737303 passed;
preparation PR7 refreshed to9a30a6b before this UI commit (not reviewed/merged).

## Initial test-report certification and metadata pipeline stop — 2026-11-12

Pushed33fcdb7. Local clean-source release certification passes11cases/38evidence
references; actual Linux0.1.0 archive passes artifact certification2cases/2evidence
references. Independently verified every evidence digest and archive binding:
dist/test-reports-authoring/local-integrity.json, archiveSHA256
21de8b0ed57650d6126115bb58459b01b0db34c3c2dcc6a80f9ce50dcc48c26a.
Documentation43135266186 passed; inspect exact-head CI43135266311 to completion.
Candidate workflow43135294400 was dispatched too early: expected preparation
rejection correctly refused unprepared test-reports. No native matrix/publication
ran. Its Bash-e/tee pipeline hid the metadata failure, so the job continued to
plugin:test with an empty name and failed there. A new behavioral regression
executes the actual metadata command with an invalid tag through the workflow
pipeline and fails on old behavior (exit0); explicit shell:bash supplies GitHub's
pipefail behavior and stops at metadata. Do not bypass the preparation guard or
blindly rerun the failed candidate. Preparation PR7 at0f033b0 includes expected
Callix1.3.4/checkpoint-history1.2.3, initial test-reports0.1.0 and catalog1.0.8;
review its refreshed exact generated content and dispatched CI before merging.

Do not publicly release the new report plugin ahead of a patched host. Public
host0.7.3 predates ef0c26b canonical custom-tool policy; the plugin's alias-denial
proof uses repaired source. Package source/Linux proof is useful, but a new host
release and prepared exact-source four-platform candidate remain release gates.
No new tag/public release created and no paid request after the earlier three.
Continue report UI/composite authoring, wider real development/model matrix and
sustained/trust gates; this is not1.0 completion.

## Structured test-report tool and bounded initial authoring attempt — 2026-11-12

Implemented test-reports0.1.0 as a useful first backend/tool slice: readonly
Vitest/Jest JSON parsing, assertion-derived totals, max2MiB regular UTF-8 input,
maxFailures1..50/default10, JSON byte limit1024..64000/default12000, sanitized
failure text and original-path descriptors with canonical host policy. Bounded
file-handle reads close in finally; nonblocking open rejects FIFOs; cancellation
and missing host path guards fail closed. Runner/setup failures without a failed
assertion never appear as passing summaries. No panel or slash command yet.
New package source/catalog entry, README and initial changelog were added; no
existing plugin/catalog version was hand-bumped. Package certification covers
normal manager lifecycle/restart and thirteen independent domain observations.
Additional tests cover Jest optional diagnostics, invalid UTF-8, missing guards,
post-resolution cancellation, Unicode bytes, invalid arguments and FIFOs.

Before implementation, an independent reference passed all twelve frozen
checks and an empty package failed loading. A scripted ordinary-tools preflight
wrote all three files, ran project_check and passed all twelve checks. Real Sol
initial authoring used the same empty candidate, a task-specific minimal profile
(read/write/project_check; no agent-harness), original saved proxy/provider and
unchanged50USD atomic guard. Three admitted requests only read repository
context; fourth request exceeded the declared22k serialized-body envelope before
admission. No files were written, independent package oracle failed, all
protected tracked files/config/draft survived. Retain this as envelope-curtailed,
not autonomous delivery, a model-quality benchmark or a paid success. The manual
implementation must not be attributed to the model. Frozen oracle was not changed
during that run. Evidence dist/test-reports-authoring/{context,preflight-execution,
live-execution,live-trajectory}.json; reference code never entered the model repo.

Budget now49.871518 committed conservative USD bound,53.973398 recorded bound,
426reported/two old pending; historical cache refinement unchanged4.10188.
Standard estimate3.615988 covers260reported with166unavailable, not an invoice.
No new budget/profile or forgiven reservations. Further paid authoring needs
sufficient authorized headroom; useful local plugin/UI work can continue.
Full local suite:1148pass/3optional skips, types and docs/build pass. Source PR
certification passes lifecycle and thirteen domain checks. The first full-suite
run exposed a stale explicit plugin inventory and collected the deliberately
failing scratch runner fixture; inventory updated and the retained scratch
source renamed outside test discovery, then the full suite passed. Original
fixture run/report and first failed full-suite log are retained. No host UI or
contract changed: new optional behavior belongs in its plugin README and generated
inventory; existing architecture and UI guides need no new controls documented.
Full initial composite-plugin delivery, concurrent report UI, broad model/task
matrix, sustained sessions and broader1.0/trust gates remain open.

## Canonical permission paths for custom file tools — 2026-11-12

Local structured-test-report authoring preflight exposed a host policy gap.
Built-in read/write/edit paths resolved symlinks before permissions; custom tool
paths were only expanded. A custom readonly report reader could therefore reach
a deny-listed physical file through an alias. Three actual-file regressions
failed before repair: path argument, differently named file argument and a
hook-rewritten argument. A fourth red test caught a second issue: the host
ignored the custom tool's mapped descriptor path in favor of args.path.

The host now canonicalizes the actual declared custom descriptor before policy.
Builtin file tools retain their workspace-confined argument resolution. New
WorkspaceAccess.canonical is metadata-only and never adds a workspace grant;
resolve still enforces attached roots. A new test resolves outside metadata but
confirms no changed grants and denied access. Allowed aliases into explicitly
attached projects still work. Custom tools remain responsible for ctx.resolvePath
or scoped storage at execution; native trusted code is not an OS sandbox.
Canonical authoring guidance updated. All1139tests pass/3optional skips, types
and docs/build pass. Red/green logs dist/test-reports-authoring/path-*. No new
paid requests. This change is not in immutable public0.7.3. Continue the real
initial test-report plugin authoring case after this host prerequisite; a broad
model matrix and full composite-plugin/UI gate remain open.

## Published host0.7.3 with native background/replay and startup proofs — 2026-11-12

Immutable v0.7.3 points to79b97ee41c71fdfcc3c3ebbb238a2f2c763b0dbd. Exact-head
Node22/26 CI43127607503 and docs43127607521 passed. Build-only43127709106 and
full tagged43128862671 passed verification, all four native archive/install
smokes and publication without reruns. Independently parsed each platform job's
background/context/startup JSON from both runs and retained log hashes:
dist/v073-public/native-integrity-{43127709106,43128862671}.json.
Every native background probe executes six main/four summary calls, retains the
actual task in both permission reviews/all summary references, preserves the
draft, completes its single owned shell and resumes its original session.
Every startup probe records one hook per process, no EOF model request and
completed startup before the first prompt. Existing context smoke also passes.
The grader remains3ed222c6406e5a54b558f5e4476d9f4400e841286ed3cd4ece5336069e2899c7.
These deterministic installed-binary cases do not establish autonomous/model
quality or close broader1.0 gates. Do not move this now-public tag.

Six public assets are available (four native archives, installer and checksums).
Using the saved proxy, verified the public installer checksum and exact tagged
installer bytes, then switched an isolated prefix from the retained real public
0.7.2 binary to public0.7.3. The previous binary and state sentinel survived.
The actual publicly installed executable passed both maintained compaction and
background/replay probes (three main/one summary/one write, then six main/four
summary/two reviews/two process exits). Reports:
dist/v073-public/{public-install-report,context-smoke,background-smoke}.json.
The isolated prefix/context remains recorded for later upgrade checks; no user
installation was changed. Canonical readiness now reflects the public release.
All1133source tests pass/3optional skips, types/generators/docs/local native smoke
passed before tagging. No paid API request or budget mutation in this goal turn.
Independent CI0.1.1 and host0.7.2 tags remain unchanged. Continue broader real
self-hosted authoring, model-family development, sustained-session and trust
coverage; publication is a checkpoint, not1.0 completion.

## Prepared host0.7.3 for exact native gates — 2026-11-12

Prepared root/app0.7.3 and matching lock metadata; generated host notes include
f393bff task provenance and2892517 plain startup, despite the intervening
independent plugin tag. Generators and docs/build pass with no unrelated drift.
All1133tests pass/3optional skips, types pass, and a fresh local0.7.3 Linux
archive passes the full installer/model/SDK/kernel/Monty/Callix/context smoke,
including both new background/replay and plain-startup witnesses. The latter
records two startup hooks in two processes, zero EOF model requests and one
prompt whose model observes completed startup. Logs dist/background-binary-proof/v073-*.
No v0.7.3 tag yet. Inspect CI/docs and the exact forthcoming four-platform
build-only run, including new smoke reports on every native runner, before
creating an immutable tag. Broader1.0 gates remain open and budget unchanged.

## Packed background-task proof and plain lifecycle startup — 2026-11-12

Exact f393bff Node22/26 CI43124632687, docs43124632659 and build-only native
matrix43124766342 all passed. No host tag/publication was created by that run.
Downloaded its real Linux archive410e1cad45f1a7ee9e6cff27d03084da097b1982a5ceb588ec029b90220d67a1
through the saved proxy, then executed the installed binary outside the repo.
New maintained tools/release/background-smoke.mjs starts an owned shell behind
a completion-file gate, delivers its completion, reads a large controlled file,
forces automatic compaction and resumes the same session for another SDK-owned
follow-up. A public SDK fixture records actual permission context without
replacing core/context/session services. It checks original task/message/summary
references, journal provenance, request previews, one successful shell exit and
an unchanged unrelated draft. All transport is local; bounded20requests,
200krequest bodies,2Mjournal/output and owned-child cleanup. Journal polling
ignores only an unfinished final line, never a corrupt complete record.

Fixture calibration first found an omitted explicit hooks.js entry, then a
wrong startup assumption. Those incomplete attempts remain in dist/background-binary-proof/.
The final comparison uses an explicit handled SDK continuation command after
resume, without adding a new user task. The same frozen graderSHA
3ed222c6406e5a54b558f5e4476d9f4400e841286ed3cd4ece5336069e2899c7
fails public0.7.2 in six relevant ways and passes f393bff: both execute six main
and four auxiliary requests, exit both processes normally and preserve the draft.
Old permission/summary context chooses the notification and loses task/provenance/
previews; the candidate retains the real task through resume. Receipt
 dist/background-binary-proof/integrity.json binds source/run/archive/binary/grader.
This is controlled installed-binary evidence, not autonomous live-model work.

Calibration also exposed a real separate plain-REPL omission: runRepl never
called core.start(), so session.start hooks did not run at all. Two tests failed
before the fix (empty EOF and before first prompt). Commit2892517 now awaits
startup after renderer subscriptions and before input processing. It submits no
model prompt for EOF. Twelve CLI tests pass. Types caught a missing fixture
provider name; corrected and rerun. Complete1133tests pass/3optional skips;
types/docs and the locally compiled Linux full installed-archive smoke pass.

The maintained release smoke now invokes the background scenario and an actual
SDK startup witness: two plain processes run their startup hook exactly once,
EOF needs zero model requests, and the first request of the second process
observes completed startup. Reports background-smoke-PLATFORM.json and
plain-startup-smoke-PLATFORM.json will be required on each native runner; they
were added AFTER f393bff, so its old four-platform run does not establish those
new gates. Actual local full-smoke logs and negative controls are retained under
 dist/background-binary-proof/. The previous local smoke input e2c0d4ce7ea5b5925d740f30e6e1c2c064623ed181500108c471324c56bf240a
was hash-backed up before replacing it with the verified candidate; f393 archive
and extracted binary remain separately retained. Prepare0.7.3, inspect exact
CI/docs plus new native gates before tagging. Broader1.0 gates remain open;
no paid model requests or budget mutations in this turn.

## Published CI0.1.1; task provenance across automatic follow-ups — 2026-11-12

Immutable plugin/ci-review/v0.1.1 points to9a2314edf300324e64dcad2bcb6bd43b4e52e71b.
Candidate43122926444, exact-head Node22/26 CI43122855898, docs43122856018 and
full tagged publication43123691496 all passed without rerunning failed assertions.
Native candidate receipt dist/ci-review-native-9a2314e/integrity.json binds five
certificates,136 evidence references and four archives. Reviewed final macARM
pending/cancelled PNGs: busy status/Cancel/retained results match the actual
state; main agent remains active. Earlier stale captures and early cancellation
acknowledgment were fixed in e35c349/60c0fa7. The separate unsubscribe fixture
race was reproduced deterministically and fixed at9a2314e, retaining its contract.
Never move the now-public tag. Public host remains immutable0.7.2.

Actual public CI0.1.1 bytes passed independent checks of five published
certificates/all136 evidence hashes and all platform sidecars/catalog hashes.
LinuxSHA fc9754db345175e46d2e52337b00ab47bfdd20cf21018972d16ec99eaa84e959.
The normal manager using a verified-byte local mirror passed public0.1.0→0.1.1,
restart, locked-backup rollback and restart; settings/draft/unrelated state and
actual tool/command behavior survived all five phases, with no rollback download.
Two mirror downloads, zero model requests. Report dist/ci-review-public-011/report.json
states the transport limitation explicitly; it is not a claim of public install
verification on all four user platforms. Ten release assets are public.

While publication ran, an actual-core probe found a separate runtime bug:
plugin-owned automatic prompts were recorded as new user requests. Permission
review and compaction therefore selected the background notification over the
original task. Probe dist/background-task-reference/before.json/log reproduces
this with three scripted requests and one permitted controlled read, no live API.
Three new core tests failed before repair (user task, initial delegated task,
compaction); a separate session-preview test also failed before its repair.

Queue ownership now supplies a host-only harness origin to the turn and journal;
replay preserves it, and session request previews skip host feedback. Initial
source:agent tasks remain requests; literal user text resembling automatic
notifications remains a real request. Public prompt hook fields are unchanged;
provenance is private journal metadata. Current core testSHA
b7ae53c07906e72441fa732f5e0f482b30fad94ec118b22bceed234318f99c91.
An isolated checkout passed99targeted checks, types and docs but full testing
exposed three native-tool identity failures in web-workspaces. Restoring both
core source files to unchanged9a reproduced exactly those same three failures
in that checkout, retained as worktree-baseline-workspaces.log. Do not hide or
call that full run green. Integrated into the normal checkout only after public
release verification: all1131tests pass/3optional skips, and types pass, including
all original workspace boundaries. Canonical context/readiness docs updated.
This host source fix is not part of immutable0.7.2 or CI-plugin0.1.1; exact-head
remote CI/native host certification and broad1.0 gates remain open. No paid
requests or budget changes in this goal turn.

## Certified native candidate; controlled unsubscribe timing — 2026-11-12

Candidate43122058056 at60c0fa7 passed source and all four native plugin gates.
Independently audited five certificates,136 hashed evidence references, four
archives/sidecars/embedded identities, five transition phases per platform,
exact rollback digests, no extra rollback downloads and zero model requests.
Receipt dist/ci-review-native-60c0fa7/integrity.json. Inspected Linuxx64 and
macARM pending/cancelled PNGs: busy status/Cancel/old results are painted during
work and absent after cancellation; the main agent remains held. Companion
text snapshots match the expected states. No CI0.1.1 tag exists yet.

Exact-head Node26 CI/docs passed, but Node22 CI43122043744 exposed an unrelated
timing assumption in background-jobs.test.ts: sleep0.1 could finish before
subscribe/unsubscribe, legitimately dispatching a follow-up before unsubscribe.
The documented contract explicitly does not undo dispatched work. Preserved
failure log under dist/ci-progress-cancel-settlement/ci-node22-failure.log.
A deterministic negative control completed that child before subscribe and
reproduced the same expected1/got4 request failure locally (the extra wake plus
bounded empty-response recovery after the scripted provider's only answer).

The test now gates child completion on a file written only after acknowledged
pending subscription and acknowledged unsubscribe, then waits for the actual
post-hook shell.completed catalog event. It checks done/unsubscribed state and
still requires exactly one model request. No longer relies on a short sleep or
changes production delivery behavior. Canonical background-jobs README already
states these semantics, so this internal test correction has no public docs
impact. Local evidence/negative control: dist/background-unsubscribe-order/.
Recertify the resulting exact source and inspect Node22/26 CI before tagging.
No paid requests; broader1.0 development/model/trust gates remain open.

## Native candidate audited; screenshot paint synchronization — 2026-11-12

Merged generated metadata PR6 at4e967ff after independently reproducing its nine
files and exact-head CI/docs checks. CI-review0.1.1, MCP1.3.1 and plugin-author1.3.1
are prepared; plugin:prepare reports no pending metadata. Candidate43119892974
completed successfully on source and all four native platforms. Independently
validated five content-bound certificates,136 evidence references, four archive
hashes/sidecars/embedded identities and platform-specific published0.1.0
upgrade/rollback bindings. Receipt dist/ci-review-native-4e967ff/integrity.json.
Each native transition passed five phases, preserving config/draft and restoring
the exact old digest without a rollback download. No CI0.1.1 tag/publication yet.

Visual inspection caught a stale macARM pending screenshot despite passing
terminal-cell assertions: xterm parsing can precede browser paint. A fresh local
unmodified scenario showed the busy row, so this is capture synchronization,
not evidence that the plugin omitted it. Screenshot helper now requests a native
xterm render, waits for that event and two browser animation frames, saves
companion text and checks pending/cancelled states on both sides of capture.
The actual PTY CI scenario passes16checks; running/cancelled PNGs independently
inspected. The full four-platform candidate must be recertified at the resulting
commit before tagging; do not treat the older4e screenshots as pending UI proof.
No plugin runtime/version change or new paid model call in this correction.
OpenAI budget and broader1.0 gates remain unchanged/open. Saved proxy was already
enabled for model/tools; verified OpenAI unauthenticated401, GitHub200 and gh
through explicit child proxy environment, with no secrets printed/paid calls.

The refreshed candidate43121490546 exposed a second acknowledgment race on
Linuxx64: the conversation tool-error appeared before the panel's finally view,
so the immediate busy-removal assertion ran too soon. Failed job130863290036
logs and diagnostics are retained under dist/ci-progress-paint-{after,linux-failure}.
The failure screenshot shows the pending panel alongside the earlier conversation
error. Kept the assertion/process/main-agent checks and now await both the error
and absent panel busy state; no timeout increase or blind rerun. Local actual
PTY verification repeated in dist/ci-progress-cancel-settlement. Recertify the
resulting exact commit; neither4e nor e35 artifacts authorize publication yet.

## Real previous-release transitions are mandatory per native archive — 2026-11-12

d998964 pushed the Compositor-authored busy row and its frozen progress tests.
Automatic PR6 initially prepared CI-review0.1.1/catalog1.0.7 at1c21a486. Do not
merge that old head: preparing the first update of a published plugin exposed
missing executable previous-release bindings. Added CI transition scenarios for
source release and native artifacts, each using actual published0.1.0 bytes and
the exact candidate. The normal marketplace installs the old archive inactive,
enables it, discovers the update without changing active code, updates, restarts,
rolls back from a locked backup without downloading, then restarts again.
Every phase verifies selected managed path/version/commit, actual CI tool and
command, --repo/--limit/timeout settings, unchanged scoped config/user draft and
unrelated state. No model or real GitHub CLI request. Native candidate update
uses the manager's archive branch; source mode uses the candidate directory.

Initial source preflight caught a fixture defect: the shared package probe
overwrote the custom settings with its minimal repository config. Kept the
preservation assertions and replaced that setup-mutating probe with one that
checks configuration before/after and observes actual gh argv/limits. Source
transition from the public archive to unmodified PR6candidate1c21a486 then passed
all five phases. Independently built its actual Linux archive (d3913663a23e4690eb73eda3e59c409edf5cceb09af03c03c85afa0667c03664),
and the same transition passed through archive install/update: two managed mirror
downloads, none for rollback, exact previous digest restored, no model requests.
The scenario CLI protocol preflight additionally validated run/context binding,
result schema, previous version/SHA and every evidence hash. These are preflights
against1c21a486, not certification of the forthcoming refreshed source/platform
matrix. Reports dist/selfhost-ci-progress/transition-{source-preflight,artifact-preflight}.json
and transition-protocol/. Never publish these preflight artifacts as certified.

The gap also affected the common gate: previous-release upgrade/rollback was
required only at source release stage and could be omitted from native artifacts.
A new regression failed before the repair (artifact assessment returned no
problems despite missing transitions). Native artifacts now require separate
artifact-kind release.upgrade/release.rollback bindings. Previous version and
platform-specific checksum must match, including on macOS; missing/wrong-version/
wrong-hash and reused Linux evidence are rejected. First-release null plans and
their existing immutable certificates remain unaffected. CI plan binds the new
scenario at both stages; docs explain the contract. All existing checks retained.

Previous-byte transport requires credential-free HTTPS, at most5requests,
60seconds,128MiB and exactSHA; HTTP/oversized bodies are cancelled, raw transport
exception details are not logged. Eight boundary tests and the new gate regression
pass. Full1127tests pass/3optional skips; types, generators, docs/build pass. A
fixture-only optional assertion-message type error was corrected and typecheck/
focused21tests rerun. Release/artifact binding audits both report no missing
requirements. Next push this committed gate/scenario change, allow PR6 to refresh,
review its generated versions/checks and certify the exact new source plus four
native archives before publishing CI0.1.1. Broader1.0 gates remain open.

## Compositor-authored CI busy feedback — 2026-11-12

At026e605, the CI panel exposed old results and Cancel while a request ran but
had no explicit busy label in the panel. Prepared a tiny known UI edit with a
host-provided real read snapshot, scoped edit-only model capability and frozen
three-case success/failure/cancel oracle. All three fail before the change.
A separate validation clone passed with a known reference patch; the actual
model target stayed byte-identical to root until live execution. Scripted
preflight exercised real guarded edit and measured Responses envelopes8489/9247
bytes without API requests. Predeclared maximum2requests,11000serialized bytes
each,+4096token overhead,1024output tokens =>0.17144USD maximum admission,
fitting the then0.177061remaining conservative allowance. The parent tightened
EvalBudget.reserve before its original atomic guard, never bypassed it.

Live saved-profile Sol through buildApp/core completed in6870ms: two requests,
one edit, all expectedHash/range/strict fields retained. The exact authored
one-line status was integrated without rewriting it. Three unchanged oracle
cases passed independently; all735protected files/oracle/user draft survived.
Agent truthfully stated it did not run tests: this was an editing-only turn,
not autonomous investigation or initial plugin delivery. Evidence:
dist/selfhost-ci-progress/{execution,integrity}.json and frozen oracleSHA
9d7505ec7f27210d351fa2d85de384e1049bf5add45e4653955f73c825254e0e.

The active panel now shows an accent 'CI operation in progress' row and retains
previous results; the row vanishes on success/failure/cancel. Existing disable
semantics and Cancel/Close behavior are unchanged. Actual PTY scenario passes
all16checks including process cleanup, held main agent, settings, narrow idle
draft and restart; inspected running/cancelled/narrow screenshots. Included
oracle in the plugin's maintained tests and extended visible-progress assertions.
Full1118pass/3optional skips, types, generators, docs/build pass. The public
0.1.0 archive is unchanged. Plan now pins its four public archives as the previous
release for actual update/rollback certification of the next generated version.
Do not hand-bump manifest/catalog/changelog; normal metadata PR follows push.

Budget after this run: effective49.836283/50,raw53.938163,423reported/two old pending.
Historical cache review remains unchanged. Standard-price estimate3.598554 covers
257requests;166 still lack cache metadata. This is not an invoice. No reservations
were cleared and no provider/proxy credential entered the model workspace/logs.

## Published 0.7.2 and native context regression — 2026-11-12

Immutable v0.7.2 at888bf8c is public. Tagged43110063150 needed two addressed
macIntel reruns for infrastructure DNS failures: attempt1 passed build/smoke but
artifact upload failed ENOTFOUND; attempt2 failed Callix download ENOTFOUND
github.com before compilation; attempt3 passed build/smoke/upload and publication.
Failed logs retained under dist/v072-public/failed-{upload-attempt1,download-attempt2}.log.
Other successful jobs were carried forward with their original timestamps;
new normalized job IDs after a rerun do not mean every job was re-executed.
No failed functional assertions were hidden or weakened. Never move this tag.

Public six-asset release/installer checksum and isolated0.7.1→0.7.2 upgrade pass
through the saved proxy; previous binary and state sentinel survived. The
context smoke also passes on the actual publicly installed executable: original
task/reference retained, one write, preserved draft, no paid model. Reports:
dist/v072-public/{public-install-report,context-smoke}.json. Installation retained
at/tmp/compositor-v072-public-rb4kHq for future isolated upgrade verification.

Maintained installed-binary context scenario at026e605 passed all four native
jobs in43110702555. Independently parsed each job's emitted report and verified
three main/one summary, one write, retained task reference and actual file/draft
checks. Receipt dist/packed-context-native-integrity.json. This is deterministic
local transport evidence, not a live-model matrix or broad1.0 completion.

## Exact 0.7.2 native candidate and installed-binary context proof — 2026-11-12

888bf8c passed exact Node22/26 CI43108749292, docs43108749491 and host build-only
43108759727: verification plus native build/install smoke on Linuxx64/ARM64 and
macIntel/ARM64. Independently downloaded old14655ca and new888bf8c Linux archives
and drove their actual binaries outside the source tree with a local HTTP fixture.
The frozen900-repetition case writes once, emits a draft within8192 output tokens,
triggers completion feedback and automatic compaction under16384 context, then
reports. Old archive loses the actual user role message and passes harness
feedback as the summary task reference; new archive preserves both correctly.
Both write exactly once, preserve the user draft and produce correct file bytes.
Three main requests plus one summary each,0paid. Initial800-repetition calibration
did not force pressure and is retained separately; do not count it as a valid
failure/success comparison. Frozen probeSHA79301edb060d7a02d8b3b29093d2baea9dcd24e7fea4333b4fd40debcc5f02ee.
Receipt dist/packed-context-integrity.json binds both immutable source/run/archive
hashes. This is deterministic binary evidence, not live-model development quality.

Created/pushed annotated v0.7.2 at888bf8ce7ebb3e075290a3e257c21cbf986c1c4d after
clean-checkout, remote/local tag absence, release absence and all candidate gate
checks. Tagged release43110063150 is running; inspect that exact handle and
release state before claiming publication. No existing tag was moved. Prepared
dist/v072-public/verify-public.ts for after publication: requires completed tagged
run ID and verifies public assets/installer checksum plus isolated0.7.1→0.7.2
upgrade/state preservation via saved tool proxy. Do not run before publication.

Added maintained tools/release/context-smoke.mjs and invoked it from the regular
installed-binary smoke. It uses isolated home/environment/project, bounded local
requests, actual write/files and original task/summary references, and cleans up.
Independent helper execution rejects old and accepts new binaries. Full Linux
release:smoke with the downloaded888bf8c archive passes, including all existing
workflow/SDK/MCP/kernel/Callix/Monty/install checks; types and docs/build pass.
Retained reports dist/packed-context-maintained-{before,after}.json and
dist/release/context-smoke-linux-x64.json; full log dist/packed-context-full-smoke.log.
Previous local archive was hash-backed up before replacing the ignored smoke
input. The new maintained scenario still needs native runs on the other platforms;
it is not retroactively part of the immutable0.7.2 tagged pipeline.

## Refreshed host 0.7.2 source verification — 2026-11-12

Merged dependency metadata plus the permission-context regression and published
CI-plugin evidence. Refreshed git-cliff0.7.2 notes include the origin repair.
Full1115pass/3optional skips, docs/build, marketplace31entries and generators
pass. Typecheck caught a fixture-only ToolResult shape error (missing data);
corrected the new test to the declared result shape, reran all three affected
core cases and typecheck successfully. The unpublished local test commit was
amended before push and notes regenerated to the actual SHA2b25f78.
No product semantics or earlier acceptance checks were weakened. Next certify
this refreshed host source on all four platforms; the older successful14655ca
build omits the origin repair. Keep the goal active; no host0.7.2 publication yet.

## Published CI review and merged context dependency metadata — 2026-11-12

CI tagged run43107581688 succeeded source/four native packages/publication.
Release plugin/ci-review/v0.1.0 is public, draft=false, published2026-11-11T22:01:45Z,
bound to14655ca. Ten public assets include four archives/sidecars, certification
tar and marketplace entry. Never move this now-published tag. Public Linuxx64
installation through saved NetworkClient proxy verified entry/sidecar checksum,
normal archive installation, inactive discovery, explicit extension_control
activation/reload, /ci with zero model requests, disable/reload. Report:
dist/ci-review-public-install/report.json. Its first diagnostic script assumed
an incorrect artifacts field; inspected published source.assets and corrected
the script before the actual successful installation, not product/schema code.
Temporary installation/home cleaned and network closed; no real GitHub CLI calls.

PR5 exact8f934d2 dispatched CI43107613013 bothNode22/26 passed; docs43107617001
passed. Independent generation matched all five changed file bytes. Merged via
connector with expected head, result8d578d7efc2ff68deee1f4f7dbde67ebc254c918,
then fast-forwarded local main. Callix1.3.3/catalog1.0.6 are generated metadata.
The added permission-context regression is tested separately; prior full suite
1114pass/3skip predates this one extra test. Prepare refreshed0.7.2 notes and
exact native candidate including5cd6204 before publishing any host tag.

## CI plugin publication retry and metadata review — 2026-11-12

5cd6204 is pushed. Additional actual-core permission-review regression confirms
the original task is supplied after finish feedback without compaction; it passes
alongside both automatic-compaction cases. No further public behavior changes.

Verified gh release view returned exactly 'release not found' before moving the
failed unpublished plugin/ci-review/v0.1.0 tag fromfbd69d6 to the fully certified
14655ca. Compared remote peeled revision and used force-with-lease against its
exact old annotated-tag object6671a65; replacement objecte436f79. No published
tag or existing release was moved. Tagged run43107581688 independently passed
source and Linuxx64/ARM64/macARM archives on last poll; macIntel still npmci.
Inspect this same run and release state; publication is not yet established.

Earlier host build-only43106643838 at14655ca finished all four native smoke jobs
successfully, publication intentionally skipped. It lacks the new origin fix and
must not be used to claim that fix is released. Host0.7.2 tag still absent.

Generated PR5 head8f934d2 (base5cd6204) prepares only Callix1.3.3/catalog1.0.6,
matching bundled context inputs. All five changed file bytes were independently
regenerated in isolated worktree/tmp/compositor-metadata-pr5-NDEeSA with workspace
dependency links retargeted there. Receipt:
dist/plugin-metadata-pr5/generated-tree-integrity.json. Initial root node_modules
symlink was correctly rejected as untracked by clean-checkout preparation;
replaced it with an actual ignored directory and dependency links before success.
PR docs dispatched43107617001 passed; CI43107613013 Node22passed,Node26still
certifying all plugins on last poll. PR-triggered duplicates action_required;
use the explicit exact-head dispatch results. Do not merge until checks complete.

## Harness feedback must not replace the user's task — 2026-11-12

Two new actual-core regressions reproduced task-reference replacement after
completion feedback and after three failed tool calls. Both automatically
compact under8192-token pressure. Host continuations used role=user and were
therefore mistaken for the user's latest task by compaction/permission context.
Messages now carry optional origin=harness, set only at the two host insertion
sites. Task lookup and compaction skip that origin without inspecting text;
real steering, including literal 'Harness verification:' text, remains a task.
Compaction snapshots/replay retain the marker. Correct pinning also exposed the
old minimum-two-message folding rule: one oversized assistant draft between a
pinned task and feedback could not compact. One-message folding now proceeds,
still requiring actual token reduction and preserving history on failure.

Both core regressions plus steering/prefix regression pass; full1114 tests,
3optional skips, types, generators and docs check/build pass. No paid model
requests. This is deterministic evidence, not a new live-model quality score.
Include this repair before publishing host0.7.2;14655ca is an earlier candidate.

CI-review candidate43106650734 at14655ca passed full source plus all four native
installed archives. Independent audit verified5certificates/131evidence files,
four archive sidecars/embedded identities and source/workspace/plan identity.
Receipt dist/ci-review-native-14655ca/integrity.json; inspected macARM concurrent
settings and macIntel cancellation screenshots. Candidate publication skipped.
The old unpublished failed plugin tag is still atfbd69d6 at this checkpoint.
Node22/26 CI43106630382 was cancelled by the later documentation-only main push,
not a failed test result. Host candidate43106643838 still verifying all plugin
contracts on last poll; inspect that handle rather than restarting it blindly.

## Prepared 0.7.2 candidates — 2026-11-12

Main14655ca2cb528b6a5325716ff27ba5708601453f prepares host0.7.2: root/app/lock
versions, generated CLI reference and git-cliff notes. No plugin metadata churn;
clean plugin:prepare returns no files/plugins. Full1111 tests/3optional skips,
types, generators and docs check/build passed after preparation. Pushed main.
Host build-only candidate43106643838 and CI-review candidate43106650734 target
that exact revision; neither dispatch publishes. Latest observed plugin source
verify130811620062 passed, including repaired terminal-flow, and all four native
jobs started. Documentation43106630378 passed check/deploy. Node22/26 CI
43106630382 and host verification were still running at this checkpoint.
Do not infer their completion; inspect the same run IDs before further action.
No v0.7.2 tag exists yet. Failed unpublished CI tag still points atfbd69d6.
Current readiness now records the budget-curtailed fresh run and candidate/tag
distinction; documentation recheck also passes. Broader1.0 gates remain open.

## CI refresh synchronization and host release boundaries — 2026-11-12

PR4 was reviewed and merged normally at fbd69d6. The exact-source candidate
workflow43102853382 passed source certification and all four native installed
archives. Independently verified five certificates,131 evidence files, archive
sidecars/embedded identities and immutable source/package/workspace/plan hashes:
dist/ci-review-native-fbd/integrity.json. This was a candidate, not publication.
The subsequent plugin/ci-review/v0.1.0 tagged run43104978351 failed terminal-flow
before native jobs/publication. No release was created. Preserve that failure;
the existing tag still points at fbd69d6, not the fixes below.

Failed PTY report/input/failure.png showed that the cancellation scenario clicked
Refresh twice62ms apart. Its wait accepted an old result and absence of Cancel
before the first refresh's busy render arrived. A subprocess-start record is not
a rendered-result acknowledgement. b87356a gives fixture responses a request
sequence marker and waits for the fifth response before starting a slow request.
Actual PTY scenario passes all15 checks, including concurrent settings, real
Cancel/Close process cleanup, narrow draft and restart persistence; inspected
running/cancelled/restarted screenshots. Full release-stage source certification
also passes at8757290. Receipts: dist/ci-review-refresh-sync and
dist/ci-review-refresh-sync-source. This does not replace native certification
of a future candidate or retroactively pass the failed tag.

8757290 anchors git-cliff's host tag regex. An actual pinned git-cliff regression
with separated annotated host/plugin tags reproduced missing pending host notes
before the fix and passes afterward. Independent plugin tags no longer delimit
host releases. Real changelog preview includes changes after published0.7.1.
Full1111 tests pass,3optional skips; typecheck and docs check/build pass.

The unchanged local Qwen cases atc31c430 scored4/6 over19 requests, all protected
fixtures preserved, zero paid requests. Both precise edits still failed through
redundant writes dropping a newline; this replay did not trigger the missing-hash
diagnostic and does not establish that diagnostic improves model recovery.
Receipt: dist/local-qwen-eval-guarded-diagnostic/integrity.json.

Fresh known CI authoring atfbd69d6 removed the candidate implementation entirely
and retained frozen10+7 oracles. Reference-only validation clone passed17/17 and
types before inference. The actual unseeded run stopped before next request
admission at the budget bound: six main steps,three compactions,13 reported
requests,zero writes. All726 protected files and oracle bytes survived. This is
budget-curtailed authoring, not successful initial plugin delivery. Evidence:
dist/selfhost-ci-fresh/{execution,preservation}.json. Effective conservative bound
49.822939 of50,421reported/two old pending; raw recorded53.924819. Standard-price
estimate3.590765 covers255 requests,166 lack cache metadata; it is not an invoice.
Do not reset reservations or spend beyond admission. Current billing requested
from the user; no answer yet. Continue free/local/native work meanwhile.

Rechecked saved proxy after the user's request: enabled for models/tools, global
private config0600, CLI CONNECT200/GitHub200; shared client reaches unauthenticated
OpenAI models401 and GitHub200. No paid model calls or credentials logged.

## Missing snapshot hash now has an actionable edit diagnostic — 2026-11-12

The failed Qwen edit at ca84b9e supplied valid range offsets but omitted
expectedHash. The resolver grouped this with invalid offsets; the model then
reread and repeated the same omission. Two new real read→edit regressions fail
before the repair: guarded replacement reports 'invalid guarded range', and
insertion wrongly points only to oldText. The resolver now rejects a missing
hash before that ambiguity and asks for the complete fresh read/read_symbol
anchor. It never invents a hash, discards a range, or relaxes stale/offset checks.
Both cases verify no write/undo entry before rejection, then succeed with the
actual read anchor and preserve all other bytes. Existing stale/concurrent/
out-of-range/symlink/undo checks remain unchanged. Tool parameter descriptions
now name ordinary read anchors as well as read_symbol and state the hash/range
dependency. Canonical agent-features documents this recovery.

All9 navigation-edit tests pass; full1110 pass with3optional skips, typecheck,
event/reference generators and docs check/build pass. Generators have no drift.
No paid requests were made; reviewed budget remains49.434704,408reported/two
pending. Next run the unchanged local stock-harness cases at the committed
revision to inspect actual recovery rather than assume better model quality.

PR4 refreshed to f44f6b4 on0e47abe. Reviewed diff confirms that the old275523f
packaging/index note is gone from new CI-review's changelog; only its457b7e7
introduction remains. The PR also prepares Callix1.3.2/catalog1.0.5 as expected.
It is not merged yet: the incoming tools-source change needs normal preparation
and exact source checks before immutable candidate certification.

## Silent-response live replay and first-release history review — 2026-11-12

Committed/pushed ca84b9e integrates the Compositor-authored empty-response fix.
Live stock-harness replay at that exact revision reused byte-identical cases
and grader (f4d5db88…) from0b48eca. Strict score3/6 versus2/6,16requests versus10,
zero empty successful turns versus two. All protected fixtures survived. One
arithmetic edit passed exactly. The other did NOT fail on the step limit: it
reported two failed guarded-range edits (range valid, expectedHash missing).
An earlier chat update inferred a step-limit failure from six requests; that
was corrected after inspecting actual events. Safe preemptive policy refusals
still fail the rubric's actual-tool-denial condition. Do not call this full
editing quality or a universal win. Receipt:
dist/selfhost-empty-finish/live-replay-integrity.json. All owned local evaluation
servers exited; the user's Ollama service/configuration was unchanged.

PR4 refreshed to40b30ae based onca84b9e, but its generated CI-review changelog
incorrectly included275523f ('warm indexes eagerly…'), an older distribution
change made before this plugin existed. Review caught this before merge; no
hand-edited release versions or changelog summaries. Two regressions failed on
the existing planner: older packaging history incorrectly supplied a major
intent/note for a new plugin, and pre-introduction bundled helper history leaked
into its notes. New-package preparation now starts at the manifest introduction's
parent (--no-renames records renamed introductions too), while existing packages
retain their prepared baseline. Later bundled changes remain included. Both
regressions and all14 planner checks pass. Full1108 tests pass,3optional skips;
typecheck and docs check/build pass. Plugin-standard documents this rule.
Next verify the real clean-checkout plan, refresh/review PR4 and certify native
archives. No additional paid requests since reviewed49.434704/408reported/two
pending. The missing-hash edit diagnostic is a concrete next cooperation gap:
current 'invalid guarded range' makes the small model misdiagnose offsets instead
of copying the expectedHash supplied by read. Preserve snapshot/range guards;
do not solve this by silently dropping or inventing anchors.

## Local Qwen diagnostics and Compositor-authored empty-response repair — 2026-11-12

0b48eca passed exact local source release and installed Linux x64 archive
certification with 74 verified evidence references, matching source/workspace/
plan identity and archive sidecar/embedded metadata. Archive SHA256:
483c93b69a6689c97e7bbbe2d0913179c6e98e74681ca45554ff101e61340d6a.
Receipt: dist/ci-review-live/local-certification-0b48eca-integrity.json. New
concurrent-settings and cancellation archive screenshots were inspected.
The prior457b7e7 certificates were copied to dist/ci-review-457b7e7-certification
before reports were replaced; their archive was later rebuilt for0b48eca.

Prepared an isolated local Ollama server and Qwen3 1.7B Q4_K_M cache under ignored
dist/local-qwen-eval/models, separate from the user's11434 service/cloud stubs.
NVML reports a driver/library mismatch; no driver/service configuration changed.
Runtime /api/ps confirms CPU (sizeVram0), context8192, roughly2.43GB loaded size.
The public model tensor is1359279776bytes; all five OCI layers were verified by
size/SHA256 before use and independently rehashed at evaluator startup. Ordinary
Ollama pulls failed with EOF. A bounded four-worker Range downloader reused the
219679665-byte verified-download prefix and verified the assembled full hash.
Private proxy values stayed parent/server-environment-only and were not logged.

The first download supervisor was intentionally stopped before inference after
review found that injected provider requests would retain the host's default
cloud model name. Explicit local AGENT_MODEL and a pre-transport model guard now
refuse that route. Both owned PIDs3154161/3154186 were confirmed gone; no model
request occurred. Two subsequent ordinary pulls terminated with EOF and cleaned
up their owned server. Direct proxy manifest/Range probes passed. These setup
failures are not model task failures. Signed URLs/credentials were not printed.

All three diagnostic configurations use byte-identical frozen cases and grader
source SHA256 f4d5db8847a07400658d8c21c707fe662312582a871cf8d3fe43eec9b776c446.
Real-app scripted preflight proves absent behavior fails and known correct
behavior passes before inference. Three tasks, two repeats each: exact evidence
read, arithmetic-only edit preserving other bytes, and actual policy-denied
write without bypass. Local-only route, output768/request, six requests/case,
8192 estimated context guard, two CPU threads, seed17 and no paid API requests.
Default thinking scored4/6 with10requests; none scored2/6 with12requests; none
plus stock agent-harness scored2/6 with10requests. All protected fixtures survived.
Preemptive refusal in none mode is safe but fails the stricter actual-tool-denial
criterion; do not describe it as a permission bypass. Edits hit the default
output cap or were unfinished; one none attempt edited correctly then rewrote
the file without its trailing newline. Empty final turns were falsely quiet
successes. None mode is faster in these runs but is not a universal quality win.
Evidence: dist/local-qwen-eval{,-none,-coding-harness}/ and
all-comparison-integrity.json. This is a small development diagnostic matrix,
not full model independence or an unseen model-quality benchmark.

Used real Compositor/Sol to repair the empty final-response policy from a fresh
source0b48eca checkout. Five frozen acceptance cases: whitespace recovery,
post-read empty recovery without repeating the read, bounded failure without
turn.complete, disabled verification and replacement policy. Baseline3fail/2pass,
strict baseline types pass; a separate validation clone passes5/5 before live
execution. Only packages/app/src/harness.ts writable. The live run completed in
six steps/requests,27.374s, no compactions; checks and final response delivered.
Independent5/5 + typecheck pass, all732 protected files and oracle bytes intact.
Evidence: dist/selfhost-empty-finish/{execution,context,preservation}.json and
trajectory.jsonl. This is a completed known-task bug fix, not fresh plugin delivery.

Integrated the authored two-line finish guard and unchanged oracle. The default
agent-harness uses existing shared two completion continuations, step/token and
permission limits; it does not auto-repeat tools. Explicit verifyCompletion:false
and replacement completion services keep their behavior. Updated three unrelated
scripted fixtures to give actual final text rather than accidentally empty
stops; their routing/origin assertions and request-count expectations remain.
1106 tests pass, three optional skips; typecheck and docs check/build pass.
Canonical agent-features documents the behavior. No generator contract changed.
The stale docs/evals claim that remote CI had never run was replaced with an
explicit reference to source-bound readiness evidence.

Budget now reviewed49.434704/raw53.536584,408reported/two pending, originalUSD50
unchanged; no pending reservation released. Local model runs cost no API calls.
Current remote0b48eca CI43096012116/docs43096012200/preparation43096012092 remain
queued with no jobs. Six attempts to cancel older superseded runs were rejected
with 'Cannot cancel a workflow run that is completed', while GET still reports
queued; do not claim those runs were cancelled or terminal. A cache-bypassed
read through the saved proxy confirms latest preparation still queued. PR4 still
has oldb27eef8 head and must be refreshed before review/native candidate dispatch.
Next: live stock-harness replay of the silent-response repair, exact committed
checks, refreshed metadata review and four-platform native certification. All
broad1.0/model/self-development/long-running gates remain open.

## CI package checkpoint and concurrent configuration proof — 2026-11-12

Source integration 457b7e7 was pushed, followed by 8e0050b adding the missing
native development catalog entry without hand-bumping catalog/plugin versions.
The automatic preparation must refresh PR4 before review; its old b27eef8 head
predates CI review and must not be merged as the current release batch.

Exact committed 457b7e7 passed local full release and installed Linux x64 archive
certification. The archive hash is 41a85708db9e40319d014a93a8c82068530a99086bfc046c29df08234e70a79a.
An independent audit checked both certificates, all 70 evidence references,
archive checksum sidecar and embedded source/workspace/plan identities. Evidence:
dist/ci-review-live/local-certification-integrity.json and
reports/certification/ci-review/{release,artifact}/linux-x64/. Installed archive
cancellation and narrow screenshots were inspected. These receipts certify that
exact revision, not the subsequent catalog or visual-scenario changes.

Extended the maintained PTY scenario to edit/save maxRuns from four to three
while the main scripted agent remains held. Saving makes no gh request; the next
explicit refresh uses --limit 3, the main agent remains Working, Cancel/Close
still reap their PIDs, and restart restores the new project setting. Evidence:
dist/ci-review-concurrent-settings-synchronized/report.json; editing/saved/restart
screenshots inspected. The first diagnostic attempt sent Tab/Ctrl+A/type before
observing focus/value changes; explicit terminal field and exact-value waits
corrected scenario synchronization without application changes or longer waits.

Latest remote source checks/preparation are queued with no jobs yet assigned:
8e0050b CI43095461615, docs43095461626, preparation43095461610. Earlier457b7e7
runs43095333195/43095333260/43095333165 are also queued. Do not restart merely
because runners are not assigned. Native candidate certification follows review
of the refreshed metadata batch. No extra paid model requests were made.

## Guided CI completion and independent integration review — 2026-11-12

The saved V2 candidate was completed through patched Compositor in an isolated
workspace with only README, changelog and draft test metadata writable. Seven
Sol requests/steps completed in about 52 seconds; the frozen ten-case oracle and
strict typecheck passed, all 725 protected files remained unchanged, and the
final response was delivered. Candidate commit e149c2b exists only in its temp
checkout. Evidence: dist/selfhost-ci-review-finish-20261112/. This is guided
completion of existing model-authored code, not autonomous initial delivery.
Reviewed budget is USD49.400852, raw recorded bound USD53.502732, 402 reported
requests/two pending; the original USD50 limit and reservations are unchanged.
No further paid requests were made during integration review.

Integrated ci-review tools/settings/panel and added independent regressions:
reject mismatched run IDs and repository strings above 256 characters; retain
whole selectable records in bounded list JSON; keep normal network operations
alive beyond the default UI hook budget; clear stale actions and discard old
responses after repository changes; display readable job statuses. Tool help
now supplies plugin-owned schema-shaped usage examples. UI hook timeout is the
host five-minute user-operation budget; execution remains bounded to 100–30000ms.

The new lifecycle test covers inactive install, enable, repeated reload, restart,
synthetic update/rollback, disable/re-enable/remove and preserved settings. The
certification behavior suite includes fixed argv, policy denial, controlled
CLI network errors, actual subprocess timeout/cancel/unload cleanup, scoped
storage/migration/isolation and form write failure/recovery. PR certification
passed, including package/composite lifecycle. No native archive certificate
or independent release is claimed yet; the plan declares all four targets.

Real Ink PTY scenario dist/ci-review-ui-final/report.json passes keyboard/mouse
configuration/save/cancel, run/job/failed/full logs, held main-agent concurrency,
Cancel/Close PID cleanup, narrow draft and saved settings after restart. Its gh
executable is isolated fixture data, not user authentication. Runs/jobs/cancel/
narrow/restart screenshots were inspected. The first diagnostic capture failed
because the scenario searched for nonexistent bracketed button labels and
reused stale list text; corrected terminal synchronization passed. Separately,
dist/ci-review-live/report.json proves actual gh list+summary requests to the
project through the saved proxy: workflow documentation, run43090986974, two
jobs, zero model requests and no mutations. Temporary private proxy copies were
0600 and removed with the isolated project. OpenAI model/tool proxy reachability
was also rechecked without API credentials (both returned expected HTTP401).

All 1101 maintained tests passed with three optional skips, typecheck and
marketplace validation passed; docs check/build passed for 102 canonical pages.
Final source/docs verification and immutable native artifact certification remain
next. Existing v0.7.1 does not include these changes or the compaction repair.
Broader model-family, initial self-development and multi-hour/trust gates remain
open. Do not treat this plugin as completion of the 1.0 objective.

## Self-hosted CI authoring exposed lost task context in summaries — 2026-11-12

5294732's historical-cache review passed exact remote Node 22/26 CI 43083769290,
docs 43083769073 and plugin preparation 43083769390. The real ledger kept every
original charge, the pending unknown attempt and USD50 authorization intact.

Prepared frozen CI-plugin authoring oracles outside the model workspace and an
isolated source checkout, preserving a user README draft and all host files.
The first 10-test oracle failed before any candidate and baseline host typecheck
passed. Live Sol authored tools/hooks/settings and passed eight cases, but two
tests replaced the entire settings object with limits only, accidentally deleting
mandatory repository. The candidate correctly rejected this contradiction.
The operator stopped owned runner 11313/PID3054847; exit130, no workers remained,
all 718 protected files survived and the interrupted request stayed reserved.
This was our evaluation-fixture defect, not a scored model failure. A separate
permission rule also wrongly let a broad deny override read-only script listing.
Evidence and original frozen bytes: dist/selfhost-ci-review-20261112/; its archived
oracle is named ci-review-oracle.fixture.ts, with unchanged hash 5839e702….

V2 preserves repository in those two test settings, limits the execution deny
to readOnly:false, and explicitly compiles every new plugin TS module. Before
execution: 10 absent-candidate failures, strict compiler success and a real-app
permission preflight proved listing allowed/unrelated execution denied with zero
model/subprocess calls. A separate validation workspace containing the previous
candidate passed all 10 corrected tests and strict compilation; no candidate was
seeded into the new authoring workspace. Oracle cdbf73d4… and all conditions were
frozen before a fresh live Sol session. Real gh list/run JSON shapes also match
the requested command fields. Evidence: dist/selfhost-ci-review-v2-20261112/.

V2 authored functional tools/shared code/panel; frozen behavior and strict type
checks passed during the run. It then repeatedly reread guidance and unfinished
docs through 14 completed compactions/74 reported requests without completing
the requested documentation/draft plan/final response. The first auxiliary
summary already claimed the original task was absent; later summaries treated
the explicit read-only GitHub task and /ci as unconfirmed assistant proposals,
promoting generic approval-scaffold examples into current scope. The original
user request remained verbatim in the main transcript but was deliberately
excluded from folded messages, so every auxiliary segment/merge lacked it.

Stopped the owned V2 runner at a confirmed settled-request boundary (SIGSTOP
inspection verified two pre-existing reservations and no held budget lock,
then SIGINT/CONT). Exit130; no workers remained, all 720 protected files survived,
and no new unknown reservation was introduced. Neither episode is a completed
autonomous initial delivery. Their candidate code remains outside the repository;
V2 README/changelog are still starter text and plugin.test.json is absent.

The repair adds optional Summarizer ctx.userRequest and supplies the latest
user text independently of folded history. The default model summarizer includes
that verbatim reference in every segment and merge, distinguishes requests from
examples/assistant proposals, and budgets reference/framing/output together.
An oversized reference fails before any auxiliary call and preserves history.
Existing custom callbacks can ignore the additive field. Three regressions failed
before the repair and pass afterward; all 1081 maintained tests pass with three
optional skips, typecheck and docs check/build pass. Both generators ran without
drift. Internal oracle archives were renamed from *.test.ts to *.fixture.ts after
Vitest discovered them under ignored dist; frozen bytes/assertions were unchanged,
and the full suite then passed. No product test discovery exclusions were added.

One controlled live Sol summary probe with a conflicting approval starter now
retains the explicit ci_review runs/run/logs and /ci task, without inventing a
missing authorization requirement. It used one 2048-output request and is not an
exact old-input replay or a completed development rerun. Evidence:
dist/selfhost-ci-review-v2-20261112/summarizer-probe.json. Reviewed admission bound
is now $49.303714, raw recorded bound $53.405594, 395 reported/two pending attempts,
still under the original USD50 reviewed ceiling. No pending charge was released.
Broader development/long-session/model/trust gates remain open; this source fix
is not in published immutable v0.7.1. A guided completion from the saved candidate
and independent tool/UI/lifecycle review are next; do not count that as a fresh
initial-delivery benchmark or integrate unfinished metadata as a ready plugin.

## Explicit historical cache review within the original budget — 2026-11-12

The budget guard now supports a trusted operator's one-time historical cache
review after an independent global-endpoint/usage audit. The receipt binds the
audited canonical ledger snapshot under the existing cross-process lock, records
the source revisions and external evidence hash, and fingerprints the covered
original charges. It uses maximum global Sol tier rates, including 12h writes
($30/M non-read input, $60/M output, $0.60/M confirmed cache reads), without
assuming historical Standard processing or cheaper retention. Only the fixed
reported legacy/cache-known cohort is refined. Original charge objects, unknown
cache costs, pending reservations, current Standard charges, later admissions,
the root policy and authorization remain intact. Older guards ignore the receipt
and continue using the larger recorded total. New reports expose both bounds.

Every read validates usage and the receipt; invalid counts/policies, changed
covered originals and forged ceilings fail closed. A second review cannot
replace it, a stale audit cannot race a new admission/settlement, and a review
cannot clear a pricing halt. 26 new regressions bring the total to 1078 passing
tests with three optional skips; typecheck and docs check/build pass. Deliberate
mutations prove that concurrency admission and charge-fingerprint assertions
detect their respective violations. Evidence: dist/budget-review-20261112/
negative-{admission,fingerprint}.log. No generator input changed; docs/evals.md
documents the operator trust/provenance requirement and dated pricing limits.

After all checks, revalidated the actual private ledger against its unchanged
read-only audit and every historical saved-profile source revision's strict
global endpoint and redirect refusal. Applied the receipt to exactly 74 charges.
All 295 original charge objects are identical, the pending unknown reservation
is unchanged and private file mode remains 0600. Raw recorded bound remains
$49.693673; reviewed admission bound is $45.591793 under the same $50 total.
This is not an invoice or an estimate of actual billed usage. Receipt and policy
source digest: dist/budget-review-20261112/applied-review.json. There were still
zero new paid model requests at this checkpoint. The ci-review authoring packet
still needs executable frozen oracles and absent-candidate negative control
before starting its new autonomous initial-delivery episode.

## Published v0.7.1 and verified public update — 2026-11-12

v0.7.1 is published at immutable annotated tag source
7e8e38989d2d88780f76aee7cbab1d62621747c5:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.7.1.
Exact source Node 22/26 CI 43078608479, documentation 43078608245 and
plugin preparation 43078608564 passed. Build-only candidate 43078638205 passed
source verification and all four native build/install jobs with publication
skipped. After independently rechecking those exact SHA/results and clean state,
the tag was created without moving any prior tag. Tagged release 43079898942
repeated source/all-plugin deterministic contracts and all four native build/install
checks successfully, then published four platform archives, installer and
checksums. Preflight receipt: dist/v071-candidate/release-preflight.json.

A separate local Linux x64 build used the verified pinned Callix archive obtained
through the saved tool proxy; release smoke passed installer checksum rejection,
versioned/latest installation, inactive/default catalog behavior, scoped plugin
override, authoring SDK/MCP, custom kernel/journal/resume, Monty, bundled Callix
cross-file analysis/editing, workspace scope and state preservation. Its model
endpoint is a local fixture, not a paid provider.

Independent public-asset verification downloaded the published installer and
checksums, matched the installer's digest and exact tagged source, and used that
unmodified installer through the saved proxy to update an isolated symlink from
the previously verified public 0.7.0 binary to 0.7.1. The installed binary reports
0.7.1; the old real binary still reports 0.7.0 and the saved state sentinel is
unchanged. This public check is Linux x64 only. Evidence/runner:
dist/v071-candidate/{public-install-report.json,public-installer.log,verify-public.ts}.
The canonical readiness page records the exact release scope; all broader 1.0
model/development/long-duration gates remain open. 1052 source tests pass with
three optional skips, typecheck and docs check/build pass; both generators ran.

A further read-only pricing audit checked every historical saved-profile source
revision, all of which require the official global Responses URL and reject
redirects. Official data-residency docs require prefixed regional domains; this
distinguishes the actual global adapter history from the earlier hypothetical
regional uplift case. All 294 reported inputs are at most 33191 tokens, below
long-context pricing. Known cache reads under maximum global tier/12h-write rates
give a conservative $45.591793 total, keeping all 166 cache-unknown historical
charges, 54 current Standard charges and the pending unknown reservation intact.
This is an audited potential refinement, not an invoice or activated discount.
Ledger bytes and admission policy remain unchanged at raw $49.693673. Receipt:
dist/budget-review-20261112/read-only-report.json. Sources include the official
pricing/model pages and https://developers.openai.com/api/docs/guides/your-data.
Any admission refinement still needs explicit validated provenance and fail-closed
tests; preserve original charge records and the USD50 authorization.

Prepared a requirements-only initial authoring task for a missing ci-review
plugin: read-only GitHub Actions status/failed logs through fixed gh argv and a
concurrent configurable panel, guarded cancellation, untrusted-output handling and
the full lifecycle. Packet: dist/selfhost-ci-review-20261112/. Its preparation
manifest is non-executable: frozen independent oracles and budget reconciliation
must be ready first. No plugin source, passing acceptance suite or completed
autonomous delivery is claimed. No new paid model call occurred in this turn.

## Prepared v0.7.1 host candidate — 2026-11-12

Core revision c582d8e passed exact remote Node 22/26 CI 43077761538,
documentation 43077761589 and plugin preparation 43077761541. Project checks'
separate four-platform candidate evidence remains bound to f102fef.

The root/application versions are prepared as 0.7.1 with matching lockfile,
generated git-cliff notes and CLI reference. No plugin version/catalog metadata
was manually changed. Both generators ran; 1052 tests pass with three optional
skips, typecheck and the 100-page docs check/build pass. The host patch includes
bounded installer transfers, interactive real TTY rendering under CI flags,
Project checks' canonical root fix, accepted background wakes and safe interrupted
turn continuation/cancellation. Four native host build/install gates still need
to pass for this exact prepared revision before tagging/publication. No new tag
or published host release is established here.

Read-only budget/pricing review leaves the ledger unchanged: $49.693673 recorded
upper bound, 294 reported requests and one retained unknown 403 reservation.
Only 128 historical requests have cache counts. The current official Sol rates
were fetched again; assuming the most expensive tier, 12h writes and regional
uplift for all old reported requests yields $50.039638 including existing new
Standard bounds and the pending reservation. Thus a partial cache discount alone
does not prove affordable new live runs under every historical pricing case.
No historical charges/reservations were reset, lowered or silently treated as
Standard, and no paid request was made. A current user billing figure was
requested while independent release verification continues. Official sources:
https://developers.openai.com/api/docs/pricing?latest-pricing-expanded=true
and https://developers.openai.com/api/docs/models/gpt-6.1-sol.

## Four-platform Project checks and cancellable waiting continuations — 2026-11-12

Project checks 0.1.1 at f102fef completed candidate run 43075940358 successfully:
source and Linux/macOS x64/arm64 installed archives passed, publication skipped.
Independent audit checks the immutable workspace, locally identical plugin
package/plan identity, exact candidate metadata, all evidence hashes, archive
checksums and embedded release identity. Receipt:
dist/plugin-candidate-20261112/project-checks-f102fef-certification-integrity.json.
macOS ARM64 successful-check/narrow and Intel cancellation screenshots were
inspected. The canonical readiness assessment now records this exact scope;
later source revisions, live-model quality and initial autonomous plugin delivery
are not certified by these results.

Follow-up cancellation review found a flaw in 0e3dd72's settlement wait: another
Stop or Clear could not discard a waiting continuation because it lived outside
the prompt queue. Controlled cases reproduced both unwanted model starts. A
cancellation generation now covers submissions waiting for conversation reset
or terminal settlement. Stop/Clear discard them; close rejects them. Five turn
settlement regressions cover delayed hooks, subscriber reentry and all three
cancellation actions, with a fresh explicit prompt still accepted afterwards.

Full validation exposed two Callix fixture assumptions under worker contention:
the process could expire before writing its startup counter, producing one start
instead of two or no counter file. No Callix runtime defect was established.
Its deadline test now holds the long worker until the independent short request
actually fails, verifies the long request is still pending, then releases it and
checks completed-graph reuse across limits without another execution. Removing
deadline separation deliberately makes this controlled test fail. The status
case compares invocation counters before/after inspection, including a worker
that expired before JS startup. No runtime deadline was raised or skipped.
Mutation log: dist/turn-settlement-20261112/callix-deadline-negative.log.

1052 tests pass with three optional skips; typecheck and docs check/build pass.
No event/metadata generator input changed. No paid model call, ledger discount,
plugin tag, archive publication or new host release occurred in this iteration.

## Interrupted turn settlement before explicit continuation — 2026-11-12

Both actual PR #3 checks passed at 79f256b: CI 43073680504 (Node 22/26)
and docs 43073680108. The independently reproduced five-file preparation was
merged as f102fef; the clean committed plugin preparation is now empty, with
Project checks 0.1.1 and catalog 1.0.4. Exact candidate run 43075940358 passed
source verification and started its four native archive jobs; their results are
not yet established. No candidate publication or new host release is claimed.

The saved HTTP CONNECT proxy is enabled for both model and tool scopes. Fresh
unauthenticated OpenAI probes through each scope returned the expected 401,
without paid requests or credential output. The existing evaluation budget and
all historical charges remain unchanged.

An additional deterministic audit reproduced an interrupted-turn ownership race.
The core marks interruption before awaiting terminal plugin hooks and journal
writes. Submitting another prompt during a delayed hook, or immediately from the
terminal event subscriber, could start a new turn whose state/context was then
overwritten by the old cleanup. Explicit continuation now awaits the active
turn's settlement before checking session state and submitting again. Busy-turn
queueing remains unchanged, and closing still rejects subsequent submissions.

Two controlled regressions cover delayed hooks and immediate event continuation,
then verify new-turn identity, a real core tool execution and steering delivery.
The initial fixture incorrectly expected another model request after a plain
text finish; it now uses a tool step so the steering check has a real continuation.
Both final scenarios fail without the guard and pass with it. Negative-control
log: dist/turn-settlement-20261112/negative-control.log. All 1049 tests pass with
three optional skips; typecheck and docs check/build pass. No event or metadata
input changed, so generation is unaffected. The canonical execution guide
documents settlement; the architecture map's service topology is unchanged.
This is backend-only behavior, verified through core/app tests rather than a UI
change. Broader live-model and long-running 1.0 gates remain open.

## Accepted background wakes across interruption and clear — 2026-11-12

Generated plugin release PR #3 at 06b7199 contained exactly the five expected
Project checks 0.1.1 preparation files, byte-for-byte independently reproduced.
Its explicit dispatch CI 43069310530 and docs 43069314590 passed. Duplicate PR
triggers initially required GitHub approval; after reviewing that exact bot head,
the two specific runs were approved through the CLI (the connector has no such
method). PR docs 43069314705 passed, but Node 22 in PR CI 43069314634 failed
background-jobs' interrupted-follow-up assertion (two model requests vs three).
PR #3 was not merged or treated as green despite its other passing runs.

Controlled completion-before/after-Stop cases reproduce a real contract violation:
interrupt cleared every queued prompt, including accepted plugin-owned wakes.
Before-Stop completion was lost; after-Stop completion remained queued, making the
old sleep-based case timing-dependent. The original CI trace does not prove which
completion ordering occurred. New cases hold the real shell until explicitly
released, check the initial foreground request, inspect status via the supported
concurrent user-tool API, and verify both orderings without increasing timeouts.
The first draft incorrectly inspected a model tool while the model was busy; the
corrected test uses invokeUserTool rather than weakening the delivery assertion.

Interrupt now cancels ordinary queued prompts/steering but preserves accepted
plugin-owned wakes in interrupted state until explicit continuation. Stopping
before an idle wake timer fires also pauses it. Clear resets its cancelled timer
handle so new conversation wakes still schedule; close explicitly discards all
pending prompts. Owner unload, deduplication, permissions and budgets remain in
force. Deterministic negative controls reproduce lost before-Stop wake, idle wake
pause and post-clear timer failures; all three now pass. The new idle fixture's
initial assertion was corrected to match the existing nested host event response.

1047 tests pass with three optional skips, typecheck and docs check/build pass;
both generators ran without drift. The real CI=1 background PTY scenario also
passes: Ctrl+C interruption, foreground chat during a real shell, one completion
without model polling, and retained unsent draft. Screenshot inspected; evidence:
dist/followup-interruption-20261112/. Its six provider requests are scripted,
not paid model evaluations or a multi-hour workload. Canonical host/plugin docs
clarify accepted delivery vs model review and cancellation scope. The new core
source still needs exact remote checks; automatic plugin preparation must be
refreshed and reviewed before Project checks native certification can proceed.

## Four-platform Git review and Project checks path aliases — 2026-11-12

Git review c98b3ce completed candidate run 43067043375 successfully: full source
certification and installed archives for Linux/macOS x64/arm64 all passed; publish
was skipped. Independent audit validated certificate schemas/requirements, every
evidence hash, archive sidecars, workspace digest and embedded release identities.
Receipt: dist/plugin-candidate-20261112/git-review-c98-certification-integrity.json.
Native macOS Intel cancellation and ARM narrow screenshots were inspected. No
plugin tag/archive was published and broader 1.0 gates remain open.

Project checks run 43067034036 passed source and Linux archives but macOS Intel
failed before real script discovery. Its package confinement compared the canonical
file parent against a lexical ctx.cwd, so macOS /var versus /private/var aliases
were wrongly rejected. Both root and package path now use the host path resolver
before comparison. There are no direct filesystem calls or weaker path checks.
A real-app integration regression selects a symlinked project, lists and runs an
actual npm check, then attaches an outside directory and confirms a package link
there is rejected before filesystem read or execution. It failed at discovery
before the fix; existing 18 Project checks assertions still pass. The first new
test reached the host's earlier scope denial, so its outside directory is now
explicitly attached to exercise the plugin's own stricter confinement, without
relaxing the expected denial. Plugin test metadata includes this regression.

1044 tests pass with three optional skips, typecheck and docs check/build pass.
Both generators ran without generated changes. Canonical plugin docs explain
canonical root confinement and avoid duplicating its independently generated
version. Runtime version/changelog preparation must remain automatic; no plugin
or catalog version was hand-bumped. The new fix needs a prepared release revision
and fresh native certificates before claiming macOS support for Project checks.

The optional local locked-browser download did not complete: direct installation
was stopped to switch to the explicitly requested saved tool proxy, whose range
probe returned 206. The owned proxied installer reached 20 percent before its
180-second command bound stopped it. Local visual proofs used the existing
compatible Chromium 156 override; remote CI installed and tested locked Chromium
158. No local locked-browser installation or new paid model run is claimed.

## Native candidate evidence and terminal bench synchronization — 2026-11-12

The 4a9e142 renderer repair passed exact main CI 43064242098 on Node 22/26
and documentation 43064242086. Project checks run 43064286391 now renders the
real UI and passes script success/failure/configuration, then fails after cancel.
The tool journal publishes its cancellation before the plugin publishes its final
panel, so measuring the next button early used a row that moved during settlement.
The scenario now additionally waits for the final cancellation panel and removal
of Cancel/Cancelling controls before measuring the next action. Original PID,
main-agent, cleanup and repeat-run assertions stay intact; no timeout was raised.
The affected real CI=1 PTY flow passes locally (ci-cancel-settlement-after).

Git review run 43064293930 passed its full source certificate and exact native
Linux x64/arm64 archive certificates at 4a9e142. Downloaded evidence was audited
with certificateSchema, assess and validateEvidence; archive/sidecar/certificate
hashes and embedded release identities match the immutable workspace. The source
has 13 case bindings and each artifact four; these counts are not model tasks.
Receipt: dist/plugin-candidate-20261112/git-review-partial-integrity.json. Native
x64 running and arm64 narrow screenshots were inspected. These are two Linux
platforms, not a four-platform release; no plugin was published.

The macOS Intel archive built and passed smoke/domain cases but failed its terminal
case after closing a panel. Input logs contain the command characters but no
Alt+i sequence: xterm's default macOptionIsMeta=false treats Option as native text
input. The bench now explicitly enables macOptionIsMeta. An independent diagnostic
using actual Chromium, the real app/PTY and simulated MacIntel navigator state
reproduced missing Meta/focus before, then observed ESC+i and the preserved draft
with the added character after the fix. Receipts are mac-meta-{before,after}.
This simulation is not native macOS certification. The first diagnostic snapshot
read before the PTY repaint; the retained probe now waits for actual draft output,
and no product code changed for that observation correction. Native Mac ARM was
still queued at the last audit; the old run is superseded by these specific bench
repairs, not by an observation timeout.

Canonical controls explain native Option-as-Meta setup, and bench docs record
keyboard mapping and waiting for panel settlement. Product/runtime source stays
at 4a9e142; these follow-up edits affect bench input/synchronization and docs.
Documentation check/build passes. New exact-source native certification remains
required. The original failed evidence is retained, and broader 1.0 gates stay open.

## Live TTY repaint with inherited CI flags — 2026-11-12

The browser preparation repair 74438b2 passed exact main CI 43062715844 and docs
43062715919. New Project checks / Git review candidate runs 43062758790 and
43062769066 successfully installed and launched locked Chromium 158 without apt.
Both then failed only terminal-flow; all other source certification cases passed.
The retained failure PNG shows a blank terminal, ANSI contains only initial
control probes, and no user interactions occurred. Failed certificates and traces
are retained under dist/plugin-candidate-20261112/*-74438b2-failed/.

A local CI=1 real-PTY run reproduced the identical blank first frame. Ink's
import-time CI detection defaults even a TTY to noninteractive mode and emits
only the final frame at unmount. The renderer now explicitly selects interactive
mode from stdout.isTTY. This preserves live terminal output under inherited CI /
CONTINUOUS_INTEGRATION without clearing those variables, and retains static final
frames for redirected renderer output. No scenario timeout or expectation changed.

Fresh-process regressions initialize Ink with both CI flags and verify a frame
before a held source exits, plus final-only output through a pipe. The first
fails against the old renderer while the pipe case passes. Both now pass.
Complete real Project checks and Git review PTY flows also pass under CI=1,
including concurrent tool work/cancel, real subprocess cleanup, keyboard/mouse,
narrow layout and restart. Broad visual:check passes under the same flags.
Evidence is retained in dist/plugin-candidate-20261112/ci-{pty,git-review,broad}-after/;
ci-pty-before retains the failed reproduction. Narrow/running Project checks and
the broad independent-agent screenshots were inspected. Local browser checks use
the documented compatible Chromium override; remote certificates remain separate.

1043 tests pass with three optional skips; typecheck and the 100-page docs
check/build pass. Canonical renderer/bench docs explain TTY vs redirected output.
No event, CLI or plugin metadata inputs changed; no generated files or plugin
versions were edited. The repaired runtime still needs exact-source remote
certification on all four native platforms. Broader 1.0 gates remain open.

## Plugin certification browser preparation repair — 2026-11-12

The previous goal turn made concrete progress: 6f18153 introduced immutable-source
plugin candidate certification. Its exact-revision Node 22/26 CI 43060005315,
documentation 43060006825 and plugin preparation 43060005586 succeeded.

Project checks candidate run 43060035871 reached a terminal failure before plugin
certification: playwright install --with-deps retried Ubuntu font-package mirrors
for ten minutes and failed DNS resolution. Logs are retained in
 dist/plugin-candidate-20261112/project-checks-43060035871-failed.log. This was not
a plugin or terminal test result. Git review run 43061419039 was still queued
with the same affected workflow; it was explicitly cancelled as superseded by
the repair, not restarted because observation expired.

The workflow now installs locked Playwright Chromium without re-running apt for
system libraries already supplied by its hosted runners. A separate required
browser step launches Chromium and loads a page; unavailable libraries/binaries
still fail rather than skipping UI cases. Its check is inline so existing old-tag
validation does not depend on a new helper file in that tag. The existing local
compatible Chromium override passed both real source/artifact prerequisite
commands; an invalid browser path failed both. CI still must validate its own
locked browser revision on each runner. Browser preparation is bounded at ten
minutes, verification/platform jobs at thirty minutes and publication at fifteen.
All mandatory certification cases and expectations remain unchanged.

1041 tests pass with three optional skips and coverage thresholds satisfied;
the 100-page docs check/build passes. The new workflow regression fails against
the previous workflow. No contract/generation inputs or plugin runtime/version
metadata changed. New exact-revision remote certification remains required.

A read-only budget review left the private ledger unchanged at $49.693673,
294 reported / one pending, under the original $50 limit. Of 74 legacy reported
requests with saved cache usage, original bounds total $9.916410; applying the
maximum published mode, regional uplift and longest cache-write rates would
bound those known requests at $6.395984 (all inputs are below long-context
threshold). This is a feasibility calculation, not an invoice or activated
admission-policy change. Unknown historical cache usage retains its original
bound; the old pending 403 reservation is unchanged. Official sources checked: https://developers.openai.com/api/docs/pricing
and https://developers.openai.com/api/docs/models/gpt-6.1-sol . Any future
reconciliation needs validated usage, preserved original records, explicit policy
evidence and tests before it can affect request admission. No paid requests ran.

## Immutable-source plugin candidate workflow — 2026-11-12

The previous goal turn made concrete progress: the public 0.7.0 installer proof
completed, installer network waits were bounded, and d275029 is pushed. Its
exact-revision CI 43058942194 subsequently succeeded. The 1.0 goal stays active.

Manual plugin-release validation can now select candidate_name plus a full
candidate_sha instead of requiring a pre-existing publication tag. Metadata
rejects ambiguous, mutable or mismatched selections, retains automatic version
preparation checks, and records the resolved SHA/mode in source.json. The workflow also
records source-commit.txt independently of revision-specific helper output, so
old existing-tag helpers cannot drop SHA pinning. Every platform job and
publication checkout uses that verified SHA. Manual dispatch
cannot publish, including when dispatched from a tag; publication still requires
a tag push and rechecks its commit. No native certificate or plugin publication
is inferred from implementing the workflow. Existing-tag manual validation stays
available. Failed platform diagnostics are retained in separate quality-plugin-*
artifacts, excluded from the publication archive download set.

Local validation: 1040 tests pass with three optional skips and coverage above
thresholds; typecheck and the 100-page docs check/build pass. Four focused new
cases cover candidate metadata and publication/source-selection boundaries;
existing metadata/preparation cases remain green. Reintroducing a tag-based
platform checkout and manual-tag publication makes both workflow boundary tests
fail. No SDK, CLI or event generation inputs changed; no plugin versions or
changelogs were edited. Exact-source remote CI and four-platform Project checks
candidate certification are the next required evidence.

## Published 0.7.0 checkpoint and bounded installer networking — 2026-11-12

The previous goal turn verified both model/tool proxy scopes with non-billable
OpenAI models requests (expected unauthenticated HTTP 401). It added fresh route
evidence; proxy activation and the paid adapter fix were already persisted.

Immutable v0.7.0 points to 21d79342183a9f3262efbe7d9925ba71085b9539 and is
published with four archives, install.sh and SHA256SUMS. Exact-revision main CI
43053396437 (Node 22/26), docs 43053396720 and release 43054146510 all succeeded.
The release workflow verifies all 29 plugin PR contracts and builds/installs each
native archive on Linux/macOS x64/arm64. These facts supersede the preparation
notes below. They do not close the broader 1.0 gates or publish independent plugin
archives. Public Linux installation verification also completed successfully: the
original published installer downloaded the archive and checksums from GitHub,
verified integrity, installed into an isolated prefix, and returned compositor
0.7.0 while preserving the controlled home-state sentinel. Evidence is retained
in dist/v070-public-install/report.json and installer.log. The transfer took over
18 minutes while steadily receiving bytes; that evidence raised the new source
limit from the initially chosen 15 minutes to 30 minutes before finalization.

Review of that download exposed unbounded installer network waits. Source now
bounds connection setup (15s), low-throughput stalls (below 1 KiB/s for 60s),
individual attempts (1800s), and retry admission (three retries within 1800s).
An in-flight attempt may finish after the retry window. Failures precede any
installation switch. Regressions cover either download failing with partial
data, retained active symlink/binary/state, and temporary-directory cleanup.
A real loopback HTTP server also leaves an incomplete response open; real curl
terminates it with code 28 under scaled existing time limits. All three cases fail as negative controls when production limits are removed.
This source fix is subsequent to v0.7.0; published assets and its tag are unchanged.

Validation: 1036 tests pass with three optional skips, coverage thresholds pass,
the complete Linux distribution/installer smoke passes, and the 100-page docs
check/build passes. No plugin, CLI or event metadata changed, so generated
references and contracts need no regeneration.

The initial installer fix 924e0dd also passed exact-revision Node 22/26 CI
43057009191, documentation 43057008730 and plugin preparation 43057008648. The
final 30-minute limits passed the three focused tests and another documentation
check/build. Published v0.7.0 remains unchanged. Next extension-quality work can
remove the existing pre-publication workflow gap: plugin-release manual dispatch
requires a resolvable plugin tag, while pushing that tag starts publication. A
separate immutable-source candidate mode is needed for four-platform archive
certification before publication; no candidate mode or extra certificate is
claimed yet.

## Final 0.7.0 release-gate repairs — 2026-11-12

The first 0.7.0 preparation CI 43051816654 passed Node 22 but the Node 26
coverage run timed out in the held command-starter authoring test. Review found
lost-release and stale-waiter races in ScriptedProvider: holds were registered
only after emitting events, and aborted/released requests retained callbacks or
abort listeners. Three deterministic negative controls reproduced early-release,
abort/next-request and early-iterator-close failures. Holds now register before
first yield and dispose their waiter/listener on release, abort or iterator
completion. Four regressions also enforce concurrent FIFO and no idle release
credits. No timeout was raised. Focused tests, typecheck and the complete local
coverage run pass with 1033 tests / three optional skips; line coverage is 89.58%.
This changes the deterministic fixture provider, not remote model scheduling.

The compiled marketplace bench lacked the source fixture's held-model HTTP path.
Added an abort-aware token-scoped loopback SSE sequence for busy/question/done and
selected that endpoint explicitly for compiled runs. It has a bounded lifetime
and cleans up on request abort/cancel. Both source and actual compiled 0.7.0
Linux runs pass the complete install/enable/restart/disable, concurrent catalog
search/management, delayed reload, pending question, settings and 48x18 flow.
Evidence: dist/v070-marketplace-{source,binary}/report.json. The compiled narrow
question/management screenshot was inspected. No external model was invoked.
These are release-gate repairs; the immutable publication tag is not yet created.

## Preparing the usable 0.7.0 host milestone — 2026-11-12

The form revision 66510ee passed main CI 43050460400 on both supported Node
versions and documentation 43050460383. Generated plugin-release PR #2 was
reviewed by independently applying plugin:prepare and docs:gen to the clean
committed base, comparing all 21 output files byte-for-byte to d139028. The review
matched exactly (dist/plugin-release-pr-review-20261112.json); it contained only
generated versions/changelogs, catalog/state and references, no executable edits.
Its explicitly dispatched CI 43050528284 and docs 43050532645 passed. The reviewed
head was merged with an expected-SHA guard as 286f6c7. Existing plugin versions
were not bumped manually and independent plugin archives were not published.

Prepare host 0.7.0 so the earlier user-authorized installer/release workflow can
ship the concurrent tools/panels, new Git/Project checks utilities, compaction and
capacity fixes, proxy routing and Unicode editing. This is a pre-1.0 milestone;
it does not close broader readiness gates. Only root/app versions changed in the
lockfile; dependencies are unchanged. git-cliff generated the root changelog,
and the CLI reference was regenerated. 1029 tests with three optional skips,
typecheck and the 100-page docs check/build pass after merged plugin metadata
and host version preparation. Exact release CI, native matrix and publication
must still succeed for the resulting immutable tag; do not claim them early.

## Live form refactor through Project checks — 2026-11-12

The preceding goal turn made concrete progress: a9f99c9 is pushed with green
Node 22.19.0/26 CI (43046489076), all 29 plugin PR certificates and successful
four-platform native candidate build/install smoke (43046640227). The build-only
workflow skipped publication. Project checks release/source and installed Linux
x64 archive certificates also passed for that source snapshot. Retained checkpoint:
dist/goal-checkpoint-20261112.json. These are scoped candidate checks, not 1.0.

A subsequent real multi-file task asked Compositor to share grapheme editing
between message input and text/URL/password settings fields. The isolated worktree
starts at a9f99c9 and includes an immutable check:unicode npm script and a controlled
user-owned README annotation. Tools were limited to read/write/edit/navigation,
tool_help and the enabled project_check plugin: no raw exec tool was exposed.
The parent process loaded the saved budgeted Sol provider/proxy first, then used
the minimal evaluationEnvironment for the CLI and all owned npm subprocesses.
Provider/proxy credentials stayed in parent closures, not the process environment.
This is environment hygiene, not OS containment.

The initial frozen oracle reproduced 25 failures / one privacy pass before the
model ran. The model authored text-edit.ts and refactored ui.ts and form.ts, ran
check:unicode successfully (68 tests) through project_check and reported typecheck
failure truthfully. The compiler error was in the frozen harness: its
String.isWellFormed call was absent from the existing TypeScript library. The
model correctly left the test, config and user draft unchanged instead of
bypassing checks. Normal agent exit 0 does not mean all project verification
passed. Original evidence is in dist/selfhost-form-unicode-20261112/ and detached
authored snapshot b55bfb84e4554f4880708fe4aa1276f5b9ca0cb2.

The run lasted 171006ms, with 15 main steps, 23 reported model requests and three
automatic compactions. Total usage was 135952 input / 7219 output. It exercised
actual script discovery, success and failure through the same guarded tool the
human panel uses. Original oracle, package.json and user README hashes were
preserved. independent-review.json correlates calls/results and preservation.

The original oracle is retained as oracle-v1.ts.snapshot. The corrected v2 uses
an equivalent UTF-8 round-trip well-formedness assertion, without a library
upgrade or weaker outcome; oracle-correction.json records hashes and the defect.
Independent reruns passed all 68 checks and typecheck, plus 20 retained probes for
limits, narrow rendered Unicode, selection and clear behavior. There was no paid
rerun and no post-run change to the model-authored source. This is a successful
independently verified artifact with a documented harness correction, not an
all-green autonomous episode under the original harness or an unseen benchmark.

Main integrates the authored three-file refactor unchanged, plus corrected tests
and canonical controls documentation. Text/URL defaults and edited form values
respect the 4096 UTF-16-unit limit at grapheme boundaries. Password input remains
private/masked, and public editor cursor offsets remain UTF-16. Custom editor
providers and other question/input implementations retain their own contracts.
The real network-proxy PTY scenario now edits a joined emoji in username and
password, saves, and verifies stored private values without printing them.
Evidence: dist/form-unicode-pty-20261112/report.json; the masked form screenshot
was inspected. Unrelated user's actual proxy configuration is unchanged by this
isolated scripted bench.

1029 tests pass with three optional skips, typecheck and the 100-page docs
check/build pass, and all 29 native plugins pass PR certification on the unchanged
final source tree. Remote CI and native archives for the new revision remain
separate evidence. The conservative guard bound is $49.693673, 294 reported / one
pending (the old direct 403), with the original $50 authorization. The separate
30m Standard estimate covers 128 requests at $1.247307 and leaves 166 historical
requests unavailable. No invoice total, refund, ledger reset or wider billing
authorization is inferred. Broader 1.0 readiness gates remain open.

## Completed live plugin review and Unicode message editing — 2026-11-12

The previous goal turn made concrete progress: proxy routing was fixed and pushed
as 7c559a9, the saved proxy plugin was enabled for this project, and a real Sol
probe passed. The broad 1.0 goal remains active; this is not a completion audit.

After the user's explicit proxy instruction, a new isolated iteration using the
saved budgeted gpt-6.1-sol profile started from original authored candidate
0e1356a. The former direct-403 episode remains unchanged. Evidence is in
dist/selfhost-checks-review-proxy-20261112/; final detached authored snapshot is
5867580ef56c811c9da5699dcd864dbe4bd2b531. The run completed with code 0 in 267139ms,
22 main steps, 36 tool calls, 30 reported model requests and two automatic
compactions. Caller limits were 24 steps, 300000 turn/session tokens, context
24576 and output reserve 4096. Reported total usage was 265042 input / 12774 output.
The model fixed five supplied review findings, recovered from an obsolete mock
missing background(), then passed the unchanged six-test original oracle,
unchanged five-test review oracle and seven additional regressions. Frozen hashes
match context.json. Independent reruns of all 18 tests and typecheck passed.
The trace-correlated independent-review.json records actual verification calls.
plugin_dev correctly reported structure-only with unavailable runtime syntax
checking; typecheck supplied compiler validation. No PTY or certification success
was claimed by the model. This is completed guided review on a known candidate,
not unseen evaluation or completed autonomous initial plugin delivery.

The reviewed main integration adopts the model-authored settlement logic and
its additional tests. It waits for owned SDK cleanup before replacing running
state, rejects late success after cancellation, publishes through the retained
cleanup handle only while its operation still owns state, ignores unload-revoked
view completion and shows the current check heading above long script lists.
The broader existing invalid-command warning, tool help and certification plan
remain maintained by independent integration. The real Project checks PTY flow
passes after integration (dist/project-checks-live-integration-20261112/); its
running screenshot was inspected. Source/archive certificates still need the
exact final committed snapshot. Prior certificates cover their own older inputs.

Eight negative-control cases reproduced UTF-16 cursor splitting in the default
message editor. Left/Right, Backspace and Delete now use native Intl.Segmenter
grapheme boundaries while public cursor offsets remain UTF-16. Simple emoji,
joined emoji with skin tone, flags and combining accents pass. The complete real
PTY smoke in dist/unicode-draft-20261112/ also checks editing, narrow Unicode draft
preservation and the existing window/plugin flows; screenshots were inspected.
This change applies to the default message editor, not custom editor providers
or every other form field. The canonical app controls guide documents the scope.

1003 tests pass with three optional skips; typecheck and the 100-page docs
check/build pass. The current conservative guard bound is $49.231814, 271 reported
and one pending request (the original direct 403); authorization remains $50.
The separate 30m Standard estimate covers 105 requests at $0.978788 with 166 old
requests unavailable. Neither figure is the user's account invoice. Historical
charges and the user's reported approximately $2 earlier spend were preserved.

CI 43044504783 confirms the pinned ripgrep installation, npm installation,
typecheck and coverage tests pass on both Node versions; Node 22.19.0 completed
successfully. Node 26 later rejected Project checks' composite certification with
JSON unexpected EOF. Its retained artifact log is in
/tmp/compositor-ci-382cbb0/reports/certification/project-checks/pr/linux-x64/.
Three traced local composite reruns passed, so do not claim a deterministic
reproduction of the CI exception. Review found a real readiness race in both Git
review and Project checks fixture workers: the reader could parse child-pids.json
between file creation and completion. Workers now write a temporary JSON file and
rename it atomically; assertions and deadlines are unchanged. Casebook errors
also retain the failing requirement name and original cause for future diagnosis.
These are oracle publication/diagnostic fixes, with no production contract change
or separate user-guide impact. Final exact-snapshot certification remains required.
All 29 native plugins subsequently passed PR certification against the unchanged
final source tree (reports/certification/summary-pr.json). Release/archive and
remote CI evidence still need the committed revision.

## CI search prerequisite independent of Ubuntu mirrors — 2026-11-12

Repeated authoritative logs from 43040650857 and 43042550884 show DNS failures
for azure.archive.ubuntu.com, archive.ubuntu.com and security.ubuntu.com before
any tests, including on the pinned Ubuntu 24.04 runner. The pin aligned the
supported baseline but did not fix network availability.

Linux x64 validation jobs in ci.yml, release.yml and plugin-release.yml now use
node tools/release/ci-ripgrep.mjs. It downloads official ripgrep 15.1.0 through
curl, verifies the pinned upstream archive SHA-256, extracts only known binary
and MIT-license entries into memory, checks the actual version and atomically
installs into an isolated RUNNER_TEMP directory added to GITHUB_PATH. There is
no sudo, apt mirror dependency or fallback to unverified bytes. Failure still
stops the validation job. Existing platform-specific archive prerequisites are
unchanged. Canonical release docs explain this operational dependency.

The real official archive checksum matched its published .sha256 file. Both
an offline verified-archive install and an actual CLI download/install passed;
/tmp/compositor-ci-ripgrep-cli/compositor-ci-tools/15.1.0/bin/rg reports 15.1.0.
An altered-archive regression verifies rejection before extraction and preserves
an existing installation. All three workflow files parse with the new command.
1001 tests pass with three optional skips (including pending Unicode UI work),
and the 100-page docs check/build passes. Remote CI must still be observed for
the pushed revision; local installation success does not prove a green workflow.

## User-requested proxy connection — 2026-11-12

The user explicitly requested connecting the proxy after the region refusal.
The saved global proxy.json already configured an authenticated HTTP CONNECT
endpoint for models/tools, but network-proxy was inactive in this project and
the budgeted injected provider bypassed NetworkClient entirely. No credentials
were copied into repository files or model workspaces.

Enabled the existing local network-proxy plugin in project scope through
extension_control; a user-scope enable correctly refused the project-local
source, so no global plugin installation or activation was invented. Reload and
session start now yield Proxy enabled and Models: proxied · Tools: proxied for
this project. Global proxy settings and unrelated selections were preserved.

The evaluation adapter now reads scoped proxy.json and uses the existing model
NetworkClient, closing its owned client in generator finally on completion or
failure. Model proxy selection and cleanup are covered by integration tests;
the provider's real CONNECT tests remain unchanged. Canonical eval docs describe
the routing and no direct fallback on proxy failure.

A non-billable proxied OpenAI models request without a key returned 401 as
expected. A budgeted gpt-6.1-sol Responses probe through the saved proxy then
returned exactly PROXY_OK, confirmed Standard terminal metadata, reported 13
input / 7 output tokens and settled once. The ledger is now $48.681235 guard
bound, 241 reported / one pending, with the original $50 authorization and all
historical charges preserved. The pending reservation is the prior direct 403,
not a new unreported proxied success. No account invoice total is asserted.

The goal continuation had also reproduced and fixed eight default-editor Unicode
cases and passed the real complete PTY smoke in dist/unicode-draft-20261112/;
those UI changes remain separate uncommitted work during this proxy request.
The Ubuntu 24.04 CI run 43042550884 still failed; inspect its precise cause before
claiming the runner pin repaired CI. It was a baseline alignment, not proof of
network recovery.

## Standard evaluation admission and a region refusal — 2026-11-12

The previous goal turn made concrete progress: Project checks source was pushed
as 2c45c2f; its source release and installed Linux x64 archive certificates both
passed afterward. Artifact PTY screenshots were inspected. Evidence remains in
reports/certification/project-checks/{release,artifact}/linux-x64/. Other native
platforms and publication are not established by those certificates.

New paid-profile requests now explicitly select Responses service_tier default.
The reviewed sol-standard-2026-11-12 per-charge policy reserves $5/M input,
including 12h cache writes, and $10/M output. Settlement discounts only confirmed
cached reads to $0.10/M; all other input retains the $5/M ceiling. Terminal SSE
metadata must confirm default before settlement; missing/unexpected tiers retain
the charge and persistently halt further admission across profile/process
restarts. New charges retain input/output token ceilings and refuse usage
outside them. Old root ledger identity and all historical charge amounts remain
unchanged at their prior $30/$60 policy. The total authorization stays $50.
The separate Standard estimate explicitly assumes 30m cache writes and is not an
upper bound when retention is unknown. Canonical docs/evals.md explains both.

Two negative controls reproduced excessive new-request reservation before the
change (/tmp/compositor-standard-before.log). Twenty budget/profile tests now
cover historical preservation, new ceilings, concurrent/missing settlement,
cache accounting, invalid policies, token envelopes, tier mismatches, fragmented
SSE metadata and persistent halt after restart. 990 repository tests pass with
three optional skips; typecheck and the 100-page docs check/build pass.

A new isolated review iteration was prepared from original authored snapshot
0e1356a with both frozen oracle files unchanged. This runner correctly configures
maxTokensPerTurn and maxTokensPerSession (300000), 24 steps, a 24576-token context
and 4096 output reserve. Evidence: dist/selfhost-checks-review-20261112/. Its sole
HTTP request returned 403 unsupported_country_region_territory before any model
work. The episode is a provider refusal, not a completed review or a successful
live Standard/cache-price validation. Do not retry it through an alternate route.
The $0.10078 reservation is retained: guard bound $48.68110, 240 reported and one
pending request. No old amounts were changed and no billing refund was inferred.

The local Ollama service is reachable but has only cloud stubs
(deepseek-v4.1-flash:1017-cloud and gemma4:31b-cloud), not local model weights.
Current official cloud pricing is usage-credit based, so no unmetered paid
fallback was used. Free integration work remains available; the broad goal is
active, not blocked or complete. Documentation and plugin preparation for 2c45c2f
passed. Its main CI failed again before tests on Ubuntu 26.04's package mirrors
with DNS failures while installing ripgrep; investigate the rolling runner image.

## Self-authored Project checks candidate and review — 2026-11-12

The active 1.0 scope includes useful missing plugins developed through Compositor
and complete convenient UI flows while the main agent works. Project checks is
a second concrete authoring episode: discover local npm scripts, run an exact
existing name through guarded owned exec, configure scoped output/time limits,
and use the same tool from the model or an independent human panel.

Original authoring evidence is preserved under
dist/selfhost-project-checks-20261112/. The isolated checkout based on 6d3a267 is
/tmp/compositor-project-checks-eoa0w24h/repo; detached snapshot 0e1356a preserves
the original artifact and frozen acceptance suite. The six frozen tests were red
before implementation and passed unchanged afterward; five agent-added tests
and typecheck also passed. The turn then failed at the conservative evaluation
USD request-admission guard before a final response. Do not count this as a
completed autonomous plugin delivery or certification. The runner's agent.maxTokens
key was unsupported; effective episode bounds were the 26-step limit, context
settings and persistent USD guard, not a claimed 140000-token limit. Original
ignored test copies now use .snapshot suffixes to preserve their bytes without
Vitest accidentally collecting evidence files as repository suites.

Independent review reproduced four defects before corrections: unbounded script
metadata, copying merged project settings into global scope, silent invalid UI
command arguments and Cancel buried below the script list. The reviewed source
also replaces stale success output with running status and clears active state
after the initiating hook expires, using a retained trusted cleanup capability.
The model's lightweight hook mock now implements that public capability. Five
review cases include actual app boundaries and hook-expiry recovery. Tool help
now supplies schema-shaped discovery/run examples. Catalog initial version is
0.1.0; existing plugin versions are unchanged. Full standard source/archive
lifecycle, domain, mutation, persistence and PTY scenarios are bound in its plan.

982 repository tests pass with three optional skips; typecheck and the 100-page
docs check/build pass. Real PTY evidence in dist/project-checks-review-pty-4/
passes keyboard/mouse, actual npm success/failure, global settings and restart,
held-agent concurrency, cancel and Close process reaping, narrow layout and draft
preservation. Screenshots were inspected. Earlier PTY attempts exposed an input
synchronization error in the bench: it proceeded after deleting one draft
character. The bench now waits for the empty prompt placeholder before closing
a pane. No host input fix was justified by that evidence.

The persistent guard remains $48.58032 for 240 reported requests with no pending
requests. This is an intentionally pessimistic bound, not an invoice. The user
reported only about $2 actual spend due to cache at the earlier checkpoint. The
separate Standard/global estimate covers only 74 recent requests ($0.630362),
with 166 historical requests unavailable; aggregate cache-write counts cannot
distinguish retention pricing. No paid requests were made during this independent
review, no ledger reset occurred and the $50 authorization remains unchanged.
All further integration/certification work here uses free scripted/local checks.
All 29 native plugins pass PR certification against the unchanged reviewed source
snapshot; report reports/certification/summary-pr.json. The previous 6d3a267 CI
failed before npm/tests while Ubuntu package hosts failed DNS resolution; failed
jobs were rerun. Its documentation and plugin preparation workflows passed.
Broader models, sustained development and native platform publication remain open.

## Output reserves and profile-specific capacity — 2026-11-12

The previous live traces exposed unset main maxOutputTokens for an injected
provider without metadata. Four negative-control tests reproduced missing
configured/embedder limits, failure to cap at a provider ceiling and unusable
small-window defaults. Retained log:
dist/output-capacity-20261111/negative-control.log.

TokenBudget now separates caller settings from resolved capacity. applyCapacity
resolves metadata and overrides without overwriting the source configuration;
outputReserve exposes the effective generation allowance. configure explicitly
replaces settings and updates the high-water mark; invalid updates retain the
old budget. Output defaults are min(8192, window/4), system defaults
min(2048, window/8); clipping leaves at least 128 transcript tokens. Output
reservations must be positive integers (remove old zero values for defaults),
while system reserve zero remains valid. Settings are restored when provider
ceilings rise or metadata disappears instead of retaining a stale low cap.

Core uses the resolved reserve with or without metadata. Every model request
also resolves its own profile's hard output ceiling, including auxiliary and
concurrent user calls. Capacity denial stops generation. Metadata lookup carries
the request cancellation signal into private hook APIs, including idle auxiliary
calls, and cancellation is checked before generation. Catalog 0.23 adds optional
profile to service.model.capabilities; the default resolver passes it to the
provider. The frozen baseline hash remains unchanged after explicitly checking
and removing only this additive optional field. Canonical API/capacity docs and
generated event/schema references are updated.

Live verification resumed the known ledger fixture through the actual app with
an injected budgeted gpt-6.1-sol provider exposing no capabilities method. All
three main requests carried maxOutputTokens 2048; the auxiliary summary used
1024. No project source/check/contract/export/NOTES files changed. Independent
review correlated a successful node checks.mjs call/result and reran the check
under a minimal environment. Evidence: dist/output-capacity-20261111/{live.ts,
trajectory.jsonl,review.json,independent-review.json}. This is one known review,
not broad model-family or sustained development evidence. The cumulative guard
bound is $42.27555, 218 reported requests, zero pending. Standard/global pricing
estimate covers 52 new requests at $0.275471; 166 historical requests are still
explicitly unavailable. No charges were reset or authorization increased.

964 tests pass with three optional skips on Node 26 and actual Node 22.19.0
(coverage), typecheck and the 98-page docs check/build pass. All 28 native plugin
PR certifications pass; retained summary:
reports/certification/output-capacity-pr-summary.json. An earlier certification
overlapped the cancellation fix and correctly rejected changed inputs; the final
run used an unchanged source snapshot. Previous main 0f5c2c0 CI, documentation
and plugin preparation all completed successfully. Broader self-hosted tasks,
model families and native release/platform evidence remain open 1.0 work.

## Automatic compaction failures and recovery — 2026-11-11

An initial live ledger migration in a configured 16384-token window finished
without compaction because the model read samples selectively. This did not
establish automatic-pressure readiness. Its injected provider remained the
budget-bound gpt-6.1-sol, but the fixture omitted AGENT_MODEL and its audit labels
incorrectly showed the application's default Gemma name. Do not count this as
Gemma evidence. The later fixture explicitly supplies the actual model label.

A deterministic negative control exposed a real first-batch failure: one large
tool result occupied the mandatory recent tail, leaving only a single user
message to summarize. No summary was attempted and execution stopped. The
compactor now optionally bounds the retained tail by tokens and preserves the
latest user request verbatim outside the folded middle. Core enables both: an
oversized newest tool group is folded whole, without orphaned results or effect
re-execution. External compactTranscript callers keep old selection when the
new maxTailTokens/preserveLastUser options are omitted. Failure still retains
the original transcript. The negative control now reaches the next model step
with exactly one original effect and one successful summary.

The first 8192-token live pressure run then genuinely failed: tiny character
segments generated verbose intermediate summaries, and their merge did not
shrink. Preserve this failure in dist/automatic-context-small-20261111/result.json
and trajectory.jsonl. Summary segment packing now uses the same Unicode-aware
token heuristic as pressure, reserves instruction room and never splits a code
point. Segment/merge prompts specify concise size targets and omit raw file
contents/repetitive records. Existing segment/merge limits and fail-closed
non-shrink behavior remain. Tests verify ASCII packing, Unicode bounds and
failure retention; the old character-count assertion was replaced by the actual
estimated-token bound it is meant to establish.

Resumed that exact saved ledger session through the revised source composition.
It passed three automatic compactions (3197→1230, 4035→1515, 2737→1786 estimated
transcript tokens), kept the latest request verbatim and retained valid tool
groups. The agent ran the approved check. Independent grading reran it and a
separate 100-seed balance/deduplication grid, global first-ID behavior, validation
of invalid duplicates, sorting, input freezing/nonmutation, original comment and
frozen package/export/contract/check/NOTES hashes. Review passes. Artifacts:
dist/automatic-context-small-20261111/{resumed.jsonl,resumed-result.json,
resume-requests.jsonl,grade.py,review.json,candidate-aggregate.mjs}. Preparation,
workers and original failure remain alongside them. This was a bounded known
fixture and recovery after a code change, not an unbiased before/after comparison
or a multi-hour/native-binary/million-token session.

A separate controlled live API truncation probe capped only the first auxiliary
request at 32 output tokens. The actual API returned length; the same segment
hash retried with the normal 2048-token allowance and returned stop. The partial
output was discarded and key task facts remained. This is explicit fault
injection, not a naturally occurring long-session truncation. Evidence:
dist/automatic-context-small-20261111/truncation-review.json and its probe source.

954 package tests pass with three optional skips on Node 26 and actual Node
22.19.0 (including coverage), typecheck and docs check/build pass. All 28 native
plugins passed PR certification for workspace
576080f6e87da354d37b69c9860ebf4fba5c902a26d79849930dd92de9a37b82;
retained summary: reports/certification/context-compaction-pr-summary.json.
The final cumulative guard bound is $41.9484, with 214 reported requests and no
pending reservations. The Standard/global estimate covers 48 new requests at
$0.255444; 166 historical requests remain explicitly unavailable. The original
$50 authorization and all old charges remain unchanged.

Follow-up found while recording requests: injected providers without capacity
metadata can leave main-request maxOutputTokens unset despite explicit context
reserveOutput settings. Verify/fix that configuration path next. Broader actual
repositories, sustained sessions, model families and release/platform gates remain
open; the 1.0 goal is not complete.

## Cache estimates and first fresh-process recovery — 2026-11-11

The user reports roughly $2 actual account spend for the earlier evaluations;
this is user-provided billing evidence, not an independently queried invoice.
The old $38.66391 was a conservative admission bound with $30/M input and $60/M
output, not actual spend. Keep the authorized total at $50 and retain every old
charge/reservation. No reset, credit or extra allowance was authorized.

The evaluator now stores cache read/write counts on new reported charges and
exposes a separate standardPriceEstimate with its dated Standard/global policy,
covered and unavailable request counts. Official GPT-6.1 Sol model/caching docs
were fetched on 2026-11-11: $2/M ordinary input, $0.10/M cached input, $2.50/M
cache writes, $10/M output, with documented long-context multipliers. This
estimate does not reduce the conservative admission balance; old charges lack
cache details and are not retroactively repriced. Provider integration tests
check actual cache fields; invalid/overlapping counts retain reservations.
Tests/typecheck and documentation checks/build pass (950 tests, three optional
skips). No public plugin, UI, execution or event contracts changed in this step.

Ran a real saved-profile development task through buildApp/core in two separate
Bun processes. The small checkout fixture had a discount bug and required a new
post-discount fee argument with finite/nonnegative validation. The first worker
exited 130 immediately after a successful edit's tool.result had been persisted,
before turn completion. A fresh process opened the exact same session/project,
explicitly requested real-model compaction, re-read current files and completed
the second implementation file and both project checks. This uses the actual
application composition/tool/session path, not the native CLI binary or a
multi-hour autonomous session. Compaction was requested explicitly, not induced
by natural context pressure or a truncated summary.

Independent grading reran both frozen checks and a separate parameter-grid/API/
invalid-fee probe, checked frozen package/check/NOTES hashes and the pre-existing
subtotal comment, and verified exactly one successful math mutation across both
trajectories. The same session ID and context.compacted event are retained.
Evidence: dist/resume-development-20261111/{context.json,prepare.py,worker.ts,
interrupt.jsonl,checkpoint.json,resume.jsonl,resume-result.json,grade.py,
review.json,candidate-math.mjs,candidate-checkout.mjs}. The report passes.

Ten new reported requests, no pending reservations. The cumulative conservative
bound is now $39.25365 (176 reported requests); the separate Standard/global
estimate covers only these ten calls at $0.03443, with 166 historical requests
explicitly unavailable. This is not an invoice or an estimate of total account
spend. Automatic pressure, truncated-summary retry on a live model, broader
repositories/model families and multi-hour recovery remain open 1.0 gates.

Observed prior main 8d5b164 CI: documentation and plugin preparation succeeded,
but Node 22.19.0 timed out in the queued-background-wake/unload test; Node 26
passed. That test used sleep 0.1 to assume the human turn started first. It now
holds the real background process on an explicit fixture signal, starts and
verifies the held user request, then releases the process and waits for the
specific automated-completion queue event before unloading its owner. The
production runtime, test timeout and permission policy are unchanged.

The final full coverage suites pass all 950 tests with three optional skips on
both actual Node 22.19.0 and Node 26. Node 22 was downloaded from its pinned
official release and SHA256-verified under dist/runtime-node22 after the npm
executor unexpectedly resolved Node 26. Separate coverage directories preserve
each run; the first overlapping coverage attempt correctly refused a shared
report-directory lock. Logs: /tmp/compositor-node22-actual-ci.log and
/tmp/compositor-node26-ci-check.log. Typecheck and the 98-page documentation
check/build pass. No additional paid requests followed the recovery episode.

## Explicit UI command routing — 2026-11-11

Native command declarations accept optional ui:{site:'main'}. buildApp qualifies
the local site with the loaded plugin owner; AppUI dispatches the complete
trimmed command as ui.press {site:'plugin-OWNER-SITE',key:'command:/name args'}.
This reuses the existing independent UI interaction lifetime and permission
chain. No prompt hooks, model request/context or queue entry are involved.
Undeclared commands retain their ordinary queued prompt behavior. Do not route
conversation/model commands this way. Keep prompt handlers for older hosts and
the line-based interface; update both handlers when authoring new behavior.

Git review, cost/usage, Todos, MCP, Workflows and Proxy now declare and implement
UI command routes. Generic command/panel plugin_dev starters emit both handlers,
with installed authoring guidance and canonical contracts updated. Site IDs are
bounded local identifiers, not arbitrary paths or owner selections. Errors are
visible; literal quoted/shell-looking arguments stay text.

Verification: 947 tests passed with three optional skips, typecheck and the
98-page documentation check/build passed. Generic synthetic-plugin integration
checks literal argument delivery, visible hook failure and legacy queued
commands; bundled-panel checks hold a scripted model active while opening all
five additional panels. Generated command/panel starters also execute their UI
handlers while a real core's scripted provider is held active. Existing Git
integration verifies opening/reopening the initially absent panel, tool usage
and queued-prompt/model-context preservation. The real Git PTY scenario passed
under dist/git-open-concurrent-second, including command opening during model
work, subprocess cancellation, draft/narrow behavior and settings restart.
Inspected active-open and cancelled-process screenshots. The failed first PTY
run clicked using stale geometry immediately after resize; the scenario now
waits for the wide frame before coordinate-dependent input.

Previous main d2fc961 CI, documentation and plugin release preparation all
completed successfully. No paid model requests were made; the conservative
$38.66391 ledger and total $50 allowance are unchanged. Broader model/session
and four-platform release readiness remain open.

The additional panel PTY checks passed for Usage, Todos, MCP, Workflows and
Proxy, retaining narrow/draft/restart evidence under dist/ui-command-visual-*.
The initial MCP run exposed its default one-second ui.press budget expiring
during a human approval wait. It now explicitly allows five minutes. The
scenario focuses the input dock with Alt+i before answering: a Y key in the
focused MCP panel must not approve a tool. This is intentional focus isolation,
not evidence of a late-focus race. A 1.2-second delayed-approval regression
passes; removing the explicit timeout reproduces expiration before the answer.
The final suite passes 948 tests with three optional skips and typecheck;
documentation checks/build pass. Inspected MCP error recovery, narrow Workflows
and restored Proxy screenshots. Source UI routing commit: bf19d5f.
MCP approval lifetime fix: f57620a. All 28 native packages passed final PR
certification for workspace
35246df072ebed3a5b9c78a0865f4af441c096f1b83e8e07ba79086d9a4dfacd;
retained summary: reports/certification/ui-command-pr-summary.json. Git review
also passed Linux x64 release/build/installed-artifact certification after that
fix. Archive SHA256:
3de08daeb3119d7b2ed634af8b70c0fadb4a56ad06c0964024bc0db838e2b34f.
Inspected the installed archive opening its panel while the agent was working.
These are source/local artifacts, not a published host/plugin release. Next
priority is real resumed development and context pressure, retaining the failed
earlier authoring trajectories and remaining spending allowance.

## Guarded concurrent user tools — 2026-11-11

The source now routes $.agent.tool through invokeUserTool. Calls during an
active model turn get separate AsyncLocalStorage operation state, cancellation,
tool snapshots, records and usage counters while retaining the existing tool
rewrite, allowlist, permission, approval and execution chain. Four concurrent
operations and five-minute lifetimes bound admission; session costs remain
shared. This is accounting, not future-token reservation across overlapping
model requests. Conversation replacement/compaction from an operation is denied.
Reload waits for operations; owner unload and core close cancel/drain them.
Journal errors stop both lanes. Catalog 0.22 adds tool.operation and optional
operationId audit correlation; replay and eval verification exclude UI tool
groups from model work. Idle interactive calls retain their existing behavior.

The TUI correlates tool cards by callId, avoiding same-name interleaving errors.
Ctrl+C in a focused plugin cancels its operations; Alt+i returns to agent input.
Git review offers Cancel review, disables duplicate actions while active and
cancels on Close without reopening the pane after completion. Ordinary plugin
slash commands still queue behind the model: opening a new panel during a turn
remains an explicit workflow gap, not a completed 1.0 criterion.

Verification: 943 tests passed with three optional skips, typecheck and the
98-page docs check/build passed. Thirteen core cases include real file writes,
denials/workspace boundaries, approvals, shared costs, isolation, replay, unload
and journal failure. Three app cases cover actual Git, real subprocess Ctrl+C
cleanup and same-name card ordering. Real PTY evidence under
dist/git-review-concurrent-second verifies fresh Git output while a scripted
agent is held active, cancellation with the process PID gone, continued model
activity, narrow terminals and settings restart. Inspected running/cancelled
screenshots. An initial failed scenario clicked a stale composer coordinate
after resize; using the actual Alt+i focus shortcut fixed the harness input.
The frozen-schema check explicitly verifies optional additive fields in both
input and tool.call next responses; the original hashes remain unchanged.

No paid model calls were made; the conservative $38.66391 ledger is unchanged.
Source commit: 2d4bedd. All 28 native plugins passed PR certification for workspace
96fd44e8b7e1be517c47b232a24b381cdfb013d7a2c7cd6b189506048b1c3206;
the retained summary is reports/certification/concurrent-tools-pr-summary.json.
Git review release/build/installed-artifact certification passed on Linux x64;
the archive SHA256 is
e3cff1e756e15032b46f3b409144b6a322e4b9722ea20b2c74d878c9556f19a1.
Inspected installed-artifact cancellation and restored-settings screenshots.
An earlier PR certification overlapped test edits and correctly rejected changed
inputs; the final run used one unchanged snapshot. No archive/tag was published.
All broader readiness gates, live resumed development and remaining platform
release checks remain open. Previous main 3b8dc6d CI, documentation and plugin
release preparation all completed successfully.

## Active 1.0 objective and live evaluation setup — 2026-11-11

The user now explicitly requests a stable, extensible, model-independent agent
capable of replacing their normal coding-agent workflow and developing itself.
The historical deferred feature discussion is not the acceptance criterion;
[docs/readiness.md](docs/readiness.md) records the full current gates. The 1.0
objective is not achieved by the small suites or existing release checks.

The user explicitly expanded the goal to implementing missing plugins for
practical development and improving UI usability, using Compositor for that
development as well. This includes the complete plugin lifecycle and concurrent
tools/settings/catalog access during agent work. Prioritize blockers and observed
friction, retain the public extension model and verify actual terminal workflows
through the tui-visual-check skill and independent review. The concrete scope is
recorded in docs/readiness.md; the existing $50 live-model allowance is unchanged.

The requested setup-first step is complete: private global profile openai-eval
uses gpt-6.1-sol through official OpenAI Responses, with a saved credential
(mode 0600) and configured 1,050,000-token model context. Authentication/model
availability and a real read-tool episode passed. Do not print, commit or copy
the key into execution workspaces. The user authorized at most $50 total for
these tests. Run paid evals through --profile openai-eval --max-usd 50; the
persistent private eval-budgets/openai-eval.json ledger retains reservations
across output directories and turns. Do not reset it to reuse the allowance.
Its conservative accounting total after plugin authoring is $38.66391, with 166
reported requests and no pending reservations. This is an upper accounting
bound, not the actual OpenAI invoice. The priced adapter is intentionally bound
to this model; other model pricing/protocol evidence is still required.

Strengthened eval grading: exact preservation where the task freezes fixtures;
independent original project checks where new regression tests are allowed;
call/result-correlated verification commands and independent behavior probes.
Graders use project cwd/minimal environment, and an intercepting shell service
clears inherited host values. A regression reproduced the old shell HOME/env
inheritance before the fix. These are environment controls, not OS containment.
All eval TypeScript is now covered by the standard typecheck command.

Initial live 1/2 included an unfair scorer failure: the greeting task allowed
new tests but was incorrectly byte-frozen. That criterion was corrected, not
reported as a model defect. A later 3/4 diagnostic run had a real verification
denial when npm test was chained with another unapproved command. Generic exec
usage now explains exact-grant/compound-command behavior without changing
permissions. Callix reports actionable text-tool fallback when its native
backend has no supported semantic sources, rather than encouraging repeated
status/refresh calls. No plugin versions were hand-bumped.

Final native OpenAI development run: 4/4 episodes (two tasks, two repetitions)
in dist/evals-openai-agent-complete/report.json. These are small, known tasks,
not Claude Code parity or an unbiased model comparison. Earlier diagnostic
reports remain in dist/evals-openai-agent-baseline and
dist/evals-openai-agent-verified. The unchanged scripted suites pass 5/5 basic,
3/3 tools and 2/2 agent cases. All 882 tests pass with 3 optional skips;
typecheck and the 96-page documentation check/build pass. No 1.0 publication
or completion is claimed. Next work is broader self-hosted development,
long-session recovery and multi-agent/extension workflows against these gates.

## First self-hosted production fix — 2026-11-11

Ran the actual source CLI entry point with the budgeted live openai-eval provider
in a detached worktree containing the current source snapshot. The task repaired
headless interruption reporting: interrupted runs previously returned success
and could reuse a historical assistant answer. An independently authored,
frozen regression failed 5/6 cases before the run. Compositor changed headless
output collection and interruption status, added ten further tests, updated the
canonical guide and ran its checks. Tool/file permissions restricted the task;
private credentials stayed in the parent provider, outside its execution home.

Reviewed and transferred the patch to the main working tree, verifying that the
frozen regression was unchanged and tracked edits stayed within the allowed
source/documentation paths. Independent verification passed all 16 focused
tests, all 898 package tests (3 optional skips), typecheck and the 96-page docs
check/build. Artifacts are in dist/selfhost-headless: context.json, task.txt,
trajectory.jsonl, execution.json and candidate.patch. The detached baseline is
2d8ec43ee35c3dbb01f11f037ee3c30f2cc967d1. This demonstrates one bounded real
repository fix through Compositor, not long-session recovery, native binary
verification, model independence or completion of the 1.0 gates. These source
changes are committed as 1af72fb, together with eval-discovered tool recovery
guidance, but are not released.


## Management access in short terminals — 2026-11-11

The baseline marketplace PTY scenario passed but did not finish answering its
pending question or exercise management with hidden toolbar controls. Expanded
coverage exposed inaccessible keyboard entry, focus not returning to existing
management panes, and a tall pending dialog starving the management content.
Alt+o opens Plugins; Alt+, opens Settings, also through custom editors. Explicit
management opens focus the existing pane on its workspace without relocating it.
When a pending question/approval leaves fewer than eight rows for content while
another pane is focused, the dock uses a six-row reminder. Alt+i or a first click
expands it without submitting an answer or granting permission. Settings forms
retain their own keyboard controls.

Verified 901 package tests (3 optional skips), typecheck, generators and the
96-page docs check/build. Real PTY marketplace flow passed in
dist/ui-management-narrow-confirm, including mouse expansion before answering
and draft preservation; broad visual regression passed in
dist/ui-management-broad-confirm. Inspected narrow management, completed-answer
and broad startup/approval screenshots. The failed initial browser launch used a
missing Playwright revision; selected the installed compatible Chromium instead.
dist/ui-shortcuts-before-compact retains the failing pre-fix PTY capture. No new
paid model requests were made. Native terminal and broad daily-use readiness
remain open; these changes do not close the 1.0 goal.
UI source, regression tests, PTY scenario and terminal controls are committed
locally as 489a757; no release was published. The earlier eval foundation is
committed as 49ae176 and the headless/tool recovery fixes as 1af72fb.

## Live plugin authoring and summary recovery — 2026-11-11

Three budgeted source-CLI attempts targeted a missing read-only Git review
command, model tool and interactive panel in an isolated source snapshot. They
are NOT passing autonomous authoring episodes: the first exceeded the paid
adapter's 200000-byte request bound after excessive source exploration; resume
spent 20 auxiliary summary calls before one reached its 2048-token output cap;
a short-context handoff created the remaining UI/tests but reached its step cap.
No live process or outstanding budget reservation remains. Keep these failures
visible; do not erase them or call a fresh handoff successful session recovery.

The original independent fixture accidentally omitted permission to enable its
test package, masking behavior behind a management denial. Corrected that grant
after retaining its original source and patch; production policy was unchanged.
The task's exec-service example also omitted the canonical required plugin field.
Reviewed corrections added that field, fixed the UI event site and a generated
test's host reference. Candidate behavior then passed 10 independent/additional/
lifecycle tests, the source typecheck and explicit strict plugin typecheck. A
real PTY check exercised actual status, distinct staged/working diffs, Close and
unsent draft preservation at 48x18; inspected wide diff and narrow status PNGs.
An initial narrow capture used a stale filename assertion; the corrected check
waits for the distinct branch/status result before capturing.

The reviewed candidate is committed only in its detached worktree at
/tmp/compositor-git-review-f15oigxo/repo, revision
ca6fb06c6128d1d4658a62129cdf9d4431df5030. It is not yet in the main plugin catalog.
First-party certification/test-plan integration, installed archives and platform
checks remain required. Artifacts: dist/selfhost-git-review,
dist/selfhost-git-review-resumed, dist/selfhost-git-review-handoff (authored files,
oracle correction, final patch/review.json) and dist/selfhost-git-review-ui.
The original model-authored candidate is preserved separately from corrections.

The host summarizer now retries only a length-truncated segment with doubled
output allowance, capped at 8192 tokens or a quarter of context capacity (at most
three attempts). Partial summaries are discarded; errors, missing completion and
cancellation do not retry. Seven deterministic tests cover recovery and bounds;
all 908 package tests pass with 3 optional skips, typecheck and docs checks pass.
This new recovery path still needs a real-model long-session rerun. The visual
bench has an isolated opt-in Git fixture for exact candidate verification.

Next work: integrate and certify the reviewed Git plugin through the normal
first-party path, then repeat realistic resumed development with the summary
fix. Preserve the remaining authorized live-model allowance; no budget increase
was requested or granted. Broader 1.0 gates remain open.

## Integrated Git review and owned SDK processes — 2026-11-11

Promoted the reviewed Git prototype into plugins/git-review with initial version
0.1.0 and a development catalog entry. Added on-demand tool guidance and a
Configure output form with validation, project/global scope, cancel, restart
persistence and effective-value reporting when a project overrides a global
setting. No existing plugin/catalog versions were hand-bumped. A dry run of
plugin:prepare derives the new package and catalog 1.0.3 through normal release
preparation; archives/tags have not been published.

Certification exposed a real SDK leak: service.exec.run ignored operation
cancellation and plugin unload; the tool's early cancellation race could return
while its process remained alive. New host-owned process groups stop descendants
on cancellation, timeout, unload and normal foreground exit, wait for closure,
and bound combined output to 1 MiB. ToolContext requests and hook API emissions
propagate operation signals through AsyncLocalStorage without altering frozen
event payloads. User UI actions retain their separate foreground-independent
lifetime. The Git tool now awaits service cleanup rather than racing it.
The original SDK failed four of the five initial negative-control checks;
the final suite has six real process tests and passes.

Commits: 627a9b4 (SDK fix) and afdc3cc (Git plugin/integration). All 926 tests pass
with 3 optional skips; typecheck, marketplace validation and the 98-page docs
check/build pass. All 28 native packages passed deterministic PR certification
against the exact source workspace; retained summary:
reports/certification/sdk-process-pr-summary.json. Git review also passed Linux
x64 release certification, bundle build and artifact certification, including
real PTY configuration save/cancel/restart, mouse/keyboard actions and 48x18
controls against the exact extracted archive. Inspected source and archive
settings/narrow screenshots. The archive is
dist/plugins/git-review/0.1.0/git-review-0.1.0-linux-x64.tar.gz, SHA256
d517619c8ebc63ac33e48d4e6b9024825096945b4b396f7dea18474500752192.

Remaining release checks: Linux arm64 and both macOS platforms, compatible native
host distribution, publication review/gates. The authoring attempts still failed
autonomously; independent completion and certification do not rewrite those
results. No new paid calls were made; the $38.66391 upper bound is unchanged.
Previous main 402d709 CI, docs and plugin preparation completed successfully.

Next runtime task: guarded UI tool calls currently use invokeTool, which rejects
while a model turn is running. Panel/configuration work stays available, but Git
operations report busy. Add a separate operation context with isolated abort,
policy, transcript/journal and completion state; do not reset the active turn's
abort controller, token counters or tool records, and do not bypass permission
checks. Resume/compaction live testing and all broader 1.0 gates remain open.

## Verified v0.6.1 publication — 2026-11-11

The user requested push and release of concurrent plugin management. Published
host v0.6.1 as latest from b28983d6da6a82c34ac3fe338f7885c474796da0:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.6.1
Release workflow 42957091632 passed quality, certification, all four Linux/macOS
x64/arm64 native build/installer smoke jobs and publication. Main CI,
documentation and plugin release preparation passed too. The generated plugin
release PR remains subject to its normal review; no plugin tags were published.

Verified non-draft/non-prerelease latest status, four platform archives,
install.sh and SHA256SUMS. All listed checksums match GitHub asset digests.
Downloaded the public Linux x64 archive and installer, checked their hashes,
and ran the extracted binary: compositor 0.6.1. Publication evidence is saved
under dist/release/v0.6.1-publication.json. All 855 local tests passed with three
optional skips; typecheck, documentation and local native smoke passed.
The unpublished v0.6.0 candidate stays immutable and is excluded from git-cliff
release boundaries so these feature/fix commits appear in the v0.6.1 notes.


## Native release journal regression — 2026-11-11

The requested host publication tagged v0.6.0, but native smoke gates correctly
blocked publication. Its external kernel/custom repository fixture clones
incoming events; Bun 1.4.4 rejects structuredClone of the live AbortSignal in
service.context.prepare. Node-based tests did not expose that runtime difference.
The core now creates a detached JSON snapshot before service.session.append,
matching SessionEvent's existing JSON contract across all backends. Live hooks
and execution keep their capability objects; serialization or storage failures
still latch the fail-closed journal state.

The Bun source probe reproduced the failure before the fix and succeeds after
it. A regression test checks detached JSON records while prompt preparation
retains a live signal. All 855 tests pass with 3 optional skips; typecheck and
a locally built native archive's full installer/kernel/custom-repository/resume
smoke passed. v0.6.0 remains an immutable unpublished candidate. git-cliff ignores
that tag so its changes remain in the v0.6.1 notes; the corrected v0.6.1 candidate passed
the complete native publication gates.


## Concurrent plugin management UI — 2026-11-11

The user reported that plugin install/enable/update and marketplace/configuration
workflows were unusable while an agent worked. The TUI now routes explicit
management commands and toolbar actions through a separate user lane. Plugins
opens the manager; catalog search, scoped inactive install, enable, update
checks, rollback/remove and Apply plugin changes are connected by action rows.
Placement remains on Alt+p, /placement and Arrange plugin windows. The manager
and marketplace reuse the management area when navigating; ordinary window
placement rules still apply. Existing model-facing tool turns retain their
permission, history and busy behavior.

Catalog 0.21 adds replaceable service.extension.control and
service.marketplace.control services, including guard denial and provider
selection. User ui.press/ui.change hooks retain hook budgets and plugin unload
cancellation independently of foreground cancellation. Questions and approvals
stay docked; other windows and settings forms remain interactive and do not
answer or cancel the agent's pending decision. New requests preserve pane focus.

The default manager saves installation/activation decisions while busy. File
updates, rollbacks and removals are deferred in memory until explicit application
at idle; closing the process discards those unapplied operations. /reload or
Apply queues reload behind the active turn and queued prompts. Loading, errors,
empty search and saved-selection messages explain the state. Managed package
files are not replaced under a running turn. These guarantees are for the TUI
user services, not concurrent arbitrary model tools or the plain REPL.

Verification: 854 tests passed with 3 optional skips; typecheck, event/reference
generation and the 95-page documentation check/build passed. New integration
coverage holds a real core provider while managing plugins, tests a real
1.0.0-to-1.1.0 deferred update/removal, guard denial, and management forms alongside
both approvals and questions. Real Ink/PTY browser scenarios marketplace,
settings and placement passed; inspected screenshots show catalog search and
settings beside an unanswered agent question. Evidence lives under
dist/visual-marketplace-flow-complete, dist/visual-settings-flow-complete and
dist/visual-placement-flow-final. No plugin or marketplace release versions were bumped.


## Journal failures and incomplete replay — 2026-11-11

The user authorized fixing the two reproduced harness-study observations.
Configured session journals must acknowledge writes with {value:true}; creation,
append, denial, hook/resolver faults and missing acknowledgements stop execution.
The core latches the storage failure, aborts outstanding work, discards queued
prompts and rejects further execution until the instance is reopened. Live
failure reporting remains possible without writing the broken journal, and
subscribers see success only after persistence. No journal remains an explicit
in-memory mode. This does not provide exactly-once external effects.

Replay inserts unknown-outcome interrupted results for missing calls in partial
tool batches and restored context before later messages. It preserves completed
results and never retries the effect. Full-suite verification exposed an existing
concurrent metadata-temp-file race previously hidden by best-effort writes;
SessionStore now serializes appends per session within one instance.
Canonical architecture, feature and extension guides describe these guarantees;
the dated research records its historical baseline and links to current behavior.
Verification passed 849 package tests (3 optional skips), typecheck, generation,
the 95-page documentation build and its executable example. Final focused
core/session verification passed 58 tests. Backend contracts changed; no terminal
layout/input/rendering implementation was changed.
No versions, commits or publication were changed.

## Agent harness source study — 2026-11-11

The user requested studying features and harness implementation across the open
CLI landscape, then asked to study the complete comparison in depth. The dated
source/test comparison is [docs/harness-research-2026-11.md](docs/harness-research-2026-11.md),
covering 18 systems and the separate session-manager layer with immutable source
links. External test contracts were inspected, not executed. This is research,
not authorization to implement the candidate design work or replace the engine.

Current Compositor already has replaceable turn/batch/context/journal services,
independent agents, checkpoints, background wake and workflow leases/budgets.
Two deterministic local API probes at 71397f88 reproduced narrower limits:
19 rejected journal appends still allowed one in-memory tool and turn completion
with no core failure; replay of prompt + tool.call without tool.result sent an
unmatched call to ScriptedProvider. No external API rejection is claimed. These
observations concern the default ordinary-session path, not stronger workflow
snapshots or a custom journal provider. Research evidence is under
dist/harness-research-2026-11; no runtime fix is included in this study.

Useful reference mechanisms: Pi separates completion-event order from persisted
tool-result order; Codex uses shared/exclusive tool admission; OpenHands declares
resource locks and preserves tool-batch atomicity in context views; DSH separates
durable events from validated message projections; Vibe validates machine
checkpoints; OpenCode records execution claims; Qwen journals dispatch-prefix
replay and gates budgets; Hermes scopes memory writes/recall away from forks;
OpenClaw tracks harness ownership and waits for cleanup settlement.

Documentation validation passed: event/reference generation, the 95-page docs
check/build and its executable example. The built research page contains the
expected title and 52 distinct pinned source links. No host/plugin versions,
runtime behavior, commits or publication were changed by this research task.

## Verified v0.5.1 publication — 2026-11-11

The user explicitly requested publication of the render fixes. Host v0.5.1 is
published as latest from tag commit 26fb7e38599ddb3bfa2858bd803f08fbba5934a9:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.5.1
Release run 42928439141 passed quality verification, all four Linux/macOS
x64/arm64 native build/installer smoke jobs, and publication. Main CI on
Node 22.19.0/26 and the documentation deployment also passed.

The public release has four archives, install.sh and SHA256SUMS. Verified latest,
non-draft/non-prerelease status, all archive digests against SHA256SUMS and GitHub
asset digests, and the downloaded installer/checksum file contents. Local compiled
v0.5.1 installer smoke passed before tagging. Publication evidence is retained at
dist/release/v0.5.1-publication.json. Coverage verification passed 840 tests with
3 optional skips and 88.24% line coverage. GitHub Pages serves the v0.5.1 CLI
reference and updated render architecture/bench instructions.

Plugin preparation was a no-op: no affected plugin runtime bundles, no release
metadata writes, development catalog remains 1.0.2. No independent plugin tags
were published. The rendering investigation below is now included in the host
release; benchmark observations retain their stated environment/terminal limits.

## Render latency, animation and VTE checks — 2026-11-11

The user reported whole-app stalls around animation/hover and identified GNOME
Terminal/VTE. AppUI previously drew both the assistant.text catalog precursor
and the rewritten delta, reparsing growing Markdown on every fragment. Text now
coalesces on a 16 ms timer; input/lifecycle draws remain immediate, turn completion
flushes pending text, and close cancels the timer. Ink incremental rendering is
enabled. Native composer images reserve their rectangle without portable RGBA
downsampling, and host-owned input bypasses the unused view cache key that used
to stringify full image payloads.

Added visual:performance to the existing real PTY/xterm.js bench: live source
animation, 1200 Markdown/Unicode fragments, keyboard echo, pointer/highlight
latency, erase counters, output volume, browser queue/long-task observations,
fixture CPU/event-loop measurements and eight seeded resize cell/style checks.
visual.frames remains an output-chunk counter, not FPS. Snapshot synchronization
requires complete borders and three stable browser frames; visible text access
now clips hidden xterm cells beyond the current viewport after shrinking.

Native GTK3/VTE replay of captured output/resizes exposed an existing ZWJ-width
mismatch that could scroll the whole layout and remove its header. Alternate
screen output now disables autowrap and restores it for external programs/exit.
Resize synchronization begins before Ink's out-of-band clear, preventing a blank
intermediate paint. Tests cover final streamed content and bounded redraws,
native image decoding avoidance, resize synchronization and wrap restoration.
VTE still shapes some ZWJ sequences as multiple glyphs: bounded output prevents
vertical damage but does not establish universal glyph-width/pixel parity.

Final sequential motion comparison: dist/render-baseline-final versus
dist/render-candidate-final. Streaming duration 28.53 s -> 3.99 s; PTY output
6,904,145 -> 721,004 bytes; whole-fixture CPU 32.79 -> 4.86 s. Hover-highlight p95
34.2 -> 18.2 ms. Streaming keyboard p95 62.4 -> 66.2 ms; do not claim typing
became faster. All eight terminal cell/style snapshots match. Resize blank paints
fell from two to zero in this run. Results are fixture/environment observations,
not guarantees for arbitrary projects/terminals. Performance runs must be serial.

The --vte profile models compact status without SIXEL/OSC 22 and checks real
hover painting. tools/visual/vte-replay.py optionally feeds the same raw trace to
an actual offscreen GTK3/VTE widget. Final trace/pixels/report are in
dist/render-vte-final, validated on VTE 0.84.1 (62x31, header/result/draft intact).
The local VTE build has no SIXEL; no live GNOME GPU/input/SIXEL claim is made.
Cold SIXEL encoding of the six bundled idle frames took 7..75 ms in a separate
microprobe; the graphics backend caches those frames. Custom large animations
and terminal-dependent Unicode width negotiation remain separate topics.

Final verification: 840 passing package tests, 3 optional skips, typecheck,
generation/docs build, broad real-PTY regression (dist/render-regression-final)
and source-image Ghost lifecycle (dist/render-mascot-final), with PNG inspection.
Changes are local and unpublished; no plugin/catalog versions were hand-bumped.

## Verified v0.5.0 publication — 2026-11-11

The user explicitly requested publication and release. Published host v0.5.0
from immutable tag commit 968b346aaab0f91ca29b4c0a6458a7292ebe4215:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.5.0
Release run 42913930683 passed its quality gate, all four native build/installer
smoke jobs (Linux/macOS x64/arm64), and publication. The non-draft release is
latest and contains four archives, install.sh and SHA256SUMS.

The first automatic plugin release preparation succeeded end to end. Reviewed
and merged PR #1 after CI on Node 22.19.0/26 and documentation checks passed.
Only generated release metadata/references changed; 27 plugin baselines are
recorded, workflows is 1.4.0, background-jobs is 0.1.0, Callix is 1.3.0 and the
development catalog is 1.0.2. A clean post-merge plugin:prepare returns no pending
plugins or writes. Host archives bundle these snapshots; independent plugin
release tags/archives were not published. GitHub required approval for the first
bot PR's workflows; these were approved after reviewing the generated diff.

Verification included 837 passing tests (3 optional skips), 87.42% line coverage,
all 27 deterministic plugin certificates, typecheck, documentation build, real
PTY checks and a local compiled installer smoke. GitHub Pages serves the updated
reasoning/workflow/background-job guides and the v0.5.0 CLI reference at
https://neko1313.github.io/agent-compositor/.

## Workflow completion and reasoning controls — 2026-11-11

New workflow_run runs default to completion:wake, with notify/none alternatives.
Each run retains its originating session context; retry/resume adopts the
requesting session and increments the delivery generation. Completion metadata
contains no worker output and uses the bounded service.agent.enqueue queue.
Interrupted foreground turns pause follow-ups while detached workflow stages
continue. Stopped work only notifies, paused work does not deliver, and loading
old journals never replays completion. Host shutdown drains cores and plugin
workers before closing state/network services. This extends the earlier optional
background-jobs work; workers still consume their normal model/token budgets.

Trusted hooks can acquire $.background() during a live invocation. Its services
and signal last for that plugin instance rather than a foreground turn; next()
is forbidden and unload revokes it. This is an explicit trusted SDK capability,
not isolation or a permission bypass.

The model selector and connection editor now expose profile reasoningEffort,
project/global persistence and Provider default reset. Reset is stored as null
to clear inherited legacy values; older saved profiles without the field retain
legacy inheritance. Changing effort preserves a manual model selection. Gemini
thinkingLevel is encoded uppercase; other provider fields keep their native
mapping. Offered protocol levels remain model-dependent, with official source
links in docs/state-and-network.md. Existing custom gateway levels stay visible.

Verification includes real PTY settings selection/restart/reset and workflow
parent wake (dist/visual-effort-final, dist/visual-workflow-completion), transport
fixtures, foreground interruption, per-run delivery, retries and SDK revocation.
Changes remain local and unpublished; plugin versions/changelogs are owned by
the automated release preparation workflow rather than hand-bumped here.

## Event-driven background jobs — 2026-11-11

The user requested long-lived background commands with completion subscriptions,
agent wake-up and continued foreground conversation without polling/model costs.
New optional background-jobs 0.1.0 observes the existing guarded
exec(background:true) path and exposes background_jobs list/status/subscribe/
unsubscribe. Default automatic mode is wake; mode:notify emits only a user
notification, autoSubscribe:false permits explicit subscriptions. Output and
cancellation remain separate guarded exec_output/exec_kill tools. No production
activation, publication or commit/push was performed.

Catalog 0.20 adds service.shell.jobs (metadata), shell.completed (OS close),
service.agent.enqueue (bounded owner/dedupe queue) and service.background.jobs
(optional plugin policy). Completion envelopes exclude stdout/stderr, command and
environment. Follow-ups have agent provenance, run after a busy turn, coalesce
nearby completions, pause after interruption and are revoked on owner unload.
Host lifetime checks use actual HooksHost registration, including dynamic SDK
plugins, rather than a stale composition snapshot. Normal permissions/budgets
apply; untrusted process output never becomes a user instruction.

Host shells now have per-core UUID identities instead of a global shell map,
16 concurrent jobs, bounded completed history and 512 KiB output tails per
stream. Background timeoutMs is enforced (default 120000, max 86400000). Failed
launches drain native close before rejecting. Clear/end/app close drain process
groups, workspace revocation kills affected commands, ephemeral subagents close
their shells, and app close cancels/drains an awakened provider stream. Successful
background admission no longer counts as an exec failure in harness recovery.

Plugin reload preserves version-1 session subscription records and reattaches
live jobs. Unknown/corrupt state is rebuilt from live host metadata without
replaying commands; restart cannot recover unowned OS children. Plugin removal
revokes subscriptions/queued wakes; host-owned commands continue until their own
cancel/timeout/session teardown. Single-shot headless runs do not become daemons.
Older v0.4.0 hosts lack these primitives, so installing this plugin alone there
is insufficient. The host update is part of this source change.

Initial integration caught a submit() microtask regression affecting immediate
Ctrl+C: reset waits are now conditional, preserving synchronous busy-state entry.
Clear reinitializes active plugins after teardown, preserving Callix warming;
host close also revokes dynamically registered plugin lifetimes.
Real PTY/browser verification exercises a cancelled busy turn, a background shell,
foreground chat, closed provider streams during waiting, one output-reading wake,
and an unchanged unsent draft. Evidence: dist/visual-background; the scripted
provider's six requests include interruption, launch, chat and result continuation,
not polling. A first bench attempt clicked before resize acknowledgement; the
scenario now waits for the actual resized footer. No product input relaxation or
timeout extension was used. External model reliability remains a separate claim.
Final package verification includes 825 passing tests (3 optional skips), typecheck,
the 94-page documentation build and the real PTY scenario at
dist/visual-background-final. The new-plugin release-plan regression preserves an
initial manifest byte-for-byte when its version stays unchanged, so formatting
alone cannot make the generated PR fail strict version checks. Expected missing
bootstrap manifests are read quietly. Final PR and installed-archive certificates
passed and match the current source identity; Linux x64 archive smoke passed.
This is local evidence, and no release has been published.

## Eager Callix warming and automatic plugin release preparation — 2026-11-11

The user requested proactive indexing for active Callix and automatic plugin
versions/changelogs. Callix now starts its owned primary-root warm immediately
on session.start/reload, precomputes navigation maps and shares analysis with
the first query without blocking startup. Debounce applies to later file edits.
session.end cancels/drains its watcher/build and retained queries. background:false
still disables warming. Tests cover startup before any query, sharing/cancellation
and the explicit lazy setting; source/archive behavior checks also exercise warm
startup without initiating analysis through a diagnostic query.

`.plugin-release.json` bootstraps at 0c0f975 and records each prepared source
baseline. `plugin:prepare` plans from committed history in a clean checkout;
`--write` applies metadata. The main-push `plugin-release-preparation` workflow
creates/refreshes automation/plugin-releases with SemVer, changelog entries,
relative catalog versions and generated references. fix/other runtime changes
select patch, feat selects minor and !/BREAKING CHANGE selects major; notes include
breaking migration bodies and commit links. Inputs include bundled workspace
code/manifests, selected lockfile dependencies, Monty's copied native variants and
distribution tooling. Docs/tests-only changes and unrelated docs dependencies do
not bump plugins. Higher pre-existing development versions survive migration.
Published archive entries stay pinned until certified catalog promotion.

Normal contribution CI reports pending preparation instead of requiring hand
bumps; generated release PRs use strict checks. Tag metadata validation rejects
unprepared runtime changes. Publication extracts only the selected changelog
entry and retains existing certification gates. Preparation itself does not tag
or publish. AGENTS.md, contribution docs and plugin-author's served standard guide
explain the new routine workflow.

GitHub's Actions PR-creation setting was enabled using the authorized gh account;
the API's combined can_approve_pull_request_reviews flag is true, while default
workflow permissions remain read. No automatic review/merge is implemented. The
preparation job explicitly dispatches CI/docs for its generated commit because
GITHUB_TOKEN-created PR events do not trigger those workflows. No PAT is stored.
No commit/push has deployed the new workflow yet.

An isolated full-repository snapshot prepared all 26 versions/catalog entries
successfully (the shared license-packaging fix affects every native artifact).
Strict checks and marketplace validation passed; after committing the generated
metadata, re-planning returned no changes and Callix tag validation passed. A
regression caught and fixed the initial catalog bump edge case when migration
followed an already raised development catalog version. Local tests also cover
breaking/patch/minor batches, archive pinning, dirty-checkout protection, actual
Bun input discovery without entrypoint execution, and release-note extraction.
Final verification passed 810 package tests (3 optional skips), 37 explicit
Callix checks, typecheck, docs generation/build, and Callix/plugin-author PR
certification. Callix's Linux x64 archive passed artifact certification and smoke.
The isolated generated release batch also passed the full docs check/build,
including commit summaries with MDX-sensitive braces, strict version checks,
catalog validation, a no-op repeat and tag-readiness checks. YAML/run-block shell
syntax was checked locally; the new workflow has not run on GitHub yet.

## Large Callix graph verification — 2026-11-11

The user authorized finding a large local project or cloning Superset to test
graph-size failures. The replan session recorded repeated `Callix graph exceeds
output limit` failures for status, symbols and a file-specific outline. Native
Callix produced a 69950821-byte graph (100610 nodes, 209723 relations) in 8.85s;
the adapter reproduced its 64 MiB failure in 8.65s. No replan source/configuration
was modified; diagnostics and isolated caches are under /tmp/compositor-replan-*.

The unreleased 1.3.0 now defaults to a 256 MiB native graph limit (the existing
maximum). Explicit lower limits remain honored for new builds. Overflow errors
distinguish full-graph bytes from model-facing maxTokens and suggest recovery.
Timeout/output limits no longer invalidate completed graph identities; concurrent
builds retain separate resource/deadline ownership. Earlier v3 disk-cache keys
remain readable. Disk validation avoids a second full stringify/parse of graphs.

On the same replan query, a cold outline returned 13 symbols in 10.2s, a warm
query in 65ms, and a fresh process read the disk cache in 352ms even with a 1 KiB
new-build limit. These are local observations, not general performance claims.
Tests cover a graph above 64 MiB, compact result budgets, resource-limit changes,
legacy disk caches and separate concurrent deadlines. The full suite passed 800
tests (3 optional skips), plus 36 explicit Callix checks, typecheck, documentation
build and PR/archive certification with archive smoke on Linux x64. Native
output, parsed graphs and adjacency maps still
need memory; graphs above 256 MiB require a narrower attached project or text
tools. This does not implement an unbounded/out-of-core graph database.

## Callix invocation and indexing reliability — 2026-11-11

The user reported that asking an agent to invoke Callix led to a long wait and
then no usable graph/tool. Their exact installed configuration and error were
not provided. A native probe on this checkout (632 discovered files) measured
about 7.9 seconds cold and 10 ms warm; these are one-machine observations.

Reproduced and fixed status triggering analysis, prose/log edits invalidating
semantic caches, and invalid direct service actions starting a native process.
Callix 1.3.0 adds readiness/error diagnostics without analysis, source/resolver
input fingerprints, one timeout across source-change retries, and immediate
recovery after the last consumer cancels. Last-consumer cancellation also drains
native process teardown before disposal completes. Attached roots use separate
disk-cache directories. Removing an attached root cancels its retained queries.

Enabled background mode now returns pending:true/complete:false after queryWaitMs
(default 10000, range 50..600000), while the owned build continues. Status shows
availability, selected executable, indexing attempts/time or the last failure.
glob/grep/read remain usable. Close/reload/disable cancels retained queries;
background:false retains synchronous bounded behavior. v3 fingerprints rebuild
older disk entries once. README/help explain code_query versus native callix
and action values such as read_symbol. No user activation or provider policy
was changed. Development catalog metadata is 1.0.1; the plugin is 1.3.0.

A real Gemma navigation/edit diagnostic used code_query successfully but first
invented a read_symbol tool and later exhausted its 80000-token task budget,
despite correct file effects and executed verification. It is a failed full task,
not evidence of general model reliability. The generic core now suggests an
available tool whose action enum exactly matches an unknown tool name; it does
not execute an alias, bypass policy or reveal excluded tools. A focused source
inspection task passed with actual code_query calls on Gemma and DeepSeek
(two requests each). Reports: dist/callix-reliability-live and
dist/callix-invocation-live. No general quality or speedup claim follows.

Artifact installation also exposed plugin archives copying notices from every
root dependency, including the documentation site, exceeding the installer's
directory inventory limit. Plugin builds now select notices from bundler inputs
and explicitly copied native packages; installer limits remain unchanged. A
regression verifies bundled notices survive and unrelated packages are excluded.

Local verification includes 797 package tests (3 optional skips), 33 explicit
native Callix checks, typecheck and documentation build. The package behavior
scenarios now assert non-indexing status, retained failure diagnostics and
pending-worker cleanup on the actual source/installed candidate. Independent
PR and archive certificates passed for the final Linux x64 candidate, along
with archive smoke. This is not four-platform publication certification. No commit, push
or release publication was requested for this fix.

## Docusaurus documentation and GitHub Pages — 2026-11-11

The user authorized building the documentation site and publishing it to GitHub
Pages, including repository configuration changes through the authenticated gh
CLI. Pages now uses Actions at https://neko1313.github.io/agent-compositor/;
the repository homepage points there. No native application release is implied.

The website workspace uses Docusaurus 3.10.2, its standard reading/navigation UI
and local full-text search. It publishes 92 pages from canonical docs, all 26
native plugin READMEs/changelogs, authoring references, the terminal manual and
the visual bench guide. website/.content and build are ignored projections;
edit links return to the original source. Navigation inventory and ownership
coverage live in tools/docs. The site describes main, with independent plugin
versions, rather than claiming immutable release snapshots.

New entry guides cover setup, the first plugin, architecture, contribution and
documentation maintenance. Generated committed references use real CLI help,
plugin manifests and package metadata. docs:check rejects stale output, missing
page/module coverage and broken links/anchors and executes the first-plugin
package through actual activation, unrelated-input handling, reload and disable.
An intentional wrong tutorial was rejected by the checker. docs:dev watches
canonical source directories; source-to-projection changes and restoration were
verified. AGENTS.md and the PR template require documentation impact review;
docs:impact routes diffs to relevant pages and is explicitly advisory.

The documentation workflow checks pushes/PRs and deploys main through the Pages
environment using OIDC. Existing application/plugin release gates remain separate.
GitHub branch protection was not changed: workflow execution alone does not make
it a required merge status. Runtime docs were corrected for model defaults,
layout persistence, context metadata, mouse support and historical milestones.

Docusaurus transitive Tinypool, serialize-javascript and SockJS UUID dependencies
have reviewed root overrides. Audit reports no moderate/high/critical entries;
five low entries remain from upstream deepmerge in the build-time SVGR chain
(docs/dependencies.md). Search uses hashed filenames: Docusaurus's local server
misredirects query-hashed JSON assets under a non-root base URL. Browser smoke
is docs:browser with an existing Chromium override; captures live under dist/.

Local typecheck and all 787 application tests passed (3 optional skips), along
with documentation checks/build and event generation. Publication status must
be verified from the documentation workflow and public URL after the commit.

## Verified v0.4.0 publication — 2026-11-10

The user authorized committing, pushing and publishing the host release after CI.
Feature commit da4c60a introduces explicit scoped activation, independent plugin
versions/catalog updates and mandatory certification. Release commit 74e76e9
sets the root/app/lockfile to 0.4.0 and documents the opt-in migration. Annotated
tag v0.4.0 points to 74e76e9c5ffe6e65c2c2b13b1b7afc43eb8eccda.

Main CI 42822150243 passed on Node 26 and 22.19.0. Release run 42822929225 passed
verification, native build/installer/model/Monty/Callix smoke on Linux x64/arm64
and macOS x64/arm64, then publication. GitHub reports v0.4.0 as latest, non-draft,
non-prerelease, published at 2026-11-10T13:22:18Z. Assets are the four native
archives, install.sh and SHA256SUMS. Published v0.3.0 assets/tags were not changed.

Before tagging, all 26 full source release certificates passed on the committed
candidate, including real PTY and live reference cases, and were reverified
against its source snapshot. Local Linux full distribution smoke passed; the
Harness2 Python 3.13 environment passed 46 tests. Source evidence is retained in
reports/certification/summary-release.json and host-v0.4.0.json.

This host release bundles the independently versioned plugin sources and offline
market. It does not publish separate plugin/* tags/releases or claim complete
four-platform standalone plugin archive certification. Those independent release
workflows retain their full gates and reference-service configuration requirement.
Fresh plugin activation is explicit; enable mascot or plugin-author in the desired
scope and reload when needed. Existing explicit user/project selections persist.

## Plugin coverage completion — 2026-11-10

The user asked to close the blocking gaps from the initial certification rollout.
This supersedes the initial 25-plugin/329-gap inventory below. All 26 native
packages now bind and pass their complete deterministic PR matrix and Linux x64
extracted-archive matrix. There are no deterministic adoption waivers.

Added tools/plugins/behavior requirement-specific oracles for actual SDK-loaded
modules, filesystem state, genuine legacy layouts, project isolation, HTTP and
CONNECT faults, stdio MCP, native Monty workers, controlled Callix processes,
workflow selection/routing/budgets, private forms and plugin authoring. Composite
cases repeat all component assertions on the managed installed package after
reload, fresh process, a synthetic contract-preserving update, rollback and
re-enablement. Synthetic updates are not historical compatibility evidence.
Archive scenarios verify embedded identity and use the same public SDK linking
helper as the real installer. A separate extracted native Callix check parsed a
TypeScript function through code_query successfully.

Nine package-specific real PTY scenarios exercise source/archive identity, actual
terminal input/actions, narrow drafts, dismissal and restart, retaining PNG/ANSI/
input/report evidence. Six model profiles use the declared live Ollama reference
(gemma4:31b-cloud), three repetitions of seven task types each. All 126 cases pass;
graders inspect actual artifacts, activated generated commands, approval verdicts,
workflow results, plans and retained compaction goals. Thirteen negative controls
reject wrong, unsafe, fabricated or incomplete outputs. Calls and tokens are
bounded; provider usage is recorded and unavailable monetary billing is null.
Standalone live evaluation is diagnostic, never a publication certificate.

Coverage found and fixed observable failures: unawaited notifications, lost
turn-log retry prompts, malformed export input, invalid MCP configurations and
hidden operation errors, cross-project checkpoint storage and cancelled restore
writes, hanging CONNECT shutdown, and default one-second model command deadlines.
Compaction now preserves its transcript AND reports summarizer/non-reduction
failure; session commands consume denied/failed controls so the model cannot
falsely claim success. Plugin authoring checks entry syntax without importing code
in Bun and guides complete-file edits and behavior verification. Changed plugins
have independent patch versions, changelogs and matching development catalog
entries. Coverage output now lives in reports/coverage so it cannot erase existing
certification evidence during a concurrent run.

Validation: 787 TypeScript tests passed, 3 optional skips; 86.7% line coverage.
Typechecks, generated contracts/schemas, marketplace metadata, independent version
checks, workflow YAML and the scripted 5-case/3-case/proxy evals passed. All 52
PR/archive certificates were reverified against the current inputs and exact
archive checksums. All nine required UI profiles passed; inspected the relevant
normal/narrow/private-form/restarted screenshots. Failed diagnostic captures and
superseded source identities are not publication evidence.

Current evidence: reports/certification/adoption-readiness.json and
verified-local.json, summary-pr.json, summary-artifact-local.json, per-package
artifact/linux-x64/pty, and dist/plugin-live-verified-<name>. The source release
gate still rejects uncommitted inputs; other three archive platforms and remote
CI were not executed. Model-dependent release CI requires repository variable
PLUGIN_LIVE_OLLAMA_URL and optionally secret PLUGIN_LIVE_OLLAMA_TOKEN; absence
blocks the release rather than replacing the model. No commit, push or release
was requested or performed in this follow-up.

## Initial fail-closed plugin certification — 2026-11-10

The user authorized implementing the blocking mechanism for current and future
plugins. V2 plans now declare component/trait profiles, platforms, preceding
release, individually bound cases, setup/oracles/forbidden effects and budgets.
The loader derives a union of mandatory requirements. Legacy v1 convenience
suites remain readable but cannot certify publication. Obvious omitted manifest
profiles are rejected; arbitrary trusted native logic still requires review.

Added tools/plugins/certification.ts, certify.ts, gate.ts and the scenario protocol.
Exact Vitest file/full-name results plus diagnostics reject skips, duplicates,
empty/unrelated runs, failures, retries and flaky passes. Scenario evidence binds
run ID, package, plan, host/tooling/fixture snapshot, platform and archive checksums.
Live cases must match predeclared provider/model/config/task digest, repeat count,
success floor and baseline; scripted models cannot satisfy them. Upgrade evidence
needs the actual previous tagged version and pinned artifact. A forgotten null
previousVersion cannot waive preceding tags. Release inputs must be committed.

The bounded runner limits time/output and terminates owned process groups on
failure/timeout, including descendants. Archive certification repeats component
and trait behavior against the installed candidate, rather than accepting a lone
install smoke. The archive embeds its build input identity and is checked before
execution. Publication/catalog generation reverify complete source and four-platform
archive certificates against the immutable plugin tag. Catalog promotion retains
hashed evidence; official archive validation rejects missing certification even
when an entry omits the native format marker. CI/host-release jobs automatically
run the mandatory deterministic matrix for every discovered native package.

All 26 native packages have v2 profiles and useful installed-package lifecycle
scenarios: inactive installation, enable, repeat, double reload, fresh process,
disable, re-enable and remove preserving independent settings. Their source
baseline scenarios pass. This does NOT mean all 26 are fully certified: only
notify-done currently satisfies the complete deterministic matrix; 25 are blocked
by 329 missing deterministic bindings. Real PTY/model/domain/migration coverage
must be implemented rather than relabeling broad convenience suites. The mandatory
CI step intentionally remains red while those requirements are absent. No
legacy adoption exemption or waiver silently grants readiness. The portable
Claude example is not an independently published native package.

A new command isolation probe found btw consuming /btw-unrelated. Fixed exact
command matching, added regression coverage and bumped its independent version
and development catalog entry to 1.2.0. notify-done now has real public-host
unrelated/repeat/dependency-failure recovery cases. Host update tests additionally
reject a tampered rollback backup while retaining the active version.

Validation: 761 TypeScript tests pass, 3 optional skips, 85.92% line coverage;
root and new plugin-tooling typechecks, schemas, marketplace metadata and workflow
YAML parsing pass. notify-done passes deterministic and Linux x64 archive matrices;
corrupt archives and uncommitted release inputs are rejected. Validator tests
exercise incomplete evidence, wrong content/platform/artifact, exact bindings,
model policy drift, preceding tags and catalog promotion with an older release.
Other platforms and live reference-model evaluations were not executed locally.
Reports: reports/certification/summary-pr.json, per-package readiness/certificates,
notify-done/artifact/linux-x64 and rejections/. No commit, push, release or remote
CI execution was requested or performed in this turn.

## Mandatory plugin testing model — 2026-11-10

The user correctly identified that the standard's test-plan format and green
commands do not define or enforce sufficient coverage. Audited the current
runner: unit/integration suites are self-declared, visual/evals optional, and
the shared per-plugin contract only exercises activation/unload. The previous
744/26 passing counts must not be described as complete plugin certification.

Added docs/plugin-testing.md as a proposed normative model, explicitly separating
host guarantees, actual plugin behavior and real model effectiveness. It defines
mandatory lifecycle cases, component/trait-derived obligations, objective case
oracles, negative controls for graders, source/artifact checks, previous-release
migration and live model evidence for model-dependent changes. Readiness has
passed/failed/missing/blocked/reviewed-not-applicable outcomes; missing required
evidence or skipped required cases cannot produce a green publication gate.

The model is not yet enforced by schemaVersion 1 or certification tooling.
Do not claim that all 26 packages satisfy it, fabricate mappings from existing
broad suites, or treat scripted model results as live quality evidence. Next
implementation should derive required matrices, bind individual executed cases,
audit actual coverage and gate release/catalog promotion on content-bound
certificates. This turn defines the model rather than silently implementing a
new testing framework before discussing its requirements.

## Plugin standard 1 and independent marketplace lifecycle — 2026-11-10

The user requested uniform plugin standards/testing, all plugins off by default,
a preconnected repository marketplace, scoped opt-in and independent plugin
versions/releases/updates. They explicitly chose independent versions and releases
in this monorepo rather than separate repositories. This authorizes the current
implementation; the earlier deferred marketplace discussion is resolved.

All filesystem packages now remain unimported until explicit user/project
activation (or an explicitly configured legacy capability selection). Kernel
loop/file tools, model/session/settings and management adapters remain available
for bootstrap. An exact enabledPlugins ceiling and disabledPlugins restrictions
remain binding. Project decisions override user decisions. Selection records bind
the actual source directory, persist across restart and do not silently fall back
to another copy when the chosen source disappears. User grants select shared code;
project-local overrides need explicit project consent. HOME workspaces keep new
project installations separate from user installations; legacy paths are retained.

The repository agent-compositor catalog ships offline. Bundled code is an inactive
cache: normal installed-app activation requires installing a scope-specific
snapshot first, preserving its version across core upgrades. Installed versions
outrank the cache. Official relative entries use matching self-contained bundled
snapshots; newer first-party versions require a published archive entry, avoiding
incomplete raw sources. Installed package versions remain unchanged on catalog
refresh. Local development folders can still be explicitly enabled for iteration.

Standard: docs/plugin-standard.md; JSON schemas under schema/plugin-*.json.
All 26 native first-party plugins declare compositor.standard=1/apiVersion=1,
independent SemVer, README/changelog and plugin.test.json. The initial migration
increments their own minor versions; catalog metadata starts at 1.0.0, and the
portable Claude example remains separate. QA plans reference existing meaningful
behavior suites and optional real PTY/eval checks. plugin:test runs a common
lifecycle contract, declared suites and scripted evals, emitting per-plugin JUnit;
zero executed tests is a failure. plugin:test:all runs all 26 packages. CI validates
schemas and rejects runtime/catalog changes without the appropriate version bump.
Positive test fixtures explicitly choose their packages; production has no
hidden auto-enable test mode. Harness2 fixtures now explicitly opt into their
requested plugin directories while respecting explicit capability restrictions.

Plugin releases use plugin/<name>/v<SemVer>, independently of host releases.
plugin-release.yml verifies, tests, builds and smokes four native artifacts, then
publishes that plugin without moving application latest. Dispatch builds only.
Development may run ahead of published catalog versions; unlisted new packages
can be tested/released before catalog promotion. Release CI emits a four-platform
marketplace-entry.json with archive URLs/checksums. plugin:catalog applies that
reviewed entry and increments catalog metadata; committing/pushing it is explicit.
Current first-party entries are still bundled/development snapshots pending their
first independent publication. No release or remote workflow was triggered here.

The installer supports pinned Git/local sources and SHA-256 platform archives.
Archive download/extraction is bounded (128 MiB compressed, 512 MiB decompressed,
120 seconds), accepts regular-file/directory ustar and rejects links, special
entries, duplicates and escapes before activation. Locks record version/source/
ref/commit or archive digest plus package content, including owned dependencies
and excluding provided host SDK links. Updates reject mutable same-version data,
modified installed contents, downgrades and incompatible metadata. Rollback checks
backup contents and preserves activation. Failed candidate/state commits retain
old code. Removing a package or catalog preserves independent user settings.

Marketplaces/extensions now render compact native text views, with mouse actions
for browsing/installing and management forms selecting user/project scope. They
report effective overrides, missing bound sources and reload requirements. Scope
is included in mutation permission descriptors. check-updates is read-only.
The real PTY marketplace scenario is npm run visual:marketplace.

Validation: 744 TypeScript tests pass (3 optional skips), 85.85% line coverage;
all 26 plugin-specific commands pass; Python 46 tests and scripted Harness2 12/12
pass. Typecheck, marketplace/schema/version checks, evals 5/5 + 3/3, proxy smoke,
Linux x64 app build and installed-release smoke pass. Individual Linux x64
plugin-author, todos, callix and monty archives build and pass the same secure
archive installer smoke (including real native dependencies). Source/binary PTY
checks cover inactive startup, default market, scope forms, installation without
activation, restart/disable and composite authoring; workflows PTY also passes.
Four-platform release jobs are configured, not locally verified on other targets.
Evidence: dist/standards-proof/report.json, dist/standards-market-final/,
dist/standards-author-final/, dist/standards-workflows-visual/,
dist/standards-harness2/ and reports/plugins/. Screenshots inspected.

This follow-up remains uncommitted/unreleased on top of pushed 45e47b2.
Published v0.3.0 is unchanged and does not include these new defaults/standards.

## Composite plugin packages — 2026-11-10

The user requested implementing the package model discussed after plugin-author:
one plugin can combine agent services/hooks, UI, tools, skills and MCP, and the
marketplace manages it as one installable unit. plugin_dev init now accepts a
distinct components array, retaining kind for a single component, including mcp.
Combined starters preserve service and prompt hooks together; pure skill/MCP
packages need no dummy JS entry. The composition guide is bundled on demand.

Native and Claude-compatible declarations now share the loader's stdio MCP
reader. It supports .mcp.json, inline/wrapped maps, config references and arrays,
validates before native import, expands PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT literally,
supports explicit cwd, and retains legacy owner-local IDs. Unsupported transports,
render-only MCP and cross-owner server ID collisions fail visibly. Config paths
are contained in the package; declarations do not launch processes. The ordinary
mcp/mcp_call gateway and permission policy still apply. The sample worker needs
Node or an explicitly configured runtime. Exact allowlists/selections are not
edited automatically; provider/controller selections still need restart.

Manifest resources retain additional runtime code/data in release bundles;
referenced MCP configs and standard skills/assets are also copied. Packaging
rejects escapes (including nested symlinks) and generated-entry collisions.
Marketplace install validates declarations before side effects; rejected updates
preserve the installed package. Reload disposes old MCP connections. Disabling
or removing the owner removes hooks/tools/skills/MCP contributions; independent
user settings survive. Removing a catalog retains installed extensions. MCP
dispose now also removes its exit listener to avoid accumulating listeners.

Validation: 681 tests pass, 3 optional skips, 85.89% line coverage; typecheck,
marketplace validation (27 entries), evals 5/5 and tool evals 3/3 pass. The Linux
x64 bundle and installed-release smoke pass, including composite scaffolding,
SDK tool, selected instructions, command, skill and real stdio MCP with an
explicit runtime under an empty PATH. Real PTY source/binary scenarios exercise
creation, write approval, reload, panel/command/skill/MCP, restart and owner
disable/re-enable. Screenshots inspected. Evidence:
dist/composite-source-lifecycle/, dist/composite-binary-lifecycle/ and
dist/composite-proof/report.json. This work is included in the authoring/composite
feature commit; it is unreleased and published v0.3.0 remains unchanged.

## Self-hosted plugin authoring — 2026-11-10

After v0.3.0 publication the user requested a plugin with a skill that lets users
write their own Compositor plugins inside the app. Added the ordinary replaceable
plugin-author plugin, /plugin request command, create-plugin skill and plugin_dev
tool. The host change is general: loaded disk plugins contribute skills/ entries,
with existing project/user sources retaining priority. Descriptions are refreshed
per turn, bodies load on demand, and reload/disable/removal updates discovery.
Virtual app-injected plugins without a disk root contribute no filesystem skills.
Selected service.agent.instructions replacements own their own index policy.

plugin_dev guide serves bundled contracts/patterns/testing and current canonical
event schemas, including from an installed distribution outside the workspace.
init creates non-overwriting local command/tool/panel/skill/service starters and
links public host SDK packages inside the new plugin. Paths use the attached
workspace resolver; cancellation/failure cleans up the newly created directory.
check validates metadata, entry containment and skill headers without importing
code. It explicitly does not prove syntax, imports or behavior. Tool permissions
still apply; no config allowlist/provider selection is changed or auto-activation
performed. User /reload between turns activates code; startup composition config
changes require restart. SDK links refer to the installation used at creation.

Release packaging now includes plugin-owned skills/resources. The marketplace
has 27 entries. Docs: docs/plugin-authoring.md and the bundled skill's references.
The real PTY scenario is npm run visual:author; source and binary variants check
skill/tool calls, an actual write approval, /reload, SDK-backed command execution
and process restart. Synchronize on the Ready status before reloading; visible
assistant final text alone does not mean the turn has finished.

Validation: 14 new integration cases, 650 total tests passed (3 optional skips),
85.47% line coverage; typecheck, marketplace validation, existing evals 5/5 and
3/3, Linux x64 build and installed-release smoke pass. The smoke now also checks
bundled skill/event schemas, scaffold/check and execution of an authored tool
with a public SDK import under an empty PATH. Reports:
dist/plugin-author-source-visual-final/report.json,
dist/plugin-author-binary-visual-final/report.json and dist/plugin-author-proof/.
One bounded Gemma live example generated a greeting command from a Russian
request, structurally checked it and left activation pending. After reviewing
its source, a fresh app executed it and emitted the requested notification with
zero model calls. This is one authoring example, not a general quality score.
Evidence: dist/plugin-author-live/generation.json and runtime.json.

This follow-up is included in the authoring/composite feature commit and remains
unreleased; published v0.3.0 predates plugin-author.
The earlier release remains at 0ce49d2; CI 42756249621 and release workflow
42756474129 succeeded, with four native bundles and verified publication/assets.

## v0.3.0 release preparation — 2026-11-10

The user authorized committing/pushing the accumulated workspace/web/Harness2
changes, checking remote CI, and publishing a release only after success.
Feature commit: 213f9a9. The next version is v0.3.0, reflecting new kernel,
workspace and web capabilities since v0.2.0. Root/app versions and lockfile must
match; CHANGELOG.md is generated with the pinned git-cliff. Follow
docs/releases.md: green CI on the exact release commit, then an annotated tag;
GitHub's release workflow verifies, builds/smokes four native bundles, and only
publishes after every gate. Remote run/publication status is authoritative on
GitHub, not inferred from local checks or this preparation note.

Local release-candidate checks pass: 636 TypeScript tests (3 optional skips),
44 Python tests, 12/12 scripted Harness2 cases, 5/5 basic evals and 3/3 tool
evals, proxy smoke, marketplace validation, typecheck, Linux x64 build and
installed-release smoke. Source and compiled real-PTY workspace/web/resume
scenarios pass; screenshots inspected. Re-generated schema/events.json to sync
catalog 0.19 before push. Local artifacts: dist/release-030-* and logs in
/tmp/release-030-*. Browser checks use an existing compatible Chromium via the
bench's executable override; no dependency or browser-version pins were changed.

## Harness² case suite — 2026-11-10

The user requested adding and improving cases through Harness². Added a real
upstream BenchmarkAdapter in tools/evals/harness2_bench.py, using the existing
CompositorSubstrate and upstream core.judge.judge_one. Optional Python 3.12/3.13
dependencies pin upstream commit 6868817518876de8fd170c6a8354daca273b6191;
package commands are eval:harness2 and test:harness2 (activate that environment).

The suite has 12 cases (5 train, 7 test): evidence, quoted home references,
multiple attached projects, search plus source/artifact, denied mutation, exact
file versus sibling scope, symlink escape, redirect boundary, denied attachment,
verified code fix, delegated grant boundary and untrusted page instructions.
Both splits were inspected during development; this is not an unseen benchmark.
The default scripted HTTP provider drives the actual CLI and loopback web tools;
live model runs are separate. Scripts/expectations/captures stay outside native
filesystem scope. Grade actual effects, correlated tool observations, no private
fixture leakage, request logs and budgets. Code artifacts also run independent
hidden Node checks. Canonical home/absolute spellings and write/edit alternatives
are accepted where appropriate. Failed/missing/duplicate/error final results and
timeouts fail; upstream judge exceptions remain ungraded and fail the runner.

New regression traces reproduced a core defect: native path preflight rejected
an out-of-scope path by terminating the entire turn without a tool result. Core
now reports a correlated denied result with normal no-bypass feedback, allowing
the model to report the boundary. Two assembly tests cover sibling and symlink
failures. Shared result recording keeps the normal and preflight paths aligned.

Rollouts use fresh temporary HOME/cwd, scrub host keys/proxies/preloads, bound
process execution and kill the group on deadline. Execution occurs outside the
report directory to avoid inherited parent-project config; only after exit are
artifacts archived under output/captures. Original roots remain in metadata for
canonical grading. Idempotent runs reject changed tasks/harness/model/runtime/
runner/configuration; manifests and fingerprints support trace inspection.
Trusted code and approved shell remain ordinary processes, not an OS sandbox.

Validation: 44 Python tests including protocol materialisation, false-positive
judging, deadline/launch failures, real two-process scope resume and hostile
report-parent configuration; 24/24 scripted episodes (two repetitions); 636
TypeScript tests passed, 3 optional checks skipped, 85.35% lines. Typecheck,
existing deterministic evals 5/5, Linux x64 build and release smoke pass. Final
suite evidence: dist/harness2-verified/report.json and
dist/harness2-tests/junit.xml. Live development runs before archive-layout
hardening passed Gemma 12/12 and DeepSeek 10/12; loopback web sources, one run per
case, not public search/model rankings. DeepSeek used a denied shell probe instead
of the symlink read and exceeded the delegated-case call bound; private fixtures
were not leaked. Reports: dist/harness2-current-{gemma,deepseek}/report.json.
No commit/push was requested for this follow-up.

## Harness test hardening — 2026-11-10

The user requested more tests. Added 44 cases: bounded HTTP streams and real
in-flight cancellation, redirect/error cleanup, search provider/key routing,
unsafe/malformed result links, CAPTCHA false positives, path alias revocation,
symlink retargeting, invalid saved scope, reference quoting/budgets/images,
queued input provenance, disabled references and delegated workspace commands.
New files: packages/app/test/web-network.test.ts, project-context.test.ts and
packages/tools/test/workspace.test.ts; assembly cases extend web-workspaces.test.ts.

The regression tests first reproduced four defects, now fixed:
- Inherited task hooks closed over the parent core and could run /workspace add
  against it. Grants require a matching requesting session as well as user origin.
- Relative saved paths could grant the process cwd on resume. Restore accepts
  canonical absolute-path records only; missing/malformed entries are skipped.
- Cancellation during attachment authorization returned stale content. Preparation
  rechecks cancellation across asynchronous boundaries and passes signals to reads.
- CAPTCHA in ordinary result text was mistaken for a human challenge. Detection
  now recognizes challenge container markup rather than matching arbitrary text.

Validation: 634 passed, 3 optional native checks skipped in 77 files; overall line
coverage 85.36%, all gates passed. Workspace lines 100%/branches 90%; reference
preparation lines 98.63%; web tool lines 97.22%. Typecheck, Linux x64 build and
installed-binary smoke passed. The compiled real PTY search/attachment/resume
scenario passes; screenshots inspected. Current evidence:
dist/harness-test-hardening-report/report.json and
dist/harness-test-hardening-binary/report.json. No commit/push or release
publication was performed for this follow-up.

## Harness internet and multiple projects — 2026-11-10

The user requested internet/search capability and simultaneous work across
projects using arbitrary file/directory references such as @~/proj. Implemented:

- Optional web plugin 1.1 defaults to keyless DuckDuckGo HTML search, preserves
  Brave-key/SearXNG selection and explicit provider errors, reports human
  challenges honestly, and returns bounded titles/URLs/snippets. web_fetch adds
  title and safe outgoing links; /web reports setup. The harness advertises actual
  web capability and source-citation guidance only when its tools are present.
- Shared WorkspaceAccess resolves ~/relative/absolute/parent paths, canonical
  symlinks, exact file grants and directory grants. @ references accept spaces
  and JSON escapes; @. lists the root. Suggestions browse a prefix without
  granting access. Tab completes; Enter submits a typed reference unless the
  user navigated to a suggestion. Scoped tool paths/cwd work across projects.
- /workspace list/add/remove, repeatable --add-dir, and workspacePaths config.
  Startup and dynamic grants are journaled as workspace.changed and restored
  on resume. Removing a directory removes nested grants; conversation content
  already read is not erased. Read denials apply to attachments, and mutation/
  shell/network policy remains binding. Tool response source directories are
  explicit; a file-only grant does not imply a whole-project navigation grant.
- Task agents inherit scope. submit carries a protected host origin through its
  queue; model-authored references and /workspace commands cannot add scope.
  Independent agents accept cwd at creation and can run concurrently in distinct
  attached projects. Relative parent grants are passed canonically instead of
  being reinterpreted under the child cwd; agent records retain projectCwd for
  restore and correct-repository worktree merges.
- Local filesystem enforcement applies to standard file tools/resolvers. A
  selected replacement resource tool retains its own path semantics and is not
  forced through the local filesystem resolver. Trusted JS is still in-process.

Catalog 0.19 adds workspace.changed and the reviewed optional cwd input on
service.agent.control. The frozen 0.17 baseline is unchanged; compatibility checks
explicitly validate/remove only this optional field before comparing old shapes.
Contracts/examples: docs/workspaces-and-web.md. This is server-text HTTP fetching,
not interactive browser automation; public HTML search can require a human check.

Validation: 590 tests passed, 3 optional native checks skipped in 74 files; line
coverage 85.25%, all gates passed. Typecheck/gen, 26-entry plugin catalog, scripted
5/5 and tools 3/3 evals, and proxy smoke passed. Actual public search returned
TypeScript documentation, and fetching its official page succeeded. Installed
Linux x64 smoke covers --add-dir, home paths and resumed scope without Node/Bun
on PATH. Source and compiled PTY scenarios cover completion, quotes, cross-project
read, loopback search/fetch and restart/resume at 60 columns; standard PTY also
passes. Final evidence: dist/harness-web-workspaces-report/report.json; live
probe: dist/harness-web-workspaces-report/live-web.json. Failed diagnostic
captures under earlier dist/visual-web-workspaces and dist/web-workspaces-binary
led to a history selection synchronization fix and HTTP-fixture tool-call name
lookup; they are not current passing evidence. No release was published.

## Accepted replacement boundary — 2026-11-10

After reviewing the concept audit, the user chose that every part except tiling
must be replaceable. The fixed tiling mechanism owns the window tree, geometry,
workspaces, focus routing and drag/resize. Decoration, all other UI (including
the composer, forms, questions and approvals), and agent behavior must have
replaceable implementations with public contracts. Styling alone is insufficient:
rendering, input, state transitions and lifecycle must be replaceable too.

This supersedes earlier permanent host-ownership decisions for the editor and
dialogs, including historical notes farther below. The kernel and private UI/
session repository changes below implement selected replacements. Concept and
contract documentation record the boundary, acceptance evidence and limits. The user subsequently authorized the generic kernel work
below and explicitly rejected implementing DevOps-specific integrations as the
answer to this requirement. Audit artifacts: dist/concept-audit/report.json
(run-specific evidence).

## Generic kernel customization — implemented 2026-11-10

The kernel is domain-independent; coding is an optional composition. No
Kubernetes/GitLab/domain integration plugins were added. Catalog 0.18 exposes
replaceable turn execution, tool-batch scheduling, effective tool definitions,
input preparation, context-pressure management/compaction and journal writes.
Public AgentTurnContext/AgentToolBatchContext preserve lifecycle, permission
checks, model accounting and invocation-scoped cancellation. Host usage totals
also cover replacement strategies; publish returns transformed assistant text.
SessionJournal is structural, and a concrete fallback model is optional.

Runtime next() now supports actual awaited downstream results and streaming
backpressure. Async hook deadlines race uncooperative promises; hooks cannot use
host effects after expiry or unload. Wrapper faults do not replay completed
continuations. Explicitly selected missing/failed providers raise errors rather
than silently choosing another backend. Registration/composition validation is
atomic; manifests support within-tier priority. Native modules can export owned
plugin.<name>:<event> definitions, removed with their hooks on unload. Render-only
and render-time public API mutation paths are guarded; agent clear/compact and
awaited auth status route through services. Legacy synchronous auth-status fields
retain the host snapshot. Trusted JS remains in-process, not an OS sandbox.

Assembly controls: enabledPlugins (before import, also applies to host
contributions), toolProviders (whole schema/handler replacement), agent.tools
(final allowlist), agent.builtinTools/controlTools, and projectContext,
fileReferences and skills switches. Neutral instructions are the harness default;
agent.instructionsPreset=coding selects the former coding instructions. Reload
retains the harness and custom event/tool composition. Standard /login uses the
replaceable auth service even when the built-in profile has no OAuth endpoint.
Tool-call rewrites now reach both permission evaluation and execution.

The subsequent private UI/session repository work below completes the editor,
dialog and history/storage seams left by this kernel change. Config changes use
existing reload/restart behavior.
Custom strategies own their algorithms and must honor supplied signals/limits;
synchronous JS cannot be forcibly preempted and started effects are not undone.

Validation: 559 tests passed, 3 optional native checks skipped, 70 files;
line coverage 84.2%, all coverage gates passed. Typecheck/gen, 26-entry catalog,
scripted evals 5/5 and tool evals 3/3, and proxy smoke passed. Linux x64 release
build/install smoke includes an external kernel extension with private event,
exact tools and resume, without a fallback-model request or Node/Bun on PATH.
The real PTY regression passed with inspected screenshots under
dist/core-customization-verified. The earlier dist/core-customization-final is a
failed diagnostic: the harness searched before the composer redraw settled.
Its locate helper now waits for the exact visible text; no assertion was removed.
Summary and logs: dist/core-customization-report/report.json. No release was
published and no public tag or release assets were modified.

## Private UI controllers and complete session repositories — 2026-11-10

The user explicitly authorized implementing the remaining editor/dialog and
history/storage replacement work. Trusted native modules can export named
`controllers` and `sessionRepository` factories without hooks. `ui.controllers`
selects owners independently for editor, approval, question, form, placement and
history; `sessionProvider` selects the complete conversation backend. Omission
keeps standard implementations through the same registry/router. Explicit missing
selections fail closed rather than silently using another implementation.

Public controller leases carry private data/state directly to the selected owner,
with rendering, input, snapshot, measurement, pointer and teardown contracts.
Editor snapshots survive reload even when dispose erases state. Async extension
input is serialized; abort races uncooperative handlers and rejects late results.
UI close/session switch disposes pending leases and settles/cancels dialogs.
Forms validate returned field types/values; approvals require an explicit boolean
and valid scope. Editor/form views bypass unrelated render hooks. Pure rendering
also rejects effects through retained APIs belonging to a different owner, and
rejects recursive invalidate calls. Reference renderer forwards F1–F12 and their
modifiers, preserving text/function-key/mouse order in coalesced terminal reads.
Fixed tiling geometry/focus/drag/resize remains in WindowManager.

SessionRepository is a complete structural interface, independent of SessionStore
and filesystem roots. Journaling, browsing/search, rename/archive/fork, interactive
resume, headless startup resume and independent-agent restoration share the
selected backend. Reload gates calls, drains operations before opening the next
repository, validates the core contribution, commits, then disposes the old
backend. Failed preparation keeps the previous repository. Cleanup errors after
commit are recorded on the router. General settings and agent-window metadata
still use their separate storage services; changing providers does not migrate
records. Custom private input handlers have no automatic hook deadline and must
honor their lifetime signal. Trusted JS remains in-process.

Contracts/configuration: [docs/ui-controllers.md](docs/ui-controllers.md). External
fixture is test-only under tools/visual/controller-plugin; no domain integration
plugins or production remote storage backend were added. `visual:controllers`
exercises replacement behavior and persistence across actual PTY restarts in
source and compiled modes. Earlier failed diagnostic directories under dist/
record transport and bench-synchronization fixes; use the final report paths
recorded by the current verification run. Validation: 577 passed, 3 optional
checks skipped in 73 files; line coverage 84.51%, all gates passed. Typecheck/gen,
26-entry plugin catalog, scripted evals 5/5, tool evals 3/3 and proxy smoke passed.
Linux x64 build/install smoke passed with the external repository. Source/binary
replacement and standard PTY reports all pass; screenshots inspected. Summary:
dist/ui-replacement-report/report.json. Current replacement captures:
dist/ui-replacement-source-final and dist/ui-replacement-binary-final; tiling
regression: dist/ui-replacement-standard-final. No release has been published.

## Implemented: auto approval review

The user requested automatic action approval based on risk assessments by a
small/inexpensive model. This is implemented as a replaceable plugin on top of
the shared permission chain, with a separately configured reviewer profile.
It defaults to off.

- Modes: manual and explicitly enabled `auto`.
- Assess the concrete tool and arguments: command, paths, network access, scope,
  reversibility, secret access, and effects on external systems.
- Reviewer output is structured: risk level, decision, and brief reason. Low-risk
  actions may be approved within policy; dangerous, ambiguous, or unknown actions
  go to the user.
- Explicit deny and sandbox restrictions remain binding. Errors, timeouts, and
  invalid reviewer output fall back to manual approval.
- Show decisions and reasons in the UI/log; provide thresholds, a review budget,
  and immediate auto disable. Treat commands and tool output as data, not as
  instructions to the reviewer.

Configuration: `.agent-compositor/auto.json`, command `/auto on|off|status`.
Full feature instructions: [docs/agent-features.md](docs/agent-features.md).

## Default plugin choices

The user selected Monty for isolated code execution and Callix
(https://github.com/Callix-Tools/callix) for repository analysis/navigation.
These are replaceable default plugins, not mandatory core dependencies.
Use Callix's native binary and JSON graph (`callix analyze`), without a Python
API/venv intermediary. The `callix` plugin provides `service.project.query`;
select alternatives through `serviceProviders`. Monty isolates Python code and
explicit host callbacks; it does not provide OS isolation for arbitrary shell
processes.

The original gap analysis below is a historical snapshot. The user subsequently
requested its implementation; compare it with current code before acting on it.

### Plan implementation status — 2026-11-09

The user explicitly requested all planned features. At this milestone, the code
was in the working tree without a commit/publication. The original analysis
below is historical: its list of missing features no longer describes the
current implementation.

Implemented:
- Shared model/tool contracts, model switching, and tools/hooks reload.
- Anthropic, Gemini, Responses, and OpenAI-compatible providers; retry, replay
  metadata, images, and truncated-stream detection before tool execution.
- AGENTS/CLAUDE/GEMINI instructions, skills, @files/@images, ignore rules,
  an editor, and history.
- Headless text/JSON/JSONL, JSON schema validation, and resume/fork/archive/rename UI.
- Once/session/project permissions and small-model auto review with audit/fallback.
- Native Callix binary/JSON graph and Monty Python/workflows with replay/cancel.
- MCP/workflow panels; MCP timeout, cancellation, cwd-aware connection caching,
  and process disposal on reload/close.
- Web fetch and Brave/SearXNG search with size limits and separate permissions.
- Checkpoints of available project files and conversation; code/conversation/both
  restore, protection against later edits, Before/After review, and per-file
  Keep/Revert controls.
- Install/update/enable/disable/remove extensions from a configured Git catalog;
  lockfile dependencies without scripts, previous-version backups, and disable
  before import.
- Keys in a private file, OAuth device flow/refresh for a configured client,
  profile selection, and logout. Private vendor CLI login protocols are not
  imitated.
- Usage for all model calls, cache, configured pricing, marked estimates when
  providers omit usage, token/step budgets, and configurable account quotas.
- Independent agents with separate sessions, panes, budgets, and Git worktrees;
  asynchronous messages/results, stop/queue cancellation, archive/merge, mouse
  recipient selection, and conversation/pane restoration after restart.
- Queued approval/question dialogs for multiple agents and waiting-dialog cancellation.

Configuration and limits are documented in docs/agent-features.md. External
search, quota, and OAuth integrations require the user's endpoints, keys, or
registered client. At this milestone, live cloud accounts were not tested without
credentials; HTTP fixtures and local processes were checked. Monty does not
isolate the host shell. Checkpoints cannot undo external side effects and are
bounded by project ignore/size rules. The real PTY/browser UI scenario stores its
results under dist/visual-verified.

## Agent features

Date: 2026-11-09. The user requested saving the comparison with Codex CLI,
Gemini CLI, and Claude Code for later discussion. This section records discussion
topics, not authorization to implement the roadmap immediately. Statements below
describe the original analysis, before the implementation status recorded above.

### Main finding

The project had a working agent loop and windowed TUI. Most gaps concerned tools,
integrations, and execution management. A promising distinction was a windowed
workspace for multiple independent agents and tools. At the time, multiple
conversation views shared one AgentCore: multiple windows did not yet mean
multiple agents.

### Already working at the time

- Streaming answers, file reading/editing, shell, and background processes.
- Interruption, task steering, and queued requests.
- Session resumption, context compaction, skills, and hooks.
- Todos with UI/persistence and local plugins with UI.
- Windowed TUI: workspaces, mouse focus, drag/resize, and plugin placement.

### Missing capabilities at the time

- An MCP client for server connections, tool discovery, and execution.
- Subagents with separate loops/contexts, lifecycle, result exchange, budgets,
  and worktree isolation. agent.offer/agent.spawn were declarations only.
- OS sandboxing for shell/files/network; permissions and guard plugins did not
  replace it.
- Dedicated glob/grep, symbol navigation, and LSP. Shell search was possible,
  but there was no dedicated code-navigation layer.
- Built-in web_search/web_fetch.
- Images, attachments, and multimodal provider messages.
- Full headless operation: one-shot prompts, JSON/JSONL, and exit codes.
- Built-in diff/review and an interactive change-selection workflow.
- Extension installation/updates, a catalog, and dependency management.

### Partially implemented at the time

- Providers: OpenAI-compatible Chat Completions only; no native Anthropic, Gemini,
  Responses API, account login, UI model selection, or complete provider recovery.
- Context: COMPOSITOR.md memory and a skill loader; no automatic
  AGENTS.md/CLAUDE.md/GEMINI.md loading, @files, or shared context exclusion policy.
- Sessions: resume was connected; fork/archive existed in storage, but lacked UI
  search, naming, selection, and branching.
- Rewind: the last saved state of one file; no turn-wide checkpoint with separate
  code/conversation restoration.
- Permissions: rules and one-off approval; session/project approval persistence
  was not complete as a user workflow.
- Context/usage: estimated tokens and compaction; no full cost, cache, or quota
  accounting.
- Input: slash suggestions existed; multiline editing, prompt history, an
  external editor, and attachments were missing.
- Plugin placement persisted, but the complete window tree and independent
  agent/task state did not.

### Architectural limits at the time

- Model-facing tools were fixed when AgentCore was created. Plugins needed a
  standard schema/handler registration mechanism.
- Main requests called provider.complete directly, so replacing
  service.model.complete did not cover the whole agent loop.
- Check the current implementation before acting: these findings describe the
  analysis date, not guaranteed future gaps.

### Proposed sequence (not yet approved at that point)

1. Extensible core: tool registration and a shared model-request path.
2. Repository work: project instructions, search, @files, input editor, diff.
3. MCP and providers: external tools, native adapters, model selection.
4. Reliable execution: sandbox, persistent approvals, checkpoints, headless JSON.
5. Multitasking: subagents, independent sessions, worktrees, and pane presentation.

### Comparison sources

- Codex CLI: https://learn.chatgpt.com/docs/codex/cli
- Claude Code extensions: https://code.claude.com/docs/en/features-overview
- Claude checkpoints: https://code.claude.com/docs/en/checkpointing
- Gemini subagents: https://geminicli.com/docs/core/subagents/
- Gemini sandbox: https://geminicli.com/docs/cli/sandbox/
- Gemini headless: https://geminicli.com/docs/cli/headless/
- Gemini extensions: https://geminicli.com/docs/extensions/

Competitor capabilities differ; this list does not claim complete parity.
Recheck official documentation before making a new comparison.

## Ghost mascot — replaceable default plugin

The user supplied 10 APNG animations and requested an interactive mascot reacting
to component hooks. `plugins/mascot` preserves the originals, decodes frames, and
subscribes to turn/tool/subagent, ui.reaction, and agent.activity events.
The core has no Ghost-specific logic: shared UiTextView.raster, ui.visibility,
and $.ui.remove allow replacement. Ink displays RGBA through colored half blocks;
native Kitty/Sixel support is unnecessary. Hidden/headless surfaces do not run
animation timers. Controls: `/mascot on|off|pause|resume|reload`, Pause/Resume,
and Pet Ghost. Configuration: `.agent-compositor/mascot.json`, replaceable
project-local APNG packs, and configurable tool/reaction mappings. Details:
plugins/mascot/README.md.

Mascot checks at that milestone: 336 tests passed, 1 optional Callix test skipped,
and typecheck passed. The real PTY/browser scenario captured 24 screenshots with
report.ok=true under dist/visual-mascot. It covered frame changes, Pet, pause,
a subagent question, manual approval, and existing window interactions. All 10
APNG files matched the user's archive byte for byte.

## Marketplace, home storage, proxy, and quality evals — 2026-11-09

Implemented in the working tree at this milestone, following the user's request:
- `.claude-plugin/marketplace.json`, Git/local marketplace registration, explicit
  updates/pinned commits, name@marketplace installation in user/project scope,
  and backups. Relative sources and GitHub/HTTPS Git source objects are supported.
  The repository has a 26-entry catalog and portable Markdown command example.
  Installed native plugins outside the monorepo resolve host API imports through
  host package bindings.
- Claude compatibility adapter: namespaced commands/skills, `$ARGUMENTS`/positional
  arguments, MCP maps, synchronous command hooks, matcher/stdin/timeout/cancel,
  and deny/ask. This is an explicit subset: agents/LSP/mods/async/prompt/http hooks
  and userConfig are not silently emulated; unsupported components cause loader
  errors. Native TS/Ink UI does not automatically become portable to Claude.
- Runtime data defaults to `~/.agent-compositor/projects/<name>-<canonical hash>`:
  sessions, agents/worktrees, Todos, workflows, checkpoints, UI preferences,
  memory, and plugin state/cache. Old project-local data receives a nondestructive,
  one-time migration. `AGENT_STORAGE_MODE=project` retains portable mode.
- `$.storage.config/get/set` and service.storage.* with global/project/session/cache
  scopes, atomic JSON writes, plugin namespaces, path/symlink confinement, and a
  render guard. Legacy relative $.fs .agent-compositor paths are remapped.
  Global/project/component configuration merges; independent agent roots inherit
  parent profiles/MCP/proxy while retaining separate runtime state and local
  overrides. `#global note` saves global memory; `# note` saves private project
  memory. COMPOSITOR.md is migrated without deletion.
- Replaceable network-proxy plugin: `/proxy status|on|off`, proxy.json, pre-request
  validation, native Node Undici and Bun fetch proxy routing, model streams,
  OAuth/quota/web, and shell/MCP proxy environment without changing global
  process.env. Invalid enabled routing blocks model requests. The real endpoint
  remains user-configured and routing defaults to off. OpenAI/Anthropic API keys
  were not supplied or requested at this milestone.
- Persistent/background Callix graph, cache fingerprint, source/Git/tool change
  hooks, debounce, and cleanup. Queries verify freshness. External edits and disk
  reuse after restart were checked with a real CLI subprocess; the native Callix
  adapter was also checked.
- Reproducible isolated eval fixtures/rubrics, repetition/split/baseline reports,
  and explicit live Ollama runs. Gemma4/DeepSeek model tags were preserved exactly.
  The DeepSeek cloud tag was installed in the existing Ollama instance; no local
  inference claim was made.
- Real Harness² Substrate and BenchSpec-compatible workspace_config
  materialisation, headless compositor trajectories, and process-group timeouts.
  The upstream deterministic demo and a Compositor/Gemma rollout were checked.
  These are not full JobBench/LAB/WorkBuddy results or measurements of recursive
  optimization gains with live models. Upstream commit:
  6868817518876de8fd170c6a8354daca273b6191; Python 3.13 isolated under /tmp.
- Vitest 5/coverage, JUnit/Cobertura, and deterministic eval/proxy/catalog CI steps.
  Node >=22.12. The vulnerable older Vitest/tinypool toolchain was removed; the
  pre-existing Zod 3 major migration was outside this change. Existing worktree
  edits were preserved. No commit/push/publication had been requested or performed
  at this milestone.

Usage and limits: docs/marketplace.md, docs/state-and-network.md, docs/evals.md.
Run evidence: dist/quality-report.json, dist/evals-ollama-final/report.json,
dist/harness2-smoke/report.json, dist/harness2-demo/demo.json, and
dist/visual-marketplace-storage/report.json. These are run-specific evidence,
not permanent quality guarantees. Keep shared catalogs free of machine-local
cache paths; Git project registrations retain pinned provenance and reconstruct
the cache in the user's home directory.

Final checks for this milestone: 355 passed and 1 optional Callix test skipped
(native Callix separately passed 5/5), across 45 test files. Coverage: lines 80.16%,
statements 76.45%, functions 76.06%, branches 66.02%; all gates passed. Typecheck
and diff checks passed. Live Ollama passed 10/10 (5 each for Gemma and DeepSeek).
The PTY/browser scenario captured 26 screenshots with ok=true. Machine-readable
report: dist/quality-report.json; interpretation and limits: docs/evals.md.
Changes were still uncommitted at the time of this recorded validation.

## Release distribution (2026-11-09)

Release tooling uses pinned git-cliff 2.14.2 with Conventional Commit groups in
cliff.toml. The first planned public tag is v0.1.0, matching the root and app
versions. GitHub Actions verifies quality, builds native Linux/macOS x64/arm64
archives, tests their installers against local model/release servers, then
publishes all assets from a draft. A branch dispatch only builds and verifies.

Distribution plugins and host API modules are external to the Bun executable;
user/project plugins take precedence. Keep the extracted directory together.
Monty retains its Node bridge requirement; Callix is a separate executable.
install.sh checks SHA-256, supports version/prefix selection, switches an active
symlink and preserves user state. README and docs/releases.md document usage.

Local checks: full suite 359 passed / 1 optional test skipped before the final
loader JS regression case; focused final changes passed 32/32, typecheck passed.
The Linux x64 archive passed checksum rejection, versioned/latest installation,
all default plugin loads, a mock provider turn, packaged Monty execution and
state preservation. Remote platform/publication results must be checked in CI.
Known pre-existing dependency issue: npm audit flags Zod 3 for
GHSA-mrhx-c7xc-m3w5; the Zod 4 migration is outstanding (docs/releases.md).

The v0.1.0 candidate tag was not published: Ubuntu 22.04 failed the packaged
Monty check because the upstream native module requires __isoc23_sscanf
(glibc 2.38+). All other platform archive checks passed. Keep that candidate tag
as history; publish the corrected distribution as v0.1.1, with Linux x64 on
Ubuntu 24.04 and an explicit glibc 2.38+ support floor. Two existing integration
tests also needed bounded 10-second waits and reliable cleanup under CI load;
the focused tests pass locally. No published tags were moved.

v0.1.1 was published successfully:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.1.1
Release workflow: https://github.com/Neko1313/agent-compositor/actions/runs/42553673828
All four native archive jobs, quality verification and publication passed.
The release quality suite passed 360 tests with 1 optional Callix test skipped.
Main CI also passed (run 42553665436).

The public Linux x64 asset was downloaded through install.sh with checksum
verification and installed under /tmp/compositor-live-v0.1.1. The installed
binary printed version 0.1.1 and loaded all 25 default plugins from a fresh
project with PATH=/nonexistent, confirming that starting the core does not
require Node.js or Bun. Executing the Monty bridge still requires Node.js.
The working tree was clean before recording these publication results.

## Ghost: full-resolution terminal graphics

Ghost now keeps the original 228x228 APNG frames and source timing instead of
sampling to 96x96. Protocol 0.6 negotiates optional `render.raster` with the
`Raster` capability; catalog 0.10 permits bounded 512x512 RGBA. The shared Ink
renderer probes Kitty graphics support, strips terminal replies from keyboard
input, transmits compressed/chunked pixels, caches frames and places them after
Ink commits. Window/workspace changes, editor suspension and exit clean up
placements. `AGENT_GRAPHICS=off|kitty|auto` controls selection. Auto falls back
inside tmux/screen; no passthrough, Sixel or iTerm2 backend is implemented.
Plugins continue to replace rasters through ui.render or supply their own views.

The supplied APNGs retain dark outline/eye RGB but incorrectly set its alpha to
zero; the supplied storyboard shows those details opaque. The mascot decoder
optionally repairs dark pixels within 12 source pixels of the opaque sprite.
It changes alpha only, preserving original RGB, poses and timing. Built-in
packs enable this repair; custom packs default off; `restoreInk: false` restores
exact source transparency. Original APNG assets remain unchanged. Repeated
activity events no longer postpone the animation timer indefinitely.

Validation: 369 tests passed and 1 optional Callix test skipped; coverage gates
passed (lines 80.32% in that run). Typecheck, generated docs and diff checks
passed. The complete PTY scenario passed both native-protocol emulation and
portable fallback (26 captures each). The compiled Linux distribution passed
installer/model/Monty smoke and the focused native-graphics lifecycle scenario:
source-size animation, pause, fullscreen, mouse drag to workspace 2, hidden
placement cleanup, resize and disabling the mascot. Native Kitty GPU rendering
was not directly tested: browser captures emulate the real emitted protocol.

Evidence: dist/visual-ghost-native-final/report.json,
dist/visual-ghost-fallback/report.json, dist/visual-ghost-binary/report.json.
The fullscreen binary capture is
dist/visual-ghost-binary/01-native-fullscreen.png.
New bench command: npm run visual:mascot. VISUAL_EXECUTABLE selects an extracted
compiled executable in visual:serve/visual:mascot with isolated home/project.
The local distribution is dist/release/linux-x64/compositor/compositor; public
v0.1.1 still contains the earlier implementation. No new release tag was made.

## Bundled Callix native dependency

Release builds now install the pinned official Callix 1.7.0 archive for their
native Linux/macOS x64/arm64 target. `plugins/callix/distribution.mjs` shares the
version/checksum table and verified extraction between explicit setup and the
release builder. Only the verified binary and upstream MIT license are streamed
out of the archive; a developer-local ignored bin/ is never copied. Offline
builds can supply CALLIX_RELEASE_ARCHIVE and undergo the same checksum check.
The distribution includes plugins/callix/bin/callix, LICENSE and release.json,
with source URL, platform, version and archive/binary/license SHA-256 digests.

The existing runtime priority remains CALLIX_BIN, executable setting, bundled
binary, then PATH. Provider replacement/disable settings are unchanged; loading
a plugin performs no installation or downloads. Source users can still run
node plugins/callix/install.mjs explicitly. Published v0.1.1 predates bundling;
no existing release or version tag is overwritten by this implementation.

Local validation: 379 tests passed, 1 optional native Callix source test skipped,
48 files; coverage lines 80.33%, all gates passed. Typecheck and diff checks
passed. The rebuilt Linux x64 release passed install/checksum/model/Monty smoke.
Its installed compositor invoked the real code_query tool and returned a
resolved cross-file TypeScript call with CALLIX_BIN cleared and PATH empty.
The smoke also checks packaged license/provenance and Callix --version.
All four native platform builds and installed Callix cross-file checks passed
in workflow_dispatch run 42578297780 (Linux x64/arm64, macOS x64/arm64):
https://github.com/Neko1313/agent-compositor/actions/runs/42578297780
Publishing was skipped because this was a branch run. Main CI also passed:
https://github.com/Neko1313/agent-compositor/actions/runs/42578290036
Implementation commit: 99f6b52. The local Linux archive was rebuilt with the
updated documentation at dist/release/compositor-linux-x64.tar.gz.

## Native model/provider/proxy settings

The workspace bar now exposes Settings. `/settings`, `/providers` and `/models`
open the built-in model-selector panel. Connections can be added from Ollama,
OpenAI Responses, Anthropic, Gemini and compatible-gateway presets; edited,
copied by ID, tested, removed or switched without editing JSON. GET /models
uses each provider's authentication headers and the shared model network client;
manual IDs remain available when discovery is unsupported. Discovery is bounded
and does not issue a completion or display provider error bodies. Profiles use
private/global providers.json; private model.json restores profile plus model.
API keys remain in credentials.json (0600). Project overrides beat global
settings, including immediately after a global edit.

Trusted plugins have host-owned `$.ui.form`: text, URL, masked password, select
and toggle fields, actions, validation, mouse focus, keyboard navigation,
scrolling and cancel/abort/close cleanup. Draft/results bypass ui.render and
catalog events. Password declarations cannot contain initial secrets. Headless
hosts require an explicit handler. `$.storage.configure` writes private project
or global component settings atomically; both APIs are guarded against untrusted
plugins and ui.render mutation. Existing storage/network service hooks still
consume effective proxy configuration; these callbacks do not replace them.

The network-proxy plugin owns a native form for HTTP(S) CONNECT endpoint,
username/password, separate model/tool switches, bypass hosts and persistence
scope. `/proxy` opens it; status/on/off remain available. Blank secret fields
retain current values; explicit switches clear saved credentials. API-key login
also uses a native form when no configured OAuth device flow exists. Structured
plugin views now scroll from the top; conversation logs continue following the
tail. Arrow/Enter navigation activates visible plugin actions.

Verification: 389 tests passed, 1 optional native Callix test skipped, 49 files;
coverage lines 80.99%. Typecheck, standard PTY visual regression, settings PTY
scenario and compiled-binary settings scenario passed. Inspected actual PNGs;
settings scenarios exercise fake keys, native input, proxy switches, restart and
cancel. Local proxy smoke passed model/tool HTTP CONNECT and shell environment.
Linux x64 release build/install/Callix/model smoke passed; no new release tag was
published. `npm run visual:settings` is the maintained settings check; its raw
input.jsonl must never contain real credentials. See docs/state-and-network.md
and tools/visual/README.md for contracts, interaction and scope details.

## Agent harness, model context and dynamic workflows

The user explicitly requested implementation of the audited harness gaps.
Base agent instructions now resolve through service.agent.instructions, with
behavior.json/config overrides; project/skill instructions remain separate.
service.agent.finish provides a replaceable completion gate. Per-session
private task-plans/<session>.json preserves model-authored goals, tasks,
acceptance/evidence and next action; /tasks opens it and /continue resumes a
bounded turn. Planned edits require recorded successful verification or explicit
unavailable/inapplicable reporting; pending plan items request continuation.
Background workflow hand-off must be explicit. Gates/reminders are not proofs of
correctness; command recognition is deliberately documented as a heuristic.
Application default is 64 steps/turn. Repeated tool failures trigger recovery
instructions and stop after six consecutive failures without progress.

service.model.capabilities supplies context/output capacity. Explicit profile
contextWindow, native Ollama/Gemini metadata, optional same-origin metadataUrl,
a configurable exact-ID model-catalog.json and marked 32768 fallback are
supported. Limits update on model/profile changes with a 60-second metadata
cache. Provider usage is not capacity. Schema/system/image/tool overhead counts,
output is reserved/capped, hard pressure bypasses cooldown, summarization uses
bounded segments and adjusts recent tail while retaining tool/result groups.
Failures, empty summaries and non-shrinking summaries retain original history.
Context overflow permits one compaction retry. Subagents inherit project rules,
use separate budgets/plans and route optional stage profiles independently.
The TUI shows estimated context occupancy and fallback provenance.

The replaceable workflows plugin adds workflow_run: persistent background DAG
stages, ready-stage concurrency, conditional branches, JSON expansion into workers
and automatic downstream joins, status/wait, pause/resume/retry/stop. It keeps
Python/Monty workflow journals compatible. UI exposes stages, worker IDs, live
activity, outputs/errors, attempts and accounted tokens. Atomic serialized run
snapshots and process leases prevent competing execution; interrupted runs load
paused, with explicit resume. App reload/exit cancels workers; this is not an OS
daemon. Cached completion is not refreshed against later repository changes,
and interrupted external effects are not exactly-once. Stage budgets default to
60000 tokens/10 minutes/32 steps; concurrency 2 (max 8), stages 100 (max 500), four
active runs. Workers cannot launch nested background workflows.

New npm run eval:agent exercises cross-file bug repair and failure recovery/API
preservation with actual executed checks and independent hidden behavioral
graders outside the model workspace. Initial live run with an incomplete eval
search toolset passed 1/4; restoring default Callix search and bounded recovery
produced 4/4 on gemma4:31b-cloud and deepseek-v4.1-flash:1017-cloud. This is a small
development suite, not an unbiased capability/parity benchmark. Evidence:
dist/evals-agent-live/report.json (diagnostic) and dist/evals-agent-final/report.json.
The maintained real PTY check npm run visual:workflows passed dynamic fan-out,
parallel workers, pause/join/resume, result detail, restart and foreground input.
The standard visual scenario also passed. Bench plugins remain under tools/visual
and are not shipped as application defaults. Contracts and limits are documented
in docs/agent-features.md, docs/evals.md and plugins/workflows/README.md.

Final local verification for this milestone: 403 tests passed, one optional
native Callix test skipped, 50 files, line coverage 81.46%; typecheck passed.
Source PTY workflow and settings scenarios passed, as did the standard visual
regression. Installed Linux x64 smoke now explicitly starts/polls a background
workflow across separately bundled hooks/tools and checks its worker output.
Shared registry ownership lives behind service.workflow.run in the hooks entry,
so source module sharing is not assumed by release bundles. Native metadata
queries against the existing Ollama returned 262144 context tokens for
Gemma4:31b-cloud and 1048576 for DeepSeek-v4.1-flash:1017-cloud in this environment.
Typed control chunks and bracketed paste use separate Ink input channels;
form passwords remain masked. No release tag/publication was requested.

## Callix navigation, guarded editing and cost comparison

The user requested deep tests and better file/symbol navigation, precise edits
and token comparisons with conventional search methods. Callix remains native
and replaceable through service.project.query; no new Python bridge or mandatory
backend was introduced. The plugin now supports outline/read_symbol/impact,
exact path/name/ID disambiguation, indexed adjacency lookups, compact bounded
results, snapshot/filter cursors and payload size estimates. UTF-8 one-based
native spans are converted to exact UTF-16 edit ranges; truncated source never
issues an anchor. Native aliased calls and Unicode/CRLF source slices are tested.

The standard read tool also returns a guarded range anchor. Standard edit accepts
expectedHash/range/strict, so permissions, guards and checkpoints remain intact.
Stale or ambiguous changes fail; guarded inverses are recorded privately. File
mutation locks are shared across cores in-process, not across external editors.
Normalized edits now detect multiple matches correctly and cannot loop when a
replacement re-matches the whitespace-normalized needle. Replacement strings
are literal, including $&. Model-facing tool JSON stays valid above its limit;
compact results are capped at 128 KiB with a structured preview for oversized data.

Index builds are shared with per-consumer cancellation, checked for source
changes during analysis, and saved with root/config/binary provenance. Extra
ignore rules filter cached/output graph nodes (native CLI analysis still uses
its own discovery rules). Text search handles nested ignores, symlink escape,
deleted/binary/large files, streaming regex batches and bounded scan memory/time.
Skipped pagination matches are not all retained. Exact-ID warm lookups are tested
against a 10000-node graph without another node scan.

Commands: npm run test:callix, eval:navigation, eval:navigation:live. Fixed-protocol
comparison validates identical caller paths and edits for broad full-file,
bounded range and graph approaches. Approximate result tokens: 34880 / 376 / 834.
Callix cold path ~78 ms; warm graph requests ~2..6 ms in that fixture. Efficient
text is cheaper for the simple known-path task; do not claim universal savings.
Final live runs passed 4/4 guarded-edit/behavior/check episodes with actual
provider usage, but Gemma used text even when semantic tools were available.
DeepSeek used Callix and spent more input than its text-only run. ToolTraffic
estimates, provider input/cache/output and method adherence are recorded separately.
These are method/development comparisons, not branded-assistant or statistically
representative benchmarks. Earlier failed guard/command-adherence trajectories
remain under dist/navigation-live; final runs are dist/navigation-live-final.
See plugins/callix/README.md and docs/evals.md for exact contracts and results.

Final verification: 420 tests passed and three optional native tests skipped in
52 files; line coverage 81.87%. The explicit native Callix suite passed all 25
tests in four files. Typecheck, marketplace validation (26 entries), and diff
checks passed. The rebuilt Linux x64 binary passed install/checksum/default
plugin smoke, bundled cross-file Callix queries and guarded symbol editing with
an empty PATH, plus the existing background workflow checks. No release was
published for this task.

The first CI run exposed missing ripgrep on the hosted runner (regex pagination
test failed with spawn rg ENOENT). CI explicitly installs ripgrep before tests;
the regex test remains mandatory rather than skipped when the dependency is absent.

## Token efficiency, workflow profiles and auto-review inheritance

The user requested provider-cache optimization, fewer unnecessary auto-approval
prompts (particularly with Anthropic), and tool-use guidance/evals. Anthropic
now defaults to ephemeral stable tools/system breakpoints plus automatic growing
conversation caching; profiles can select prefix-only caching or opt out.
Responses/compatible adapters support an explicitly configured promptCacheKey.
Cache reads and writes are separate model.usage counters; missing write prices
mark the request unpriced. Declarations have deterministic name ordering.

Ephemeral workflow/task usage forwards once to the parent. New children check
the remaining ancestor allowance rather than resetting the parent session cap. Stage model profiles
now survive both the actual request model field (the parent model no longer
wins over a selected stage profile) and context compaction. App summarizers use
an optional fork factory to bind child streams; custom embedders without a fork
retain their existing summarizer. Native wire tests check the selected model,
not just profile labels. Input estimates are checked before charged requests,
with output limited to the estimated remainder. These remain token estimates,
not hard billing caps across independent sessions/providers.

Workflow runs reserve a shared maxTokensTotal allowance (default 120000) across
parallel stages. Failed/unreported/interrupted allocations are conservatively
charged; retries preserve the persisted tokensCharged ledger. This ledger may
exceed reported usage and is not a provider invoice. Reviewer calls retain the
parent's separate review budget. Persistent agent_control sessions remain
independent, rather than silently folding their usage into another session.

Auto review stays opt-in with a dedicated reviewer. Ephemeral children inherit
the root session's enabled state/review budget. Source code vocabulary and URLs
no longer trigger the command danger filter during writes/edits; canonical
sensitive/external paths still require manual approval. Single fenced JSON is
accepted; malformed responses/errors/explicit denies remain manual. Read-only
workflow status/list can be reviewed locally without a model call. Manual
fallback reasons reach approval dialogs. Unknown tools are not auto-allowed.

New tool_help retrieves examples/pitfalls/schema on demand. Every default tool
has parameter-shaped examples; plugins can supply ToolSpec.usage without adding
examples to every repeated schema. Default instructions discourage shell-based
file inspection, repeated reads, unbounded delegation and equivalent retries
after a denied action. eval:tools adds allowed-tool/call-count/result-size
checks, usable with existing --harness and Harness² materialization.

Recorded live development evidence: initial 4/6 and final 6/6 episodes across
Gemma4:31b-cloud and DeepSeek-v4.1-flash:1017-cloud. General policy and denial
feedback changed; the final denial prompt also explicitly requests write, so
these are diagnostic iterations, not an unbiased improvement score. Reports:
dist/evals-tools-live and dist/evals-tools-final. Provider cache contracts use
HTTP fixtures; no paid Anthropic/OpenAI cache-hit or dollar-saving claim is made.

Final local checks: 434 passed, three optional native tests skipped, 53 files;
line coverage 82.17%. The explicit native Callix suite passed 25/25. Typecheck,
marketplace validation, generated-contract sync and diff checks passed. Scripted
tool evals passed 3/3; live Ollama tool episodes passed 6/6 as qualified above.
The rebuilt Linux x64 archive passed installer/checksum/default-plugin/model,
background workflow, bundled Callix and guarded editing smoke. Main CI now runs
and preserves the scripted tool-use report. No release tag was published.

## Local read commands, Markdown and GNOME Terminal behavior

The user reported unnecessary approvals for grep/ls, absent native cursor
changes, browser/native appearance differences, missing model Markdown, and
asked about OpenAI/Google caching. They identified GNOME Terminal as their host.

Builtin exec now classifies a restricted POSIX read/search subset using verified
standard executables, project/cwd/symlink checks, allowed flags and tokenized
pipelines/chains. Unsupported syntax, redirects, substitutions, executable
filters, shadow binaries, env overrides and external paths remain approval-
requiring. A readOnly descriptor/rule match allows the default without a reviewer;
explicit ask/deny and custom exec implementations are preserved. Plan mode
permits verified reads. This is a permission convenience, not an OS sandbox.

Default assistant Markdown uses Marked/GFM tokens before styled wrapping:
headings, emphasis, lists/tasks, quotes, links, tables and literal fenced code.
Control sanitization remains; HTML is not executed and images are not fetched.
Historical blocks cache by text/width/theme. Plugins still replace ui.render.
A constrained single Ink Text row holds all styled spans so narrow resize does
not independently shrink segments into clipped words. Ctrl+J/LF is distinct
from Enter/CR even in coalesced typed input; paste keeps its separate channel.

VTE/GNOME Terminal lacks OSC 22 support. Native cursor shape cannot be changed
there by this protocol; no false Pointer capability is advertised. Title/border
hover highlighting works independently, including separator feedback. Known
Kitty/Ghostty/Foot environments use OSC 22; conservative unknown/multiplexer
fallback and AGENT_POINTER=on|off|x11 overrides exist. The browser bench explicitly
emulates OSC 22; that is not proof of native support or equal GTK font rendering.

OpenAI/Gemini cached-input usage existed before this task. OpenAI Responses now
has opt-in promptCacheOptions (mode/TTL); older APIs can use promptCacheRetention.
Cache-write usage is accounted separately when reported, including compatible
Chat endpoints. Gemini implicit caching remains provider-owned; thinking tokens
now count toward output usage. No explicit Google cache objects are created or
managed, and no external cache-storage fees are enabled automatically. See
provider-specific contracts in docs/agent-features.md, with official sources.

New npm run visual:presentation uses the real PTY and a token-scoped loopback
model fixture, with OSC 22 disabled. It captures Markdown, styled cells, literal
code, native-independent hover, resize and source/compiled app behavior. Actual
GNOME Terminal/GTK is not installed in this environment; browser captures verify
the emitted terminal output and fallback rather than native pointer support.

Final checks: 447 passed and three optional native tests skipped in 55 files,
line coverage 82.18%; explicit native Callix suite 25/25. Typecheck, catalog
validation, generated-contract sync, scripted tool evals and diff checks passed.
The complete real-PTY interaction scenario passed under dist/visual-terminal-verified.
Focused source screenshots were inspected under dist/visual-presentation-width;
compiled screenshots/report are dist/visual-presentation-binary-final (including
hover without OSC 22). Narrow styled rows remain readable after resize. The
rebuilt Linux x64 installer/default-plugin/model/workflow/Callix/edit smoke passed.
No new release tag/publication was requested.

The first CI run rejected the positive ls read test. Executable pinning now
compares canonical system targets (including symlink/multicall installations),
not literal /usr/bin/<name> strings. The positive fixture uses a controlled
standard PATH; a symlink to the real system ls is accepted, while a shadow shell
script remains rejected. No generic basename-only executable trust was added.

## Universal auto-review eligibility

The user explicitly requested that auto approvals apply to arbitrary console
commands and tool calls, rather than a small tool/command whitelist. Auto-approve
1.2 now accepts every model-facing tool requiring approval for assessment:
shell, MCP, workflows and custom plugins. Already permitted actions avoid an
extra review; explicit deny remains binding before any reviewer call. Only
allow + low passes automatically. No blanket permission or unrestricted mode
was added; uncertain/higher-risk responses and failures still ask the user.

service.permission.review now optionally carries the registered tool description,
parameter schema and bounded current task context. Ephemeral children forward
their task plus the parent's original task; review budgets remain shared. The
reviewer treats metadata/arguments/context as untrusted data. Inputs above 24000
JSON characters return to manual approval without truncating hidden effects.
Command names/URLs are no longer a hard manual-only filter. Protected filesystem
mutations are guarded by descriptor effects, including custom tool aliases.
Canonical checks support new nested paths and reject unresolved symlinks.

Audit errors now update the in-memory verdict/history as ask, and disabling auto
while a review or its audit/UI completion is pending cannot return a stale allow.
Tests cover generic eligibility, metadata/context delivery, actual plugin tool
execution, explicit deny, higher-risk verdicts, malformed/oversized/unconfigured
reviews, shared budgets, nested files, symlinks and late disable. The mode still
requires /auto on and a dedicated reviewer profile; defaults remain manual.

Verification: 461 tests passed, three optional native tests skipped, 56 files;
line coverage 82.29%. Typecheck passed. Catalog 0.14 adds optional review metadata;
marketplace metadata and generated docs/schema are synchronized.

## Human choices and questionnaires (2026-11-09)

Extended ask_user with rich options (label/description/recommended), single or
multiple choice, and default custom text (allowOther:false closes the set).
Preserved numeric input and the legacy answer result/callback string options.
Added ask_questions for atomic 1–8 question interactions, stable question IDs,
Back, editable review and explicit submission. Shared events schemas validate
unique IDs/labels, answer completeness, choices and cardinality; results include
selected labels plus optional custom text. Headless/cancel does not invent answers.

The real TUI supports arrows, Space, Tab, mouse choice/description/button hits,
scrolling and narrow layouts. Question drafts preserve unsent prompts; queued
approvals cannot consume keys during an active question. Plugins use $.ui.ask
and $.ui.questionnaire through replaceable service contracts (catalog 0.15).
Human waits in plugin hooks require an appropriate trusted hookTimeouts entry;
render hooks cannot request input. Core guidance recommends essential questions
only, after inspecting available context, independently of execution permissions.

Verification: 479 tests passed, three optional native tests skipped, 59 files;
line coverage 82.55%. Typecheck, marketplace validation, scripted evals (5+3),
proxy smoke, release build and installation smoke passed. visual:questions passed
for source and compiled binary, with screenshots inspected; visual:check passed
including legacy child ask_user. The maintained bench now has a questionnaire
scenario; native GNOME pointer/font support and live provider behavior are not
established by the scripted xterm.js fixture.

## Interactive chat history (2026-11-09)

/history, /sessions and bare /resume open the replaceable session-manager browser.
The pane supports live literal search by name/ID/conversation text, local activity
dates, message counts, current/archive markers, paged keyboard/mouse selection,
first-prompt/latest-reply preview, native rename, archive visibility and resume.
Default labels come from the first ordinary prompt without an extra model call.
The search field is independent of the unsent prompt; Escape/Close preserves it.
Pending filters cannot resume stale results, and active turns reject switching.
Resuming identifies the selected chat in the conversation title and resets stale
recipient/context/tool/scroll display state. Known ID/prefix resumption remains.

compositor --resume (without an ID) and --history open history at startup; they
require a TTY. Explicit --resume ID still works in headless/plain modes. Session
history stays scoped to the project's existing home-storage root. Sidecars now
hold bounded first/last prompts, last completed response and message counts.
Legacy metadata is enriched read-only with a bounded process cache; appends
persist it. Body search streams conversation records and excludes tools/system
instructions. Search cancels stale work and is debounced; no paid model is used.
Handled commands now persist as prompt.dropped, so newly recorded UI commands
cannot reappear as user messages when replaying a conversation. Older unmarked
records are preserved rather than guessed away.

Catalog 0.16 adds optional UiTextView.input and ui.change for reusable editable
plugin views. The host owns the active local draft; change its ID or remove/
reopen the view to reset it. Text edits emit ui.change, navigation/actions use
ui.press, and generic rendering/placement contracts remain replaceable.

Checks: 491 tests passed, three optional native tests skipped, 60 files; line
coverage 83.25%. Typecheck, marketplace, generated contracts, scripted evals
(5+3), proxy smoke, release build and installation smoke passed. visual:history
passed for source and compiled --resume startup with inspected screenshots;
the full real-PTY visual:check also passed. Artifacts: dist/visual-history-fixed,
dist/visual-history-binary-final and dist/visual-history-regression-final. These
use isolated storage and scripted providers; no native GNOME/live-model claim.

History resilience follow-up: missing rollout files no longer block searching
other chats; non-event JSON values are ignored for previews/search and retained
as corrupt records for loss-tolerant replay/fork. Added these cases to the store
checks. The existing workflow concurrency fixture now gates both workers on an
explicit barrier rather than assuming a 5 ms sleep overlaps disk scheduling.
Final full-suite count remains 491 passed / three optional skipped.

## TUI UX/UI review and shared refinements (2026-11-10)

The user requested loading UX/UI review skills and applying their principles to
every TUI segment, explicitly authorizing subagents. Used Impeccable 4.3.1 and
project tui-visual-check. Independent A design review scored baseline 27/40;
independent B supplied actual PTY/detector evidence without anchoring A. A third
controls review covered forms/question/placement editing. The archived critique
is `.impeccable/critique/2026-11-09T13-57-20Z__packages-app-src-ui-ts.md`; the maintained
per-segment principles are docs/tui-design.md. This was scoped refinement of the
existing i3-like terminal identity, not a replacement visual world.

Implemented shared readable split projection (24 columns/6 rows), preserved trees/
ratios and directional access to hidden panes, correct fullscreen/composer focus;
contextual status/titles/hints; complete semantic action navigation with unique
IDs, scrolling and overflow cues, including ui.render overrides; literal native
input/approval rendering; pinned/scrolled approval details and explicit scopes;
real question text editing/reverse Tab; required/validation/form scroll guidance;
safe placement Escape; effective proxy summary with optional redacted diagnostics;
New chat labels and pinned literal search fields. Whole-word wrapping no longer
splits valid task words due to a half-width heuristic.

Catalog 0.17 adds optional selectionText, UiTextView.hint and input.label. Mono
uses explicit RGB selection colors rather than black/gray ANSI names, since bold
black may become bright black and disappear on gray. Keep all styling, semantic
views, hints and plugin placement replaceable. Mascot assets and agent/workflow
behavior were preserved. The web detector returned [] with no meaningful markup
coverage; no DOM-overlay or native GNOME/screen-reader clearance is claimed.

The user chose to update Impeccable to the offered 4.8.1 in the NEXT session. Do
not update it during this review. Preserve this deferred request; the current
skill context was loaded once and its installed files were not rewritten.

Final verification for the TUI review: 513 tests passed, three optional native
checks skipped, 62 files; line coverage 83.83%. Typecheck, generated contracts,
26-entry marketplace validation, scripted evals 5/5 + 3/3, proxy smoke and rebuilt
Linux x64 installation smoke passed. Current broad/settings/question/workflow/
Markdown reports are under dist/ux-final-confirm; corrected history and compiled
RGB/long-approval checks are under dist/ux-final-functional. Representative PNGs
were inspected. Initial counterexamples are retained under dist/ux-final-round1
and are not current passing evidence. The critique snapshot is closed as its
baseline source changed. All owned visual servers/browsers were cleaned up.

## Dependency refresh (2026-11-10)

The user requested review and updates of all libraries, including tooling.
All 23 external direct npm dependencies were checked against stable registry
dist-tags; manifests now name current stable versions, with compatible
transitive refreshes and standalone plugin lockfiles checked. Major migrations:
Zod 3.25.76 -> 4.6.7, TypeScript 5.9.3 -> 7.0.2, Undici 7.30.2 -> 8.12.4,
Marked 17.0.6 -> 18.1.3, Node types 24.19.2 -> 26.6.6. Development/source runtime
minimum is now Node 22.19.0; CI tests it and Node 26 LTS.

Zod migration preserves frozen event acceptance/defaults and questionnaire
refinements, uses explicit record key/value schemas and public JSON Schema
conversion. Generated schemas now contain actual contracts for all 83 events.
TypeScript 7 needs explicit ambient Node types. Undici 8 changes HTTP proxy
defaults; preserve CONNECT with explicit proxyTunnel:true.

Bun 1.4.4, Callix 1.7.0, Monty 1.5.0, git-cliff 2.14.2 and upstream Harness²
commit 6868817518876de8fd170c6a8354daca273b6191 were already current. CI actions
are upgraded and SHA-pinned. Harness² requires Python >=3.12,<3.14; isolated
Python 3.13 adapter check passed, while host Python 3.14 is not supported.
No user-global tools or installed skills were upgraded. Impeccable's previously
accepted update remains deferred to the next session.

Validation: 518 generic tests passed (3 optional skipped), 25 explicit native
Callix tests passed, typecheck/gen/marketplace/proxy passed, scripted evals 5/5
and tools evals 3/3 passed. Real PTY broad and Markdown presentation scenarios
passed with visually inspected screenshots in dist/dependency-visual and
dist/dependency-presentation. Linux x64 release build/installer smoke passed;
no release was published. npm audit: zero advisories, npm outdated: empty.
See docs/dependencies.md for full inventory and maintenance constraints.

## Published v0.2.0 (2026-11-10 local time)

The user explicitly requested publication. Released v0.2.0 as Latest:
https://github.com/Neko1313/agent-compositor/releases/tag/v0.2.0
Immutable annotated tag: 212d549e64cc374678d9e8e45a6c8230bdfa0154.
Successful publishing run: 42638064053 (workflow_dispatch from f9ea46e).
All 518 generic tests, marketplace validation and four native release build/
installer/model/workflow/Monty/Callix guarded-edit smoke jobs passed. Six public
assets exist: Linux/macOS x64/arm64 archives, install.sh and SHA256SUMS. Latest
API points to v0.2.0; checksum entries match GitHub asset digest metadata.

Initial tag run lacked ripgrep in the verification runner. A later build exposed
a macOS smoke fixture issue: /var and /private/var temporary directory aliases
caused an exact edit permission rule to miss the canonical tool path. Fixed
release dependency provisioning and realpath of the smoke root, then verified
the fixture under an aliased TMPDIR locally and on both macOS native runners.
Application guards were not relaxed. No release was published from failed runs.

The tag was not moved. The repaired workflow can publish an existing unpublished
tag via explicit release_tag input only if its package version and application
source match the tag; only release.yml and smoke.mjs differences are permitted.
Publishing checks out the immutable tag for git-cliff notes and installer, and
validates downloaded CI artifact digests before upload. This run's code exactly
matches the tag outside those two pipeline/fixture files.

## Wisp Soul composer plugin (2026-11-10)

The user supplied wisp-soul-ink.zip and requested the redesigned mascot as an
extension of human message input rather than a separate actor/window. Adapted
the supplied WispSoul text frames into plugins/mascot/wisp.ts; Unicode small
fullwidth dashes in eyes use ASCII dashes to keep terminal cell geometry stable.
No images are generated, no new library or model calls are added.

The default mascot now publishes UiTextView.attachment {site:'composer',width,
label} through the normal $.ui.view API. This is generic and replaceable; AppUI
contains no mascot-specific rendering or event logic. A stable latest-producer
slot lives inside the host-owned editor, never enters the tiling tree or plugin
placement panel, and is removed on disable/unload. Existing drafts/focus/dialog
controls stay host-owned. Protected dialogs/completions retain their full input
space. At >=60 columns and >=24 rows the text art sits in four rows beside the
editor; narrower screens retain status only. Existing legacy layout panes are
not restored for a composer attachment.

The activity reducer still observes tools, turns, planning, concurrent children,
manual dialog reactions and independent-agent metadata. Text motion uses 250ms
frames only when expanded/selected; compact, hidden, headless, paused, NO_COLOR
and TERM=dumb stop frame advancement while activity and transient expiry work.
/mascot on|off|pause|resume|pet|reload persist through project settings. Earlier
APNG pack settings are legacy and yield a notice; APNG assets/decoder and generic
raster/Kitty rendering remain available to other views and compatibility tests.

Validation: typecheck/generated contracts/marketplace passed; 522 tests passed
with 3 optional skips. Composer tests verify no separate window, stable draft,
compact behavior, producer priority and removal. Real PTY broad regression and
focused mascot lifecycle passed; current screenshots/report are under
dist/wisp-regression and dist/wisp-composer-final. Wide, compact and protected
approval screenshots were inspected. Earlier wisp-composer-proof/confirm are
failed diagnostic captures (unsupported test shortcut and inherited NO_COLOR),
not current evidence. The motion-only scenario explicitly omits inherited
NO_COLOR in its isolated child; production respects it and unit regressions
cover static preferences. Built Linux x64 distribution and installer/model/
workflow/Monty/Callix smoke passed. Published v0.2.0 assets were not changed;
these source changes await a future release.

## Wisp storyboard correction (2026-11-10)

The user supplied 1670.jpg as the intended visual reference. The four-row
WispSoul.tsx archive was a simplified diamond-like placeholder, not a faithful
representation of the curled pixel flame in the storyboard. The initial
integration incorrectly treated it as final artwork. Reference appearance now
wins: the plugin builds bounded 18x12 monochrome pixel silhouettes with a bent
flame tip, rounded body, negative-space eyes and state-specific decorations.
Half-block glyphs encode pairs of pixels into six terminal rows. Solid blocks
use background-filled cells in composer art to avoid font baseline seams.

UiTextView.attachment adds optional rows (1..8, default4) so other plugins can
choose bounded art height too; the host remains mascot-agnostic and the human
editor/compact/protected-dialog behavior is preserved. Wisp requests width18,
rows6; semantic theme accent keeps the character monochrome. This supersedes
the archive-based four-row visual while retaining the composer plugin model.

Verified: 522 tests passed, 3 optional skipped; typecheck/gen passed, focused
real PTY lifecycle and broad regression passed. Current captures are in
 dist/wisp-storyboard-confirm and dist/wisp-storyboard-regression; idle and
happy silhouettes were visually inspected. Linux x64 build and distribution
smoke passed. No published release assets or tags were changed.


## Ghost source media and native composer graphics (2026-11-10)

The user rejected the Wisp text/pixel replacements and chose to return to the
original Ghost. They offered new APNG assets; no replacement archive has arrived
yet. Do not redraw the character or synthesize intermediate poses. Preserve
source pixels, alpha and timing. The old bundled APNGs remain available and are
228x228, six frames at 180ms each (~5.6 fps); a renderer cannot manufacture smooth
source motion. Ghost remains a replaceable plugin attached to the human editor,
never a separate actor/window. This supersedes both Wisp sections above.

Mascot now decodes GIF (bundled MIT omggif 1.0.10) and PNG/APNG, including finite
loops, GIF disposal/background/transparency, and original positive frame delays.
Limits are 2 MiB input, 512x512 canvas, 600 frames and 8 million total decoded
pixels per state. Timeline follows monotonic elapsed source time, skips late
frames, freezes while paused/hidden, and stops finite animations. Transient state
expiry remains independent of long source holds. Automatic dark-ink repair is
restricted to SHA256 fingerprints of the ten historical bundled APNG files;
new artwork keeps its alpha untouched unless restoreInk is explicitly requested.

Renderer auto-negotiates Kitty or SIXEL. SIXEL requires DA1 code 4, measured
physical cell size (CSI16t or VTE-compatible CSI14t+CSI18t), and terminal
background (OSC11); otherwise the composer keeps compact semantic status with
images unavailable. It does not silently replace source artwork with block art.
Forced SIXEL still needs size/background replies. SIXEL composites alpha,
letterboxes aspect ratio, quantizes with a bounded weighted median-cut palette,
and clears old cells before geometry changes. Native-only frame changes bypass
React/Ink text repaint through separate text/raster dirty channels; public
RendererState.apply still reports all visual changes. Other text plugins retain
normal composer attachment behavior. No application-specific mascot code in host.

Validation: typecheck, generated contracts, marketplace validation and 536 tests
passed (3 optional native skips). Linux x64 build and extracted distribution
smoke passed, including packaged GIF decoding and license notices. Real PTY
compiled Ghost lifecycle and broad regression passed; final evidence is in
 dist/ghost-media-shipping-final and dist/ghost-media-regression-shipping.
Inspected the full-resolution Ghost and compact draft screenshots. Independent
ImageMagick SIXEL decode verified all 4096 checkerboard pixels; separate 4096
colour gradient check had maximum RGB error 7 (mean 2.67). Diagnostic Kitty
emulator observed ~35.8 distinct changes/s for a synthetic 50 fps GIF in a two
second run (dist/ghost-media-gif-smooth), not a native terminal-wide guarantee.
Native GNOME Terminal/VTE SIXEL rendering is not verified on the user's terminal;
the local VTE build lacks SIXEL. Do not claim pixel-perfect GIF in every terminal.
Release builder includes omggif README MIT notice; no FFmpeg runtime dependency.
No published v0.2.0 assets/tags were modified and no new release was requested.
