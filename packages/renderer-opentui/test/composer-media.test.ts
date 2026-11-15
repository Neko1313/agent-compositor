import {describe, expect, it} from 'vitest';
import {composerImageProtocol, composerMediaStatus} from '../src/composer-media.js';

const caps = {kitty_graphics: true, sixel: true, multiplexer: 'none' as const};
describe('portable composer media policy', () => {
  it('accepts supported native protocols and requires actual SIXEL pixel geometry', () => {
    expect(composerImageProtocol('auto', 'kitty', caps, false)).toBe('kitty');
    expect(composerImageProtocol('kitty', 'kitty', caps, false)).toBe('kitty');
    expect(composerImageProtocol('auto', 'sixel', caps, true)).toBe('sixel');
    expect(composerImageProtocol('sixel', 'sixel', caps, true)).toBe('sixel');
    expect(composerImageProtocol('sixel', 'sixel', caps, false)).toBeUndefined();
    expect(composerImageProtocol('sixel', 'blocks', caps, false)).toBeUndefined();
  });
  it('never substitutes blocks, invents capabilities or enables unimplemented multiplexer graphics', () => {
    for (const mode of ['auto', 'kitty', 'sixel', 'off', 'invalid'])
      expect(composerImageProtocol(mode, 'blocks', caps, true)).toBeUndefined();
    for (const multiplexer of ['tmux', 'screen'] as const)
      expect(composerImageProtocol('kitty', 'kitty', {...caps, multiplexer}, true)).toBeUndefined();
    expect(composerImageProtocol('auto', 'kitty', null, true)).toBeUndefined();
    expect(composerImageProtocol('auto', 'kitty', {...caps, kitty_graphics: false}, true)).toBeUndefined();
    expect(composerImageProtocol('auto', 'sixel', {...caps, sixel: false}, true)).toBeUndefined();
    expect(composerImageProtocol('kitty', 'sixel', caps, true)).toBeUndefined();
    expect(composerImageProtocol('off', 'kitty', caps, true)).toBeUndefined();
  });
  it('retains producer labels, pause/error information and alternate text literally', () => {
    expect(composerMediaStatus({label: 'Approval needed · paused', alt: 'Review the file', hasImage: true}, true))
      .toBe('Approval needed · paused · images unavailable');
    expect(composerMediaStatus({label: 'Thinking · paused', alt: 'Thinking', hasImage: true}, false)).toBe('Thinking · paused');
    expect(composerMediaStatus({label: '  ', alt: 'Original Ghost', hasImage: true}, true)).toBe('Original Ghost · images unavailable');
    expect(composerMediaStatus({label: 'Something went wrong', alt: 'Something went wrong', hasImage: true}, false))
      .toBe('Something went wrong');
    expect(composerMediaStatus({label: '\x1b[31mReady\u202e', hasImage: false}, false)).toBe('\\u001b[31mReady\\u202e');
    expect(composerMediaStatus({label: 'Text-only companion', hasImage: false}, true)).toBe('Text-only companion');
    expect(composerMediaStatus(undefined, true)).toBe('');
  });
});
