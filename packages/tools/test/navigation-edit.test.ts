import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { editTool, registerDefaultResolvers, UndoStore, queryProject, projectFiles, type ToolContext } from '../src/index.js';
const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0))
    await rm(p, { recursive: true, force: true }); });
async function temp() { const p = await mkdtemp(join(tmpdir(), 'navigation-edit-')); roots.push(p); return p; }
function context(cwd: string): ToolContext { const handlers = new Map<string, (p: any) => Promise<any>>(); registerDefaultResolvers({ on: (s, h) => { handlers.set(s, h); } }, { root: cwd }); return { cwd, signal: new AbortController().signal, undo: new UndoStore(), request: async (s, p) => handlers.get(s)!(p) }; }
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
describe('guarded exact editing', () => {
    it('edits only the selected duplicate block and records a guarded inverse without leaking it in output', async () => {
        const cwd = await temp(), ctx = context(cwd), text = '// 👻 café\r\nfunction first(){ return 1; }\r\nfunction second(){ return 1; }\r\n';
        await writeFile(join(cwd, 'code.ts'), text);
        const start = text.indexOf('function second'), end = text.length - 2;
        const out = await editTool.execute(ctx, { path: 'code.ts', oldText: 'return 1;', newText: 'return 2; // $& literal', expectedHash: sha(text), range: { start, end } });
        expect(out.ok).toBe(true);
        if (out.ok)
            expect(out.data).not.toHaveProperty('undo');
        expect(await readFile(join(cwd, 'code.ts'), 'utf8')).toBe(text.replace('function second(){ return 1; }', () => 'function second(){ return 2; // $& literal }'));
        const inverse = ctx.undo.pop()!.inverse as any;
        expect(inverse.expectedHash).toBeTruthy();
        expect((await editTool.execute(ctx, { ...inverse, path: 'code.ts' })).ok).toBe(true);
        expect(await readFile(join(cwd, 'code.ts'), 'utf8')).toBe(text);
    });
    it('rejects stale snapshots, normalized drift and two concurrent edits from the same snapshot', async () => {
        const cwd = await temp(), ctx = context(cwd);
        await writeFile(join(cwd, 'a.ts'), 'let x = 1;');
        expect((await editTool.execute(ctx, { path: 'a.ts', oldText: 'x = 1', newText: 'x = 2', expectedHash: sha('old') })).ok).toBe(false);
        expect((await editTool.execute(ctx, { path: 'a.ts', oldText: 'x  = 1', newText: 'x = 2', strict: true })).ok).toBe(false);
        const args = { path: 'a.ts', oldText: '1', newText: '2', expectedHash: sha('let x = 1;'), range: { start: 0, end: 10 } };
        const outcomes = await Promise.all([editTool.execute(ctx, args), editTool.execute(context(cwd), { ...args, newText: '3' })]);
        expect(outcomes.filter(r => r.ok)).toHaveLength(1);
        expect(outcomes.find(r => !r.ok)).toMatchObject({ error: expect.stringContaining('stale') });
    });
    it('handles deletion/insertion undo, validates ranges and never follows an escaping symlink', async () => {
        const cwd = await temp(), outside = await temp(), ctx = context(cwd);
        await writeFile(join(cwd, 'a'), 'abc');
        expect((await editTool.execute(ctx, { path: 'a', oldText: 'abc', newText: '', expectedHash: sha('abc'), range: { start: 0, end: 3 } })).ok).toBe(true);
        expect((await editTool.execute(ctx, { path: 'a', ...ctx.undo.pop()!.inverse as any })).ok).toBe(true);
        expect(await readFile(join(cwd, 'a'), 'utf8')).toBe('abc');
        expect((await editTool.execute(ctx, { path: 'a', oldText: 'a', newText: 'b', range: { start: 0, end: 1 } })).ok).toBe(false);
        await writeFile(join(outside, 'secret'), 'do not touch');
        await symlink(join(outside, 'secret'), join(cwd, 'link'));
        expect((await editTool.execute(ctx, { path: 'link', oldText: 'do not', newText: 'changed' })).ok).toBe(false);
        expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('do not touch');
    });
    it('normalized replacement terminates and rejects ambiguity instead of choosing the first occurrence', async () => {
        const cwd = await temp(), ctx = context(cwd);
        await writeFile(join(cwd, 'a'), 'a   b\na   b\n');
        expect((await editTool.execute(ctx, { path: 'a', oldText: 'a b', newText: 'done' })).ok).toBe(false);
        const all = await editTool.execute(ctx, { path: 'a', oldText: 'a b', newText: 'a b', replaceAll: true });
        expect(all).toMatchObject({ ok: true, data: { replacements: 2, match: 'normalized' } });
        expect(await readFile(join(cwd, 'a'), 'utf8')).toBe('a b\na b\n');
    });
});
describe('bounded project search', () => {
    it('honors nested ignore/negation rules outside git and handles filenames with spaces', async () => {
        const cwd = await temp();
        await mkdir(join(cwd, 'src'));
        await writeFile(join(cwd, '.gitignore'), '*.log\n');
        await writeFile(join(cwd, 'src/.gitignore'), '!keep.log\n');
        for (const f of ['src/a.log', 'src/keep.log', 'src/code with space.ts'])
            await writeFile(join(cwd, f), 'needle\n');
        await writeFile(join(cwd, '.agentignore'), 'src/keep.log\n');
        expect(await projectFiles(cwd)).toContain('src/code with space.ts');
        expect(await projectFiles(cwd)).not.toContain('src/a.log');
        expect(await projectFiles(cwd)).not.toContain('src/keep.log');
        expect(await queryProject({ cwd, action: 'grep', pattern: 'needle' })).toMatchObject({ matches: [{ path: 'src/code with space.ts', line: 1, text: 'needle' }], truncated: false });
    });
    it('paginates deterministically and distinguishes exact exhaustion from truncation', async () => {
        const cwd = await temp();
        await writeFile(join(cwd, 'b.ts'), 'needle\nneedle\n');
        await writeFile(join(cwd, 'a.ts'), 'needle\n');
        const first = await queryProject({ cwd, action: 'grep', pattern: 'needle', regex: true, limit: 2 });
        expect(first.matches.map((m: any) => m.path)).toEqual(['a.ts', 'b.ts']);
        expect(first.truncated).toBe(true);
        expect(await queryProject({ cwd, action: 'grep', pattern: 'needle', regex: true, limit: 2, offset: 2 })).toMatchObject({ matches: [{ path: 'b.ts', line: 2 }], truncated: false });
        expect(await queryProject({ cwd, action: 'glob', pattern: '**/*.ts', limit: 2 })).toMatchObject({ files: ['a.ts', 'b.ts'], truncated: false, total: 2 });
    });
    it('skips binary/oversized files and escaping symlinks; validates paths and cancelled requests', async () => {
        const cwd = await temp(), outside = await temp();
        await writeFile(join(outside, 'secret'), 'needle');
        await symlink(join(outside, 'secret'), join(cwd, 'link'));
        await writeFile(join(cwd, 'binary'), Buffer.from('needle\0bytes'));
        await writeFile(join(cwd, 'large'), 'needle'.repeat(200000));
        expect((await queryProject({ cwd, action: 'grep', pattern: 'needle' })).matches).toEqual([]);
        expect((await queryProject({ cwd, action: 'grep', pattern: 'needle', regex: true })).matches).toEqual([]);
        await expect(queryProject({ cwd, action: 'grep', pattern: 'needle', path: '../' })).rejects.toThrow('escapes');
        await expect(queryProject({ cwd, action: 'grep', pattern: 'x', limit: -1 })).rejects.toThrow('pagination');
        const controller = new AbortController();
        controller.abort();
        await expect(queryProject({ cwd, action: 'glob', pattern: '*' }, controller.signal)).rejects.toThrow();
    });
});
