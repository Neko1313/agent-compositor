import { expect, it } from 'vitest';
import { pointerControl } from '../src/pointer.js';
it('does not promise OSC 22 in VTE/GNOME Terminal, Alacritty or unknown terminals', () => {
    for (const env of [{ TERM: 'xterm-256color', VTE_VERSION: '8000' }, { TERM: 'alacritty' }, { TERM: 'xterm-256color' }, { TERM: 'xterm-kitty', TMUX: 'session' }]) {
        const p = pointerControl(env);
        expect(p.supported).toBe(false);
        expect(p.sequence('pointer')).toBe('');
    }
});
it('uses supported native shapes and explicit overrides with a reset sequence', () => {
    for (const env of [{ TERM: 'xterm-kitty' }, { TERM_PROGRAM: 'ghostty' },  { TERM: 'foot' }])
        expect(pointerControl(env).sequence('ew-resize')).toBe('\x1b]22;ew-resize\x1b\\');
    expect(pointerControl({}, 'x11').sequence('pointer')).toContain('hand2');
    expect(pointerControl({}, 'on').sequence('default')).toContain('default');
    expect(pointerControl({ TERM: 'xterm-kitty' }, 'off').supported).toBe(false);
});
