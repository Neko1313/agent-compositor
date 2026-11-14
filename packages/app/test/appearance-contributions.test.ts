import {expect, it} from 'vitest';
import {AppearanceContributions, mergeAppearance} from '../src/appearance-contributions.js';
import {appearanceFrom, DEFAULT_APPEARANCE} from '../src/presentation.js';

it('merges all portable sections without importing any renderer defaults', () => {
  const store = new AppearanceContributions();expect(store.snapshot()).toEqual({});
  const patch = {colors: {text: '#010101', muted: 'gray', accent: 'cyanBright', success: 'green', warning: 'yellow', danger: 'red', border: '#020202',
    titleBackground: '#030303', selectionBackground: '#040404', selectionText: 'whiteBright'},
    chrome: {borderStyle: 'double' as const, controls: 'always' as const},
    presentation: {userLabel: 'User', agentLabel: 'Worker', welcome: 'Welcome', toolDetails: true, hints: false, showTools: true}};
  expect(store.publish('theme', patch)).toMatchObject({accepted: true, showTools: true});expect(store.snapshot()).toEqual(patch);
  patch.colors.text = '#999999';expect(store.snapshot().colors?.text).toBe('#010101');
  expect(Object.isFrozen(store.snapshot())).toBe(true);expect(Object.isFrozen(store.snapshot().colors)).toBe(true);
  expect(appearanceFrom([store.snapshot()]).colors).toEqual(store.snapshot().colors);
});

it('replaces owner fields at valid publication order and ignores invalid state and ordering changes', () => {
  const store = new AppearanceContributions();
  store.publish('a', {colors: {accent: 'red', border: 'blue'}, chrome: {borderStyle: 'round'}});
  store.publish('b', {colors: {accent: 'green', success: 'yellow'}});
  const valid = store.snapshot();expect(store.publish('a', {colors: {accent: '\x1b[31m'}, presentation: {showTools: false}})).toEqual({accepted: false, changed: false});
  expect(store.snapshot()).toBe(valid);expect(store.snapshot().colors?.accent).toBe('green');
  store.publish('a', {presentation: {agentLabel: 'Latest'}});
  expect(store.snapshot()).toEqual({colors: {accent: 'green', success: 'yellow'}, presentation: {agentLabel: 'Latest'}});
  store.publish('b', null);expect(store.snapshot()).toEqual({presentation: {agentLabel: 'Latest'}});
  expect(appearanceFrom([store.snapshot()]).colors).toEqual(DEFAULT_APPEARANCE.colors);
  store.remove('a');expect(store.snapshot()).toEqual({});
});

it('returns showTools only for explicit valid publications and never replays it for removal or unrelated fields', () => {
  const store = new AppearanceContributions();
  expect(store.publish('a', {presentation: {showTools: true}}).showTools).toBe(true);
  expect(store.publish('a', {presentation: {showTools: true}}).showTools).toBe(true);
  expect(store.publish('b', {colors: {accent: 'blue'}}).showTools).toBeUndefined();
  expect(store.publish('a', null).showTools).toBeUndefined();expect(store.snapshot()).toEqual({colors: {accent: 'blue'}});
  store.clear();expect(store.snapshot()).toEqual({});
  expect(mergeAppearance([{colors: {accent: 'red'}}, {colors: {accent: undefined}}])).toEqual({colors: {accent: 'red'}});
});
