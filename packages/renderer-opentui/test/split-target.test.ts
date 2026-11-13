import {expect, it} from 'vitest';
import {splitTargetLabel} from '../src/split-target.js';
import type {WindowLayoutSnapshot, WindowSplitTarget} from '../src/layout.js';

const state = (target?: Partial<WindowSplitTarget>, changes: Partial<WindowLayoutSnapshot> = {}): WindowLayoutSnapshot => ({
  revision: 1, width: 140, height: 40, frames: [], focused: 'main', workspace: 1, workspaces: [1, 2],
  locations: {main: 1, tools: 1}, axis: 'vertical', fullscreen: false, compact: false, pointer: 'default',
  ...(target ? {splitTarget: {axis: 'horizontal', ratio: .55, focusedChild: 0, children: [['main'], ['tools']], visibility: 'visible', ...target}} : {}),
  ...changes,
});

it('names the selected split rather than the different future opening axis', () => {
  expect(splitTargetLabel(state({focusedChild: 1}), 140)).toBe('Target: columns · saved 55/45 · + grows right');
  expect(splitTargetLabel(state({axis: 'vertical', focusedChild: 1}), 140)).toBe('Target: rows · saved 55/45 · + grows bottom');
});

it('keeps saved ratios distinct from visible geometry and explains hidden targets', () => {
  expect(splitTargetLabel(state({ratio: .85, divider: {x: 45, y: 0, width: 2, height: 20}}), 140))
    .toBe('Target: columns · saved 85/15 · + grows left');
  expect(splitTargetLabel(state({visibility: 'size-limited'}), 140)).toContain('hidden by terminal size');
  expect(splitTargetLabel(state({visibility: 'zoomed'}), 140)).toContain('hidden by zoom');
  expect(splitTargetLabel(state({visibility: 'unmeasured'}), 140)).toContain('waiting for viewport');
});

it('retains the target side and hidden reason within a 38-column footer', () => {
  for (const axis of ['horizontal', 'vertical'] as const) for (const focusedChild of [0, 1] as const)
    for (const visibility of ['size-limited', 'compact', 'zoomed', 'unmeasured'] as const) {
      const text = splitTargetLabel(state({axis, focusedChild, visibility}), 38);
      expect(text.length).toBeLessThanOrEqual(36);
      expect(text).toContain(visibility === 'size-limited' ? 'small' : visibility === 'compact' ? 'narrow' : visibility === 'unmeasured' ? 'wait' : 'zoomed');
    }
  expect(splitTargetLabel(state({focusedChild: 1, visibility: 'compact'}), 38))
    .toBe('Target: cols 55/45 · +right · narrow');
  expect(splitTargetLabel(state({focusedChild: 1, visibility: 'size-limited'}), 38))
    .toBe('Target: cols 55/45 · +right · small');
  expect(splitTargetLabel(state({focusedChild: 1, visibility: 'size-limited'}), 48))
    .toBe('Target: cols 55/45 · +right · small area');
});

it('distinguishes a lone or empty workspace from a host without target metadata', () => {
  expect(splitTargetLabel(state(undefined, {locations: {main: 1}}), 140)).toBe('Next split: rows · no resize target');
  expect(splitTargetLabel(state(undefined, {locations: {main: 1}, workspace: 2}), 38)).toBe('Next: rows · no resize target');
  expect(splitTargetLabel(state(), 140)).toBe('Split target unavailable');
});
