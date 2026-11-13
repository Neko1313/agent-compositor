import { expect, it } from 'vitest';
import { initialLayout, isPaneVisible, updateLayout } from '../src/layout.js';

it('keeps Main visible when opening utility views and focuses either tile without moving it', () => {
  const main = initialLayout('main', 'side');
  const plugins = updateLayout(main, { type: 'open', id: 'plugins' });
  expect(plugins).toMatchObject({ primary: 'main', secondary: 'plugins', focused: 'plugins' });
  expect(isPaneVisible(plugins, 'main', false)).toBe(true);
  expect(isPaneVisible(plugins, 'side', false)).toBe(false);
  expect(updateLayout(plugins, { type: 'focus' })).toEqual({ ...plugins, focused: 'main' });
  expect(updateLayout(plugins, { type: 'open', id: 'main' })).toEqual({ ...plugins, focused: 'main' });
  expect(updateLayout(plugins, { type: 'open', id: 'plugins' })).toBe(plugins);
});

it('keeps the focused identity through swaps, resizing and orientation, including under zoom', () => {
  let layout = initialLayout('main', 'side');
  layout = updateLayout(layout, { type: 'swap' });
  layout = updateLayout(layout, { type: 'orient' });
  layout = updateLayout(layout, { type: 'resize', delta: -200 });
  expect(layout).toMatchObject({ swapped: true, firstShare: 25, direction: 'column', focused: 'main' });
  expect(updateLayout(layout, { type: 'resize', delta: 200 }).firstShare).toBe(75);
  expect(isPaneVisible(layout, 'side', true)).toBe(false);
  expect(isPaneVisible(layout, 'side', false)).toBe(true);
  const zoom = updateLayout(layout, { type: 'zoom' });
  expect(isPaneVisible(zoom, 'side', false)).toBe(false);
  const side = updateLayout(zoom, { type: 'focus' });
  expect(isPaneVisible(side, 'side', false)).toBe(true);
  expect(isPaneVisible(side, 'main', false)).toBe(false);
  expect(updateLayout(zoom, { type: 'zoom' })).toEqual(layout);
});

it('keeps a single pane until there is a distinct second view', () => {
  const layout = initialLayout('main', 'main');
  expect(layout.secondary).toBeUndefined();
  expect(updateLayout(layout, { type: 'focus' })).toBe(layout);
  expect(updateLayout(layout, { type: 'swap' })).toBe(layout);
  expect(updateLayout(layout, { type: 'open', id: 'main' })).toBe(layout);
  expect(updateLayout(layout, { type: 'open', id: 'side' })).toMatchObject({ secondary: 'side', focused: 'side' });
});
