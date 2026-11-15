import type {TerminalCapabilities} from '@opentui/core';
import {appearanceText} from './colors.js';

export interface ComposerMediaPresentation {label?: string; alt?: string; hasImage: boolean}
export type ComposerImageProtocol = 'kitty' | 'sixel';

/** Accept only the SDK-selected native protocol and its actual requirements. */
export function composerImageProtocol(mode: string | undefined, resolved: string,
  capabilities: Pick<TerminalCapabilities, 'kitty_graphics' | 'sixel' | 'multiplexer'> | null,
  hasResolution: boolean): ComposerImageProtocol | undefined {
  const requested = mode ?? 'auto';
  if (!['auto', 'kitty', 'sixel'].includes(requested) || !capabilities ||
    capabilities.multiplexer === 'tmux' || capabilities.multiplexer === 'screen') return;
  if (requested !== 'auto' && requested !== resolved) return;
  if (resolved === 'kitty' && capabilities.kitty_graphics) return 'kitty';
  if (resolved === 'sixel' && capabilities.sixel && hasResolution) return 'sixel';
}

/** Compact decoration retains the producer's status without inventing block art. */
export function composerMediaStatus(presentation: ComposerMediaPresentation | undefined, unavailable: boolean): string {
  const primary = presentation?.label?.trim() ? presentation.label : presentation?.alt;
  const labels = primary?.trim() ? [appearanceText(primary)] : [];
  if (presentation?.hasImage && unavailable) labels.push('images unavailable');
  return labels.join(' · ');
}
