import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexProject, parseGraph, queryGraph, runBinary, type Graph } from '../../../plugins/callix/adapter.js';
import { buildApp } from '../src/build.js';
import { ScriptedProvider } from '@agent-compositor/core';

const graph: Graph = { schema_version: 1, metadata: { resolver_status: { typescript: 'degraded' } }, nodes: [
  { id: 'a', name: 'start', qualified_name: 'app.start', kind: 'function', file_path: 'app.ts', span: [1, 0, 2, 0] },
  { id: 'b', name: 'run', qualified_name: 'app.run', kind: 'function', file_path: 'app.ts', span: [3, 0, 4, 0] },
], relations: [
  { source_id: 'a', target_id: 'b', kind: 'calls', metadata: { span: [2, 0, 2, 4] } },
  { source_id: 'a', target_id: 'b', kind: 'references' },
] };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temp() { const root = await mkdtemp(join(tmpdir(), 'callix adapter ')); roots.push(root); return root; }

describe('native Callix adapter', () => {
  it.skipIf(!process.env.CALLIX_TEST_BIN)('resolves a cross-file call using the real native binary', async () => {
    const root = await temp(); await mkdir(join(root, '.agent-compositor'));
    await writeFile(join(root, '.agent-compositor/callix.json'), JSON.stringify({ executable: process.env.CALLIX_TEST_BIN }));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'callix-integration', private: true, type: 'module' }));
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] }));
    await writeFile(join(root, 'leaf.ts'), 'export function leaf(value: number): number { return value + 1; }\n');
    await writeFile(join(root, 'main.ts'), 'import { leaf } from "./leaf.js";\nexport function start(): number { return leaf(1); }\n');
    const entry = await indexProject(root, true);
    const leaf = entry.graph.nodes.find(n => n.name === 'leaf' && n.kind === 'function');
    expect(leaf).toBeDefined();
    const result = queryGraph(entry.graph, { cwd: root, action: 'callers', pattern: leaf!.id });
    expect((result.relations as unknown[]).length).toBeGreaterThan(0);
    expect(result.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'start' })]));
    expect(result.metadata).toEqual(entry.graph.metadata);
  }, 120000);

  it('queries graph directions, retains locations/quality and rejects unknown schemas', () => {
    expect(queryGraph(graph, { cwd: '.', action: 'callers', pattern: 'b' })).toMatchObject({ relations: [graph.relations[0]], nodes: graph.nodes, metadata: graph.metadata });
    expect(queryGraph(graph, { cwd: '.', action: 'callees', pattern: 'a' })).toMatchObject({ relations: [graph.relations[0]] });
    expect(queryGraph(graph, { cwd: '.', action: 'references', pattern: 'b' })).toMatchObject({ relations: [graph.relations[1]] });
    expect(queryGraph(graph, { cwd: '.', action: 'definition', pattern: 'app.run' })).toMatchObject({ symbols: [graph.nodes[1]] });
    expect(() => parseGraph('{"schema_version":2,"nodes":[],"relations":[]}')).toThrow(/Unsupported/);
  });

  it('runs the configured executable with literal arguments, caches and invalidates edits', async () => {
    const root = await temp();
    await mkdir(join(root, '.agent-compositor'));
    const binary = join(root, 'fake callix.mjs');
    await writeFile(binary, '#!/usr/bin/env node\n' + `import {appendFileSync} from 'node:fs'; appendFileSync('runs.txt',JSON.stringify(process.argv.slice(2))+'\\n'); console.log(${JSON.stringify(JSON.stringify(graph))});`, { mode: 0o700 });
    await writeFile(join(root, '.agent-compositor/callix.json'), JSON.stringify({ executable: binary }));
    // Keep the invocation log outside the source fingerprint.
    await writeFile(join(root, '.agentignore'), 'runs.txt\n');
    await writeFile(join(root, 'app.ts'), 'export const a = 1;');
    const first = await indexProject(root), second = await indexProject(root);
    expect(second).toBe(first);
    await writeFile(join(root, 'app.ts'), 'export const changed = 2;');
    expect(await indexProject(root)).not.toBe(first);
    const { readFile } = await import('node:fs/promises');
    expect((await readFile(join(root, 'runs.txt'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))).toEqual([['analyze', root, '--quiet'], ['analyze', root, '--quiet']]);
  });

  it('reports missing executables, cancellation, timeouts and oversized output', async () => {
    const root = await temp();
    await expect(runBinary(join(root, 'missing'), [], root)).rejects.toThrow(/CALLIX_BIN/);
    await expect(runBinary(process.execPath, ['-e', 'setInterval(()=>{},1000)'], root, undefined, 30)).rejects.toThrow(/exceeded/);
    await expect(runBinary(process.execPath, ['-e', 'console.log("x".repeat(2000))'], root, undefined, 1000, 100)).rejects.toThrow(/output limit/);
    const controller = new AbortController();
    const work = runBinary(process.execPath, ['-e', 'setInterval(()=>{},1000)'], root, controller.signal);
    controller.abort(); await expect(work).rejects.toThrow(/cancelled/);
  });

  it('routes model tools through a replacement provider without starting Callix', async () => {
    const root = await temp(), dir = join(root, 'plugins/replacement'); await mkdir(dir, { recursive: true });
    await writeFile(join(root, 'agent-compositor.json'), JSON.stringify({ serviceProviders: { 'service.project.query': 'replacement' } }));
    await writeFile(join(dir, 'plugin.json'), JSON.stringify({ name: 'replacement', version: '1.0.0', trust: 'trusted', provides: ['service.project.query'] }));
    await writeFile(join(dir, 'hooks.ts'), `export default {'service.project.query': async () => ({value:{provider:'replacement',symbols:['found']}})};`);
    const provider = new ScriptedProvider([{ toolCalls: [{ name: 'code_query', args: { action: 'symbols', pattern: 'x' } }] }, { text: 'done' }]);
    const app = await buildApp({ cwd: root, env: { HOME: root }, provider, pluginDirs: [join(process.cwd(), 'plugins')] });
    expect(app.pluginErrors).toEqual([]);
    const core = app.createCore(async () => false); await core.start(); await core.submit('find x');
    expect(core.getMessages().find(m => m.role === 'tool')?.content).toContain('replacement');
  });
});
