export type PointerMode = 'auto' | 'on' | 'off' | 'x11';
export type PointerShape = 'default' | 'pointer' | 'text' | 'grab' | 'grabbing' | 'ew-resize' | 'ns-resize' | 'not-allowed';
/** VTE/GNOME Terminal and Alacritty do not implement OSC 22. */
export function pointerControl(env: NodeJS.ProcessEnv = process.env, mode: PointerMode = 'auto') {
    const known = /kitty|ghostty|foot/i.test([env.TERM, env.TERM_PROGRAM].join(' ')) || !!env.KITTY_WINDOW_ID;
    const supported = mode === 'on' || mode === 'x11' || mode === 'auto' && known && !env.VTE_VERSION && !env.TMUX && !env.STY;
    const x11: Record<PointerShape, string> = { default: 'left_ptr', pointer: 'hand2', text: 'xterm', grab: 'hand2', grabbing: 'fleur', 'ew-resize': 'sb_h_double_arrow', 'ns-resize': 'sb_v_double_arrow', 'not-allowed': 'crossed_circle' };
    return { supported, sequence: (shape: PointerShape) => supported ? `\x1b]22;${mode === 'x11' ? x11[shape] : shape}\x1b\\` : '' };
}
