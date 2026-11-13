/** @jsxImportSource @opentui/react */
import { CliRenderEvents, NativeImage, resolveImageRenderProtocol, type ImageRenderable } from '@opentui/core';
import { useRenderer } from '@opentui/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface ComposerFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** The host owns the source, animation clock and activity-to-media mapping. */
export interface ComposerMedia {
  subscribe(active: boolean, onFrame: (frame: ComposerFrame | undefined) => void): () => void;
  dimensions?():{width:number;height:number};
}

function AnimatedImage({ media, active }: { media: ComposerMedia; active: boolean }) {
  const renderer = useRenderer();
  const image = useRef<ImageRenderable>(null);
  const [frame, setFrame] = useState<ComposerFrame>();
  useEffect(() => media.subscribe(active, setFrame), [media, active]);
  useLayoutEffect(() => {
    if (!frame || !image.current) return;
    const source = NativeImage.fromPixels(frame.rgba, frame.width, frame.height, {
      owner: renderer.nativeScene.resourceContext,
    });
    try {
      image.current.source = source;
    } finally {
      // The renderable retains its own handle when source is assigned.
      source.dispose();
    }
  }, [renderer, frame]);

  const size=media.dimensions?.();
  return frame ? <image id="composer-ghost" ref={image} fit="fit" protocol="kitty"
    width={Math.max(1,Math.min(20,size?.width??8))} height={Math.max(1,Math.min(8,size?.height??4))} flexShrink={0} /> : null;
}

export function Ghost({ media, enabled, active }: { media?: ComposerMedia; enabled: boolean; active: boolean }) {
  const renderer = useRenderer();
  const [kitty, setKitty] = useState(false);
  useEffect(() => {
    function update() {
      const caps = renderer.capabilities;
      setKitty(Boolean(caps?.kitty_graphics && resolveImageRenderProtocol('auto', caps, false) === 'kitty'));
    }
    renderer.on(CliRenderEvents.CAPABILITIES, update);
    update();
    return () => { renderer.off(CliRenderEvents.CAPABILITIES, update); };
  }, [renderer]);

  const graphics = process.env.AGENT_GRAPHICS ?? 'auto';
  if (!media || !enabled || !kitty || (graphics !== 'auto' && graphics !== 'kitty') ||
      process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb' || process.env.AGENT_REDUCED_MOTION === '1') return null;
  return <AnimatedImage media={media} active={active} />;
}
