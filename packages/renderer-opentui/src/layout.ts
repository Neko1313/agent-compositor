export interface WindowFrame {
  surface: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WindowDirection = 'left' | 'right' | 'up' | 'down';
export type WindowDropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface WindowLayoutSnapshot {
  revision: number;
  width: number;
  height: number;
  frames: readonly WindowFrame[];
  focused: string;
  workspace: number;
  workspaces: readonly number[];
  locations: Readonly<Record<string, number>>;
  axis: 'horizontal' | 'vertical';
  fullscreen: boolean;
  compact: boolean;
  pointer: 'default' | 'grab' | 'grabbing' | 'ew-resize' | 'ns-resize';
  drop?: {surface: string; edge: WindowDropEdge};
  dragging?: string;
  gesture?: 'move' | 'resize';
  saving?: boolean;
  error?: string;
}

export type WindowLayoutAction =
  | {type: 'open' | 'focus'; id: string}
  | {type: 'cycle' | 'orient' | 'swap' | 'zoom' | 'close'}
  | {type: 'resize'; delta: number}
  | {type: 'direction'; key: WindowDirection; move?: boolean}
  | {type: 'workspace' | 'moveWorkspace'; id: number}
  | {type: 'pointer'; phase: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number;
      kind?: 'title' | 'pane' | 'separator'; revision?: number; workspace?: number};

/** The host owns the tiling tree, gestures, placement policy and persistence. */
export interface WindowLayoutSource {
  snapshot(): WindowLayoutSnapshot;
  subscribe(listener: () => void): () => void;
  resize(width: number, height: number): void;
  act(action: WindowLayoutAction): void;
}

interface WindowKey {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  super?: boolean;
  hyper?: boolean;
  raw?: string;
}

/** Legacy parsers can combine a bare Escape with an immediately following SGR release. */
export function isWindowGestureCancelKey(key: WindowKey): boolean {
  if (key.ctrl || key.super || key.hyper) return false;
  if (key.name === 'escape' && !key.meta && !key.shift) return true;
  const combinedRelease = /^\x1b\x1b\[<\d+;\d+;\d+m$/;
  return combinedRelease.test(key.sequence) || (key.raw !== undefined && combinedRelease.test(key.raw));
}

const directions: Readonly<Record<string, WindowDirection>> = {h: 'left', j: 'down', k: 'up', l: 'right'};

/** Keep window shortcuts disjoint from ordinary editor and approval input. */
export function windowActionForKey(key: WindowKey, panes: readonly string[]): WindowLayoutAction | undefined {
  if (key.ctrl || key.super || key.hyper) return;
  // Legacy xterm encodes Alt+Shift+digit as ESC plus punctuation. The SDK's
  // generic key parser leaves those exact packets unnamed and without Meta.
  const legacyWorkspace = /^\x1b([!@#$%^&*(])$/.exec(key.sequence);
  if (legacyWorkspace) return {type: 'moveWorkspace', id: '!@#$%^&*('.indexOf(legacyWorkspace[1]) + 1};
  if (key.meta) {
    const sequence = key.sequence.replace(/^\x1b/, '');
    const shiftedWorkspace = '!@#$%^&*('.indexOf(sequence);
    const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : undefined;
    if (digit) return {type: key.shift ? 'moveWorkspace' : 'workspace', id: digit};
    if (shiftedWorkspace >= 0 && sequence.length === 1)
      return {type: 'moveWorkspace', id: shiftedWorkspace + 1};
    const direction = directions[key.name.toLowerCase()];
    if (direction) return {type: 'direction', key: direction, move: key.shift};
    if (!key.shift && (key.name === 'left' || key.name === 'right'))
      return {type: 'resize', delta: key.name === 'left' ? -.05 : .05};
    return;
  }
  if (key.shift) return;
  const match = /^f(\d+)$/.exec(key.name);
  if (!match) return;
  const number = Number(match[1]);
  if (panes[number - 2]) return {type: 'open', id: panes[number - 2]};
  const controls = ['cycle', 'orient', 'swap', 'zoom', 'close'] as const;
  const control = controls[number - Math.max(6, panes.length + 2)];
  return control ? {type: control} : undefined;
}
