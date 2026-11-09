import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { indexProject, query, queryGraph, type Graph } from '../../../plugins/callix/adapter.js';
import { symbolSlice, budgetResult } from '../../../plugins/callix/navigation.js';
import { estimateTokens } from '@agent-compositor/context';
import { buildApp } from '../src/build.js';
import { ScriptedProvider } from '@agent-compositor/core';
const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0))
    await rm(p, { recursive: true, force: true }); });
async function temp() { const p = await mkdtemp(join(tmpdir(), 'callix-navigation-')); roots.push(p); return p; }
const node = (id: string, name: string, path = 'a.ts', line = 1) => ({ id, name, qualified_name: `${path}.${name}`, kind: 'function', file_path: path, span: [line, 1, line, 12] });
function graph(nodes: any[]): Graph { return { schema_version: 1, nodes, relations: [], metadata: { resolver_status: 'degraded' } }; }
async function fake(root: string, g: Graph, delay = 0) { await mkdir(join(root, '.agent-compositor'), { recursive: true }); const exe = join(root, '.agent-compositor', `fake-${Math.random()}.mjs`); await writeFile(exe, `#!/usr/bin/env node\nimport{appendFileSync}from'node:fs';appendFileSync('.agent-compositor/calls','1\\n');setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(g))}),${delay});`, { mode: 0o700 }); return exe; }
describe('graph query precision and result budgets', () => {
    it('disambiguates identical names using exact paths/IDs and indexes reverse impact with cycle bounds', () => {
        const g = graph([node('a', 'work', 'a.ts'), node('b', 'work', 'nested/a.ts'), node('c', 'caller', 'caller.ts')]);
        g.relations = [{ source_id: 'c', target_id: 'a', kind: 'calls' }, { source_id: 'a', target_id: 'c', kind: 'calls' }];
        expect(queryGraph(g, { cwd: '.', action: 'definition', pattern: 'work', path: 'a.ts' }).symbols.map((n: any) => n.id)).toEqual(['a']);
        expect(queryGraph(g, { cwd: '.', action: 'definition', pattern: 'b' }).symbols.map((n: any) => n.id)).toEqual(['b']);
        expect(queryGraph(g, { cwd: '.', action: 'impact', pattern: 'a', depth: 4 }).relations).toHaveLength(2);
    });
    it('uses UTF-8 byte spans but returns exact UTF-16 edit offsets, including CRLF and non-ASCII prefixes', () => {
        const text = '\uFEFFconst x="👻é"; function café(){return 1;}\r\n', bytes = Buffer.from(text), start = Buffer.byteLength(text.slice(0, text.indexOf('function'))), end = bytes.indexOf('\r');
        const out = symbolSlice(bytes, [1, start + 1, 1, end + 1]);
        expect(out.content).toBe('function café(){return 1;}');
        expect(text.slice(out.range.start, out.range.end)).toBe(out.content);
        expect(() => symbolSlice(bytes, [1, bytes.indexOf(Buffer.from('👻')) + 2, 1, end + 1])).toThrow('UTF-8');
        expect(() => symbolSlice(bytes, [5, 1, 5, 2])).toThrow('span');
    });
    it('paginates bounded JSON without duplicate/skipped records and invalidates cursors after edits', async () => {
        const cwd = await temp();
        await writeFile(join(cwd, 'a.ts'), 'function x(){}\n');
        const g = graph(Array.from({ length: 80 }, (_, i) => node('id' + i, 'symbol' + i)));
        const executable = await fake(cwd, g);
        let cursor: string | undefined;
        const seen: string[] = [];
        for (let page = 0; page < 100; page++) {
            const out = await query({ cwd, action: 'symbols', pattern: 'symbol', settings: { executable }, maxTokens: 512, limit: 40, cursor });
            expect(estimateTokens(JSON.stringify(out))).toBeLessThanOrEqual(512);
            seen.push(...out.symbols.map((n: any) => n.id));
            cursor = out.nextCursor;
            if (!cursor)
                break;
        }
        expect(new Set(seen).size).toBe(80);
        expect(seen).toHaveLength(80);
        const first = await query({ cwd, action: 'symbols', settings: { executable }, maxTokens: 512 });
        await writeFile(join(cwd, 'a.ts'), 'function changed(){}\n');
        await expect(query({ cwd, action: 'symbols', cursor: first.nextCursor, settings: { executable }, maxTokens: 512 })).rejects.toThrow('cursor');
    });
    it('never issues an edit anchor with a truncated source, and reveals ambiguity instead of selecting one definition', async () => {
        const cwd = await temp();
        await writeFile(join(cwd, 'a.ts'), 'x'.repeat(5000));
        await writeFile(join(cwd, 'b.ts'), 'x'.repeat(5000));
        const a = node('a', 'same'), b = node('b', 'same', 'b.ts');
        a.span = [1, 1, 1, 5001];
        b.span = [1, 1, 1, 5001];
        const executable = await fake(cwd, graph([a, b]));
        const ambiguous = await query({ cwd, action: 'read_symbol', pattern: 'same', settings: { executable } });
        expect(ambiguous.ambiguous).toBe(true);
        expect(ambiguous.edit).toBeUndefined();
        const large = await query({ cwd, action: 'read_symbol', pattern: 'a', settings: { executable }, maxTokens: 512 });
        expect(large.sourceTooLarge).toBe(true);
        expect(large.edit).toBeUndefined();
        const full = await query({ cwd, action: 'read_symbol', pattern: 'a', settings: { executable }, maxTokens: 4096 });
        expect(full.edit.expectedHash).toBe(createHash('sha256').update('x'.repeat(5000)).digest('hex'));
        expect(full.content).toHaveLength(5000);
    });
    it('retains endpoint nodes for every returned edge when budgets truncate an adjacency page', async () => {
        const cwd = await temp();
        await writeFile(join(cwd, 'a.ts'), 'function x(){}');
        const nodes = [node('target', 'target'), ...Array.from({ length: 40 }, (_, i) => node('c' + i, 'caller' + i))], g = graph(nodes);
        g.relations = nodes.slice(1).map(n => ({ source_id: n.id, target_id: 'target', kind: 'calls' }));
        const executable = await fake(cwd, g);
        const out = await query({ cwd, action: 'callers', pattern: 'target', settings: { executable }, maxTokens: 700 });
        const ids = new Set(out.nodes.map((n: any) => n.id));
        for (const r of out.relations) {
            expect(ids.has(r.source_id)).toBe(true);
            expect(ids.has(r.target_id)).toBe(true);
        }
        expect(out.nextCursor).toBeTruthy();
    });
});
describe('index freshness and ownership', () => {
    it('shares a build between cancelled and live consumers without cancelling the survivor', async () => {
        const cwd = await temp();
        await writeFile(join(cwd, 'a.ts'), 'function a(){}');
        const executable = await fake(cwd, graph([node('a', 'a')]), 200), one = new AbortController(), two = new AbortController();
        const first = indexProject(cwd, false, one.signal, { settings: { executable } }).then(() => null, e => e), second = indexProject(cwd, false, two.signal, { settings: { executable } });
        await vi.waitFor(async () => expect(await readFile(join(cwd, '.agent-compositor/calls'), 'utf8')).toBe('1\n'));
        one.abort();
        expect(String(await first)).toContain('cancelled');
        expect((await second).graph.nodes[0].id).toBe('a');
        expect(await readFile(join(cwd, '.agent-compositor/calls'), 'utf8')).toBe('1\n');
    });
    it('does not reuse a disk graph from a different executable configuration and filters ignored graph files', async () => {
        const cwd = await temp(), cache = await temp();
        await writeFile(join(cwd, 'a.ts'), 'allowed');
        await writeFile(join(cwd, 'hidden.ts'), 'hidden');
        await writeFile(join(cwd, '.agentignore'), 'hidden.ts\n');
        const first = await fake(cwd, graph([node('first', 'first'), node('hidden', 'hidden', 'hidden.ts')])), second = await fake(cwd, graph([node('second', 'second')]));
        expect((await indexProject(cwd, false, undefined, { settings: { executable: first }, cacheDir: cache })).graph.nodes.map(n => n.id)).toEqual(['first']);
        expect((await indexProject(cwd, false, undefined, { settings: { executable: second }, cacheDir: cache })).graph.nodes.map(n => n.id)).toEqual(['second']);
    });
    it('retries when sources change during analysis instead of tagging a stale graph as current', async () => {
        const cwd = await temp();
        await mkdir(join(cwd, '.agent-compositor'));
        await writeFile(join(cwd, 'a.ts'), 'before');
        const executable = join(cwd, '.agent-compositor/fake.mjs');
        await writeFile(executable, `#!/usr/bin/env node\nimport{readFileSync,appendFileSync}from'node:fs';const name=readFileSync('a.ts','utf8');appendFileSync('.agent-compositor/calls','1\\n');setTimeout(()=>console.log(JSON.stringify({schema_version:1,nodes:[{id:name,name,qualified_name:name,kind:'function',file_path:'a.ts'}],relations:[],metadata:{}})),150);`, { mode: 0o700 });
        const work = indexProject(cwd, false, undefined, { settings: { executable } });
        await vi.waitFor(async () => expect(await readFile(join(cwd, '.agent-compositor/calls'), 'utf8')).toBe('1\n'));
        await writeFile(join(cwd, 'a.ts'), 'after');
        expect((await work).graph.nodes[0].id).toBe('after');
        expect(await readFile(join(cwd, '.agent-compositor/calls'), 'utf8')).toBe('1\n1\n');
    });
});
const native = process.env.CALLIX_TEST_BIN;
describe.skipIf(!native)('real Callix navigation and guarded editing', () => {
    async function project() { const cwd = await temp(); await writeFile(join(cwd, 'package.json'), '{"type":"module"}'); await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] })); return cwd; }
    it('follows aliased cross-file calls, reads UTF-8 spans, applies a precise edit, and refreshes the changed graph', async () => {
        const cwd = await project();
        await writeFile(join(cwd, 'price.ts'), 'const title="👻é"; export function price(n:number){ return n * 2; }\r\nexport function unrelated(n:number){ return n * 2; }\r\n');
        await writeFile(join(cwd, 'main.ts'), 'import {price as compute} from "./price.js";\nexport function checkout(n:number){ return compute(n); }\n');
        const opts = { settings: { executable: native } };
        const found = await query({ cwd, action: 'definition', pattern: 'price', ...opts });
        const id = found.symbols.find((n: any) => n.kind === 'function').id;
        const calls = await query({ cwd, action: 'callers', pattern: id, ...opts });
        expect(calls.nodes.some((n: any) => n.name === 'checkout')).toBe(true);
        expect(calls.metadata.resolver_status).toBe('ok');
        const source = await query({ cwd, action: 'read_symbol', pattern: id, ...opts });
        expect(source.content).toBe('function price(n:number){ return n * 2; }');
        const app = await buildApp({ cwd, env: { HOME: cwd }, provider: new ScriptedProvider([]) }), core = app.createCore(async () => true);
        const edited = await core.invokeTool('edit', { ...source.edit, oldText: 'n * 2', newText: 'n * 3' });
        expect(edited.ok).toBe(true);
        expect(await readFile(join(cwd, 'price.ts'), 'utf8')).toContain('function unrelated(n:number){ return n * 2; }');
        const stale = await core.invokeTool('edit', { ...source.edit, oldText: 'n * 3', newText: 'n * 4' });
        expect(stale.ok).toBe(false);
        expect(stale.error).toContain('stale');
        const fresh = await query({ cwd, action: 'read_symbol', pattern: id, ...opts });
        expect(fresh.content).toContain('n * 3');
        expect(fresh.edit.expectedHash).not.toBe(source.edit.expectedHash);
        await app.close();
    }, 120000);
    it('keeps ordinary edit permission denials binding with a valid native symbol anchor', async () => {
        const cwd = await project();
        await writeFile(join(cwd, 'price.ts'), 'export function price(n:number){ return n * 2; }\n');
        await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({ permissions: { rules: [{ tool: 'edit', path: join(cwd, 'price.ts'), decision: 'deny' }] } }));
        const before = await readFile(join(cwd, 'price.ts'), 'utf8');
        const source = await query({ cwd, action: 'read_symbol', pattern: 'price', settings: { executable: native } });
        const app = await buildApp({ cwd, env: { HOME: cwd }, provider: new ScriptedProvider([]) }), core = app.createCore(async () => true);
        expect((await core.invokeTool('edit', { ...source.edit, oldText: 'n * 2', newText: 'n * 3' })).ok).toBe(false);
        expect(await readFile(join(cwd, 'price.ts'), 'utf8')).toBe(before);
        await app.close();
    }, 120000);
});
it('keeps oversized model-facing tool results valid JSON instead of slicing through anchors', async () => {
    const { AgentCore } = await import('@agent-compositor/core');
    const provider = new ScriptedProvider([{ toolCalls: [{ name: 'big', args: {} }] }, { text: 'done' }]);
    const core = new AgentCore({ cwd: await temp(), provider, onApproval: async () => true, tools: [{ name: 'big', description: 'fixture', parameters: { type: 'object' }, describe: () => ({ tool: 'big' }), execute: async () => ({ ok: true, data: { content: 'x'.repeat(140000), anchor: 'not a complete source' } }) }] });
    await core.submit('inspect');
    const value = JSON.parse(core.getMessages().find(m => m.role === 'tool')!.content);
    expect(value.truncated).toBe(true);
    expect(value.preview.length).toBeLessThanOrEqual(16000);
    expect(value.originalBytes).toBeGreaterThan(128 * 1024);
});

it('reuses adjacency maps rather than scanning every node on warm exact-ID lookups',()=>{
 let iterations=0;const items=Array.from({length:10000},(_,i)=>node('n'+i,'function'+i)),g=graph(new Proxy(items,{get(target,key,receiver){if(key===Symbol.iterator){return function*(){iterations++;yield* target;};}return Reflect.get(target,key,receiver);}}));g.relations=[{source_id:'n9999',target_id:'n0',kind:'calls'}];
 queryGraph(g,{cwd:'.',action:'callers',pattern:'n0'});const before=iterations;const result=queryGraph(g,{cwd:'.',action:'callers',pattern:'n0'});expect(result.nodes.map((n:any)=>n.id)).toContain('n9999');expect(iterations).toBe(before);
});
