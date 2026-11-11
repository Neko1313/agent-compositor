# Changelog

## 0.1.0 — Initial local implementation

- Read-only GitHub Actions run lists, run summaries, and failed/full logs through fixed `gh` arguments and an explicitly configured repository.
- Validated scoped repository and limit settings, bounded/control-cleaned output, and explicit error reporting.
- Concurrent `/ci` panel with selection, configuration, cancellation, and close controls.
- Added integration, lifecycle, behavior and real-terminal test cases; publication requires certification of the exact source and archives. Controlled fixtures do not claim live GitHub reliability.
