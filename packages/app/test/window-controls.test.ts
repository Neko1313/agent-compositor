import {expect, it} from 'vitest';
import {windowControl, type WindowControlInput} from '../src/window-controls.js';

const key = (key: string, modifiers: readonly string[] = []): WindowControlInput => ({kind: 'key', key, modifiers});

it('maps mode navigation and shifted movement without requiring terminal Meta shortcuts', () => {
  for (const [letter, arrow, direction] of [['h', 'left', 'left'], ['j', 'down', 'down'], ['k', 'up', 'up'], ['l', 'right', 'right']]) {
    expect(windowControl(key(letter))).toEqual({type: 'focus', direction});
    expect(windowControl(key(arrow))).toEqual({type: 'focus', direction});
    expect(windowControl(key(letter, ['shift']))).toEqual({type: 'move', direction});
    expect(windowControl(key(arrow, ['shift']))).toEqual({type: 'move', direction});
    expect(windowControl({kind: 'text', text: letter.toUpperCase()})).toEqual({type: 'move', direction});
  }
  expect(windowControl(key('tab'))).toEqual({type: 'cycle', reverse: false});
  expect(windowControl(key('tab', ['shift']))).toEqual({type: 'cycle', reverse: true});
});

it('handles physical and legacy printable workspace movement keys', () => {
  for (let id = 1; id <= 9; id++) {
    expect(windowControl(key(String(id)))).toEqual({type: 'workspace', id});
    expect(windowControl(key(String(id), ['shift']))).toEqual({type: 'moveWorkspace', id});
    expect(windowControl({kind: 'text', text: '!@#$%^&*('[id - 1]})).toEqual({type: 'moveWorkspace', id});
  }
  expect(windowControl(key('0'))).toBeUndefined();
});

it('keeps resize, explicit axes, window actions and composer exit distinct', () => {
  expect(windowControl({kind: 'text', text: '+'})).toEqual({type: 'resize', delta: .05});
  expect(windowControl(key('=', ['shift']))).toEqual({type: 'resize', delta: .05});
  expect(windowControl(key('-'))).toEqual({type: 'resize', delta: -.05});
  expect(windowControl(key('b'))).toEqual({type: 'axis', axis: 'horizontal'});
  expect(windowControl(key('v'))).toEqual({type: 'axis', axis: 'vertical'});
  expect(windowControl(key('f'))).toEqual({type: 'zoom'});
  expect(windowControl(key('q'))).toEqual({type: 'close'});
  expect(windowControl(key('w'))).toEqual({type: 'picker'});
  expect(windowControl(key('i'))).toEqual({type: 'exit', input: true});
  expect(windowControl(key('escape'))).toEqual({type: 'exit'});
  expect(windowControl(key('enter'))).toEqual({type: 'exit'});
});

it('ignores pasted commands, controls and modified shortcuts instead of interpreting them as mode commands', () => {
  for (const text of ['q', 'i', 'h', '1', '!', '+', 'b', 'f', 'w', 'q\n'])
    expect(windowControl({kind: 'text', text, paste: true})).toBeUndefined();
  for (const text of ['hj', 'q\n', '\t', '\x1b', '\x1b[1;2A', '', 'help', '😀', '\u2028'])
    expect(windowControl({kind: 'text', text})).toBeUndefined();
  for (const modifiers of [['meta'], ['ctrl'], ['super'], ['hyper'], ['alt'], ['shift', 'ctrl']])
    for (const name of ['h', '1', 'tab', 'q', 'i', 'escape']) expect(windowControl(key(name, modifiers))).toBeUndefined();
  for (const name of ['pageup', 'pagedown', 'backspace', 'delete', 'a', 'space', 'Q', 'constructor', '__proto__', 'toString', 'prototype'])
    expect(windowControl(key(name))).toBeUndefined();
});
