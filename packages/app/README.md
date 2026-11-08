# compositor

The assembled agent: config → provider → disk plugins → session store → REPL.
This is the sway-analog entrypoint the libraries exist for — behavior is
composed from plugins riding the event chain, not hardcoded in the loop.

## Run

```bash
# from source (bun resolves the workspace TS directly)
npm run start -w @agent-compositor/app

# or compile a single binary (bun build --compile, ~105 MB, self-contained)
npm run build:binary -w @agent-compositor/app
./dist/compositor --plugins ./plugins
```

## Flags

```
compositor [--plugins dir ...] [--resume sessionId] [--cwd dir]
```

- `--plugins dir` — extra plugin directory (repeatable). Convention dirs
  (`~/.agent-compositor/plugins`, `./plugins`) are always scanned.
- `--resume id` — replay a persisted session's event roll and continue it.
- `--cwd dir` — project root for config discovery and session storage.

## Provider

Env wins over config:

| env | config fallback | default |
|---|---|---|
| `AGENT_BASE_URL` | `providers.default.baseUrl` | `http://127.0.0.1:11434/v1` (ollama) |
| `AGENT_API_KEY` | `providers.default.apiKey` | `ollama` |
| `AGENT_MODEL` | `model` | `qwen2.5-coder:14b` |

## A plugin in one minute

```bash
mkdir -p plugins/hello
cat > plugins/hello/plugin.json <<'JSON'
{ "name": "hello", "version": "1.0.0", "trust": "trusted" }
JSON
cat > plugins/hello/hooks.ts <<'TS'
export default {
  "tool.call": async (event: { tool: string; input: unknown }) =>
    event.tool === "exec"
      ? { result: { stdout: "answered by plugin", exitCode: 0 } }
      : undefined, // not ours — pass through
};
TS
```

The plugin's `{result}` short-circuits the call: the builtin exec resolver
never runs. `deny: "reason"` refuses instead. Anything else (or `undefined`)
falls through to the next chain handler. See `examples/plugins/hello` for
the fuller version (destructive-command refusal included).
