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
  it.each(['auto','sixel'] as const)('uses SIXEL only after pixel geometry is available in %s mode',async graphics=>{
    vi.stubEnv('AGENT_GRAPHICS',graphics);vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','xterm-256color');
    const [{createTestRenderer,setRendererCapabilities},sdk,{createRoot,flushSync},{createElement},{SurfaceRaster}]=await Promise.all([
      import('@opentui/core/testing'),import('@opentui/core'),import('@opentui/react'),import('react'),import('../src/surface-raster.js'),
    ]);
    const test=await createTestRenderer({width:80,height:24,exitOnCtrlC:false});cleanup.push(()=>test.dispose());
    setRendererCapabilities(test.renderer,{kitty_graphics:false,sixel:true,multiplexer:'none'});
    let resolution:{width:number;height:number}|null=null;vi.spyOn(test.renderer,'resolution','get').mockImplementation(()=>resolution);
    const root=createRoot(test.renderer);cleanup.push(()=>root.unmount());
    flushSync(()=>root.render(createElement(SurfaceRaster,{raster:{width:1,height:1,rgba:'/wAA/w==',alt:'Resource chart'},width:20,height:8,visible:true})));
    const nodes=(node:typeof test.renderer.root):typeof node[]=>[node,...node.getChildren().flatMap(nodes)];
    const images=()=>nodes(test.renderer.root).filter(node=>node instanceof sdk.ImageRenderable) as InstanceType<typeof sdk.ImageRenderable>[];
    await test.waitFor(()=>test.captureCharFrame().includes('Resource chart'));expect(images()).toHaveLength(0);
    resolution={width:800,height:480};flushSync(()=>test.renderer.emit(sdk.CliRenderEvents.FRAME));
    await test.waitFor(()=>images().length===1);expect(images()[0].protocol).toBe('sixel');
    resolution=null;flushSync(()=>test.renderer.emit(sdk.CliRenderEvents.RESIZE));
    await test.waitFor(()=>images().length===0&&test.captureCharFrame().includes('Resource chart'));
  });
});
