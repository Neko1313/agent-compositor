import {WindowManager, leaves, type Frame, type ResizeHandle, type Tree, type DropEdge} from './windows.js';
import type {BuiltApp} from './build.js';
import type {WindowLayoutAction, WindowLayoutSnapshot, WindowLayoutSource} from '@agent-compositor/renderer-opentui';

export interface WindowPane {id: string; label: string; transient?: boolean}
export type WindowPlacement = Parameters<WindowManager['place']>[1];
export interface DynamicWindowLayout extends WindowLayoutSource {
  register(pane: WindowPane, placement?: WindowPlacement): void;
  relocate(id: string, placement?: WindowPlacement): void;
  detach(id: string): void;
  forget(id: string): void;
  disconnect(): Promise<void>;
}
type Storage = Pick<BuiltApp, 'loadLayout' | 'saveLayout'>;
type Gesture = {width: number; height: number} & (
  | {kind: 'resize'; handle: ResizeHandle}
  | {kind: 'move'; surface: string; x: number; y: number; moved: boolean}
);
const validWorkspace = (id: number) => Number.isInteger(id) && id >= 1 && id <= 9;
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128
  && !['input', '__swap', '__drag_swap'].includes(id);
const validPane = (pane: WindowPane) => validId(pane.id) && typeof pane.label === 'string'
  && pane.label.length > 0 && pane.label.length <= 512 && (pane.transient === undefined || typeof pane.transient === 'boolean');
const validPlacement = (placement: WindowPlacement) => !placement || (
  (placement.workspace === undefined || validWorkspace(placement.workspace))
  && (placement.site === undefined || ['split', 'sidebar', 'inspector', 'status-bar'].includes(placement.site))
  && (placement.size === undefined || Number.isFinite(placement.size) && placement.size >= .05 && placement.size <= .95)
  && (placement.relativeTo === undefined || validId(placement.relativeTo))
  && (placement.focus === undefined || typeof placement.focus === 'boolean'));
type LayoutState = {version: 1; workspace: number; focused: string; axis: 'horizontal' | 'vertical'; fullscreen: boolean;
  spaces: {id: number; tree?: Tree; focus?: string}[]};
type LegacyView = {id: string; title: string; kind: string};

/** Admit late owners without trusting arbitrary saved IDs or an unbounded tree. */
function retainedIds(value: unknown): Set<string> {
  const state = value as Partial<LayoutState> | undefined;
  if (state?.version !== 1 || !Array.isArray(state.spaces) || state.spaces.length > 9) throw Error('Invalid window layout');
  const ids = new Set<string>();
  let nodes = 0;
  const visit = (node: any, depth: number) => {
    if (node === undefined || node === null) return;
    if (++nodes > 256 || depth > 24 || typeof node !== 'object') throw Error('Invalid bounded window tree');
    if (typeof node.surface === 'string') {
      if (!validId(node.surface) || ids.has(node.surface)) throw Error('Invalid window identity');
      ids.add(node.surface); return;
    }
    if (!['horizontal', 'vertical'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio < .05 || node.ratio > .95
      || !Array.isArray(node.children) || node.children.length !== 2) throw Error('Invalid window split');
    node.children.forEach((child: unknown) => visit(child, depth + 1));
  };
  for (const space of state.spaces) visit(space?.tree, 0);
  return ids;
}

/** Adapt the existing compositor tree without importing application code into the renderer. */
export async function connectWindowLayout(storage: Storage, options: {
  panes: readonly WindowPane[];
  initial?: readonly string[];
  storageFormat?: 'app' | 'raw';
}): Promise<DynamicWindowLayout> {
  const registry = new Map(options.panes.map(pane => [pane.id, {...pane}]));
  const detached = new Map<string, WindowPane>();
  const known = new Set(registry.keys());
  if (known.size !== options.panes.length || known.size > 256 || options.panes.some(pane => !validPane(pane)))
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
  let seen = new Set(options.panes.filter(pane => !pane.transient).map(pane => pane.id));
  let views: LegacyView[] = [];
  let error: string | undefined;
  let loaded = false;
  try {
    const saved = await storage.loadLayout();
    if (saved !== undefined) {
      const envelope = saved as {windows?: unknown; registered?: unknown; views?: unknown};
      const value = envelope?.windows ?? saved;
      const retained = retainedIds(value);
      if (envelope?.registered !== undefined) {
        if (!Array.isArray(envelope.registered) || envelope.registered.length > 256 || envelope.registered.some(id => !validId(id)))
          throw Error('Invalid registered window inventory');
        for (const id of envelope.registered) retained.add(id);
      }
      if (Array.isArray(envelope?.views)) views = envelope.views.slice(0, 100).filter((view): view is LegacyView =>
        view && /^window-\d+$/.test(view.id) && typeof view.title === 'string' && view.title.length <= 512
        && ['session', 'tools', 'help'].includes(view.kind)).map(view => ({id: view.id, title: view.title, kind: view.kind}));
      for (const view of views) retained.add(view.id);
      for (const id of known) retained.add(id);
      if (retained.size > 256) throw Error('Too many retained windows');
      wm.restore(value, retained);
      seen = retained;
      for (const pane of registry.values()) if (pane.transient) seen.delete(pane.id);
      loaded = true;
    }
  } catch (cause) {
    error = 'Could not restore window layout: ' + String(cause);
    views = [];
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
  const locations = () => Object.fromEntries([...registry.keys()].flatMap(id => {
    const workspace = wm.workspaceOf(id);
    return workspace === undefined ? [] : [[id, workspace]];
  }));
  // Keep unknown late publications in the canonical tree, never in hit testing.
  const projection = () => {
    const view = new WindowManager();
    view.restore(wm.snapshot(), new Set(registry.keys()));
    view.focusContent();
    return view;
  };
  const compact = () => width < 70;
  const frames = (view = projection()): Frame[] => compact()
    ? width > 0 && height > 0 && view.ids().includes(view.focused)
      ? [{surface: view.focused, x: 0, y: 0, width, height}] : []
    : view.frames(width, height);
  function canonicalSplit(projected: Exclude<Tree, {surface: string}>): {node: Exclude<Tree, {surface: string}>; path: number[]} | undefined {
    const target = new Set(leaves(projected));
    const walk = (node: Tree | undefined, path: number[]): ReturnType<typeof canonicalSplit> => {
      if (!node || 'surface' in node) return;
      const nested = walk(node.children[0], [...path, 0]) ?? walk(node.children[1], [...path, 1]);
      if (nested) return nested;
      const visible = leaves(node).filter(id => registry.has(id));
      if (visible.length === target.size && visible.every(id => target.has(id))
        && node.children.every(child => leaves(child).some(id => registry.has(id)))) return {node, path};
    };
    return walk(wm.tree, []);
  }
  const separator = (x: number, y: number): ResizeHandle | undefined => {
    const handle = compact() ? undefined : projection().separator(x, y, width, height);
    if (!handle) return;
    const match = canonicalSplit(handle.node);
    return match ? {...handle, ...match, original: match.node.ratio} : undefined;
  };
  const snapshot = (): WindowLayoutSnapshot => {
    const view = projection();
    return {
    revision, width, height, frames: frames(view), focused: view.focused, workspace: wm.workspace,
    workspaces: [1, 2, 3, 4, 5, 6, 7, 8, 9], locations: locations(), axis: wm.axis,
    fullscreen: wm.fullscreen, compact: compact(), saving: pendingWrites > 0, error, pointer, drop,
    gesture: gesture?.kind,
    dragging: gesture?.kind === 'move' ? gesture.surface : undefined,
    };
  };
  let state = snapshot();
  function publish(advance = true) {
    if (!active) return;
    if (advance) revision++;
    state = snapshot();
    for (const listener of listeners) listener();
  }
  function persist() {
    const permanent = new Set([...seen].filter(id => !registry.get(id)?.transient));
    const saved = new WindowManager();
    saved.restore(wm.snapshot(), permanent);
    const value = options.storageFormat === 'raw' ? saved.snapshot() : {
      windows: saved.snapshot(), views: structuredClone(views), registered: [...permanent],
    };
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
  function changeSplit(action: {type: 'orient' | 'swap'} | Extract<WindowLayoutAction, {type: 'axis' | 'resize'}>) {
    const view = projection();
    const nearest = (node?: Tree): Exclude<Tree, {surface: string}> | undefined => {
      if (!node || 'surface' in node) return;
      const child = node.children.find(child => leaves(child).includes(view.focused));
      return child ? nearest(child) ?? node : undefined;
    };
    const split = nearest(view.tree);
    const canonical = split && canonicalSplit(split)?.node;
    if (action.type === 'orient' || action.type === 'axis') {
      if (action.type === 'axis') view.setSplitAxis(action.axis);
      else view.orient();
      wm.axis = view.axis;
      if (canonical && split) canonical.axis = split.axis;
    } else if (action.type === 'swap') {if (canonical) canonical.children = [canonical.children[1], canonical.children[0]];}
    else if (action.type === 'resize') {view.resize(action.delta); if (canonical && split) canonical.ratio = split.ratio;}
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
    subscribe(listener) { if (!active) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    register(pane, placement) {
      if (!active) return;
      if (!validPane(pane)) throw Error('Window panes require distinct, bounded semantic IDs');
      if (!validPlacement(placement)) throw Error('Invalid window placement');
      const previous = registry.get(pane.id);
      const retained = previous ?? detached.get(pane.id);
      if (retained && !!retained.transient !== !!pane.transient) throw Error('A window identity cannot change persistence lifetime');
      if (new Set([...seen, ...registry.keys(), ...detached.keys(), pane.id]).size > 256) throw Error('Too many registered windows');
      if (previous) {
        registry.set(pane.id, {...pane});
        let changed = false;
        for (const view of views) if (view.id === pane.id && view.title !== pane.label) {view.title = pane.label; changed = true;}
        if (changed) persist();
        return;
      }
      cancel();
      const existing = seen.has(pane.id) || detached.has(pane.id) || wm.has(pane.id);
      if (!existing) {
        const before = wm.snapshot();
        try {wm.place(pane.id, placement); retainedIds(wm.snapshot());}
        catch (cause) {wm.restore(before, retainedIds(before)); publish(); throw cause;}
      }
      registry.set(pane.id, {...pane});
      detached.delete(pane.id);
      if (!pane.transient) seen.add(pane.id);
      for (const view of views) if (view.id === pane.id) view.title = pane.label;
      persist(); publish();
    },
    detach(id) {
      if (!active) return;
      const pane = registry.get(id);
      if (!pane) return;
      // A reload withdraws the source generation, not the user's window tree.
      // Detached panes cannot render, focus, reopen or receive pointer input.
      cancel();
      registry.delete(id);
      detached.set(id, pane);
      publish();
    },
    forget(id) {
      if (!active || (!registry.has(id) && !detached.has(id) && !seen.has(id))) return;
      cancel(); registry.delete(id); detached.delete(id); seen.delete(id);
      views = views.filter(view => view.id !== id);
      wm.forget(id);
      persist(); publish();
    },
    relocate(id, placement) {
      if (!active || !registry.has(id)) return;
      if (!validPlacement(placement)) throw Error('Invalid window placement');
      cancel();
      const before = wm.snapshot();
      try {wm.relocate(id, placement); retainedIds(wm.snapshot());}
      catch (cause) {wm.restore(before, retainedIds(before)); publish(); throw cause;}
      if (JSON.stringify(before) !== JSON.stringify(wm.snapshot())) persist();
      publish();
    },
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
      const original = wm.snapshot();
      const before = JSON.stringify(original);
      const view = projection();
      try {
      switch (action.type) {
        case 'open': {
          if (!registry.has(action.id)) return;
          const location = wm.workspaceOf(action.id);
          if (location !== undefined && location !== wm.workspace) wm.switchTo(location);
          wm.open(action.id);
          break;
        }
        case 'focus':
          if (!view.ids().includes(action.id)) return;
          wm.focused = action.id;
          break;
        case 'cycle': {
          view.cycle(action.reverse);
          wm.focused = view.focused;
          break;
        }
        case 'axis':
          if (action.axis !== 'horizontal' && action.axis !== 'vertical') return;
          changeSplit(action); break;
        case 'orient': case 'swap': changeSplit({type: action.type}); break;
        case 'zoom': if (view.ids().length) wm.fullscreen = !wm.fullscreen; break;
        case 'close': wm.focused = view.focused; wm.close(); break;
        case 'resize':
          if (!Number.isFinite(action.delta) || Math.abs(action.delta) > 1) return;
          changeSplit(action); break;
        case 'direction': {
          const source = view.focused;
          view.direction(action.key, width, height);
          if (action.move && source !== view.focused && registry.has(source) && registry.has(view.focused)) {
            const fullscreen = wm.fullscreen;
            wm.drop(source, view.focused, 'center'); wm.fullscreen = fullscreen;
          } else if (!action.move) wm.focused = view.focused;
          break;
        }
        case 'workspace': if (validWorkspace(action.id)) wm.switchTo(action.id); break;
        case 'moveWorkspace': if (validWorkspace(action.id)) {wm.focused = view.focused; wm.moveWorkspace(action.id);} break;
      }
      retainedIds(wm.snapshot());
      } catch (cause) {
        wm.restore(original, retainedIds(original));
        error = 'Could not update window layout: ' + String(cause);
        publish(); return;
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
