import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ComposerMedia} from '../src/ghost.js';
import type {ConversationSession, ConversationSnapshot} from '../src/session.js';
import type {WindowLayoutSource} from '../src/layout.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fixture() {
  const [{createTestRenderer, setRendererCapabilities}, sdk, {createRoot, flushSync}, {createElement}, {Ghost}] = await Promise.all([
    import('@opentui/core/testing'), import('@opentui/core'), import('@opentui/react'), import('react'), import('../src/ghost.js'),
  ]);
  const test = await createTestRenderer({width: 120, height: 24, exitOnCtrlC: false});
  cleanup.push(() => test.dispose());
  setRendererCapabilities(test.renderer, {kitty_graphics: true, multiplexer: 'none'});
  const root = createRoot(test.renderer);
  cleanup.push(() => root.unmount());
  let presentation = {label: 'Approval needed · paused', alt: 'Review the file', hasImage: true};
  const frame = {width: 1, height: 1, rgba: Uint8Array.from([1, 2, 3, 128])};
  let availableFrame: typeof frame | undefined = frame;
  const listeners = new Map<Parameters<ComposerMedia['subscribe']>[1], boolean>();
  const subscribe = vi.fn<ComposerMedia['subscribe']>((_active, listener, options) => {
    const expanded = options?.expanded !== false;
    listeners.set(listener, expanded);listener(expanded ? availableFrame : undefined);
    return () => {listeners.delete(listener);};
  });
  const media: ComposerMedia = {presentation: () => presentation, dimensions: () => ({width: 8, height: 4}), subscribe};
  const show = async (enabled = true, expanded = true) => {
    flushSync(() => root.render(createElement('box', {flexDirection: 'column'},
      createElement('text', {}, 'Actual composer'), createElement(Ghost, {media, enabled, expanded, active: false}))));
    await test.flush({maxPasses: 30});
    expect(test.captureCharFrame()).toContain('Actual composer');
  };
  const nodes = (node: typeof test.renderer.root): typeof node[] => [node, ...node.getChildren().flatMap(nodes)];
  const images = () => nodes(test.renderer.root).filter(node => node instanceof sdk.ImageRenderable) as InstanceType<typeof sdk.ImageRenderable>[];
  const publish = async (next: typeof presentation) => {
    presentation = next;
    flushSync(() => {for (const [listener, expanded] of listeners) listener(expanded ? frame : undefined);});
    await test.flush({maxPasses: 30});
  };
  return {test, root, show, publish, subscribe, listeners, images, frame, media, createElement, flushSync, sdk,
    holdFrames() {availableFrame = undefined;}};
}

// Node 22 can run the portable policy tests without loading the native SDK.
describe.skipIf(Number(process.versions.node.split('.')[0]) < 26)('native Ghost presentation', () => {
  it('retains the actual producer status when image output is disabled', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'off');
    const f = await fixture();await f.show();
    expect(f.test.captureCharFrame()).toContain('Approval needed · paused');
    expect(f.test.captureCharFrame()).not.toContain('Review the file');
    expect(f.subscribe).toHaveBeenLastCalledWith(false, expect.any(Function), {expanded: false});
    expect(f.images()).toHaveLength(0);
  });
  it.each(['NO_COLOR', 'AGENT_REDUCED_MOTION', 'TERM'] as const)('retains a compact live status with %s', async variable => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv(variable, variable === 'TERM' ? 'dumb' : '1');
    const f = await fixture();await f.show();
    expect(f.test.captureCharFrame()).toContain('Approval needed · paused');
    expect(f.images()).toHaveLength(0);
    expect(f.subscribe).toHaveBeenLastCalledWith(false, expect.any(Function), {expanded: false});
    await f.publish({label: 'Something went wrong', alt: 'Source unavailable', hasImage: false});
    expect(f.test.captureCharFrame()).toContain('Something went wrong');
  });
  it('keeps compact metadata subscribed and revokes callbacks only when its composer is hidden', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('AGENT_REDUCED_MOTION', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const f = await fixture();await f.show(true, false);
    expect(f.listeners.size).toBe(1);expect([...f.listeners.values()]).toEqual([false]);
    await f.publish({label: 'Text-only companion', alt: 'Ready', hasImage: false});
    expect(f.test.captureCharFrame()).toContain('Text-only companion');
    const late = [...f.listeners.keys()][0];await f.show(false, false);
    expect(f.listeners.size).toBe(0);expect(f.test.captureCharFrame()).not.toContain('Text-only companion');
    late(f.frame);await f.test.flush();expect(f.images()).toHaveLength(0);
  });
  it('retains RGBA alpha in the native image and destroys it when returning to compact status', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('AGENT_REDUCED_MOTION', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const f = await fixture();await f.show();
    await f.test.waitFor(() => f.images()[0]?.image !== null && Boolean(f.images()[0]?.image));
    const image = f.images()[0];expect(image.protocol).toBe('kitty');expect([...image.image!.raw().data]).toEqual([1, 2, 3, 128]);
    await f.publish({label: 'Replacement status', alt: '', hasImage: false});
    expect(image.isDestroyed).toBe(true);expect(f.images()).toHaveLength(0);
    expect([...f.listeners.values()]).toEqual([false]);
    expect(f.test.captureCharFrame()).toContain('Replacement status');
    await f.publish({label: 'Approval needed · paused', alt: 'Review the file', hasImage: true});
    await f.test.waitFor(() => Boolean(f.images()[0]?.image));
    const resumed = f.images()[0];
    await f.show(true, false);
    expect(resumed.isDestroyed).toBe(true);expect(f.images()).toHaveLength(0);
    expect(f.test.captureCharFrame()).toContain('Approval needed · paused');
    await f.show();await f.test.waitFor(() => Boolean(f.images()[0]?.image));
    expect(f.images()[0]).not.toBe(image);expect(f.listeners.size).toBe(1);
  });
  it('subscribes only the selected editor composer while the parked native composer stays hidden', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('AGENT_REDUCED_MOTION', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const f = await fixture(), {ConversationView} = await import('../src/view.js');
    const selectedState: ConversationSnapshot = {messages: [], running: false, editor: {id: 'chosen-editor', kind: 'editor', revision: 1, inputRevision: 0,
      available: true, preferredRows: 1, view: {lines: [{text: 'Selected editor ready'}]}}};
    const session: ConversationSession = {id: 'core', paneId: 'session', label: 'Main', submit: () => false, subscribe: () => () => {},
      snapshot: () => selectedState,
      editorInput: () => 1, editorViewport() {},
    };
    const state = {revision: 1, width: 120, height: 19, frames: [{surface: 'session', x: 0, y: 0, width: 120, height: 19}],
      focused: 'session', workspace: 1, workspaces: [1], locations: {session: 1}, axis: 'horizontal', fullscreen: false,
      compact: false, pointer: 'default'} as const;
    const windowLayout: WindowLayoutSource = {snapshot: () => state, subscribe: () => () => {}, resize() {}, act() {}};
    f.flushSync(() => f.root.render(f.createElement(ConversationView, {sessions: [session], composerMedia: f.media, windowLayout})));
    await f.test.flush({maxPasses: 30});
    expect(f.test.captureCharFrame()).toContain('Selected editor ready');
    expect(f.listeners.size).toBe(1);
    expect([...f.listeners.values()]).toEqual([false]);
  });
  it('reopens without importing old pixels while the new source frame is delayed', async () => {
    vi.stubEnv('AGENT_GRAPHICS', 'auto');vi.stubEnv('NO_COLOR', undefined);vi.stubEnv('AGENT_REDUCED_MOTION', undefined);vi.stubEnv('TERM', 'xterm-256color');
    const f = await fixture();await f.show();await f.test.waitFor(() => Boolean(f.images()[0]?.image));
    const image = f.images()[0];await f.show(false);expect(image.isDestroyed).toBe(true);
    f.holdFrames();const imports = vi.spyOn(f.sdk.NativeImage, 'fromPixels');
    await f.show();expect(f.images()).toHaveLength(0);expect(imports).not.toHaveBeenCalled();
  });
});
