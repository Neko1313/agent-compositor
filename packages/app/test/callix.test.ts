import callixTools from '../../../plugins/callix/tools.js';
import type {ToolContext} from '@agent-compositor/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexProject, parseGraph, queryGraph, runBinary, type Graph } from '../../../plugins/callix/adapter.js';
import {buildAppWithPlugins as buildApp} from './plugin-fixture.js';
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
    expect(queryGraph(graph, { cwd: '.', action: 'references', pattern: 'b' })).toMatchObject({ relations: [graph.relations[0],graph.relations[1]] });
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

describe('semantic failure recovery guidance',()=>{
  it('directs unsupported projects to available text tools without claiming a semantic result',async()=>{
    const tool=callixTools.find(tool=>tool.name==='code_query')!;
    const ctx={cwd:'/project',request:async()=>{throw Error('Callix exited 1: nothing to analyse under /project');}} as unknown as ToolContext;
    const result=await tool.execute(ctx,{action:'outline',path:'greeting.mjs'});
    expect(result.ok).toBe(false);expect(result.error).toContain('Continue with glob, grep or read');
    expect(result.error).toContain('status/refresh cannot add language support');expect(result).not.toHaveProperty('data');
  });
  it('retains other backend failures for normal diagnosis',async()=>{
    const tool=callixTools.find(tool=>tool.name==='code_query')!;
    const ctx={cwd:'/project',request:async()=>{throw Error('Graph schema is corrupt');}} as unknown as ToolContext;
    expect(await tool.execute(ctx,{action:'outline',path:'source.ts'})).toEqual({ok:false,error:'Error: Graph schema is corrupt'});
  });
});

it('explains a missing search directory without retrying or changing scope',async()=>{
 const tool=callixTools.find(tool=>tool.name==='grep')!;let attempts=0;
 const ctx={cwd:'/project',resolvePath:async()=>{attempts++;throw Object.assign(Error('ENOENT: missing directory'),{code:'ENOENT'});}} as unknown as ToolContext;
 const result=await tool.execute(ctx,{pattern:'x',cwd:'guessed-folder'});expect(result.ok).toBe(false);expect(attempts).toBe(1);expect(result.error).toContain('Keep the default cwd');expect(result.error).toContain('Do not invent');
});

it('resolves the project reference cwd for search and graph tools, preserving literal directories and workspace scope', async () => {
  const cwd = await realpath(await temp()), other = await realpath(await temp()), home = await temp();
  const attached = await realpath(await temp());
  await mkdir(join(cwd, '.agent-compositor'));
  await writeFile(join(cwd, '.agent-compositor/callix.json'), JSON.stringify({background:false}));
  await writeFile(join(cwd, 'main.mjs'), 'export const match = "primary";');
  await writeFile(join(other, 'external.mjs'), 'export const match = "external";');
  await writeFile(join(attached, 'attached.mjs'), 'export const match = "attached";');
  const provider = new ScriptedProvider([]);
  const app = await buildApp({cwd, env:{HOME:home}, provider, pluginDirs:[join(process.cwd(), 'plugins/callix')]});
  try {
    const core = app.createCore(async () => false);
    await core.start();
    await core.attachWorkspace(attached);
    const roots = core.workspace.list();
    const grep = (cwd:string) => core.invokeTool('grep', {pattern:'export const match', cwd});
    const glob = (cwd:string) => core.invokeTool('glob', {pattern:'*.mjs', cwd});
    const status = (cwd:string) => core.invokeTool('code_query', {action:'status', cwd});
    expect(await grep(attached)).toMatchObject({ok:true, output:{cwd:attached, matches:[{path:'attached.mjs'}]}});
    expect(await glob('@.')).toMatchObject({ok:true, output:{cwd, files:['main.mjs']}});
    expect(await grep('@.')).toMatchObject({ok:true, output:{cwd, matches:[{path:'main.mjs'}]}});
    expect(await status('@.')).toMatchObject({ok:true, output:{cwd}});
    expect(await glob('./@.')).toMatchObject({ok:false,error:expect.stringContaining('ENOENT')});

    const literal = join(cwd, '@.');
    await mkdir(literal);
    await writeFile(join(literal, 'nested.mjs'), 'export const match = "literal";');
    for (const spelling of ['@.', './@.']) {
      expect(await glob(spelling)).toMatchObject({ok:true, output:{cwd:literal, files:['nested.mjs']}});
      expect(await grep(spelling)).toMatchObject({ok:true, output:{cwd:literal, matches:[{path:'nested.mjs'}]}});
      expect(await status(spelling)).toMatchObject({ok:true, output:{cwd:literal}});
    }
    await rm(literal, {recursive:true});
    await symlink(other, literal);
    expect(await grep('@.')).toMatchObject({ok:false,error:expect.stringContaining('escapes attached workspaces')});
    await rm(literal);
    await symlink(join(other, 'missing'), literal);
    expect(await glob('@.')).toMatchObject({ok:false,error:expect.stringContaining('ENOENT')});
    await rm(literal);
    await writeFile(literal, 'a regular file');
    expect(await status('@.')).toMatchObject({ok:false,error:expect.stringContaining('Not a workspace directory')});
    expect(core.workspace.list()).toEqual(roots);
    expect(provider.requests).toHaveLength(0);
  } finally {
    await app.close();
  }
});
