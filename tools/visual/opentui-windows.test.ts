import {expect, it} from 'vitest';
import {connectWindowLayout} from './opentui-windows.js';

const panes = ['main', 'side', 'workflows', 'plugins'].map(id => ({id, label: id}));
function memory(initial?: unknown) {
  let value = initial;
  const saved: unknown[] = [];
  return {
    saved, loadLayout: async () => structuredClone(value),
    saveLayout: async (next: unknown) => { value = structuredClone(next); saved.push(value); },
  };
}
const leaves = (tree: any): string[] => !tree ? [] : tree.surface ? [tree.surface] : tree.children.flatMap(leaves);
const frame = (layout: Awaited<ReturnType<typeof connectWindowLayout>>, id: string) =>
  layout.snapshot().frames.find(frame => frame.surface === id)!;

it('keeps a real nested tree, workspace ownership and intentionally closed panes across restoration', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(160, 40);
  layout.act({type: 'open', id: 'plugins'});
  layout.act({type: 'open', id: 'workflows'});
  expect(layout.snapshot().frames).toHaveLength(4);
  expect(layout.snapshot().locations).toEqual({main: 1, side: 1, plugins: 1, workflows: 1});
  layout.act({type: 'moveWorkspace', id: 2});
  expect(layout.snapshot()).toMatchObject({workspace: 2, focused: 'workflows'});
  layout.act({type: 'workspace', id: 1});
  layout.act({type: 'open', id: 'workflows'});
  expect(layout.snapshot()).toMatchObject({workspace: 2, focused: 'workflows'});
  expect(layout.snapshot().frames).toHaveLength(1);
  layout.act({type: 'open', id: 'side'});
  expect(layout.snapshot().workspace).toBe(1);
  layout.act({type: 'close'});
  expect(layout.snapshot().locations.side).toBeUndefined();
  layout.act({type: 'workspace', id: 3});
  expect(layout.snapshot().frames).toEqual([]);
  await layout.disconnect();
  const restored = await connectWindowLayout(storage, {panes});
  restored.resize(160, 40);
  expect(restored.snapshot()).toMatchObject({workspace: 3, focused: 'input', locations: {main: 1, plugins: 1, workflows: 2}});
  expect(restored.snapshot().locations.side).toBeUndefined();
  expect(restored.snapshot().frames).toEqual([]);
  restored.act({type: 'open', id: 'side'});
  expect(restored.snapshot().locations.side).toBe(3);
  await restored.disconnect();
  const all = (storage.saved.at(-1) as any).spaces.flatMap((space: any) => leaves(space.tree));
  expect(new Set(all).size).toBe(all.length);
});

it('ignores stale gesture starts and restores a cancelled resize, including after viewport changes', async () => {
  const layout = await connectWindowLayout(memory(), {panes});
  layout.resize(120, 40);
  const original = frame(layout, 'main').width;
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: original - 1, y: 10,
    revision: layout.snapshot().revision - 1});
  layout.act({type: 'pointer', phase: 'move', x: 90, y: 10});
  expect(frame(layout, 'main').width).toBe(original);
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: original - 1, y: 10,
    revision: layout.snapshot().revision});
  layout.act({type: 'pointer', phase: 'move', x: 90, y: 10});
  expect(frame(layout, 'main').width).toBe(90);
  layout.act({type: 'pointer', phase: 'cancel', x: 90, y: 10});
  expect(frame(layout, 'main').width).toBe(original);
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: original - 1, y: 10});
  layout.act({type: 'pointer', phase: 'move', x: 90, y: 10});
  layout.resize(100, 30);
  expect(frame(layout, 'main').width).toBe(65);
  layout.act({type: 'pointer', phase: 'up', x: 90, y: 10});
  expect(frame(layout, 'main').width).toBe(65);
  await layout.disconnect();
});

it('projects only the focused pane in compact geometry without changing the saved tree', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(100, 30);
  const wide = layout.snapshot().frames;
  const revision = layout.snapshot().revision;
  layout.act({type: 'pointer', phase: 'move', x: 64, y: 10});
  expect(layout.snapshot()).toMatchObject({pointer: 'ew-resize', revision});
  layout.act({type: 'pointer', phase: 'move', x: 2, y: 0});
  expect(layout.snapshot()).toMatchObject({pointer: 'grab', revision});
  layout.resize(48, 14);
  expect(layout.snapshot()).toMatchObject({compact: true, frames: [{surface: 'main', x: 0, y: 0, width: 48, height: 14}]});
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 31, y: 4});
  expect(layout.snapshot().gesture).toBeUndefined();
  layout.act({type: 'cycle'});
  expect(layout.snapshot().frames).toEqual([{surface: 'side', x: 0, y: 0, width: 48, height: 14}]);
  layout.act({type: 'direction', key: 'left'});
  expect(layout.snapshot().focused).toBe('main');
  layout.resize(100, 30);
  expect(layout.snapshot().frames).toEqual(wide);
  await layout.disconnect();
  expect((storage.saved.at(-1) as any).spaces[0].tree.ratio).toBe(.65);
});

it('commits title edge drops and workspace drops through the existing manager', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(100, 30);
  const main = frame(layout, 'main'), side = frame(layout, 'side');
  layout.act({type: 'pointer', phase: 'down', kind: 'title', x: side.x + 2, y: side.y});
  layout.act({type: 'pointer', phase: 'move', x: 30, y: main.height - 1});
  expect(layout.snapshot().drop).toEqual({surface: 'main', edge: 'bottom'});
  layout.act({type: 'pointer', phase: 'up', x: 30, y: main.height - 1});
  expect(frame(layout, 'main')).toMatchObject({x: 0, y: 0, width: 100, height: 15});
  expect(frame(layout, 'side')).toMatchObject({x: 0, y: 15, width: 100, height: 15});
  layout.act({type: 'pointer', phase: 'down', kind: 'title', x: 2, y: 15});
  layout.act({type: 'pointer', phase: 'up', x: 2, y: -1, workspace: 2});
  expect(layout.snapshot()).toMatchObject({workspace: 2, focused: 'side', locations: {main: 1, side: 2}});
  await layout.disconnect();
  const restored = await connectWindowLayout(storage, {panes});
  restored.resize(100, 30);
  expect(restored.snapshot()).toMatchObject({workspace: 2, focused: 'side'});
  expect(restored.snapshot().frames).toEqual([{surface: 'side', x: 0, y: 0, width: 100, height: 30}]);
  await restored.disconnect();
});

it('keeps zoom when opening panes, excludes unknown saved identities and rejects invalid registration', async () => {
  const storage = memory({version: 1, workspace: 1, focused: 'main', axis: 'horizontal', fullscreen: true,
    spaces: [{id: 1, tree: {axis: 'horizontal', ratio: .5, children: [{surface: 'main'}, {surface: 'missing'}]}}]});
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(100, 30);
  expect(layout.snapshot().locations).toEqual({main: 1});
  layout.act({type: 'open', id: 'plugins'});
  expect(layout.snapshot()).toMatchObject({fullscreen: true, focused: 'plugins'});
  expect(layout.snapshot().frames).toEqual([{surface: 'plugins', x: 0, y: 0, width: 100, height: 30}]);
  layout.act({type: 'open', id: 'unknown'});
  expect(layout.snapshot().focused).toBe('plugins');
  await layout.disconnect();
  await expect(connectWindowLayout(memory(), {panes: [{id: 'input', label: 'bad'}]})).rejects.toThrow(/semantic IDs/);
});

it('reports corrupt bounded snapshots and persistence failures without publishing after disconnect', async () => {
  const invalid = memory({version: 1, spaces: [{id: 1, tree: {axis: 'horizontal', ratio: Infinity, children: []}}]});
  const layout = await connectWindowLayout(invalid, {panes});
  expect(layout.snapshot().error).toContain('Could not restore');
  expect(invalid.saved).toEqual([]);
  await layout.disconnect();
  let fail = true, changes = 0;
  const broken = await connectWindowLayout({loadLayout: async () => undefined,
    saveLayout: async () => { if (fail) throw Error('Disk full'); }}, {panes});
  const off = broken.subscribe(() => changes++);
  await expect.poll(() => broken.snapshot().error).toContain('Disk full');
  expect(broken.snapshot().saving).toBe(false);
  fail = false;
  broken.act({type: 'workspace', id: 2});
  await expect.poll(() => broken.snapshot().error).toBeUndefined();
  off();
  await broken.disconnect();
  const count = changes;
  broken.act({type: 'open', id: 'side'});
  broken.resize(100, 30);
  expect(changes).toBe(count);
});
