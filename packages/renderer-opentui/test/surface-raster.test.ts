import {afterEach, describe, expect, it, vi} from 'vitest';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

// This exercises the native widget, not a physical terminal or passthrough.
describe.skipIf(Number(process.versions.node.split('.')[0]) < 26)('plugin raster fallback', () => {
  it.each(['tmux', 'screen'] as const)('replaces native images with producer alt text in %s', async multiplexer => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const [{createTestRenderer, setRendererCapabilities}, sdk, {createRoot, flushSync}, {createElement}, {SurfaceRaster}] = await Promise.all([
      import('@opentui/core/testing'), import('@opentui/core'), import('@opentui/react'), import('react'), import('../src/surface-raster.js'),
    ]);
    const test = await createTestRenderer({width: 80, height: 24, exitOnCtrlC: false});cleanup.push(() => test.dispose());
    setRendererCapabilities(test.renderer, {kitty_graphics: true, multiplexer: 'none'});
    const root = createRoot(test.renderer);cleanup.push(() => root.unmount());
    flushSync(() => root.render(createElement(SurfaceRaster, {raster: {width: 1, height: 1, rgba: '/wAA/w==', alt: 'Resource chart'}, width: 20, height: 8, visible: true})));
    const nodes = (node: typeof test.renderer.root): typeof node[] => [node, ...node.getChildren().flatMap(nodes)];
    const images = () => nodes(test.renderer.root).filter(node => node instanceof sdk.ImageRenderable);
    await test.waitFor(() => images().length === 1);
    flushSync(() => {
      setRendererCapabilities(test.renderer, {kitty_graphics: true, multiplexer});
      test.renderer.emit(sdk.CliRenderEvents.CAPABILITIES);
    });
    await test.waitFor(() => images().length === 0 && test.captureCharFrame().includes('Resource chart'));
  });
});
