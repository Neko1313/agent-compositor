import {expect, it} from 'vitest';
import {todoTool} from '../src/tools/todo.js';
import {UndoStore, type ToolContext} from '../src/types.js';

const valid = () => Array.from({length: 5}, (_, index) => ({content: `Task ${index}`, status: 'pending'}));
for (const index of [0, 2, 4]) {
 it.each(['item', 'content', 'status'] as const)(`identifies invalid %s at index ${index} without emitting or mutating`, async field => {
  const args: any = {todos: valid()};
  if (field === 'item') args.todos[index] = null;
  else args.todos[index][field] = 123;
  const before = structuredClone(args);
  let requests = 0;
  const ctx: ToolContext = {cwd: '.', signal: new AbortController().signal, undo: new UndoStore(), request: async () => {requests++; throw Error('Unexpected effect');}};
  const result = await todoTool.execute(ctx, args);
  expect(result).toMatchObject({ok: false, error: expect.stringContaining(`todos[${index}]${field === 'item' ? '' : '.' + field}`)});
  expect(requests).toBe(0);
  expect(args).toEqual(before);
 });
}

it.each([null, 'tasks', {}])('identifies a non-array todos value %j', async todos => {
 const result = await todoTool.execute({} as ToolContext, {todos} as any);
 expect(result).toMatchObject({ok: false, error: expect.stringContaining('todo.todos must be an array')});
});

it.each([null, 'tasks', []])('rejects non-object arguments %j before requesting the service', async args => {
 const result = await todoTool.execute({} as ToolContext, args as any);
 expect(result).toMatchObject({ok: false, error: expect.stringContaining('arguments must be an object')});
});

it('rejects a sparse SDK list instead of emitting holes into the service', async () => {
 const todos = valid();
 delete todos[2];
 const result = await todoTool.execute({} as ToolContext, {todos} as any);
 expect(result).toMatchObject({ok: false, error: expect.stringContaining('todo.todos[2] must be an object')});
 expect(2 in todos).toBe(false);
});
