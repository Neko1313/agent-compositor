import json
import os
from pathlib import Path
import shutil
import sys

import pytest

from harness2_adapter import CompositorSubstrate
from harness2_bench import CompositorBenchmark

pytestmark = [pytest.mark.integration, pytest.mark.harness2]


@pytest.mark.parametrize('entry', ['file:../escape', 'file:/tmp/escape', 'file:'])
def test_integration_context_cannot_escape_staging(tmp_path, entry):
    bench = CompositorBenchmark(tmp_path)
    with pytest.raises(ValueError, match='escapes staging'):
        bench.substrate.materialise(bench.base_harness(), bench.spec, {entry: 'bad'})


@pytest.mark.parametrize('field', ['files', 'home_files', 'symlinks'])
def test_task_fixtures_cannot_escape_their_scope(tmp_path, field):
    bench = CompositorBenchmark(tmp_path)
    substrate = CompositorSubstrate(output_root=tmp_path)
    install = substrate.materialise(bench.base_harness(), bench.spec, {})
    task = tmp_path / 'task.json'
    task.write_text(json.dumps({'prompt': 'test', field: {'../outside': 'test'}}))
    try:
        with pytest.raises(ValueError, match='escapes'):
            substrate.execute(str(task), install, ['fixture'], 1)
        assert not (tmp_path / 'outside').exists()
    finally:
        shutil.rmtree(install.staging_dir)


def test_deadline_kills_process_and_cannot_be_graded_as_success(tmp_path, monkeypatch):
    bench = CompositorBenchmark(tmp_path)
    substrate = CompositorSubstrate(output_root=tmp_path)
    monkeypatch.setattr(substrate, 'argv', lambda *_args: [sys.executable, '-c', 'import time; time.sleep(60)'])
    install = substrate.materialise(bench.base_harness(), bench.spec, {})
    task = tmp_path / 'task.json'
    task.write_text(json.dumps({'prompt': 'test'}))
    try:
        run = substrate.execute(str(task), install, ['deadline'], .1)[0]
        assert json.loads((run / 'execution.json').read_text())['error'] == 'deadline exceeded'
        assert not bench.score(run, 'read-evidence')['all_pass']
    finally:
        shutil.rmtree(install.staging_dir)


def test_missing_launcher_records_an_execution_error(tmp_path, monkeypatch):
    bench = CompositorBenchmark(tmp_path)
    substrate = CompositorSubstrate(output_root=tmp_path)
    monkeypatch.setattr(substrate, 'argv', lambda *_args: ['/nonexistent/compositor'])
    install = substrate.materialise(bench.base_harness(), bench.spec, {})
    task = tmp_path / 'task.json'
    task.write_text(json.dumps({'prompt': 'test'}))
    try:
        run = substrate.execute(str(task), install, ['missing'], 1)[0]
        assert 'error' in json.loads((run / 'execution.json').read_text())
        assert not bench.score(run, 'read-evidence')['all_pass']
    finally:
        shutil.rmtree(install.staging_dir)


def test_trajectory_tolerates_noise_and_honors_bounds(tmp_path):
    path = tmp_path / 'trajectory.jsonl'
    path.write_text('not json\nnull\n[]\n' + json.dumps({'event': 'tool.result', 'input': {'output': 'x' * 1000}}))
    rendered = CompositorSubstrate().read_trajectory(path, obs_trunc=12, max_chars=24)
    assert rendered.startswith('[OBSERVATION]')
    assert len(rendered) <= 24
