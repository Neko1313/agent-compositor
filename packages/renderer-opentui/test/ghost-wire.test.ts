import {afterEach, describe, expect, it, vi} from 'vitest';
import {COMPOSER_MEDIA_STATUS, decodeLine, encodeMessage, hello, nativeProtocolElements,
  type NativeInputMessage, type NativeState, type WireMessage} from '@agent-compositor/protocol';
import {createNativePresentationClient} from '../src/native-client.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();vi.unstubAllEnvs();});

// A real SDK widget and production client are exercised. Only host-message
// delivery is held; this is a native unit seam, not a physical terminal claim.
describe.skipIf(Number(process.versions.node.split('.')[0]) < 26)('Ghost asynchronous native media transport', () => {
  it('keeps requesting the expanded source while its new pixel frame is still in transit', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('AGENT_REDUCED_MOTION', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const [{createTestRenderer, setRendererCapabilities}, sdk, {createRoot, flushSync}, {createElement}, {Ghost}] = await Promise.all([
      import('@opentui/core/testing'), import('@opentui/core'), import('@opentui/react'), import('react'), import('../src/ghost.js'),
    ]);
    const copy = (message: WireMessage) => decodeLine(encodeMessage(message));
    const inputs: NativeInputMessage[] = [];
    const client = createNativePresentationClient(message => {
      const value = copy(message);if (value.type === 'native-input') inputs.push(value);
    });
    cleanup.push(() => client.close());
    client.hello();
    client.receive(copy(hello('core', {surfaces: ['terminal'], sites: [],
      elements: [...nativeProtocolElements, COMPOSER_MEDIA_STATUS], encodings: ['jsonl']})));
    client.receive(copy({type: 'hello-ack', ok: true, version: '0.7.0'}));
    const state: NativeState['state'] = {sessions: [], windows: [], surfaces: [], publicRender: [], immediateCommands: [],
      layout: {revision: 1, width: 80, height: 24, frames: [], focused: '', workspace: 1, workspaces: [1], locations: {},
        axis: 'horizontal', fullscreen: false, compact: false, pointer: 'default'}};
    client.receive(copy({type: 'native-state', epoch: 'media-epoch', revision: 1, state}));await client.ready;
    const test = await createTestRenderer({width: 80, height: 24, exitOnCtrlC: false});
    cleanup.push(() => test.dispose());setRendererCapabilities(test.renderer, {kitty_graphics: true, multiplexer: 'none'});
    const root = createRoot(test.renderer);cleanup.push(() => root.unmount());
    const show = (expanded: boolean) => flushSync(() => root.render(createElement('box', {flexDirection: 'column'},
      createElement('text', {}, 'Actual composer'), createElement(Ghost, {media: client.composerMedia, enabled: true, expanded, active: false}))));
    show(false);
    await test.flush({maxPasses: 30});expect(test.captureCharFrame()).toContain('Actual composer');
    const enabled = () => inputs.filter(input => input.operation.kind === 'media-active' && input.operation.enabled);
    expect(enabled().at(-1)?.operation).toEqual({kind: 'media-active', enabled: true, active: false, expanded: false});

    // The first compact response says that the genuine source has an image.
    // The later expanded response remains explicitly undelivered during flush.
    flushSync(() => client.receive(copy({type: 'native-media', epoch: 'media-epoch', revision: 1, dimensions: {width: 8, height: 4},
      presentation: {label: 'Ready · paused', hasImage: true}})));
    await test.flush({maxPasses: 30});
    show(true);await test.flush({maxPasses: 30});
    expect(enabled().map(input => input.operation.kind === 'media-active' && input.operation.expanded)).toEqual([false, true]);
    expect(client.composerMedia.presentation?.()).toEqual({label: 'Ready · paused', hasImage: true});

    const nodes = (node: typeof test.renderer.root): typeof node[] => [node, ...node.getChildren().flatMap(nodes)];
    const images = () => nodes(test.renderer.root).filter(node => node instanceof sdk.ImageRenderable) as InstanceType<typeof sdk.ImageRenderable>[];
    expect(images()).toHaveLength(0);
    flushSync(() => client.receive(copy({type: 'native-media', epoch: 'media-epoch', revision: 2, dimensions: {width: 8, height: 4},
      presentation: {label: 'Ready · paused', hasImage: true}, frame: {width: 1, height: 1, rgba: '/wAA/w=='}})));
    await test.waitFor(() => Boolean(images()[0]?.image));
    expect([...images()[0].image!.raw().data]).toEqual([255, 0, 0, 255]);
    expect(enabled()).toHaveLength(2);
  });
  it('keeps a delayed legacy frame when its peer has no media presentation capability', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('AGENT_REDUCED_MOTION', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const [{createTestRenderer, setRendererCapabilities}, sdk, {createRoot, flushSync}, {createElement}, {Ghost}] = await Promise.all([
      import('@opentui/core/testing'), import('@opentui/core'), import('@opentui/react'), import('react'), import('../src/ghost.js'),
    ]);
    const copy = (message: WireMessage) => decodeLine(encodeMessage(message));
    const inputs: NativeInputMessage[] = [];
    const client = createNativePresentationClient(message => {
      const value = copy(message);if (value.type === 'native-input') inputs.push(value);
    });cleanup.push(() => client.close());
    client.hello();client.receive(copy(hello('core', {surfaces: ['terminal'], sites: [], elements: [...nativeProtocolElements], encodings: ['jsonl']})));
    client.receive(copy({type: 'hello-ack', ok: true, version: '0.7.0'}));
    client.receive(copy({type: 'native-state', epoch: 'legacy-media', revision: 1,
      state: {sessions: [], windows: [], surfaces: [], publicRender: [], immediateCommands: [], layout: {revision: 1, width: 80, height: 24,
        frames: [], focused: '', workspace: 1, workspaces: [1], locations: {}, axis: 'horizontal', fullscreen: false, compact: false, pointer: 'default'}}}));
    await client.ready;
    const test = await createTestRenderer({width: 80, height: 24, exitOnCtrlC: false});cleanup.push(() => test.dispose());
    setRendererCapabilities(test.renderer, {kitty_graphics: true, multiplexer: 'none'});
    const root = createRoot(test.renderer);cleanup.push(() => root.unmount());
    flushSync(() => root.render(createElement('box', {flexDirection: 'column'}, createElement('text', {}, 'Actual legacy composer'),
      createElement(Ghost, {media: client.composerMedia, enabled: true, active: false}))));
    await test.flush({maxPasses: 30});expect(test.captureCharFrame()).toContain('Actual legacy composer');
    const enabledBeforeFrame = inputs.filter(input => input.operation.kind === 'media-active' && input.operation.enabled).length;
    expect(enabledBeforeFrame).toBeGreaterThan(0);
    // Exactly one real legacy packet arrives later, without optional metadata.
    flushSync(() => client.receive(copy({type: 'native-media', epoch: 'legacy-media', revision: 1, dimensions: {width: 8, height: 4},
      frame: {width: 1, height: 1, rgba: '/wAA/w=='}})));
    await test.flush({maxPasses: 30});
    const nodes = (node: typeof test.renderer.root): typeof node[] => [node, ...node.getChildren().flatMap(nodes)];
    const images = () => nodes(test.renderer.root).filter(node => node instanceof sdk.ImageRenderable) as InstanceType<typeof sdk.ImageRenderable>[];
    expect(images()).toHaveLength(1);await test.waitFor(() => Boolean(images()[0]?.image));
    expect([...images()[0].image!.raw().data]).toEqual([255, 0, 0, 255]);
    expect(inputs.filter(input => input.operation.kind === 'media-active' && input.operation.enabled)).toHaveLength(enabledBeforeFrame);
    for (const input of inputs) if (input.operation.kind === 'media-active') expect(input.operation).not.toHaveProperty('expanded');
  });
});
