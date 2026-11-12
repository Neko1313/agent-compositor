import {it, expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, symlink, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '../../core/src/provider.js';
import {evaluationEnvironmentOverlay} from '../../../tools/evals/environment.js';

it('runs real project checks and reads fresh failure and repair reports through separate plugins', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'check-report-cooperation-')));
  const cwd = join(root, 'project'), home = join(root, 'home');
  const provider = new ScriptedProvider([]);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await mkdir(cwd); await mkdir(home); await mkdir(join(cwd, 'reports'));
    await symlink(resolve('node_modules'), join(cwd, 'node_modules'), 'dir');
    await writeFile(join(cwd, 'user-draft.txt'), 'KEEP_USER_DRAFT');
    await writeFile(join(cwd, 'package.json'), JSON.stringify({private: true, type: 'module', scripts: {test: 'node run-check.mjs'}}));
    // Use the installed runner without installing dependencies or inheriting
    // the outer Vitest process's configuration and credential environment.
    await writeFile(join(cwd, 'run-check.mjs'), `import {spawnSync} from 'node:child_process';
const result = spawnSync(process.execPath, [${JSON.stringify(resolve('node_modules/vitest/vitest.mjs'))}, 'run', '--reporter=json', '--outputFile=reports/tests.json', '--maxWorkers=1'], {stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`);
    const tests = (actual: number) => `import {test, expect} from 'vitest';
test('passing assertion', () => expect(1).toBe(1));
test('repairable assertion', () => expect(${actual}).toBe(2));
test.skip('deferred assertion', () => {});
`;
    await writeFile(join(cwd, 'example.test.js'), tests(1));
    await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({
      enabledPlugins: ['project-checks', 'test-reports'],
      agent: {tools: ['project_check', 'test_report'], builtinTools: [], controlTools: [], projectContext: false, skills: false, fileReferences: false},
      permissions: {rules: [{tool: 'project_check', decision: 'allow'}, {tool: 'test_report', decision: 'allow'}]},
    }));
    app = await buildApp({cwd, env: evaluationEnvironmentOverlay(home, root), provider, agentHub: false,
      pluginDirs: [resolve('plugins/project-checks'), resolve('plugins/test-reports')]});
    const core = app.createCore(async () => false);
    const discovered = await core.invokeTool('project_check', {action: 'list'});
    expect(discovered).toMatchObject({ok: true, output: {scripts: [{name: 'test', command: 'node run-check.mjs'}]}});

    const failed = await core.invokeTool('project_check', {action: 'run', name: 'test'});
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('failed (exit 1)');
    const failingBytes = await readFile(join(cwd, 'reports/tests.json'), 'utf8');
    const failures = await core.invokeTool('test_report', {path: 'reports/tests.json'});
    expect(failures).toMatchObject({ok: true, output: {total: 3, passed: 1, failed: 1, skipped: 1,
      failures: [{name: 'repairable assertion'}]}});

    await writeFile(join(cwd, 'example.test.js'), tests(2));
    const repaired = await core.invokeTool('project_check', {action: 'run', name: 'test'});
    expect(repaired).toMatchObject({ok: true, output: {exitCode: 0}});
    expect(await readFile(join(cwd, 'reports/tests.json'), 'utf8')).not.toBe(failingBytes);
    expect(await core.invokeTool('test_report', {path: 'reports/tests.json'})).toMatchObject({
      ok: true, output: {total: 3, passed: 2, failed: 0, skipped: 1, failures: []},
    });
    expect(await readFile(join(cwd, 'user-draft.txt'), 'utf8')).toBe('KEEP_USER_DRAFT');
    expect(provider.requests).toHaveLength(0);
  } finally {
    await app?.close(); await rm(root, {recursive: true, force: true});
  }
}, 30000);
