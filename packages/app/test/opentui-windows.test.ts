import {expect, it} from 'vitest';
import {connectWindowLayout} from '../src/opentui-windows.js';

const panes = [{id: 'session', label: 'Main'}, {id: 'tools', label: 'Tools'}];
const leaf = (surface: string) => ({surface});
const split = (axis: string, ratio: number, a: unknown, b: unknown) => ({axis, ratio, children: [a, b]});
const state = (tree: unknown, focused = 'session') => ({version: 1, workspace: 1, focused,
  axis: 'horizontal', fullscreen: false, spaces: [{id: 1, tree, focus: focused}]});
function memory(initial?: unknown) {
  let value = initial;
  const saved: any[] = [];
  return {saved, loadLayout: async () => structuredClone(value),
    saveLayout: async (next: unknown) => {value = structuredClone(next); saved.push(value);}};
}
const ids = (tree: any): string[] => !tree ? [] : tree.surface ? [tree.surface] : tree.children.flatMap(ids);

it('reads AppUI layout envelopes, preserves legacy views and keeps late owners out of rendering and hit testing', async () => {
  const tree = split('horizontal', .7, leaf('session'), split('vertical', .3, leaf('plugin-late-pane'), leaf('window-7')));
  const views = [{id: 'window-7', title: 'Earlier conversation', kind: 'session'}];
  const storage = memory({windows: state(tree, 'plugin-late-pane'), views,
    registered: ['session', 'tools', 'plugin-late-pane', 'window-7', 'plugin-closed-pane']});
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  expect(layout.snapshot()).toMatchObject({focused: 'session', locations: {session: 1},
    frames: [{surface: 'session', x: 0, y: 0, width: 120, height: 40}]});
  layout.act({type: 'focus', id: 'plugin-late-pane'});
  layout.act({type: 'open', id: 'plugin-closed-pane'});
  expect(layout.snapshot().focused).toBe('session');
  layout.register({id: 'plugin-late-pane', label: 'Loaded later'}, {site: 'sidebar', workspace: 3});
  expect(layout.snapshot()).toMatchObject({workspace: 1, focused: 'plugin-late-pane',
    locations: {session: 1, 'plugin-late-pane': 1}});
  expect(layout.snapshot().frames.find(frame => frame.surface === 'plugin-late-pane')).toMatchObject({x: 84, width: 36, height: 40});
  layout.register({id: 'window-7', label: 'Earlier conversation'});
  expect(layout.snapshot().frames.find(frame => frame.surface === 'window-7')).toMatchObject({x: 84, y: 12, height: 28});
  layout.register({id: 'plugin-closed-pane', label: 'Intentionally closed'}, {workspace: 2});
  expect(layout.snapshot().locations['plugin-closed-pane']).toBeUndefined();
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(tree);
  expect(storage.saved.at(-1).views).toEqual(views);
  expect(storage.saved.at(-1).registered).toContain('plugin-closed-pane');
});

it('normalizes an AppUI composer focus to its last content pane without persisting a pruned startup tree', async () => {
  const saved = state(split('horizontal', .6, leaf('session'), leaf('plugin-late-pane')));
  saved.focused = 'input';
  const storage = memory({windows: saved, views: []});
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});
  layout.resize(48, 18);
  expect(layout.snapshot()).toMatchObject({focused: 'session', frames: [{surface: 'session', width: 48, height: 18}]});
  expect(storage.saved).toEqual([]);
  layout.act({type: 'workspace', id: 2});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(saved.spaces[0].tree);
});

it('persists closed dynamic identities and never reopens them on ordinary content republication or restart', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});
  layout.register({id: 'plugin-new-pane', label: 'New tool'}, {site: 'sidebar', workspace: 2, size: .2, focus: false});
  expect(layout.snapshot()).toMatchObject({workspace: 1, locations: {session: 1, 'plugin-new-pane': 2}});
  layout.act({type: 'open', id: 'plugin-new-pane'});
  layout.act({type: 'close'});
  layout.register({id: 'plugin-new-pane', label: 'Fresh result'}, {workspace: 3});
  expect(layout.snapshot().locations['plugin-new-pane']).toBeUndefined();
  await layout.disconnect();
  const restored = await connectWindowLayout(storage, {panes: [panes[0]]});
  restored.register({id: 'plugin-new-pane', label: 'Loaded again'}, {workspace: 3});
  expect(restored.snapshot().locations['plugin-new-pane']).toBeUndefined();
  restored.act({type: 'open', id: 'plugin-new-pane'});
  expect(restored.snapshot().locations['plugin-new-pane']).toBe(2);
  restored.forget('plugin-new-pane');
  restored.register({id: 'plugin-new-pane', label: 'Re-enabled'}, {workspace: 3, focus: false});
  expect(restored.snapshot().locations['plugin-new-pane']).toBe(3);
  await restored.disconnect();
});

it('withdraws detached source generations without losing open workspace, closed identity or canonical saved state', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  layout.register({id: 'plugin-open-pane', label: 'Open tool'}, {site: 'sidebar', workspace: 3, size: .3, focus: false});
  layout.register({id: 'plugin-closed-pane', label: 'Closed tool'}, {site: 'sidebar', workspace: 2, focus: false});
  layout.act({type: 'open', id: 'plugin-closed-pane'});
  layout.act({type: 'close'});
  layout.act({type: 'workspace', id: 1});
  await expect.poll(() => layout.snapshot().saving).toBe(false);
  const saved = structuredClone(storage.saved.at(-1)), writes = storage.saved.length;
  const focus = layout.snapshot().focused;
  layout.detach('plugin-open-pane'); layout.detach('plugin-closed-pane');
  expect(layout.snapshot().locations['plugin-open-pane']).toBeUndefined();
  expect(layout.snapshot().locations['plugin-closed-pane']).toBeUndefined();
  layout.act({type: 'open', id: 'plugin-open-pane'});
  layout.act({type: 'focus', id: 'plugin-open-pane'});
  layout.relocate('plugin-open-pane', {workspace: 8, focus: true});
  expect(layout.snapshot()).toMatchObject({workspace: 1, focused: focus});
  expect(layout.snapshot().frames.some(frame => frame.surface === 'plugin-open-pane')).toBe(false);
  expect(storage.saved).toHaveLength(writes);
  expect(() => layout.register({id: 'plugin-open-pane', label: 'Changed lifetime', transient: true})).toThrow(/persistence lifetime/);
  layout.register({id: 'plugin-open-pane', label: 'Replacement source'}, {workspace: 8, site: 'inspector', focus: true});
  layout.register({id: 'plugin-closed-pane', label: 'Replacement closed source'}, {workspace: 8, focus: true});
  expect(layout.snapshot().locations['plugin-open-pane']).toBe(3);
  expect(layout.snapshot().locations['plugin-closed-pane']).toBeUndefined();
  await expect.poll(() => layout.snapshot().saving).toBe(false);
  expect(storage.saved.at(-1).windows).toEqual(saved.windows);
  expect(storage.saved.at(-1).registered).toEqual(saved.registered);
  layout.detach('plugin-closed-pane'); layout.forget('plugin-closed-pane');
  layout.register({id: 'plugin-closed-pane', label: 'Actually re-enabled'}, {workspace: 8, focus: false});
  expect(layout.snapshot().locations['plugin-closed-pane']).toBe(8);
  await layout.disconnect();
});

it('cancels a detached pane gesture while keeping its original tree available for re-admission', async () => {
  const tree = split('horizontal', .7, leaf('session'), leaf('plugin-live-pane'));
  const storage = memory({windows: state(tree), registered: ['session', 'plugin-live-pane']});
  const layout = await connectWindowLayout(storage, {panes: [panes[0], {id: 'plugin-live-pane', label: 'Live'}]});
  layout.resize(120, 40);
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 83, y: 10});
  layout.act({type: 'pointer', phase: 'move', x: 72, y: 10});
  expect(layout.snapshot().gesture).toBe('resize');
  layout.detach('plugin-live-pane');
  expect(layout.snapshot()).toMatchObject({gesture: undefined, pointer: 'default', locations: {session: 1},
    frames: [{surface: 'session', x: 0, y: 0, width: 120, height: 40}]});
  layout.act({type: 'pointer', phase: 'up', x: 72, y: 10});
  layout.register({id: 'plugin-live-pane', label: 'Reloaded'});
  expect(layout.snapshot().frames.find(frame => frame.surface === 'plugin-live-pane')).toMatchObject({x: 84, width: 36});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(tree);
});

it('changes the nearest visible split while retaining hidden owner subtrees and custom ratios', async () => {
  const hidden = split('vertical', .4, leaf('session'), leaf('plugin-late-pane'));
  const storage = memory({windows: state(split('horizontal', .7, hidden, leaf('tools'))), views: []});
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  layout.act({type: 'orient'});
  expect(layout.snapshot().frames).toEqual([
    {surface: 'session', x: 0, y: 0, width: 120, height: 28},
    {surface: 'tools', x: 0, y: 28, width: 120, height: 12},
  ]);
  layout.act({type: 'resize', delta: .05});
  layout.act({type: 'swap'});
  layout.register({id: 'plugin-late-pane', label: 'Late owner'});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(split('vertical', .75, leaf('tools'), hidden));
});

it('maps native resize handles to retained tree paths and preserves late owner placement after pointer resizing', async () => {
  const hidden = split('vertical', .4, leaf('session'), leaf('plugin-late-pane'));
  const storage = memory({windows: state(split('horizontal', .7, hidden, leaf('tools'))), views: []});
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 83, y: 10});
  layout.act({type: 'pointer', phase: 'move', x: 72, y: 10});
  expect(layout.snapshot().frames[0]).toMatchObject({surface: 'session', width: 72});
  layout.act({type: 'pointer', phase: 'up', x: 72, y: 10});
  layout.register({id: 'plugin-late-pane', label: 'Late owner'});
  expect(layout.snapshot().frames.find(frame => frame.surface === 'plugin-late-pane')).toMatchObject({x: 0, y: 16, width: 72, height: 24});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(split('horizontal', .6, hidden, leaf('tools')));
});

it('cycles and moves only registered panes without losing their unavailable siblings', async () => {
  const storage = memory({windows: state(split('horizontal', .7,
    split('vertical', .4, leaf('session'), leaf('plugin-late-pane')), leaf('tools'))), views: []});
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  layout.act({type: 'cycle'});
  expect(layout.snapshot().focused).toBe('tools');
  layout.act({type: 'cycle'});
  expect(layout.snapshot().focused).toBe('session');
  layout.act({type: 'direction', key: 'right', move: true});
  expect(layout.snapshot().focused).toBe('session');
  expect(layout.snapshot().frames[0].surface).toBe('tools');
  layout.register({id: 'plugin-late-pane', label: 'Late owner'});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(split('horizontal', .7,
    split('vertical', .4, leaf('tools'), leaf('plugin-late-pane')), leaf('session')));
});

it('excludes transient form identities from every persisted tree and closed inventory while leaving them usable in process', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  const persistentFrames = layout.snapshot().frames;
  layout.register({id: 'private-form-token', label: 'Private form title', transient: true}, {site: 'split', focus: true});
  expect(layout.snapshot().focused).toBe('private-form-token');
  expect(layout.snapshot().locations['private-form-token']).toBe(1);
  layout.act({type: 'close'});
  layout.register({id: 'private-form-token', label: 'Next form step', transient: true});
  expect(layout.snapshot().locations['private-form-token']).toBeUndefined();
  layout.act({type: 'open', id: 'private-form-token'});
  expect(layout.snapshot().focused).toBe('private-form-token');
  layout.forget('private-form-token');
  layout.act({type: 'focus', id: 'session'});
  expect(layout.snapshot().frames).toEqual(persistentFrames);
  await layout.disconnect();
  expect(JSON.stringify(storage.saved)).not.toMatch(/private-form-token|Private form title|Next form step/);
  expect(storage.saved.at(-1).registered).toEqual(['session', 'tools']);
});

it('forgets unloaded late owners completely and cancels their live window gestures safely', async () => {
  const storage = memory({windows: state(split('horizontal', .7, leaf('session'), leaf('plugin-late-pane'))), views: []});
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});
  layout.resize(120, 40);
  layout.register({id: 'plugin-late-pane', label: 'Later'});
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 83, y: 10});
  layout.act({type: 'pointer', phase: 'move', x: 72, y: 10});
  expect(layout.snapshot().gesture).toBe('resize');
  layout.forget('plugin-late-pane');
  expect(layout.snapshot()).toMatchObject({gesture: undefined, locations: {session: 1}});
  layout.act({type: 'pointer', phase: 'up', x: 72, y: 10});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(leaf('session'));
  expect(storage.saved.at(-1).registered).not.toContain('plugin-late-pane');
});

it.each(['input', '__swap', '__drag_swap', 'x'.repeat(129)])('rejects unsafe retained ID %s without resaving a silently pruned layout', async id => {
  const storage = memory({windows: state(split('horizontal', .7, leaf('session'), leaf(id))), views: []});
  const layout = await connectWindowLayout(storage, {panes});
  expect(layout.snapshot().error).toContain('Could not restore');
  expect(storage.saved).toEqual([]);
  await layout.disconnect();
});

it('detaches registered metadata and rejects persistence lifetime changes on an existing stable identity', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});
  const pane = {id: 'plugin-live-pane', label: 'Live'};
  layout.register(pane);
  pane.id = 'mutated';
  layout.act({type: 'open', id: 'plugin-live-pane'});
  expect(layout.snapshot().focused).toBe('plugin-live-pane');
  expect(() => layout.register({id: 'plugin-live-pane', label: 'Form', transient: true})).toThrow(/persistence lifetime/);
  await layout.disconnect();
  const count = storage.saved.length;
  layout.register({id: 'ignored', label: 'After shutdown'});
  layout.forget('plugin-live-pane');
  expect(storage.saved).toHaveLength(count);
});

it('does not cancel a live resize or rewrite disk when an existing plugin republishes its content', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  await expect.poll(() => layout.snapshot().saving).toBe(false);
  const writes = storage.saved.length;
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 77, y: 10});
  layout.act({type: 'pointer', phase: 'move', x: 72, y: 10});
  layout.register({id: 'tools', label: 'New tool output'});
  expect(layout.snapshot()).toMatchObject({gesture: 'resize'});
  expect(layout.snapshot().frames[0].width).toBe(72);
  expect(storage.saved).toHaveLength(writes);
  layout.act({type: 'pointer', phase: 'up', x: 72, y: 10});
  await layout.disconnect();
});

it('rejects malformed placements atomically before they can corrupt a saved layout', async () => {
  const storage = memory();
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  const before = layout.snapshot();
  expect(() => layout.register({id: 'bad-size', label: 'Bad'}, {size: NaN})).toThrow(/placement/);
  expect(() => layout.register({id: 'bad-workspace', label: 'Bad'}, {workspace: 10})).toThrow(/placement/);
  expect(layout.snapshot()).toBe(before);
  layout.act({type: 'open', id: 'bad-size'});
  expect(layout.snapshot()).toBe(before);
  await layout.disconnect();
  expect(JSON.stringify(storage.saved)).not.toContain('bad-size');
});

it('rejects a publication beyond the retained tree budget without losing saved late owners or registering a broken pane', async () => {
  const balance = (names: string[]): unknown => names.length === 1 ? leaf(names[0])
    : split('horizontal', .5, balance(names.slice(0, names.length / 2)), balance(names.slice(names.length / 2)));
  const names = ['session', ...Array.from({length: 127}, (_, index) => 'late-' + index)];
  const tree = balance(names);
  const storage = memory({windows: state(tree), views: []});
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});
  layout.resize(120, 40);
  expect(() => layout.register({id: 'over-budget', label: 'Too many'})).toThrow(/bounded window tree/);
  expect(layout.snapshot()).toMatchObject({locations: {session: 1}, focused: 'session'});
  layout.act({type: 'open', id: 'over-budget'});
  layout.act({type: 'workspace', id: 2});
  await layout.disconnect();
  expect(ids(storage.saved.at(-1).windows.spaces[0].tree)).toEqual(names);
  expect(storage.saved.at(-1).registered).not.toContain('over-budget');
});

it('allows an explicit first-admission placement rule to relocate a restored owner while later publications preserve manual moves', async () => {
  const storage = memory({windows: {...state(leaf('session')),spaces:[{id:1,tree:leaf('session'),focus:'session'},
    {id:2,tree:leaf('plugin-late-pane'),focus:'plugin-late-pane'}]},views:[]});
  const layout = await connectWindowLayout(storage, {panes:[panes[0]]});
  layout.register({id:'plugin-late-pane',label:'Late owner'});
  expect(layout.snapshot().locations['plugin-late-pane']).toBe(2);
  layout.relocate('plugin-late-pane',{workspace:3,site:'inspector',focus:true});
  expect(layout.snapshot()).toMatchObject({workspace:3,focused:'plugin-late-pane',locations:{session:1,'plugin-late-pane':3}});
  layout.act({type:'moveWorkspace',id:4});
  layout.register({id:'plugin-late-pane',label:'New content'},{workspace:3,site:'inspector'});
  expect(layout.snapshot().locations['plugin-late-pane']).toBe(4);
  expect(()=>layout.relocate('plugin-late-pane',{workspace:99})).toThrow(/placement/);
  layout.relocate('unknown',{workspace:3});
  layout.act({type:'close'});
  layout.register({id:'plugin-late-pane',label:'Still closed'});
  expect(layout.snapshot().locations['plugin-late-pane']).toBeUndefined();
  await layout.disconnect();
});
