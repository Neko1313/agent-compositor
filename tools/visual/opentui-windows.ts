import {WindowManager, type Frame, type ResizeHandle, type Tree, type DropEdge} from '../../packages/app/src/windows.js';
import type {BuiltApp} from '../../packages/app/src/build.js';
import type {WindowLayoutAction, WindowLayoutSnapshot, WindowLayoutSource} from '@agent-compositor/renderer-opentui';

interface Pane {id: string; label: string}
type Storage = Pick<BuiltApp, 'loadLayout' | 'saveLayout'>;
type Gesture = {width: number; height: number} & (
  | {kind: 'resize'; handle: ResizeHandle}
  | {kind: 'move'; surface: string; x: number; y: number; moved: boolean}
);
const validWorkspace = (id: number) => Number.isInteger(id) && id >= 1 && id <= 9;

/** Adapt the existing compositor tree without importing application code into the renderer. */
export async function connectWindowLayout(storage: Storage, options: {
  panes: readonly Pane[];
  initial?: readonly string[];
}): Promise<WindowLayoutSource & {disconnect(): Promise<void>}> {
  const known = new Set(options.panes.map(pane => pane.id));
  if (known.size !== options.panes.length || known.size > 256 || [...known].some(id =>
    !id || id.length > 128 || ['input', '__swap', '__drag_swap'].includes(id)))
    throw Error('Window panes require distinct, bounded semantic IDs');
  const initial = options.initial ?? options.panes.slice(0, 2).map(pane => pane.id);
  if (new Set(initial).size !== initial.length || initial.some(id => !known.has(id)))
    throw Error('Initial panes must be distinct registered IDs');
  const wm = new WindowManager();
  let tree: Tree | undefined;
  for (const id of initial) tree = tree
    ? {axis: 'horizontal', ratio: .65, children: [tree, {surface: id}]}
    : {surface: id};
  const defaults = {version: 1, workspace: 1, focused: initial[0] ?? 'input',
    axis: 'horizontal', fullscreen: false, spaces: [{id: 1, tree, focus: initial[0]}]};
  wm.restore(defaults, known);
  let error: string | undefined;
  let loaded = false;
  try {
    const saved = await storage.loadLayout();
    if (saved !== undefined) { wm.restore(saved, known); loaded = true; }
  } catch (cause) {
    error = 'Could not restore window layout: ' + String(cause);
    wm.restore(defaults, known);
  }
  let active = true;
  let width = 0, height = 0, revision = 0;
  let gesture: Gesture | undefined;
  let drop: WindowLayoutSnapshot['drop'];
  let pointer: WindowLayoutSnapshot['pointer'] = 'default';
  let pendingWrites = 0;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const locations = () => Object.fromEntries([...known].flatMap(id => {
    const workspace = wm.workspaceOf(id);
    return workspace === undefined ? [] : [[id, workspace]];
  }));
  const compact = () => width < 70;
  const frames = (): Frame[] => compact()
    ? width > 0 && height > 0 && wm.ids().includes(wm.focused)
      ? [{surface: wm.focused, x: 0, y: 0, width, height}] : []
    : wm.frames(width, height);
  const separator = (x: number, y: number) => compact() ? undefined : wm.separator(x, y, width, height);
  const snapshot = (): WindowLayoutSnapshot => ({
    revision, width, height, frames: frames(), focused: wm.focused, workspace: wm.workspace,
    workspaces: [1, 2, 3, 4, 5, 6, 7, 8, 9], locations: locations(), axis: wm.axis,
    fullscreen: wm.fullscreen, compact: compact(), saving: pendingWrites > 0, error, pointer, drop,
    gesture: gesture?.kind,
    dragging: gesture?.kind === 'move' ? gesture.surface : undefined,
  });
  let state = snapshot();
  function publish(advance = true) {
    if (!active) return;
    if (advance) revision++;
    state = snapshot();
    for (const listener of listeners) listener();
  }
  function persist() {
    const value = wm.snapshot();
    pendingWrites++;
    writes = writes.then(async () => {
      try { await storage.saveLayout(value); error = undefined; }
      catch (cause) { error = 'Could not save window layout: ' + String(cause); }
      finally { pendingWrites--; publish(false); }
    });
  }
  function cancel() {
    if (gesture?.kind === 'resize') wm.cancelResize(gesture.handle);
    gesture = undefined;
    drop = undefined;
    pointer = 'default';
  }
  const hit = (x: number, y: number): Frame | undefined => frames().find(frame =>
    x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height);
  function edgeAt(frame: Frame, x: number, y: number): DropEdge {
    if (x - frame.x < Math.min(8, frame.width / 4)) return 'left';
    if (frame.x + frame.width - x <= Math.min(8, frame.width / 4)) return 'right';
    if (y - frame.y < Math.min(3, frame.height / 4)) return 'top';
    if (frame.y + frame.height - y <= Math.min(3, frame.height / 4)) return 'bottom';
    return 'center';
  }
  function point(action: Extract<WindowLayoutAction, {type: 'pointer'}>) {
    const {x, y} = action;
    if (action.phase === 'cancel') { cancel(); publish(); return; }
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (action.phase === 'down') {
      if (action.revision !== undefined && action.revision !== revision) return;
      cancel();
      const frame = hit(x, y);
      const handle = action.kind === 'title' ? undefined : separator(x, y);
      if (handle) {
        gesture = {kind: 'resize', handle, width, height};
        pointer = handle.node.axis === 'horizontal' ? 'ew-resize' : 'ns-resize';
      } else if (frame && action.kind !== 'separator') {
        wm.focused = frame.surface;
        if (action.kind === 'title' && y === frame.y) {
          gesture = {kind: 'move', surface: frame.surface, x, y, moved: false, width, height};
          pointer = 'grab';
        }
        persist();
      }
      publish();
      return;
    }
    if (!gesture) {
      if (action.phase === 'move') {
        const handle = separator(x, y), frame = hit(x, y);
        const next = handle ? handle.node.axis === 'horizontal' ? 'ew-resize' : 'ns-resize'
          : frame && y === frame.y ? 'grab' : 'default';
        if (next !== pointer) { pointer = next; publish(false); }
      }
      return;
    }
    if (gesture.width !== width || gesture.height !== height) { cancel(); publish(); return; }
    if (gesture.kind === 'resize') {
      wm.dragResize(gesture.handle, x, y);
    } else {
      gesture.moved ||= x !== gesture.x || y !== gesture.y;
      const target = hit(x, y);
      drop = gesture.moved && target && target.surface !== gesture.surface
        ? {surface: target.surface, edge: edgeAt(target, x, y)} : undefined;
      pointer = gesture.moved ? 'grabbing' : 'grab';
    }
    if (action.phase === 'up') {
      if (gesture.kind === 'move' && gesture.moved) {
        if (action.workspace !== undefined && validWorkspace(action.workspace)) {
          wm.focused = gesture.surface;
          wm.moveWorkspace(action.workspace);
        } else if (drop) wm.drop(gesture.surface, drop.surface, drop.edge);
      }
      // A committed resize must not be restored by cancel().
      gesture = undefined;
      cancel();
      persist();
    }
    publish();
  }
  if (!loaded && !error) persist();
  state = snapshot();
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resize(nextWidth, nextHeight) {
      if (!active || !Number.isInteger(nextWidth) || !Number.isInteger(nextHeight)
        || nextWidth < 0 || nextHeight < 0 || nextWidth > 10000 || nextHeight > 10000
        || (width === nextWidth && height === nextHeight)) return;
      cancel();
      width = nextWidth; height = nextHeight;
      publish();
    },
    act(action) {
      if (!active) return;
      if (action.type === 'pointer') { point(action); return; }
      if (gesture) { cancel(); publish(); }
      const before = JSON.stringify(wm.snapshot());
      switch (action.type) {
        case 'open': {
          if (!known.has(action.id)) return;
          const location = wm.workspaceOf(action.id);
          if (location !== undefined && location !== wm.workspace) wm.switchTo(location);
          wm.open(action.id);
          break;
        }
        case 'focus':
          if (!wm.ids().includes(action.id)) return;
          wm.focused = action.id;
          break;
        case 'cycle': {
          const ids = wm.ids();
          wm.focused = ids[(ids.indexOf(wm.focused) + 1) % ids.length] ?? 'input';
          break;
        }
        case 'orient': wm.orient(); break;
        case 'swap': wm.swap(); break;
        case 'zoom': if (wm.ids().length) wm.fullscreen = !wm.fullscreen; break;
        case 'close': wm.close(); break;
        case 'resize':
          if (!Number.isFinite(action.delta) || Math.abs(action.delta) > 1) return;
          wm.resize(action.delta); break;
        case 'direction': wm.direction(action.key, width, height, action.move); break;
        case 'workspace': if (validWorkspace(action.id)) wm.switchTo(action.id); break;
        case 'moveWorkspace': if (validWorkspace(action.id)) wm.moveWorkspace(action.id); break;
      }
      if (JSON.stringify(wm.snapshot()) !== before) persist();
      publish();
    },
    async disconnect() {
      cancel();
      active = false;
      listeners.clear();
      await writes;
    },
  };
}
