import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {registerDefaultResolvers, UndoStore, writeTool, type ToolContext} from '../src/index.js';

const header = "import {subtotal} from './math.mjs';";
const body = 'export function checkout(items) { return subtotal(items); }';
const original = header + '\n' + body + '\n';
const roots: string[] = [];
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, {recursive: true, force: true});
});

async function fixture(initial?: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'write-partial-'));
  roots.push(cwd);
  const path = join(cwd, 'checkout.mjs');
  if (initial !== undefined) await writeFile(path, initial);
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const changedPaths: string[] = [];
  registerDefaultResolvers({on: (name, handler) => { handlers.set(name, handler); }}, {
    root: cwd, onFilesChanged: async changed => { changedPaths.push(changed); },
  });
  const ctx: ToolContext = {
    cwd, undo: new UndoStore(), signal: new AbortController().signal,
    request: <T>(name: string, args: unknown) => handlers.get(name)!(args) as Promise<T>,
  };
  return {path, ctx, changedPaths};
}

it.each([
  {content: body}, {content: header, allowPartialOverwrite: false}, {content: ' \nreturn subtotal(items);\t'},
])('preserves the whole source when write receives an existing fragment ($content)', async args => {
  const {path, ctx, changedPaths} = await fixture(original);
  expect(await writeTool.execute(ctx, {path, ...args})).toMatchObject({ok: false, error: expect.stringMatching(/fragment|partial/i)});
  expect(await readFile(path, 'utf8')).toBe(original);
  expect(ctx.undo.size).toBe(0);
  expect(changedPaths).toEqual([]);
});

it.each([
  {initial: undefined, content: body}, {initial: original, content: original},
  {initial: original, content: '  ' + original.trim() + '\t'}, {initial: original, content: ' \n'},
  {initial: original, content: ''}, {initial: original, content: 'export default 42;'},
  {initial: original, content: body, allowPartialOverwrite: true},
])('writes supported complete replacements and retains their undo preimage (case %#)', async ({initial, ...args}) => {
  const {path, ctx} = await fixture(initial);
  expect(await writeTool.execute(ctx, {path, ...args})).toMatchObject({ok: true});
  expect(await readFile(path, 'utf8')).toBe(args.content);
  expect(ctx.undo.pop()?.inverse).toEqual(initial === undefined ? {op: 'delete'} : {op: 'write', content: initial});
});

it.each(['true', null, 1])('rejects a malformed partial overwrite option (%j)', async allowPartialOverwrite => {
  const {path, ctx} = await fixture(original);
  const args = {path, content: 'a different complete replacement', allowPartialOverwrite};
  expect(await writeTool.execute(ctx, args as unknown as Parameters<typeof writeTool.execute>[1])).toMatchObject({
    ok: false, error: expect.stringContaining('allowPartialOverwrite'),
  });
  expect(await readFile(path, 'utf8')).toBe(original);
  expect(ctx.undo.size).toBe(0);
});

it('can restore the original excerpt after an intended file expansion', async () => {
  const {ctx, path} = await fixture(body);
  expect((await writeTool.execute(ctx, {path, content: original})).ok).toBe(true);
  const undo = ctx.undo.pop()!.inverse as {content: string; allowPartialOverwrite?: boolean};
  expect(undo.allowPartialOverwrite).toBe(true);
  expect((await writeTool.execute(ctx, {path, ...undo})).ok).toBe(true);
  expect(await readFile(path, 'utf8')).toBe(body);
});

it('preserves malformed input bytes instead of saving a lossy undo preimage', async () => {
  const {path, ctx, changedPaths} = await fixture();
  const data = Buffer.from([0xf0, 0x80]);
  await writeFile(path, data);
  const result = await writeTool.execute(ctx, {path, content: 'replace', allowPartialOverwrite: true});
  expect(result).toMatchObject({ok: false, error: expect.stringContaining('UTF-8')});
  expect(await readFile(path)).toEqual(data);
  expect(ctx.undo.size).toBe(0);
  expect(changedPaths).toEqual([]);
});

it('retains overwrite behavior for legacy direct file service calls without a precondition', async () => {
  const {path, ctx} = await fixture(original);
  await expect(ctx.request('service.file.write', {path, content: body})).resolves.toMatchObject({path});
  expect(await readFile(path, 'utf8')).toBe(body);
});

it.each([
  {initial: 'unrelated preimage', allowPartialOverwrite: false},
  {initial: undefined, allowPartialOverwrite: true},
])('requires the checked preimage at mutation time, allowPartialOverwrite=$allowPartialOverwrite', async ({initial, allowPartialOverwrite}) => {
  const {path, ctx, changedPaths} = await fixture(initial);
  const request = ctx.request;
  ctx.request = async <T>(name: string, args: unknown): Promise<T> => {
    const result = await request<T>(name, args);
    if (name === 'service.file.readText') await writeFile(path, original);
    return result;
  };
  const args = {path, content: body, allowPartialOverwrite};
  expect(await writeTool.execute(ctx, args)).toMatchObject({ok: false});
  expect(await readFile(path, 'utf8')).toBe(original);
  expect(ctx.undo.size).toBe(0);
  expect(changedPaths).toEqual([]);
});
