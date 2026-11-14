import type {WindowLayoutSource, WindowNavigationEntry, WindowNavigationInput, WindowNavigationSnapshot, WindowNavigationSource} from '@agent-compositor/renderer-opentui';
import {windowControl} from './window-controls.js';
import {clean} from './presentation.js';

export interface NavigationWindow extends WindowNavigationEntry {
  /** Public declared command name; never a user-entered command or form value. */
  command?: string;
  /** Source generation/revision used only to invalidate stale picker actions. */
  version?: string | number;
}
interface Options {
  windows(): readonly NavigationWindow[];
  open(id: string, signal: AbortSignal): void | Promise<void>;
  mainId?: string;
  onWindowIntent?(): void;
}
const label = (text: string) => clean(text).replace(/\p{Bidi_Control}/gu, '');
function query(text: string): string {
  const value = label(text).replace(/[\r\n]/g, ' ').slice(0, 512);
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {Object.freeze(value); for (const child of Object.values(value)) freeze(child);}
  return value;
}

/** Host-only window policy. Native widgets retain their own drafts, cursor and undo. */
export function createWindowNavigation(layout: WindowLayoutSource, options: Options): WindowNavigationSource & {refresh(): void; close(): void} {
  let active = true, revision = 0, mode: WindowNavigationSnapshot['mode'] = 'normal';
  let selectionRevision = 0;
  let returnMode: 'normal' | 'arrange' = 'normal';
  let text = '', selected: string | undefined, error: string | undefined;
  let previous: {workspace: number; focus: string; fullscreen: boolean} | undefined;
  let opening: {id: string; controller: AbortController} | undefined;
  let state: WindowNavigationSnapshot;
  let signature = '';
  const listeners = new Set<() => void>();
  const mainId = options.mainId ?? 'session';
  function windows(): NavigationWindow[] {
    const current = layout.snapshot().workspace;
    return options.windows().map(entry => ({...entry, title: label(entry.title)})).sort((a, b) =>
      Number(b.workspace === current) - Number(a.workspace === current)
      || Number(a.state !== 'open') - Number(b.state !== 'open')
      || (a.workspace ?? 10) - (b.workspace ?? 10));
  }
  function matching(all: readonly NavigationWindow[]) {
    const needle = text.toLocaleLowerCase();
    return all.filter(entry => (entry.title + ' ' + (entry.command ?? '')).toLocaleLowerCase().includes(needle));
  }
  function refresh() {
    if (!active) return;
    const all = windows(), entries = matching(all);
    if (opening && !all.some(entry => entry.id === opening!.id)) {
      opening.controller.abort(); opening = undefined; error = 'The selected window is no longer available';
    }
    if (selected && !entries.some(entry => entry.id === selected)) selected = undefined;
    const next = {mode, query: text,
      entries: entries.map(({command: _command, version: _version, ...entry}) => entry), selected,
      focusedLabel: all.find(entry => entry.id === layout.snapshot().focused)?.title ?? 'Empty workspace', error, opening: opening?.id, selectionRevision};
    const nextSignature = JSON.stringify([next, all.map(entry => [entry.id, entry.version])]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    state = freeze({...next, revision: ++revision});
    for (const fn of listeners) fn();
  }
  function cancelGesture() {
    if (layout.snapshot().gesture) layout.act({type: 'pointer', phase: 'cancel', x: 0, y: 0});
  }
  function leaveFinder(restore: boolean) {
    opening?.controller.abort(); opening = undefined;
    const saved = previous;
    previous = undefined;
    mode = returnMode; text = ''; selected = undefined; error = undefined;
    if (restore && saved) {
      const before = layout.snapshot();
      if (before.workspace !== saved.workspace) layout.act({type: 'workspace', id: saved.workspace});
      const current = layout.snapshot();
      if (current.locations[saved.focus] === saved.workspace) {
        layout.act({type: 'focus', id: saved.focus});
        if (layout.snapshot().fullscreen !== saved.fullscreen) layout.act({type: 'zoom'});
      }
    }
    refresh();
  }
  function focusMain() {
    opening?.controller.abort(); opening = undefined;
    previous = undefined; mode = 'normal'; text = ''; selected = undefined; error = undefined;
    cancelGesture(); layout.act({type: 'open', id: mainId}); refresh();
  }
  function openFinder() {
    if (!active) return;
    options.onWindowIntent?.();
    cancelGesture();
    opening?.controller.abort(); opening = undefined;
    if (mode !== 'finder') {
      const current = layout.snapshot();
      previous = {workspace: current.workspace, focus: current.focused, fullscreen: current.fullscreen};
      returnMode = mode;
    }
    mode = 'finder'; text = ''; error = undefined;
    const entries = windows();
    selected = entries.find(entry => entry.id === layout.snapshot().focused)?.id ?? entries[0]?.id;
    selectionRevision++;
    refresh();
  }
  function toggleArrange() {
    if (!active) return;
    options.onWindowIntent?.();
    if (mode === 'finder') leaveFinder(true);
    cancelGesture();
    mode = mode === 'arrange' ? 'normal' : 'arrange';
    error = undefined; refresh();
  }
  function choose(id: string, expected: number) {
    if (!active || mode !== 'finder' || expected !== state.revision) return;
    if (opening?.id === id) return;
    const entry = state.entries.find(entry => entry.id === id);
    if (!entry) return;
    options.onWindowIntent?.();
    opening?.controller.abort(); opening = undefined;
    if (entry.state === 'unavailable') {error = 'This window needs a fresh view from its plugin before it can open'; refresh(); return;}
    const attempt = {id, controller: new AbortController()};
    opening = attempt; error = undefined; refresh();
    const complete = () => {
      if (!active || opening !== attempt || mode !== 'finder') return;
      opening = undefined; previous = undefined; mode = 'normal'; text = ''; selected = undefined; error = undefined; refresh();
    };
    const failed = () => {
      if (!active || opening !== attempt || mode !== 'finder') return;
      opening = undefined; error = 'The window could not be opened'; refresh();
    };
    try {
      const work = options.open(id, attempt.controller.signal);
      if (work && typeof work.then === 'function') void work.then(complete, failed);
      else complete();
    } catch {failed();}
  }
  function changeQuery(value: string, expected: number) {
    if (!active || mode !== 'finder' || expected !== state.revision || typeof value !== 'string') return;
    const next = query(value);
    if (next !== text) options.onWindowIntent?.();
    if (next !== text) {opening?.controller.abort(); opening = undefined;}
    text = next; selected = matching(windows())[0]?.id; selectionRevision++; error = undefined; refresh();
  }
  function select(id: string, expected: number) {
    if (!active || mode !== 'finder' || expected !== state.revision || !state.entries.some(entry => entry.id === id)) return;
    if (selected !== id || opening && opening.id !== id) options.onWindowIntent?.();
    if (opening && opening.id !== id) {opening.controller.abort(); opening = undefined;}
    selected = id; selectionRevision++; error = undefined; refresh();
  }
  function handle(input: WindowNavigationInput): boolean {
    if (!active) return false;
    if (input.kind === 'paste') return mode === 'arrange';
    const key = input.key.toLowerCase();
    const modifiers = (input.modifiers ?? []).map(value => value === 'alt' ? 'meta' : value === 'control' ? 'ctrl' : value);
    const meta = modifiers.includes('meta') && modifiers.every(value => value === 'meta' || value === 'shift');
    const plain = !modifiers.length;
    if (meta && !modifiers.includes('shift') && key === '0') {if (!input.repeated) focusMain(); return true;}
    if (meta && !modifiers.includes('shift') && key === 'w') {if (!input.repeated) toggleArrange(); return true;}
    if (mode === 'arrange' && meta && !modifiers.includes('shift') && key === 'i') {if (!input.repeated) focusMain(); return true;}
    if (plain && key === 'f2') {if (!input.repeated) openFinder(); return true;}
    if (meta && key === 'tab' && mode !== 'finder') {
      if (!input.repeated) layout.act({type: 'cycle', reverse: modifiers.includes('shift')});
      refresh(); return true;
    }
    if (mode === 'finder') {
      if ((plain && ['escape', 'esc'].includes(key)) || key === 'c' && modifiers.includes('ctrl') && !modifiers.includes('meta')) {
        if (!input.repeated) leaveFinder(true); return true;
      }
      if (key === 'u' && modifiers.includes('ctrl') && !modifiers.includes('meta')) {changeQuery('', state.revision); return true;}
      if (modifiers.some(value => value !== 'shift')) return false;
      if (['up', 'down', 'tab', 'pageup', 'pagedown'].includes(key)) {
        const entries = state.entries, index = entries.findIndex(entry => entry.id === selected);
        const delta = key === 'up' || key === 'tab' && modifiers.includes('shift') ? -1 : key === 'pageup' ? -5 : key === 'pagedown' ? 5 : 1;
        const next = entries[Math.max(0, Math.min(entries.length - 1, index < 0 ? delta < 0 ? entries.length - 1 : 0 : index + delta))]?.id;
        if (next) select(next, state.revision);
        else {selectionRevision++; error = undefined; refresh();}
        return true;
      }
      if (['return', 'enter', 'kpenter'].includes(key)) {
        if (!input.repeated) {
          if (selected) choose(selected, state.revision);
          else {error = 'Select a current window before opening it'; refresh();}
        }
        return true;
      }
      // Finder editing, including paste at the caret, belongs to its native input.
      return false;
    }
    if (mode === 'normal' && !meta) return false;
    if (mode === 'arrange' && key === 'c' && modifiers.includes('ctrl') && !modifiers.includes('meta')) {
      if (!input.repeated) {mode = 'normal'; refresh();} return true;
    }
    const normalized = mode === 'normal' ? modifiers.filter(value => value !== 'meta') : modifiers;
    const command = windowControl({kind: 'key', key: input.key, modifiers: normalized});
    if (mode === 'normal' && command && !['focus', 'move', 'workspace', 'moveWorkspace'].includes(command.type)) return false;
    if (!command) return mode === 'arrange';
    if (input.repeated && !['focus', 'move', 'resize'].includes(command.type)) return true;
    switch (command.type) {
      case 'focus': case 'move': layout.act({type: 'direction', key: command.direction, move: command.type === 'move'}); break;
      case 'resize': layout.act({type: 'resize', delta: command.delta}); break;
      case 'axis': layout.act({type: 'axis', axis: command.axis}); break;
      case 'cycle': layout.act({type: 'cycle', reverse: command.reverse}); break;
      case 'workspace': layout.act({type: 'workspace', id: command.id}); break;
      case 'moveWorkspace': layout.act({type: 'moveWorkspace', id: command.id}); break;
      case 'zoom': layout.act({type: 'zoom'}); break;
      case 'close': layout.act({type: 'close'}); break;
      case 'picker': openFinder(); break;
      case 'exit':
        if (command.input) focusMain();
        else {mode = 'normal'; refresh();}
        break;
    }
    refresh(); return true;
  }
  const off = layout.subscribe(refresh);
  refresh();
  return {snapshot: () => state, subscribe(fn) {if (!active) return () => {}; listeners.add(fn); return () => {listeners.delete(fn);};},
    handle, toggleArrange, openFinder, choose, changeQuery, select, refresh,
    close() {if (!active) return; active = false; opening?.controller.abort(); opening = undefined; off(); listeners.clear();},
  };
}
