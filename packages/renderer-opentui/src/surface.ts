import type {UiTextView} from '@agent-compositor/events';
import type {ConversationInteraction} from './session.js';

export interface UiSurfaceSnapshot {
  revision: number;
  title: string;
  view?: UiTextView;
  form?: Extract<ConversationInteraction, {kind: 'form'}>;
  busy?: boolean;
  error?: string;
}

/** Semantic data and admitted actions; extension code never runs in the renderer. */
export interface UiSurfaceSource {
  id: string;
  snapshot(): UiSurfaceSnapshot;
  subscribe(listener: () => void): () => void;
  press(action: string, revision: number): void;
  change(field: string, value: string, revision: number): void;
  answerForm?(id: string, value: unknown): void;
  cancelForm?(id: string): void;
}

export interface UiSurfaceRegistry {
  snapshot(): readonly UiSurfaceSource[];
  subscribe(listener: () => void): () => void;
}
