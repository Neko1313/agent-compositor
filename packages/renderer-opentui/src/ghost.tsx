/** @jsxImportSource @opentui/react */
import { CliRenderEvents, NativeImage, resolveImageRenderProtocol, type ImageRenderable } from '@opentui/core';
import { useRenderer } from '@opentui/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {useAppearance} from './appearance.js';
import {composerImageProtocol, composerMediaStatus, type ComposerImageProtocol, type ComposerMediaPresentation} from './composer-media.js';

interface ComposerFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** The host owns the source, animation clock and activity-to-media mapping. */
export interface ComposerMedia {
  subscribe(active: boolean, onFrame: (frame: ComposerFrame | undefined) => void, options?: {expanded?: boolean}): () => void;
  dimensions?():{width:number;height:number};
  presentation?(): ComposerMediaPresentation | undefined;
}

function AnimatedImage({frame, size, protocol}: {frame: ComposerFrame; size?: {width: number; height: number}; protocol: ComposerImageProtocol}) {
  const renderer = useRenderer();
  const image = useRef<ImageRenderable>(null);
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

  return <image id="composer-ghost" ref={image} fit="fit" protocol={protocol}
    width={Math.max(1,Math.min(20,size?.width??8))} height={Math.max(1,Math.min(8,size?.height??4))} flexShrink={0} />;
}

export function Ghost({ media, enabled, expanded = true, active }: { media?: ComposerMedia; enabled: boolean; expanded?: boolean; active: boolean }) {
  const renderer = useRenderer();
  const {color} = useAppearance();
  const graphics = process.env.AGENT_GRAPHICS ?? 'auto';
  const [protocol, setProtocol] = useState<ComposerImageProtocol>();
  const [snapshot, setSnapshot] = useState<{media: ComposerMedia; frame?: ComposerFrame; presentation?: ComposerMediaPresentation; size?: {width: number; height: number}}>();
  useEffect(() => {
    function update() {
      const caps = renderer.capabilities;
      const resolution = renderer.resolution;
      const hasResolution = Boolean(resolution && resolution.width > 0 && resolution.height > 0);
      const requested = graphics === 'kitty' || graphics === 'sixel' ? graphics : 'auto';
      setProtocol(composerImageProtocol(graphics, resolveImageRenderProtocol(requested, caps, hasResolution), caps, hasResolution));
    }
    renderer.on(CliRenderEvents.CAPABILITIES, update);
    renderer.on(CliRenderEvents.RESIZE, update);
    // Pixel-size replies request a frame without emitting CAPABILITIES/RESIZE.
    renderer.on(CliRenderEvents.FRAME, update);
    update();
    return () => {
      renderer.off(CliRenderEvents.CAPABILITIES, update);
      renderer.off(CliRenderEvents.RESIZE, update);
      renderer.off(CliRenderEvents.FRAME, update);
    };
  }, [renderer, graphics]);

  const presentation = snapshot?.media === media ? snapshot?.presentation : media?.presentation?.();
  const imageEnabled = Boolean(enabled && expanded && protocol && (!media?.presentation || presentation?.hasImage !== false) && process.env.NO_COLOR === undefined &&
    process.env.TERM !== 'dumb' && process.env.AGENT_REDUCED_MOTION !== '1');
  useEffect(() => {
    if (!media || !enabled) {setSnapshot(undefined); return;}
    let current = true;
    const off = media.subscribe(active, frame => {
      if (current) setSnapshot({media, frame: imageEnabled ? frame : undefined,
        presentation: media.presentation?.() ?? (frame ? {hasImage: true} : undefined), size: media.dimensions?.()});
    }, {expanded: imageEnabled});
    return () => {current = false; off();};
  }, [media, enabled, imageEnabled, active]);

  if (!media || !enabled || snapshot?.media !== media) return null;
  if (imageEnabled && protocol && snapshot.frame) return <AnimatedImage frame={snapshot.frame} size={snapshot.size} protocol={protocol}/>;
  const status = composerMediaStatus(snapshot.presentation, !protocol && graphics !== 'off');
  return status ? <box height={1} maxWidth="50%" minWidth={0} flexShrink={1}>
    <text height={1} wrapMode="none" truncate selectable={false} fg={color.muted}>{status}</text>
  </box> : null;
}
