import json
from pathlib import Path
import shutil
import subprocess

import pytest

from harness2.core import tree as HT
from harness2.substrate.base import Substrate
from harness2_adapter import CompositorSubstrate, SURFACE, isolated_env
from harness2_bench import CompositorBenchmark, fixture_server, read_events

pytestmark = [pytest.mark.integration, pytest.mark.harness2]


def test_materialised_instructions_skills_plugins_and_context(tmp_path):
    bench = CompositorBenchmark(tmp_path)
    tree = {key: f'{key} instructions\n' for key in SURFACE.always_on}
    tree['AGENTS.md'] += 'For research, read .agents/skills/research/SKILL.md.\n'
    tree.update({'sub_agents/research/AGENT.md': '---\ndescription: Research sources\n---\nUse primary sources',
                 '.agents/skills/research/SKILL.md': '---\nname: research\ndescription: Research sources\n---\nRead sources',
                 'plugins/notice.ts': 'export default {};\n'})
    HT.write_tree(SURFACE, tree, bench.base_harness(), stubs=False)
    substrate = CompositorSubstrate()

    install = substrate.materialise(bench.base_harness(), bench.spec, {'file:context/input.txt': 'visible context', 'channel': 'local'})
    try:
        assert isinstance(substrate, Substrate)
        instructions = (install.staging_dir / 'AGENTS.md').read_text()
        assert all(f'{name} instructions' in instructions for name in SURFACE.always_on)
        assert 'Use primary sources' in instructions
        assert (install.staging_dir / '.agents/skills/research/SKILL.md').is_file()
        assert (install.staging_dir / 'context/input.txt').read_text() == 'visible context'
        assert json.loads((install.staging_dir / 'plugins/notice/plugin.json').read_text())['name'] == 'harness-notice'
        assert install.extras['channel'] == 'local'
        assert 'file:context/input.txt' not in install.extras
    finally:
        shutil.rmtree(install.staging_dir)


def test_actual_cli_execution_is_cached_and_keeps_judging_data_outside_scope(tmp_path):
    bench = CompositorBenchmark(tmp_path)

    run = bench.execute('read-evidence', None, 'evidence', timeout=30)
    repeated = bench.execute('read-evidence', None, 'evidence', timeout=30)

    assert run == repeated
    assert bench.score(run, 'read-evidence')['all_pass']
    assert bench.delivered(run)
    assert 'ap-northeast-3' in bench.deliverable_text(run)
    assert '[ACTION] read' in bench.trajectory(run, obs_trunc=10_000)
    assert not list((run / 'workspace').rglob('*cases.json'))
    assert not (run / 'workspace/http.json').exists()
    assert len(json.loads((run / 'http.json').read_text())['model']) == 2
    with pytest.raises(ValueError, match='different task'):
        bench.execute('denied-mutation', None, 'evidence', timeout=30)
    bench.runtime_fingerprint = 'changed runtime'
    with pytest.raises(ValueError, match='configuration'):
        bench.execute('read-evidence', None, 'evidence', timeout=30)


def test_scope_survives_a_real_cli_process_restart(tmp_path):
    bench = CompositorBenchmark(tmp_path)
    case = {'script': [
        {'calls': [{'name': 'read', 'args': {'path': '~/selected/value.txt'}}]},
        {'text': 'First read complete', 'requires': ['RESUMED_EVIDENCE']},
        {'calls': [{'name': 'read', 'args': {'path': '~/selected/value.txt'}}]},
        {'text': 'Resumed read complete', 'requires': ['RESUMED_EVIDENCE']},
    ]}
    with fixture_server(case, True) as (origin, _capture):
        substrate = CompositorSubstrate(model='scripted', base_url=origin + '/v1', plugin_dirs=[], output_root=tmp_path)
        install = substrate.materialise(bench.base_harness(), bench.spec, {})
        task = tmp_path / 'resume-task.json'
        task.write_text(json.dumps({'prompt': 'Inspect @"~/selected" then read value.txt there.', 'home_files': {'selected/value.txt': 'RESUMED_EVIDENCE'}}))
        try:
            run = substrate.execute(str(task), install, ['resume'], 30)[0]
            result = next(e for e in read_events(run) if e.get('type') == 'result')
            assert not result.get('error')
            restarted = subprocess.run(substrate.argv('Read the same selected value again.', run / 'workspace') + ['--resume', result['sessionId']],
                                       env=isolated_env(run / 'home', 'scripted', origin + '/v1'), cwd=run / 'workspace',
                                       capture_output=True, text=True, timeout=30)
            assert restarted.returncode == 0, restarted.stderr
            events = [json.loads(line) for line in restarted.stdout.splitlines() if line.startswith('{')]
            assert any(e.get('event') == 'tool.result' and e['input']['ok'] and 'RESUMED_EVIDENCE' in str(e['input']) for e in events)
            assert events[-1]['sessionId'] == result['sessionId']
            assert events[-1]['response'] == 'Resumed read complete'
        finally:
            shutil.rmtree(install.staging_dir)


@pytest.mark.parametrize('source,passed', [
    ("export const greet = n => 'Hello, ' + n; export const punctuation = n => n + '!';", True),
    ("console.log('CHECK_PASSED'); export const greet = n => 'Wrong'; export const punctuation = n => n;", False),
    (None, False),
])
def test_independent_check_uses_artifact_behavior_not_printed_success(tmp_path, source, passed):
    from harness2_bench import grade
    from harness2_helpers import capture
    run = capture(tmp_path)
    if source is not None:
        (run / 'workspace/format.mjs').write_text(source)

    result = grade(run, {'expect': {'nodeChecks': [{'file': 'format.mjs', 'expression': "m.greet('Ada') === 'Hello, Ada' && m.punctuation('X') === 'X!'"}]}})

    assert result['all_pass'] is passed


def test_report_parent_configuration_does_not_affect_execution(tmp_path):
    (tmp_path / 'agent-compositor.json').write_text(json.dumps({'permissions': {'rules': [{'tool': 'read', 'decision': 'deny'}]}}))
    bench = CompositorBenchmark(tmp_path / 'reports')

    run = bench.execute('read-evidence', None, 'isolated', timeout=30)

    assert bench.score(run, 'read-evidence')['all_pass']
    execution = json.loads((run / 'execution.json').read_text())
    runtime = Path(execution['run_root'])
    assert not runtime.is_relative_to(tmp_path)
    assert not runtime.exists()
    assert run.is_relative_to(bench.root / 'captures')
