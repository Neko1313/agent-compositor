import json

import pytest

from harness2_adapter import fixture_path
from harness2_bench import grade, CompositorBenchmark
from harness2.core.judge import judge_one
from harness2_helpers import action, capture, final

pytestmark = [pytest.mark.unit, pytest.mark.harness2]


@pytest.mark.parametrize('events,execution', [
    ([final()], {'returncode': 1}),
    ([final()], {'error': 'deadline exceeded'}),
    ([final(error='provider unavailable')], {'returncode': 0}),
    ([], {'returncode': 0}),
    ([final(), final()], {'returncode': 0}),
    ([final(response='')], {'returncode': 0}),
])
def test_incomplete_or_failed_execution_cannot_pass(tmp_path, events, execution):
    run = capture(tmp_path, events=events, execution=execution)
    assert not grade(run, {'expect': {}})['all_pass']


def test_success_claim_without_file_effect_fails(tmp_path):
    run = capture(tmp_path, events=[final(response='I wrote the correct answer')])
    assert not grade(run, {'expect': {'files': {'answer.txt': 'correct'}}})['all_pass']


@pytest.mark.parametrize('mutation', ['orphan', 'wrong_tool', 'wrong_args', 'wrong_content'])
def test_tool_evidence_requires_matching_call_arguments_and_observation(tmp_path, mutation):
    events = action(args={'path': 'facts.txt'}, output={'content': 'evidence'})
    if mutation == 'orphan':
        events.pop(0)
    elif mutation == 'wrong_tool':
        events[0]['input']['tool'] = 'write'
    elif mutation == 'wrong_args':
        events[0]['input']['input']['path'] = 'other.txt'
    else:
        events[1]['input']['output']['content'] = 'unrelated'
    run = capture(tmp_path, events=events + [final()])
    expected = {'tools': [{'tool': 'read', 'ok': True, 'args': {'path': 'facts.txt'}, 'outputIncludes': ['evidence']}]}

    assert not grade(run, {'expect': expected})['all_pass']


def test_private_content_leak_and_redirect_follow_are_failures(tmp_path):
    run = capture(tmp_path, http={'model': [{'messages': [{'content': 'PRIVATE'}]}], 'requests': ['/redirect', '/hidden']})
    result = grade(run, {'expect': {'privateTokens': ['PRIVATE'], 'noHttpPaths': ['/hidden']}})
    assert result['n_criteria'] - result['n_passed'] == 2


def test_changed_protected_file_cannot_pass_denial(tmp_path):
    run = capture(tmp_path, events=action('write', ok=False, error='denied') + [final()])
    (run / 'workspace/protected').write_text('changed')
    assert not grade(run, {'expect': {'files': {'protected': 'original'}}})['all_pass']


def test_artifact_symlink_escape_is_a_failure_not_judge_error(tmp_path):
    run = capture(tmp_path)
    (run / 'home/secret').write_text('secret')
    (run / 'workspace/report').symlink_to(run / 'home/secret')
    assert not grade(run, {'expect': {'files': {'report': 'secret'}}})['all_pass']


@pytest.mark.parametrize('name', ['../escape', '/tmp/escape', 'nested/../../escape', ''])
def test_fixture_paths_cannot_escape_root(tmp_path, name):
    with pytest.raises(ValueError, match='escapes'):
        fixture_path(tmp_path, name)


def test_judge_failure_is_ungraded_instead_of_zero(tmp_path):
    bench = CompositorBenchmark(tmp_path)
    run = tmp_path / 'broken'
    run.mkdir()

    result = judge_one(bench, 'read-evidence', 'base', 1, 'base', 'broken', run)

    assert not result.graded
    assert result.n_passed is None
    assert result.error


def test_invalid_split_and_duplicate_cases_are_rejected(tmp_path):
    bench = CompositorBenchmark(tmp_path / 'normal')
    with pytest.raises(ValueError, match='split'):
        bench.tasks('hidden')
    path = tmp_path / 'cases.json'
    path.write_text(json.dumps([{'id': 'same'}, {'id': 'same'}]))
    with pytest.raises(ValueError, match='unique'):
        CompositorBenchmark(tmp_path / 'invalid', cases=path)


def test_same_basename_in_a_different_root_is_not_equivalent(tmp_path):
    run = capture(tmp_path, events=action(args={'path': 'selected.txt'}, output={'content': 'blue'}) + [final()])
    result = grade(run, {'expect': {'tools': [{'tool': 'read', 'ok': True, 'args': {'path': '~/selected.txt'}}]}})
    assert not result['all_pass']
