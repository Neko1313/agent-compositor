# Project checks

Native Compositor plugin, standard 1 / API version 1. Discover local npm scripts and run an exact script from the model tool or a human-operated panel, including while the main agent is working.

## Requirements and installation

Requires Compositor's native trusted-plugin support, public filesystem, exec, settings and UI services, and `npm` on the host PATH. Checks need a `package.json` with a string-valued `scripts` object in the current project. Any dependencies or runtimes required by those scripts must already be available. This plugin never installs dependencies.

Keep this directory as `plugins/project-checks` in a source checkout, or install the reviewed package into your installation's project/user plugin directory using the extension manager. Installation alone does not enable it. After review, run `/extensions enable project-checks --project` (or `--user`) and `/reload` between turns. Preserve existing plugin/tool allowlists and permission rules; the `project_check` tool and its owned services must be permitted. Nothing in this implementation activates the plugin in the authoring host.

## Use

- `/checks`: open **Project checks** without starting a process or calling a model. The exact prompt fallback also accepts surrounding whitespace; `/checks-other` is not consumed.
- **Refresh scripts** (`refresh`): call `project_check` with `{ "action": "list" }`. Lists up to 128 scripts with previews bounded by `maxChars`, reports truncation, and adds **Run <name>** actions (`run:<name>`).
- **Run <name>**: call the same guarded tool with `{ "action": "run", "name": "<name>" }`. Shows progress, stdout/stderr and failures; only one panel operation runs at a time.
- **Cancel run** (`cancel`): abort only this panel operation, not the main agent. Cleanup remains SDK-owned and the panel waits for settlement.
- **Close** (`close`): abort the active operation and remove the panel; asynchronous completion does not reopen it. The last result remains available when reopened in the same session.
- **Configure limits**: enter whole-number limits, choose project/global scope, then Save or Cancel. Save reports both saved and effective values; project settings override global settings.

The panel uses host action/text views and forms, leaving keyboard/mouse routing, layout, focus, and terminal draft management to Compositor. There are no startup jobs, automatic checks or automatic model calls.

## Tool contract and settings

`project_check` accepts only `action: "list" | "run"` and, only for run, `name`. No cwd, executable, arbitrary arguments, aliases or command substitution are accepted. Script names must be nonempty, at most 48 UTF-16 code units and contain no control characters. Unsupported script names or invalid script maps fail visibly, even during listing. Run requires an own script entry, not an inherited property.

`list` is read-only. It returns `{scripts:[{name,command}],truncated}`. `run` is mutating and describes the exact command `['npm','run','--',name]`. Native success data is `{name,stdout,stderr,exitCode:0,truncated}`; combined output is bounded. Script listing bounds the combined names and command previews by `maxChars`; names remain exact, omitted/truncated previews are labeled and execution re-reads the full script. Failures return `{ok:false,error}` with bounded diagnostics. The human panel uses the tool's ordinary permissions, not a bypass.

Scoped settings file: `project-checks.json`, through the host settings API:

| Setting | Default | Allowed integer range |
| --- | ---: | ---: |
| `maxChars` | 16000 | 1000–64000 |
| `timeoutMs` | 120000 | 100–300000 |

Absent individual settings use defaults. Malformed settings, missing/invalid package files, unknown scripts, denial, nonzero exit, missing npm, timeout and cancellation are failures, not successful checks. stdout gets the output budget first, followed by stderr. Nonzero-exit errors prioritize the exit code and stderr before stdout. Host truncation is also respected. The panel additionally bounds line count; it labels omitted output.

## Security and limitations

Package files are read only on tool use through host filesystem services, confined to `ctx.cwd`; both the selected project directory and package file are canonicalized by the host path resolver before comparison. Project-directory aliases, including macOS `/var` paths, work; package paths resolving outside the canonical directory remain rejected. No dependency install, raw subprocess API or shell interpolation is performed by this plugin. Execution uses the owned `service.exec.run` API with fixed `npm run -- <name>` arguments and a finite timeout. The SDK owns cancellation and process cleanup; execution settlement is awaited. If the initiating UI hook expires, cleanup clears the active state so later operations can proceed.

**Local npm scripts are arbitrary project code**, including npm pre/post hooks. Running one can modify files, access credentials/network or start descendants. Only run scripts from trusted projects. Permission approval and host confinement are not a sandbox for script code. Listing is capped at 128 names and the preview character budget; the tool can still run another valid exact existing name. Package/settings are re-read on each invocation; a changing project can change a script between discovery and execution. No scheduler, task inference, history persistence across sessions or guarantee of display completeness is provided.

## Verification status

The frozen `packages/app/test/project-checks-oracle.test.ts` suite passed all six cases: discovery/strict inputs, command routing/output bounds, permissions/settings/missing files, panel routing, actual concurrent owned-process cancellation and actual local npm execution. Additional regressions cover discovery caps, unsupported maps/names, descriptors, own-property membership, output budgets, cancellation settlement and closed-panel behavior. Repository typecheck and `plugin_dev check` are run as authoring checks.

`plugin.test.json` binds package lifecycle, domain behavior, persistence, mutation, owned-process and real PTY scenarios for source and installed archives. Passing authoring checks alone is not certification. Consult the certificate for the exact source/artifact and platform before treating a package as release-ready. Cross-platform publication and a completed autonomous authoring turn remain separate requirements.

The initial implementation was authored through Compositor against six frozen independent acceptance tests. That turn passed eleven artifact checks but stopped at the conservative budget guard before its final response. A subsequent live guided review iteration started from the original candidate, fixed five supplied review findings and completed with all six original, five independent review and seven added tests passing; those eighteen checks and typecheck were rerun independently. Its settlement logic waits for SDK cleanup before publishing a result, rejects a late success after cancellation and keeps the current check heading above long script lists. The integration preserves broader invalid-command feedback from independent review. This demonstrates a completed review iteration on a known candidate, not a completed autonomous initial plugin delivery or an unseen quality benchmark.
