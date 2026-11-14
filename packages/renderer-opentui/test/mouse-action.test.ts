import {expect, it} from 'vitest';
import {handleActionMouseDown} from '../src/mouse-action.js';

function event(button = 0, defaultPrevented = false) {
  return {button, defaultPrevented, propagationStopped: false,
    preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.propagationStopped = true;}};
}

it('consumes an admitted action before its callback can synchronously change native focus or layout', () => {
  const mouse = event();
  expect(() => handleActionMouseDown(mouse, true, () => {
    expect(mouse.propagationStopped).toBe(true);expect(mouse.defaultPrevented).toBe(true);
    throw Error('Controlled callback failure');
  })).toThrow('Controlled callback failure');
  expect(mouse.propagationStopped).toBe(true);
});

it.each([
  {name: 'inactive or unavailable action', button: 0, prevented: false, admitted: false},
  {name: 'non-left click', button: 2, prevented: false, admitted: true},
  {name: 'already handled child click', button: 0, prevented: true, admitted: true},
])('leaves $name available to its existing pointer behavior without dispatching it', ({button, prevented, admitted}) => {
  const mouse = event(button, prevented);
  let calls = 0;
  expect(handleActionMouseDown(mouse, admitted, () => calls++)).toBe(false);
  expect(mouse.propagationStopped).toBe(false);expect(mouse.defaultPrevented).toBe(prevented);expect(calls).toBe(0);
});
