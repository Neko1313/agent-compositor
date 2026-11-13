export type WindowControlInput =
  | {kind: 'key'; key: string; modifiers?: readonly string[]}
  | {kind: 'text'; text: string; paste?: true};

type Direction = 'left' | 'right' | 'up' | 'down';
export type WindowControlCommand =
  | {type: 'focus' | 'move'; direction: Direction}
  | {type: 'resize'; delta: number}
  | {type: 'axis'; axis: 'horizontal' | 'vertical'}
  | {type: 'cycle'; reverse: boolean}
  | {type: 'workspace' | 'moveWorkspace'; id: number}
  | {type: 'zoom' | 'close' | 'picker'}
  | {type: 'exit'; input?: true};

const directions: Readonly<Record<string, Direction>> = {
  h: 'left', j: 'down', k: 'up', l: 'right', left: 'left', down: 'down', up: 'up', right: 'right',
};
const shiftedDigits = '!@#$%^&*(';

/** Parse only explicit window-mode input; ordinary editor input never uses this map. */
export function windowControl(input: WindowControlInput): WindowControlCommand | undefined {
  if (input.kind === 'text' && (input.paste || Array.from(input.text).length !== 1 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(input.text))) return;
  const modifiers = input.kind === 'key' ? input.modifiers ?? [] : [];
  if (modifiers.some(modifier => modifier !== 'shift')) return;
  const raw = input.kind === 'key' ? input.key : input.text;
  const shifted = modifiers.includes('shift') || /^[A-Z]$/.test(raw);
  const key = raw.toLowerCase();
  const direction = Object.hasOwn(directions, key) ? directions[key] : undefined;
  if (direction) return {type: shifted ? 'move' : 'focus', direction};
  if (/^[1-9]$/.test(key)) return {type: shifted ? 'moveWorkspace' : 'workspace', id: Number(key)};
  if (raw.length === 1 && shiftedDigits.includes(raw)) return {type: 'moveWorkspace', id: shiftedDigits.indexOf(raw) + 1};
  if (input.kind === 'key' && key === 'tab') return {type: 'cycle', reverse: shifted};
  if (key === '+' || key === '=') return {type: 'resize', delta: .05};
  if (key === '-') return {type: 'resize', delta: -.05};
  if (shifted) return;
  if (input.kind === 'key' && ['escape', 'enter', 'return', 'kpenter'].includes(key)) return {type: 'exit'};
  if (key === 'i') return {type: 'exit', input: true};
  if (key === 'b' || key === 'v') return {type: 'axis', axis: key === 'b' ? 'horizontal' : 'vertical'};
  if (key === 'f') return {type: 'zoom'};
  if (key === 'q') return {type: 'close'};
  if (key === 'w') return {type: 'picker'};
}
