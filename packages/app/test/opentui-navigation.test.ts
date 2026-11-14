import {afterEach, expect, it} from 'vitest';
import {connectWindowLayout} from '../src/opentui-windows.js';
import {createWindowNavigation, type NavigationWindow} from '../src/opentui-navigation.js';
import type {WindowNavigationInput} from '@agent-compositor/renderer-opentui';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
const key = (key: string, modifiers: readonly string[] = [], repeated = false): WindowNavigationInput => ({kind: 'key', key, modifiers, repeated});
async function setup(options:Partial<Parameters<typeof createWindowNavigation>[1]>={}) {
  let saved: unknown;
  const layout = await connectWindowLayout({loadLayout: async () => saved, saveLayout: async value => {saved = value;}}, {
    panes: [{id: 'session', label: 'Main'}, {id: 'tools', label: 'Tools'}, {id: 'inspect', label: 'Inspector'}], initial: ['session', 'tools', 'inspect'],
  });
  cleanups.push(() => layout.disconnect()); layout.resize(160, 50);
  let catalog: NavigationWindow[] = [{id: 'session', title: 'Main', state: 'open'}, {id: 'tools', title: 'Tools', state: 'open'}, {id: 'inspect', title: 'Inspector', state: 'open'}];
  let open: (id: string, signal: AbortSignal) => void | Promise<void> = id => {layout.act({type: 'open', id});};
  const nav = createWindowNavigation(layout, {windows: () => catalog.map(entry => {
    const workspace = layout.snapshot().locations[entry.id];
    return ['open', 'closed'].includes(entry.state) ? {...entry, workspace, state: workspace === undefined ? 'closed' : 'open'} : entry;
  }), open: (id, signal) => open(id, signal), onWindowIntent: layout.markWindowIntent,...options});
  cleanups.push(() => nav.close());
  return {layout, nav, catalog: () => catalog, setCatalog(value: NavigationWindow[]) {catalog = value; nav.refresh();},
    setOpen(value: typeof open) {open = value;}, saved: () => saved};
}

it('counts explicit mode and picker intent without treating background inventory refresh as user navigation', async () => {
  const f = await setup(), start = f.layout.windowIntentRevision;
  f.nav.handle(key('0', ['alt']));expect(f.layout.windowIntentRevision).toBeGreaterThan(start);
  const main = f.layout.windowIntentRevision;f.nav.toggleArrange();expect(f.layout.windowIntentRevision).toBeGreaterThan(main);
  const arrange = f.layout.windowIntentRevision;f.nav.openFinder();expect(f.layout.windowIntentRevision).toBeGreaterThan(arrange);
  const finder = f.layout.windowIntentRevision;f.nav.changeQuery('Tools', f.nav.snapshot().revision);
  expect(f.layout.windowIntentRevision).toBeGreaterThan(finder);
  const query = f.layout.windowIntentRevision;f.nav.refresh();f.layout.resize(150, 45);
  expect(f.layout.windowIntentRevision).toBe(query);
  f.nav.choose('tools', f.nav.snapshot().revision);expect(f.layout.windowIntentRevision).toBeGreaterThan(query);
});

it('keeps the optional normal keymap stable and preserves native form submission chords', async () => {
  const f = await setup();
  expect(f.nav.snapshot()).toBe(f.nav.snapshot());
  expect(f.nav.handle(key('return', ['alt']))).toBe(false);
  expect(f.nav.handle(key('enter', ['alt']))).toBe(false);
  expect(f.nav.handle(key('q'))).toBe(false);
  expect(f.nav.handle({kind: 'paste', text: 'q'})).toBe(false);
  expect(f.nav.handle(key('tab', ['alt']))).toBe(true);
  expect(f.layout.snapshot().focused).toBe('tools');
  f.nav.handle(key('tab', ['alt', 'shift'])); expect(f.layout.snapshot().focused).toBe('session');
  for (let index = 0; index < 12; index++) f.layout.register({id: 'extra' + index, label: 'Extra ' + index}, {focus: false});
  const before = f.layout.snapshot().focused;
  f.nav.handle(key('tab', ['alt'])); expect(f.layout.snapshot().focused).not.toBe(before);
  f.nav.handle(key('tab', ['alt', 'shift'])); expect(f.layout.snapshot().focused).toBe(before);
  expect(f.nav.handle(key('f6'))).toBe(false);
  f.nav.handle(key('0', ['alt'])); expect(f.layout.snapshot().focused).toBe('session');
});

it('applies explicit Arrange actions while consuming typing, pasted q and Ctrl+C without closing unrelated windows', async () => {
  const f = await setup();
  f.nav.handle(key('w', ['alt'])); expect(f.nav.snapshot().mode).toBe('arrange');
  const initial = JSON.stringify(f.saved());
  for (const name of ['y', 'n', 'constructor', 'toString']) expect(f.nav.handle(key(name))).toBe(true);
  expect(f.nav.handle({kind: 'paste', text: 'q'})).toBe(true);
  expect(JSON.stringify(f.saved())).toBe(initial);
  f.nav.handle(key('v')); expect(f.layout.snapshot().axis).toBe('vertical');
  const oriented = JSON.stringify(f.saved()); f.nav.handle(key('v')); expect(JSON.stringify(f.saved())).toBe(oriented);
  f.nav.handle(key('b')); expect(f.layout.snapshot().axis).toBe('horizontal');
  f.nav.handle(key('tab')); const second = f.layout.snapshot().focused;
  f.nav.handle(key('tab', ['shift'])); expect(f.layout.snapshot().focused).not.toBe(second);
  const beforeClose = Object.keys(f.layout.snapshot().locations).length;
  f.nav.handle(key('q', [], true)); expect(Object.keys(f.layout.snapshot().locations)).toHaveLength(beforeClose);
  f.nav.handle(key('c', ['ctrl'])); expect(f.nav.snapshot().mode).toBe('normal');
  expect(Object.keys(f.layout.snapshot().locations)).toHaveLength(beforeClose);
});

it('retiles only exact nonrepeated Ctrl+Arrow in Arrange while preserving native editing elsewhere', async () => {
  const f = await setup(), initial = f.layout.snapshot();
  for (const direction of ['left', 'right', 'up', 'down'])
    expect(f.nav.handle(key(direction, ['ctrl']))).toBe(false);
  expect(f.layout.snapshot()).toBe(initial);

  f.nav.toggleArrange();
  const intent = f.layout.windowIntentRevision;
  expect(f.nav.handle(key('right', ['control']))).toBe(true);
  const moved = f.layout.snapshot();
  expect(moved.focused).toBe('session');
  expect(moved.locations).toEqual(initial.locations);
  expect(moved.frames).not.toEqual(initial.frames);
  expect(moved.frames.find(frame => frame.surface === 'session')!.x).toBeGreaterThan(0);
  expect(f.layout.windowIntentRevision).toBeGreaterThan(intent);

  const after = f.layout.windowIntentRevision;
  expect(f.nav.handle(key('left', ['ctrl'], true))).toBe(true);
  for (const modifiers of [['ctrl', 'shift'], ['ctrl', 'alt'], ['ctrl', 'super'], ['ctrl', 'hyper']])
    expect(f.nav.handle(key('left', modifiers))).toBe(true);
  expect(f.nav.handle(key('h', ['ctrl']))).toBe(true);
  expect(f.layout.snapshot()).toBe(moved);
  expect(f.layout.windowIntentRevision).toBe(after);

  f.nav.openFinder();
  for (const direction of ['left', 'right', 'up', 'down'])
    expect(f.nav.handle(key(direction, ['ctrl']))).toBe(false);
  expect(f.layout.snapshot()).toBe(moved);
  f.nav.handle(key('escape'));f.nav.handle(key('escape'));
  expect(f.nav.snapshot().mode).toBe('normal');
  expect(f.nav.handle(key('left', ['ctrl']))).toBe(false);
});

it('keeps native finder editing and paste at the caret while bounding private query data and stale choice receipts', async () => {
  const f = await setup();
  f.nav.openFinder(); const revision = f.nav.snapshot().revision;
  expect(f.nav.handle(key('x'))).toBe(false);
  expect(f.nav.handle(key('backspace'))).toBe(false);
  for (const name of ['a', 'e', 'z', 'y', 'left', 'right']) expect(f.nav.handle(key(name, ['ctrl']))).toBe(false);
  expect(f.nav.handle({kind: 'paste', text: 'at native caret'})).toBe(false);
  f.nav.changeQuery('tools', revision);
  expect(f.nav.snapshot().entries.map(entry => entry.id)).toEqual(['tools']);
  expect(f.nav.snapshot().selected).toBe('tools');
  f.nav.choose('tools', revision); expect(f.nav.snapshot().mode).toBe('finder');
  f.nav.choose('tools', f.nav.snapshot().revision);
  expect(f.nav.snapshot().mode).toBe('normal'); expect(f.layout.snapshot().focused).toBe('tools');
  f.nav.openFinder(); f.nav.changeQuery('x'.repeat(511) + '😀', f.nav.snapshot().revision);
  expect(f.nav.snapshot().query).toHaveLength(511);
  expect(f.nav.snapshot().entries).toHaveLength(0);
  expect(JSON.stringify(f.saved())).not.toContain('x'.repeat(100));
});

it('creates host windows only through explicit nonrepeated Arrange keys and reports a bounded failure',async()=>{
  const created:string[]=[];
  const f=await setup({createWindow:kind=>{created.push(kind);return kind!=='help';}});
  expect(f.nav.handle(key('n'))).toBe(false);expect(created).toEqual([]);
  f.nav.openFinder();expect(f.nav.handle(key('t'))).toBe(false);expect(created).toEqual([]);
  f.nav.handle(key('escape'));f.nav.toggleArrange();
  for(const input of [key('n',[],true),key('n',['ctrl']),key('n',['shift']),key('t',['alt']),{kind:'paste',text:'nt?'} as const])
    f.nav.handle(input);
  expect(created).toEqual([]);
  f.nav.handle(key('n'));f.nav.handle(key('t'));f.nav.handle(key('/', ['shift']));
  expect(created).toEqual(['session','tools','help']);
  expect(f.nav.snapshot()).toMatchObject({mode:'arrange',error:'The window could not be created'});
  f.nav.handle(key('n'));expect(f.nav.snapshot().error).toBeUndefined();
});

it('returns to an existing Main copy resolved by the host without reopening the canonical Main',async()=>{
  const f=await setup({mainTarget:()=> 'window-2'});
  f.layout.register({id:'window-2',label:'Conversation'});
  f.layout.act({type:'open',id:'session'});f.layout.act({type:'close'});
  expect(f.layout.snapshot().locations.session).toBeUndefined();
  f.nav.handle(key('0',['alt']));expect(f.layout.snapshot().focused).toBe('window-2');
  f.nav.toggleArrange();f.nav.handle(key('i'));
  expect(f.nav.snapshot().mode).toBe('normal');expect(f.layout.snapshot().focused).toBe('window-2');
  expect(f.layout.snapshot().locations.session).toBeUndefined();
});

it('restores prior focus/workspace/zoom on finder cancellation while retaining concurrent tree publications', async () => {
  const f = await setup();
  f.layout.act({type: 'open', id: 'tools'}); f.layout.act({type: 'zoom'});
  f.nav.openFinder();
  f.layout.register({id: 'new', label: 'New'}, {workspace: 4, focus: true});
  f.setCatalog([...f.catalog(), {id: 'new', title: 'New', state: 'open'}]);
  f.nav.handle(key('escape'));
  expect(f.nav.snapshot().mode).toBe('normal');
  expect(f.layout.snapshot()).toMatchObject({workspace: 1, focused: 'tools', fullscreen: true, locations: {new: 4}});
});

it('does not reopen a removed previous focus or redirect a stale selection to the first remaining window', async () => {
  const f = await setup();
  f.layout.act({type: 'open', id: 'inspect'}); f.nav.openFinder();
  const old = f.nav.snapshot().revision;
  f.layout.forget('inspect'); f.setCatalog(f.catalog().filter(entry => entry.id !== 'inspect'));
  expect(f.nav.snapshot().selected).toBeUndefined();
  f.nav.choose('inspect', old); f.nav.handle(key('enter'));
  expect(f.nav.snapshot().mode).toBe('finder'); expect(f.nav.snapshot().error).toContain('Select a current window');
  f.nav.handle(key('escape'));
  expect(f.layout.snapshot().locations.inspect).toBeUndefined();
  expect(f.layout.snapshot().focused).not.toBe('inspect');
});

it('keeps finder ownership through asynchronous route admission and cancels it without late focus or mode changes', async () => {
  const f = await setup();
  f.setCatalog([...f.catalog(), {id: 'slow', title: 'Slow route', state: 'available', command: '/slow', version: 1}]);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let signal: AbortSignal | undefined;
  f.setOpen(async (id, owned) => {signal = owned; await gate; if (!owned.aborted) {f.layout.register({id, label: 'Slow'}); f.layout.act({type: 'open', id});}});
  f.nav.openFinder(); f.nav.changeQuery('/slow', f.nav.snapshot().revision);
  f.nav.handle(key('enter'));
  expect(f.nav.snapshot()).toMatchObject({mode: 'finder', opening: 'slow'});
  f.nav.handle(key('escape')); expect(signal?.aborted).toBe(true);
  release(); await new Promise<void>(resolve => setImmediate(resolve));
  expect(f.nav.snapshot().mode).toBe('normal'); expect(f.layout.snapshot().locations.slow).toBeUndefined();
  expect(f.layout.snapshot().focused).toBe('session');
});

it('keeps an unavailable detached source closed and awaits successful verified route publication', async () => {
  const f = await setup();
  f.setCatalog([...f.catalog(), {id: 'detached', title: 'Detached', state: 'unavailable'}]);
  f.nav.openFinder(); f.nav.changeQuery('detached', f.nav.snapshot().revision);
  f.nav.handle(key('enter'));
  expect(f.nav.snapshot().error).toContain('fresh view'); expect(f.nav.snapshot().mode).toBe('finder');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  f.setCatalog([...f.catalog(), {id: 'route', title: 'Available', state: 'available', command: '/available'}]);
  f.setOpen(async id => {await gate; f.layout.register({id, label: 'Available'}); f.layout.act({type: 'open', id});});
  f.nav.changeQuery('/available', f.nav.snapshot().revision); f.nav.handle(key('enter'));
  expect(f.nav.snapshot().mode).toBe('finder');
  release(); await expect.poll(() => f.nav.snapshot().mode).toBe('normal');
  expect(f.layout.snapshot().focused).toBe('route');
});

it('aborts a slow choice when keyboard selection changes and isolates scroll intent from background revisions', async () => {
  const f = await setup();
  f.setCatalog([...f.catalog(), {id: 'a', title: 'A route', state: 'available', version: 1}, {id: 'b', title: 'B route', state: 'available', version: 1}]);
  let release!: () => void, signal: AbortSignal | undefined;
  const gate = new Promise<void>(resolve => {release = resolve;});
  f.setOpen(async (_id, owned) => {signal = owned; await gate;});
  f.nav.openFinder(); f.nav.changeQuery('route', f.nav.snapshot().revision); f.nav.handle(key('enter'));
  expect(f.nav.snapshot().opening).toBe('a');
  const intent = f.nav.snapshot().selectionRevision;
  f.nav.handle(key('down'));
  expect(signal?.aborted).toBe(true); expect(f.nav.snapshot().selected).toBe('b'); expect(f.nav.snapshot().opening).toBeUndefined();
  expect(f.nav.snapshot().selectionRevision).toBeGreaterThan(intent!);
  const selected = f.nav.snapshot().selectionRevision;
  f.setCatalog(f.catalog().map(entry => entry.id === 'b' ? {...entry, version: 2} : entry));
  expect(f.nav.snapshot().selectionRevision).toBe(selected);
  f.nav.handle(key('down')); expect(f.nav.snapshot().selectionRevision).toBeGreaterThan(selected!);
  release(); await new Promise<void>(resolve => setImmediate(resolve));
  expect(f.nav.snapshot().mode).toBe('finder'); expect(f.nav.snapshot().selected).toBe('b');
});
