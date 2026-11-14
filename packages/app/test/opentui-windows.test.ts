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

it('admits every saved host kind without reopening closed views and allocates beyond all retained identities', async () => {
  const tree = split('horizontal', .65, leaf('session'), split('vertical', .3, leaf('window-1'), leaf('window-40')));
  const views = [{id: 'window-1', title: 'Conversation', kind: 'session'},
    {id: 'window-2', title: 'Earlier tools', kind: 'tools'}, {id: 'window-20', title: 'Help', kind: 'help'}];
  const storage = memory({windows: state(tree), views, registered: ['session', 'window-50']});
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});layout.resize(160, 40);
  expect(layout.hostViews()).toEqual(views);expect(Object.isFrozen(layout.hostViews()[0])).toBe(true);
  layout.registerClosed({id: 'tools', label: 'Tools'});
  for (const view of layout.hostViews()) layout.registerClosed({id: view.id, label: view.title});
  expect(layout.snapshot().locations).toEqual({session: 1, 'window-1': 1});
  expect(storage.saved).toEqual([]);
  expect(() => {layout.hostViews()[0].title = 'Changed';}).toThrow();
  const created = layout.createHostView('help');
  expect(created).toEqual({id: 'window-51', title: 'Window controls 51', kind: 'help'});
  expect(layout.snapshot().focused).toBe(created.id);
  expect(layout.snapshot().locations['window-20']).toBeUndefined();
  await layout.disconnect();
  expect(storage.saved.at(-1).views).toEqual([...views, created]);
  expect(ids(storage.saved.at(-1).windows.spaces[0].tree)).toContain('window-40');
  expect(storage.saved.at(-1).registered).toContain('window-50');
  const restored = await connectWindowLayout(storage, {panes: [panes[0]]});
  expect(restored.hostViews()).toEqual([...views, created]);
  expect(restored.createHostView('tools').id).toBe('window-52');await restored.disconnect();
});

it.each([
  'not an array', [{id: 'window-0', title: 'Bad', kind: 'session'}],
  [{id: 'window-01', title: 'Bad', kind: 'session'}], [{id: 'window-9007199254740992', title: 'Bad', kind: 'session'}],
  [{id: 'window-1', title: '', kind: 'session'}], [{id: 'window-1', title: 'x'.repeat(513), kind: 'tools'}],
  [{id: 'plugin-impostor-pane', title: 'Bad', kind: 'session'}], [{id: 'window-1', title: 'Bad', kind: 'plugin'}],
  [{id: 'window-1', title: 'A', kind: 'session'}, {id: 'window-1', title: 'B', kind: 'tools'}],
  Array.from({length: 101}, (_, index) => ({id: 'window-' + (index + 1), title: 'Main', kind: 'session'})),
])('rejects malformed host window metadata atomically without rewriting it', async views => {
  const storage = memory({windows: state(leaf('session')), views});
  const layout = await connectWindowLayout(storage, {panes: [panes[0]]});
  expect(layout.hostViews()).toEqual([]);expect(layout.snapshot().error).toContain('Could not restore window layout');
  layout.registerClosed({id: 'tools', label: 'Tools'});await layout.disconnect();
  expect(storage.saved).toEqual([]);
});

it('rolls back host creation at depth, descriptor, serial and retained-identity limits', async () => {
  let tree: unknown = leaf('session');
  for (let index = 0; index < 24; index++) tree = split('horizontal', .5, leaf('late-' + index), tree);
  const fullViews = Array.from({length: 100}, (_, index) => ({id: 'window-' + (index + 1), title: 'Main', kind: 'session'}));
  const cases = [
    {value: {windows: state(tree)}, error: /bounded window tree/},
    {value: {windows: state(leaf('session')), views: fullViews}, error: /Too many host windows/},
    {value: {windows: state(leaf('session')), views: [{id: 'window-9007199254740991', title: 'Last', kind: 'help'}]}, error: /serial is exhausted/},
    {value: {windows: state(leaf('session')), registered: ['session', ...Array.from({length: 255}, (_, index) => 'retained-' + index)]}, error: /Too many registered windows/},
  ];
  for (const item of cases) {
    const storage = memory(item.value), layout = await connectWindowLayout(storage, {panes: [panes[0]]});
    layout.resize(120, 40);const before = layout.snapshot(), views = layout.hostViews();
    expect(layout.snapshot().error).toBeUndefined();
    expect(() => layout.createHostView('session')).toThrow(item.error);
    expect(() => layout.createHostView('plugin' as 'session')).toThrow(/Invalid host window kind/);
    expect(layout.hostViews()).toEqual(views);expect(layout.snapshot().locations).toEqual(before.locations);
    expect(layout.snapshot().focused).toBe(before.focused);expect(layout.snapshot().frames).toEqual(before.frames);
    await layout.disconnect();expect(storage.saved).toEqual([]);
  }
});

it('counts transient manual window intent separately from registration, viewport changes, automatic focus and saves', async () => {
  const storage = memory({windows: state(split('horizontal', .7, leaf('session'), leaf('tools')))});
  const layout = await connectWindowLayout(storage, {panes});expect(layout.windowIntentRevision).toBe(0);
  layout.resize(140, 40);layout.register({id: 'passive', label: 'Passive'}, {focus: false});
  await expect.poll(() => layout.snapshot().saving).toBe(false);
  layout.actAutomatic({type: 'open', id: 'tools'});expect(layout.windowIntentRevision).toBe(0);
  layout.act({type: 'open', id: 'tools'});expect(layout.windowIntentRevision).toBe(1);
  layout.act({type: 'workspace', id: 1});expect(layout.windowIntentRevision).toBe(2);
  const frame = layout.snapshot().frames.find(frame => frame.surface === 'tools')!;
  layout.act({type: 'pointer', phase: 'down', kind: 'pane', x: frame.x + 2, y: frame.y + 2});
  expect(layout.windowIntentRevision).toBe(2);
  layout.act({type: 'pointer', phase: 'down', kind: 'title', x: frame.x + 2, y: frame.y});
  expect(layout.windowIntentRevision).toBe(3);layout.act({type: 'pointer', phase: 'cancel', x: 0, y: 0});
  const divider = layout.snapshot().splitTarget!.divider!;
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: divider.x, y: divider.y});
  expect(layout.windowIntentRevision).toBe(4);layout.act({type: 'pointer', phase: 'cancel', x: 0, y: 0});
  layout.resize(120, 30);layout.markWindowIntent();expect(layout.windowIntentRevision).toBe(5);
  await expect.poll(() => layout.snapshot().saving).toBe(false);expect(layout.windowIntentRevision).toBe(5);
  await layout.disconnect();expect(JSON.stringify(storage.saved)).not.toContain('windowIntent');
  const restored = await connectWindowLayout(storage, {panes});expect(restored.windowIntentRevision).toBe(0);await restored.disconnect();
});

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
  expect(layout.snapshot().compact).toBe(false);
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

it('sets the nearest projected split explicitly without changing detached branches, other workspaces or ratios', async () => {
  const hidden = split('horizontal', .4, leaf('session'), leaf('plugin-detached-pane'));
  const inner = split('vertical', .35, leaf('tools'), leaf('inspector'));
  const remote = split('vertical', .3, leaf('remote-a'), leaf('remote-b'));
  const storage = memory({windows: {...state(split('horizontal', .7, hidden, inner)),
    spaces: [{id: 1, tree: split('horizontal', .7, hidden, inner), focus: 'session'},
      {id: 2, tree: remote, focus: 'remote-a'}]}, registered: ['session', 'tools', 'inspector', 'plugin-detached-pane', 'remote-a', 'remote-b']});
  const registered = [...panes, {id: 'inspector', label: 'Inspector'},
    {id: 'plugin-detached-pane', label: 'Reloading'}, {id: 'remote-a', label: 'Remote A'}, {id: 'remote-b', label: 'Remote B'}];
  const layout = await connectWindowLayout(storage, {panes: registered});
  layout.resize(140, 50);
  layout.detach('plugin-detached-pane');
  layout.act({type: 'focus', id: 'tools'});
  layout.act({type: 'axis', axis: 'horizontal'});
  await expect.poll(() => layout.snapshot().saving).toBe(false);
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(split('horizontal', .7,
    hidden, split('horizontal', .35, leaf('tools'), leaf('inspector'))));
  const writes = storage.saved.length;
  layout.act({type: 'axis', axis: 'horizontal'});
  expect(storage.saved).toHaveLength(writes);
  expect(layout.snapshot().focused).toBe('tools');
  layout.act({type: 'focus', id: 'session'});
  layout.act({type: 'axis', axis: 'vertical'});
  expect(layout.snapshot().axis).toBe('vertical');
  expect(layout.snapshot().frames.some(frame => frame.surface === 'plugin-detached-pane')).toBe(false);
  layout.register({id: 'plugin-detached-pane', label: 'Reloaded'}, {workspace: 9, site: 'inspector'});
  await layout.disconnect();
  const expected = split('vertical', .7, hidden, split('horizontal', .35, leaf('tools'), leaf('inspector')));
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(expected);
  expect(storage.saved.at(-1).windows.spaces[1].tree).toEqual(remote);
  const restored = await connectWindowLayout(storage, {panes: registered});
  restored.resize(140, 50);
  expect(restored.snapshot()).toMatchObject({axis: 'vertical', focused: 'session',
    locations: {'plugin-detached-pane': 1, 'remote-a': 2, 'remote-b': 2}});
  expect(restored.snapshot().frames).toEqual(layout.snapshot().frames);
  await restored.disconnect();
});

it('sets the opening axis on a lone or empty projected workspace without mutating an unavailable split', async () => {
  const hidden = split('horizontal', .4, leaf('session'), leaf('plugin-detached-pane'));
  const storage = memory({windows: state(hidden), registered: ['session', 'plugin-detached-pane']});
  const layout = await connectWindowLayout(storage, {panes: [panes[0], {id: 'plugin-detached-pane', label: 'Reloading'}]});
  layout.resize(120, 40);
  layout.detach('plugin-detached-pane');
  expect(layout.snapshot().splitTarget).toBeUndefined();
  layout.act({type: 'axis', axis: 'vertical'});
  expect(layout.snapshot()).toMatchObject({axis: 'vertical', focused: 'session'});
  layout.act({type: 'workspace', id: 3});
  expect(layout.snapshot().splitTarget).toBeUndefined();
  layout.act({type: 'axis', axis: 'horizontal'});
  expect(layout.snapshot()).toMatchObject({axis: 'horizontal', workspace: 3, frames: []});
  layout.register({id: 'new-a', label: 'New A'}, {focus: true});
  layout.register({id: 'new-b', label: 'New B'}, {focus: true});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces.find((space: any) => space.id === 1).tree).toEqual(hidden);
  expect(storage.saved.at(-1).windows.spaces.find((space: any) => space.id === 3).tree.axis).toBe('horizontal');
});

it('describes the exact nested keyboard and pointer resize target, independently of the next opening axis', async () => {
  const tree = split('horizontal', .6, leaf('session'), split('vertical', .35, leaf('tools'), leaf('inspector')));
  const storage = memory({windows: state(tree, 'inspector')});
  const layout = await connectWindowLayout(storage, {panes: [...panes, {id: 'inspector', label: 'Inspector'}]});
  layout.resize(160, 40);
  expect(layout.snapshot()).toMatchObject({axis: 'horizontal', focused: 'inspector', splitTarget: {
    axis: 'vertical', ratio: .35, focusedChild: 1, children: [['tools'], ['inspector']], visibility: 'visible',
    bounds: {x: 96, y: 0, width: 64, height: 40}, divider: {x: 96, y: 13, width: 64, height: 2},
  }});
  layout.act({type: 'resize', delta: .05});
  expect(layout.snapshot().splitTarget?.ratio).toBeCloseTo(.3);
  expect(layout.snapshot().splitTarget?.divider).toEqual({x: 96, y: 11, width: 64, height: 2});
  layout.act({type: 'axis', axis: 'horizontal'});
  expect(layout.snapshot().splitTarget).toMatchObject({axis: 'horizontal', focusedChild: 1,
    divider: {x: 119, y: 0, width: 2, height: 40}});
  const divider = layout.snapshot().splitTarget!.divider!;
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: divider.x, y: 10});
  expect(layout.snapshot().gesture).toBe('resize');
  layout.act({type: 'pointer', phase: 'move', x: 128, y: 10});
  layout.act({type: 'pointer', phase: 'up', x: 128, y: 10});
  expect(layout.snapshot().splitTarget?.ratio).toBe(.5);
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(
    split('horizontal', .6, leaf('session'), split('horizontal', .5, leaf('tools'), leaf('inspector'))));
});

it('lifts the described target past a detached neighbor and mutates only its mapped canonical split', async () => {
  const hidden = split('horizontal', .4, leaf('session'), leaf('late'));
  const inner = split('vertical', .35, leaf('tools'), leaf('inspector'));
  const storage = memory({windows: state(split('horizontal', .7, hidden, inner), 'inspector')});
  const layout = await connectWindowLayout(storage, {panes: [...panes, {id: 'late', label: 'Late'}, {id: 'inspector', label: 'Inspector'}]});
  layout.resize(140, 50);layout.detach('late');
  expect(layout.snapshot().splitTarget).toMatchObject({focusedChild: 1, children: [['tools'], ['inspector']], ratio: .35});
  layout.act({type: 'resize', delta: .05});
  layout.act({type: 'focus', id: 'session'});
  expect(layout.snapshot().splitTarget).toMatchObject({axis: 'horizontal', ratio: .7, focusedChild: 0,
    children: [['session'], ['tools', 'inspector']], visibility: 'visible'});
  layout.act({type: 'axis', axis: 'vertical'});layout.act({type: 'resize', delta: .05});
  layout.register({id: 'late', label: 'Reloaded'});
  expect(layout.snapshot()).toMatchObject({axis: 'vertical', splitTarget: {
    axis: 'horizontal', ratio: .4, children: [['session'], ['late']], focusedChild: 0,
  }});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(
    split('vertical', .75, hidden, split('vertical', .3, leaf('tools'), leaf('inspector'))));
});

it('keeps a size-limited nearest target distinct from its visible ancestor until that target fits', async () => {
  const tree = split('horizontal', .6, leaf('session'), split('horizontal', .5, leaf('tools'), leaf('inspector')));
  const storage = memory({windows: state(tree, 'inspector')});
  const layout = await connectWindowLayout(storage, {panes: [...panes, {id: 'inspector', label: 'Inspector'}]});
  layout.resize(80, 24);
  expect(layout.snapshot().frames).toEqual([
    {surface: 'session', x: 0, y: 0, width: 48, height: 24},
    {surface: 'inspector', x: 48, y: 0, width: 32, height: 24},
  ]);
  expect(layout.snapshot().splitTarget).toEqual({axis: 'horizontal', ratio: .5, focusedChild: 1,
    children: [['tools'], ['inspector']], visibility: 'size-limited'});
  layout.act({type: 'resize', delta: .05});
  expect(layout.snapshot().splitTarget?.ratio).toBe(.45);
  layout.act({type: 'axis', axis: 'vertical'});
  expect(layout.snapshot().splitTarget).toEqual({axis: 'vertical', ratio: .45, focusedChild: 1,
    children: [['tools'], ['inspector']], visibility: 'visible',
    bounds: {x: 48, y: 0, width: 32, height: 24}, divider: {x: 48, y: 9, width: 32, height: 2}});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(
    split('horizontal', .6, leaf('session'), split('vertical', .45, leaf('tools'), leaf('inspector'))));
});

it('grows the focused second side when its first side contains a detached canonical subtree', async () => {
  const hidden = split('horizontal', .4, leaf('session'), leaf('late'));
  const storage = memory({windows: state(split('horizontal', .7, hidden, leaf('tools')), 'tools')});
  const layout = await connectWindowLayout(storage, {panes: [...panes, {id: 'late', label: 'Late'}]});
  layout.resize(120, 40);layout.detach('late');
  expect(layout.snapshot().splitTarget).toMatchObject({focusedChild: 1, ratio: .7, children: [['session'], ['tools']]});
  layout.act({type: 'resize', delta: .05});layout.act({type: 'axis', axis: 'vertical'});
  expect(layout.snapshot().splitTarget?.ratio).toBeCloseTo(.65);
  layout.register({id: 'late', label: 'Reloaded'});
  expect(layout.snapshot().splitTarget).toMatchObject({focusedChild: 1, axis: 'vertical', children: [['session', 'late'], ['tools']]});
  await layout.disconnect();
  const saved = storage.saved.at(-1).windows.spaces[0].tree;
  expect(saved.axis).toBe('vertical');expect(saved.ratio).toBeCloseTo(.65);
  expect(saved.children).toEqual([hidden, leaf('tools')]);
});

it('reports unmeasured, zoomed and size-limited targets without inventing visible divider geometry', async () => {
  const layout = await connectWindowLayout(memory({windows: state(split('horizontal', .7, leaf('session'), leaf('tools')))}), {panes});
  const hidden = (visibility: string) => {
    expect(layout.snapshot().splitTarget).toEqual({axis: 'horizontal', ratio: .7, focusedChild: 0,
      children: [['session'], ['tools']], visibility});
  };
  hidden('unmeasured');expect(layout.snapshot().compact).toBe(false);
  layout.act({type: 'zoom'});hidden('unmeasured');
  layout.resize(48, 18);hidden('zoomed');expect(layout.snapshot()).toMatchObject({compact: false, frames: [expect.any(Object)]});
  layout.act({type: 'zoom'});expect(layout.snapshot()).toMatchObject({compact: false, splitTarget: {visibility: 'visible'}});
  expect(layout.snapshot().frames).toHaveLength(2);
  layout.resize(47, 18);hidden('size-limited');expect(layout.snapshot()).toMatchObject({compact: true, frames: [expect.any(Object)]});
  layout.resize(120, 0);hidden('unmeasured');expect(layout.snapshot()).toMatchObject({compact: false, frames: []});
  layout.resize(120, 30);expect(layout.snapshot().splitTarget?.visibility).toBe('visible');
  layout.act({type: 'zoom'});hidden('zoomed');
  layout.act({type: 'zoom'});expect(layout.snapshot().splitTarget).toMatchObject({visibility: 'visible',
    bounds: {x: 0, y: 0, width: 120, height: 30}, divider: {x: 83, y: 0, width: 2, height: 30}});
  await layout.disconnect();
});

it('keeps two columns at 60 columns and cancels narrow pointer resizes without rewriting saved ratios', async () => {
  const storage = memory({windows: state(split('horizontal', .7, leaf('session'), leaf('tools')))});
  const layout = await connectWindowLayout(storage, {panes});layout.resize(60, 24);
  expect(layout.snapshot()).toMatchObject({compact: false, frames: [
    {surface: 'session', x: 0, y: 0, width: 36, height: 24},
    {surface: 'tools', x: 36, y: 0, width: 24, height: 24},
  ], splitTarget: {ratio: .7, visibility: 'visible', divider: {x: 35, y: 0, width: 2, height: 24}}});
  expect(storage.saved).toEqual([]);
  layout.act({type: 'resize', delta: .05});
  await expect.poll(() => layout.snapshot().saving).toBe(false);const writes = storage.saved.length;
  expect(layout.snapshot().splitTarget?.ratio).toBe(.75);
  expect(layout.snapshot().frames[0].width).toBe(36);
  for (const viewportChange of [false, true]) {
    layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 35, y: 10});
    expect(layout.snapshot().gesture).toBe('resize');
    layout.act({type: 'pointer', phase: 'move', x: 30, y: 10});
    expect(layout.snapshot().splitTarget?.ratio).toBe(.5);expect(layout.snapshot().frames[0].width).toBe(30);
    if (viewportChange)layout.resize(61, 24);else layout.act({type: 'pointer', phase: 'cancel', x: 0, y: 0});
    expect(layout.snapshot()).toMatchObject({gesture: undefined, pointer: 'default', compact: false, splitTarget: {ratio: .75}});
    expect(storage.saved).toHaveLength(writes);
  }
  layout.resize(160, 40);
  expect(layout.snapshot().frames).toEqual([
    {surface: 'session', x: 0, y: 0, width: 120, height: 40},
    {surface: 'tools', x: 120, y: 0, width: 40, height: 40},
  ]);
  await layout.disconnect();expect(storage.saved).toHaveLength(writes);
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(split('horizontal', .75, leaf('session'), leaf('tools')));
});

it('keeps and resizes two rows at 38 columns, collapsing toward focus only when their height cannot fit', async () => {
  const storage = memory({windows: state(split('vertical', .3, leaf('session'), leaf('tools')), 'tools')});
  const layout = await connectWindowLayout(storage, {panes});layout.resize(38, 24);
  expect(layout.snapshot()).toMatchObject({compact: false, frames: [
    {surface: 'session', x: 0, y: 0, width: 38, height: 7},
    {surface: 'tools', x: 0, y: 7, width: 38, height: 17},
  ], splitTarget: {ratio: .3, focusedChild: 1, visibility: 'visible', divider: {x: 0, y: 6, width: 38, height: 2}}});
  layout.act({type: 'resize', delta: .05});
  expect(layout.snapshot().splitTarget).toMatchObject({ratio: .25, divider: {x: 0, y: 5, width: 38, height: 2}});
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 10, y: 5});
  expect(layout.snapshot().gesture).toBe('resize');
  layout.act({type: 'pointer', phase: 'move', x: 10, y: 12});
  layout.act({type: 'pointer', phase: 'up', x: 10, y: 12});
  expect(layout.snapshot().splitTarget).toMatchObject({ratio: .5, divider: {x: 0, y: 11, width: 38, height: 2}});
  const readable = structuredClone(layout.snapshot().frames);
  layout.resize(38, 11);
  expect(layout.snapshot()).toMatchObject({compact: true, frames: [{surface: 'tools', x: 0, y: 0, width: 38, height: 11}]});
  expect(layout.snapshot().splitTarget).toEqual({axis: 'vertical', ratio: .5, focusedChild: 1,
    children: [['session'], ['tools']], visibility: 'size-limited'});
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 10, y: 5});expect(layout.snapshot().gesture).toBeUndefined();
  layout.act({type: 'cycle'});expect(layout.snapshot().frames[0].surface).toBe('session');
  layout.act({type: 'direction', key: 'down'});expect(layout.snapshot().frames[0].surface).toBe('tools');
  layout.resize(38, 24);expect(layout.snapshot().frames).toEqual(readable);
  layout.act({type: 'zoom'});expect(layout.snapshot()).toMatchObject({compact: false, fullscreen: true});
  layout.act({type: 'zoom'});layout.act({type: 'workspace', id: 2});
  expect(layout.snapshot()).toMatchObject({compact: false, frames: [], splitTarget: undefined});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces.find((space: any) => space.id === 1).tree).toEqual(split('vertical', .5, leaf('session'), leaf('tools')));
});

it('projects detached nested branches at narrow widths and restores the exact canonical tree after widening and restart', async () => {
  const tree = split('horizontal', .7, split('vertical', .4, leaf('session'), leaf('late')),
    split('vertical', .6, leaf('tools'), leaf('inspector')));
  const storage = memory({windows: state(tree, 'inspector')});
  const registered = [...panes, {id: 'late', label: 'Late'}, {id: 'inspector', label: 'Inspector'}];
  const layout = await connectWindowLayout(storage, {panes: registered});layout.detach('late');layout.resize(140, 50);
  const wide = structuredClone(layout.snapshot().frames);
  layout.resize(60, 24);
  expect(layout.snapshot()).toMatchObject({compact: false, splitTarget: {visibility: 'visible',
    children: [['tools'], ['inspector']], bounds: {x: 36, y: 0, width: 24, height: 24}}});
  expect(layout.snapshot().frames.map(frame => frame.surface)).toEqual(['session', 'tools', 'inspector']);
  layout.resize(38, 24);
  expect(layout.snapshot()).toMatchObject({compact: false, frames: [
    {surface: 'tools', x: 0, y: 0, width: 38, height: 14},
    {surface: 'inspector', x: 0, y: 14, width: 38, height: 10},
  ], splitTarget: {visibility: 'visible', ratio: .6, divider: {x: 0, y: 13, width: 38, height: 2}}});
  layout.resize(38, 11);
  expect(layout.snapshot()).toMatchObject({compact: true, frames: [{surface: 'inspector', x: 0, y: 0, width: 38, height: 11}]});
  expect(layout.snapshot().splitTarget?.visibility).toBe('size-limited');
  layout.act({type: 'pointer', phase: 'down', kind: 'separator', x: 10, y: 5});expect(layout.snapshot().gesture).toBeUndefined();
  layout.resize(140, 50);expect(layout.snapshot().frames).toEqual(wide);expect(storage.saved).toEqual([]);
  layout.register({id: 'late', label: 'Reloaded'});const admitted = structuredClone(layout.snapshot().frames);
  expect(admitted.map(frame => frame.surface)).toEqual(['session', 'late', 'tools', 'inspector']);
  await layout.disconnect();expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(tree);
  const restored = await connectWindowLayout(storage, {panes: registered});restored.resize(140, 50);
  expect(restored.snapshot().frames).toEqual(admitted);expect(restored.snapshot().focused).toBe('inspector');
  await restored.disconnect();
});

it.each([[.05, 24], [.95, 56]])('retains saved ratio %s while reporting its actual minimum-clamped divider', async (ratio, firstWidth) => {
  const storage = memory({windows: state(split('horizontal', ratio, leaf('session'), leaf('tools')))});
  const layout = await connectWindowLayout(storage, {panes});layout.resize(80, 24);
  expect(layout.snapshot().splitTarget).toEqual({axis: 'horizontal', ratio, focusedChild: 0,
    children: [['session'], ['tools']], visibility: 'visible', bounds: {x: 0, y: 0, width: 80, height: 24},
    divider: {x: firstWidth - 1, y: 0, width: 2, height: 24}});
  expect(layout.snapshot().frames[0].width).toBe(firstWidth);expect(storage.saved).toEqual([]);
  await layout.disconnect();expect(storage.saved).toEqual([]);
});

it('does not persist snapshot reads or expose live canonical children and geometry through split metadata', async () => {
  const initial = {windows: state(split('vertical', .3, leaf('session'), leaf('tools')))};
  const storage = memory(initial), layout = await connectWindowLayout(storage, {panes});layout.resize(120, 40);
  const original = structuredClone(layout.snapshot());
  for (let i = 0; i < 4; i++)expect(layout.snapshot()).toEqual(original);
  expect(storage.saved).toEqual([]);expect(await storage.loadLayout()).toEqual(initial);
  const target = layout.snapshot().splitTarget!;
  (target.children[0] as string[])[0] = 'mutated';target.bounds!.x = 999;target.divider!.width = 999;
  layout.resize(121, 40);
  expect(layout.snapshot().splitTarget).toEqual({axis: 'vertical', ratio: .3, focusedChild: 0,
    children: [['session'], ['tools']], visibility: 'visible', bounds: {x: 0, y: 0, width: 121, height: 40},
    divider: {x: 0, y: 11, width: 121, height: 2}});
  expect(storage.saved).toEqual([]);await layout.disconnect();expect(await storage.loadLayout()).toEqual(initial);
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

it.each([
  {key: 'left', axis: 'horizontal', before: ['tools', 'session'], after: ['session', 'tools']},
  {key: 'right', axis: 'horizontal', before: ['session', 'tools'], after: ['tools', 'session']},
  {key: 'up', axis: 'vertical', before: ['tools', 'session'], after: ['session', 'tools']},
  {key: 'down', axis: 'vertical', before: ['session', 'tools'], after: ['tools', 'session']},
] as const)('retiles the focused leaf at its neighbor\'s $key edge and unzooms', async ({key, axis, before, after}) => {
  const storage = memory({windows: {...state(split(axis, .65, leaf(before[0]), leaf(before[1]))), fullscreen: true}});
  const layout = await connectWindowLayout(storage, {panes});
  layout.resize(120, 40);
  expect(layout.snapshot().frames).toHaveLength(1);
  layout.act({type: 'retile', key});
  expect(layout.snapshot()).toMatchObject({focused: 'session', fullscreen: false});
  expect(layout.snapshot().frames.map(frame => frame.surface)).toEqual(after);
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(split(axis, .5, leaf(after[0]), leaf(after[1])));
  expect(storage.saved.at(-1).windows.spaces[0].focus).toBe('session');
});

it('retiles through the live projection while preserving detached branches, closed identities, unrelated ratios and restart state', async () => {
  const target = split('horizontal', .25, leaf('plugin-detached-pane'), leaf('tools'));
  const tree = split('horizontal', .65, leaf('session'), split('vertical', .7, target, leaf('inspector')));
  const remote = split('vertical', .3, leaf('remote-a'), leaf('remote-b'));
  const expected = split('vertical', .7,
    split('horizontal', .25, leaf('plugin-detached-pane'), split('horizontal', .5, leaf('tools'), leaf('session'))),
    leaf('inspector'));
  const currentPanes = [...panes, ...['inspector', 'closed', 'remote-a', 'remote-b', 'plugin-detached-pane']
    .map(id => ({id, label: id}))];
  const storage = memory({windows: {...state(tree), fullscreen: true, spaces: [
    {id: 1, tree, focus: 'session'}, {id: 2, tree: remote, focus: 'remote-b'}]},
    registered: currentPanes.map(pane => pane.id)});
  const layout = await connectWindowLayout(storage, {panes: currentPanes});
  layout.resize(38, 10);
  layout.detach('plugin-detached-pane');
  expect(layout.snapshot().frames.map(frame => frame.surface)).toEqual(['session']);
  layout.act({type: 'retile', key: 'right'});
  expect(layout.snapshot()).toMatchObject({workspace: 1, focused: 'session', fullscreen: false,
    locations: {session: 1, tools: 1, inspector: 1, 'remote-a': 2, 'remote-b': 2}});
  expect(layout.snapshot().locations['plugin-detached-pane']).toBeUndefined();
  expect(layout.snapshot().locations.closed).toBeUndefined();
  expect(layout.snapshot().splitTarget).toMatchObject({axis: 'horizontal', ratio: .5, focusedChild: 1});
  layout.resize(160, 50);
  const expanded = layout.snapshot().frames;
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces).toEqual([
    {id: 1, tree: expected, focus: 'session'}, {id: 2, tree: remote, focus: 'remote-b'},
  ]);
  expect(new Set(ids(expected)).size).toBe(4);
  expect(storage.saved.at(-1).registered).toContain('closed');

  const restored = await connectWindowLayout(storage, {panes: currentPanes.filter(pane => pane.id !== 'plugin-detached-pane')});
  restored.resize(160, 50);
  expect(restored.snapshot().frames).toEqual(expanded);
  expect(restored.snapshot()).toMatchObject({workspace: 1, focused: 'session', fullscreen: false});
  restored.register({id: 'closed', label: 'Still closed'});
  expect(restored.snapshot().locations.closed).toBeUndefined();
  restored.register({id: 'plugin-detached-pane', label: 'Reloaded'}, {workspace: 3, focus: false});
  expect(restored.snapshot().locations['plugin-detached-pane']).toBe(1);
  expect(restored.snapshot().focused).toBe('session');
  await restored.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(expected);
});

it.each([
  {name: 'an outer edge', tree: split('horizontal', .7, leaf('session'), leaf('tools')), key: 'left', measured: true},
  {name: 'an unavailable neighbor', tree: split('horizontal', .7, leaf('session'), leaf('plugin-late-pane')), key: 'right', measured: true},
  {name: 'a single leaf', tree: leaf('session'), key: 'right', measured: true},
  {name: 'an empty workspace', tree: undefined, key: 'right', measured: true},
  {name: 'an unmeasured viewport', tree: split('horizontal', .7, leaf('session'), leaf('tools')), key: 'right', measured: false},
  {name: 'an invalid direction', tree: split('horizontal', .7, leaf('session'), leaf('tools')), key: 'sideways', measured: true},
] as const)('keeps focus, zoom and disk unchanged when retile has $name', async ({tree, key, measured}) => {
  const focused = tree ? 'session' : 'input';
  const storage = memory({windows: {...state(tree, focused), fullscreen: true}});
  const layout = await connectWindowLayout(storage, {panes});
  if (measured) layout.resize(120, 40);
  const before = layout.snapshot();
  layout.act({type: 'retile', key: key as 'right'});
  expect(layout.snapshot()).toMatchObject({focused: before.focused, fullscreen: before.fullscreen,
    frames: before.frames, locations: before.locations});
  await layout.disconnect();
  expect(storage.saved).toEqual([]);
});

it('rolls back an edge retile that would exceed the retained canonical tree depth', async () => {
  let target: unknown = leaf('tools');
  for (let index = 0; index < 23; index++) target = split('vertical', .5, leaf('late-' + index), target);
  const tree = split('horizontal', .5, split('vertical', .5, leaf('session'), leaf('inspector')), target);
  const storage = memory({windows: {...state(tree), fullscreen: true}});
  const layout = await connectWindowLayout(storage, {panes: [...panes, {id: 'inspector', label: 'Inspector'}]});
  layout.resize(120, 40);
  expect(layout.snapshot().error).toBeUndefined();
  const before = layout.snapshot();
  layout.act({type: 'retile', key: 'right'});
  expect(layout.snapshot()).toMatchObject({focused: before.focused, fullscreen: true,
    frames: before.frames, locations: before.locations});
  expect(layout.snapshot().error).toContain('Could not update window layout: Error: Invalid bounded window tree');
  await layout.disconnect();
  expect(storage.saved).toEqual([]);
});

it('cycles backward through current logical panes while excluding detached, closed and other-workspace identities', async () => {
  const tree = split('horizontal', .7, split('vertical', .4, leaf('session'), leaf('plugin-detached-pane')),
    split('vertical', .6, leaf('tools'), leaf('inspector')));
  const storage = memory({windows: {...state(tree), spaces: [{id: 1, tree, focus: 'session'},
    {id: 2, tree: leaf('remote'), focus: 'remote'}]},
    registered: ['session', 'tools', 'inspector', 'plugin-detached-pane', 'closed', 'remote']});
  const layout = await connectWindowLayout(storage, {panes: [...panes, {id: 'inspector', label: 'Inspector'},
    {id: 'plugin-detached-pane', label: 'Reloading'}, {id: 'closed', label: 'Closed'}, {id: 'remote', label: 'Remote'}]});
  layout.resize(38, 10);
  layout.detach('plugin-detached-pane');
  layout.act({type: 'cycle', reverse: true});
  expect(layout.snapshot()).toMatchObject({workspace: 1, focused: 'inspector',
    compact: true, frames: [{surface: 'inspector', width: 38, height: 10}]});
  layout.act({type: 'cycle', reverse: true});
  expect(layout.snapshot().focused).toBe('tools');
  layout.act({type: 'zoom'});
  layout.resize(140, 50);
  layout.act({type: 'cycle', reverse: true});
  expect(layout.snapshot()).toMatchObject({focused: 'session', fullscreen: true});
  layout.act({type: 'cycle', reverse: false});
  expect(layout.snapshot().focused).toBe('tools');
  layout.act({type: 'cycle'});
  expect(layout.snapshot().focused).toBe('inspector');
  layout.act({type: 'workspace', id: 2});
  layout.act({type: 'cycle', reverse: true});
  expect(layout.snapshot()).toMatchObject({workspace: 2, focused: 'remote'});
  layout.act({type: 'workspace', id: 3});
  layout.act({type: 'cycle', reverse: true});
  expect(layout.snapshot()).toMatchObject({workspace: 3, focused: 'input', frames: []});
  await layout.disconnect();
  expect(storage.saved.at(-1).windows.spaces[0].tree).toEqual(tree);
  expect(storage.saved.at(-1).windows.spaces[0].focus).toBe('inspector');
  expect(storage.saved.at(-1).registered).toContain('closed');
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
