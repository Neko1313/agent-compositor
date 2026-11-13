import { expect, it } from 'vitest';
import { windowActionForKey } from '../src/layout.js';

const panes = ['main', 'side', 'workflows', 'plugins'];
const key = (name: string, values: Partial<Parameters<typeof windowActionForKey>[0]> = {}) =>
  ({name, sequence: name, ctrl: false, shift: false, meta: false, ...values});

it('opens registered panes and keeps window controls after the pane shortcuts', () => {
  expect(windowActionForKey(key('f2'), panes)).toEqual({type: 'open', id: 'main'});
  expect(windowActionForKey(key('f5'), panes)).toEqual({type: 'open', id: 'plugins'});
  expect(['f6', 'f7', 'f8', 'f9', 'f10'].map(name => windowActionForKey(key(name), panes)))
    .toEqual(['cycle', 'orient', 'swap', 'zoom', 'close'].map(type => ({type})));
  expect(windowActionForKey(key('f7'), [...panes, 'inspector'])).toEqual({type: 'cycle'});
});

it('leaves editor, approval and modified function keys to their own input handlers', () => {
  for (const name of ['y', 'n', 'return', 'left', 'pageup', '1', 'a'])
    expect(windowActionForKey(key(name), panes)).toBeUndefined();
  for (const name of ['y', 'n', 'return'])
    expect(windowActionForKey(key(name, {meta: true}), panes)).toBeUndefined();
  for (const modifier of ['ctrl', 'shift', 'meta', 'super', 'hyper'])
    expect(windowActionForKey(key('f2', {[modifier]: true}), panes)).toBeUndefined();
});

it('maps both structured and legacy shifted workspace keys without treating text as a move', () => {
  for (let id = 1; id <= 9; id++) {
    expect(windowActionForKey(key(String(id), {meta: true}), panes)).toEqual({type: 'workspace', id});
    expect(windowActionForKey(key(String(id), {meta: true, shift: true}), panes)).toEqual({type: 'moveWorkspace', id});
    const symbol = '!@#$%^&*('[id - 1];
    expect(windowActionForKey(key(symbol, {meta: true, sequence: '\x1b' + symbol}), panes))
      .toEqual({type: 'moveWorkspace', id});
    expect(windowActionForKey(key('', {sequence: '\x1b' + symbol}), panes))
      .toEqual({type: 'moveWorkspace', id});
    expect(windowActionForKey(key(symbol), panes)).toBeUndefined();
  }
});

it('keeps directional focus and swaps distinct from nearest-split resize', () => {
  expect(windowActionForKey(key('h', {meta: true}), panes)).toEqual({type: 'direction', key: 'left', move: false});
  expect(windowActionForKey(key('l', {meta: true, shift: true}), panes)).toEqual({type: 'direction', key: 'right', move: true});
  expect(windowActionForKey(key('left', {meta: true}), panes)).toEqual({type: 'resize', delta: -.05});
  expect(windowActionForKey(key('right', {meta: true}), panes)).toEqual({type: 'resize', delta: .05});
  expect(windowActionForKey(key('left', {meta: true, ctrl: true}), panes)).toBeUndefined();
});
