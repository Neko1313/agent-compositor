import json

import pytest

from harness2_adapter import isolated_env, substitute, activate_fixture_plugins
from harness2_bench import grade, CompositorBenchmark
from harness2.core.spec import BenchmarkAdapter
from harness2_helpers import action, capture, final

pytestmark = [pytest.mark.unit, pytest.mark.harness2]


def test_matching_evidence_and_actual_artifact_pass(tmp_path):
    run = capture(tmp_path, events=action('write', args={'path': 'report.txt'}, output={'bytes': 4}) + [final()])
    (run / 'workspace/report.txt').write_text('fact')

    result = grade(run, {'expect': {'tools': [{'tool': 'write', 'ok': True, 'args': {'path': 'report.txt'}}], 'files': {'report.txt': 'fact'}}})

    assert result['all_pass']
    assert result['n_passed'] == result['n_criteria'] == 4


def test_honest_denial_with_unchanged_file_passes(tmp_path):
    run = capture(tmp_path, events=action('write', ok=False, error='denied by permission rules') + [final()])
    (run / 'workspace/protected.txt').write_text('original')

    result = grade(run, {'expect': {'tools': [{'tool': 'write', 'ok': False, 'errorIncludes': ['denied']}], 'files': {'protected.txt': 'original'}, 'maxToolCalls': 1}})

    assert result['all_pass']


def test_slots_resolve_without_serialization_corruption():
    assert substitute({'x': ['{{home}}', 3, '{{origin}}/source']}, {'home': '/tmp/quoted " home', 'origin': 'http://localhost:1234'}) == {
        'x': ['/tmp/quoted " home', 3, 'http://localhost:1234/source']}


def test_host_keys_settings_proxies_and_preloads_are_not_inherited(tmp_path, monkeypatch):
    for key in ('AGENT_API_KEY', 'BRAVE_SEARCH_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'BUN_OPTIONS', 'HTTPS_PROXY', 'AGENT_HOME', 'XDG_CONFIG_HOME'):
        monkeypatch.setenv(key, 'host-secret')

    env = isolated_env(tmp_path, 'fixture', 'http://127.0.0.1:1234/v1')

    assert 'host-secret' not in json.dumps(env)
    assert env['HOME'] == str(tmp_path)
    assert env['AGENT_API_KEY'] == 'harness2-local'


def test_protocol_and_disjoint_splits(tmp_path):
    bench = CompositorBenchmark(tmp_path)

    assert isinstance(bench, BenchmarkAdapter)
    assert set(bench.tasks('train')).isdisjoint(bench.tasks('test'))
    assert set(bench.tasks('all')) == set(bench.tasks('train')) | set(bench.tasks('test'))
    assert len(bench.tasks()) == 12
    source = bench.task_files('read-evidence')
    assert (source / 'facts.txt').is_file()
    assert 'expect' not in bench.task_prompt('read-evidence')


def test_home_and_absolute_path_spelling_are_equivalent(tmp_path):
    run = capture(tmp_path, events=action(args={'path': str(tmp_path / 'home/selected.txt')}, output={'content': 'blue'}) + [final()])
    result = grade(run, {'expect': {'tools': [{'tool': 'read', 'ok': True, 'args': {'path': '~/selected.txt'}, 'outputIncludes': ['blue']}]}})
    assert result['all_pass']


def test_equivalent_mutation_tool_is_accepted(tmp_path):
    run = capture(tmp_path, events=action('edit', output={'changed': True}) + [final()])
    assert grade(run, {'expect': {'tools': [{'tool': ['write', 'edit'], 'ok': True}]}})['all_pass']


def test_benchmark_explicitly_selects_its_plugin_inputs_without_removing_denials(tmp_path):
    workspace = tmp_path / 'workspace'
    external = tmp_path / 'external'
    external.mkdir()
    (external / 'plugin.json').write_text(json.dumps({'name': 'web'}))
    generated = workspace / 'plugins/notice'
    generated.mkdir(parents=True)
    (generated / 'plugin.json').write_text(json.dumps({'name': 'harness-notice'}))
    state = workspace / '.agent-compositor/extensions-state.json'
    state.parent.mkdir()
    state.write_text(json.dumps({'disabled': ['web'], 'installed': {}}))

    activate_fixture_plugins(workspace, [external])

    selected = json.loads(state.read_text())
    assert selected['enabled'] == ['harness-notice', 'web']
    assert selected['disabled'] == ['web']


def test_benchmark_preserves_an_explicit_empty_plugin_ceiling(tmp_path):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    (workspace / 'agent-compositor.json').write_text(json.dumps({'enabledPlugins': []}))

    activate_fixture_plugins(workspace, [tmp_path])

    assert not (workspace / '.agent-compositor/extensions-state.json').exists()
