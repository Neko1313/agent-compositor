import type { ComposerMedia } from '@agent-compositor/renderer-opentui';
import { AnimationPack } from '../../plugins/mascot/animations.js';
import { Timeline } from '../../plugins/mascot/timeline.js';

// The prototype plays the original bundled APNGs with their unmodified alpha.
const pack = new AnimationPack('', { restoreInk: false });

export const ghostMedia: ComposerMedia = {
  subscribe(active, onFrame) {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    void pack.load(active ? 'thinking' : 'idle').then(frames => {
      if (cancelled) return;
      const pixels = frames.map(({ width, height, rgba }) => ({ width, height, rgba: Buffer.from(rgba, 'base64') }));
      const timeline = new Timeline();
      timeline.select(frames);
      timeline.play(true);
      function showFrame() {
        const { index, wait, done } = timeline.sample(frames, frames.plays);
        onFrame(pixels[index]);
        if (!done) timer = setTimeout(showFrame, Math.ceil(wait));
      }
      showFrame();
    }).catch(() => {
      if (!cancelled) onFrame(undefined);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  },
};
