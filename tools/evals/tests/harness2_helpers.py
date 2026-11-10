"""Small disk captures for judge tests; no application or model is mocked."""
import json


def capture(root, *, events=None, execution=None, http=None):
    (root / 'workspace').mkdir()
    (root / 'home').mkdir()
    (root / 'trajectory.jsonl').write_text('\n'.join(json.dumps(e) for e in (events if events is not None else [final()])))
    (root / 'execution.json').write_text(json.dumps(execution if execution is not None else {'returncode': 0}))
    (root / 'http.json').write_text(json.dumps(http or {'requests': [], 'model': [], 'origin': 'http://127.0.0.1:1234'}))
    return root


def final(**extra):
    return {'type': 'result', 'response': 'Completed', **extra}


def action(tool='read', *, args=None, ok=True, output=None, error=None):
    return [{'event': 'tool.call', 'input': {'callId': 'a', 'tool': tool, 'input': args or {}}},
            {'event': 'tool.result', 'input': {'callId': 'a', 'tool': tool, 'ok': ok, 'output': output, 'error': error}}]
