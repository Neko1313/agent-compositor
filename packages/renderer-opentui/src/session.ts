import type {Questionnaire, UiForm} from '@agent-compositor/events';
import type {ConversationController, ConversationEditor, ControllerInput} from './controller.js';

export type Message = {role: 'user' | 'assistant'; text: string};
export type ConversationInteraction =
  | {id: string; kind: 'question'; request: Questionnaire; error?: string}
  | {id: string; kind: 'form'; plugin: string; request: UiForm; error?: string};
export interface ConversationApproval {
  id: string;
  tool: string;
  reason: string;
  details: readonly {label: string; value: string}[];
}

export interface ConversationSnapshot {
  messages: readonly Message[];
  running: boolean;
  error?: string;
  notice?: string;
  approval?: ConversationApproval;
  interaction?: ConversationInteraction;
  controller?: ConversationController;
  editor?: ConversationEditor;
}

/** The renderer subscribes to the session it displays. The host owns its lifetime. */
export interface ConversationSession {
  id: string;
  /** Stable shared input identity across window copies and Core replacement. */
  conversationId?: string;
  /** Core binding epoch; resuming the same journal can retain its session ID. */
  generation?:string|number;
  /** Stable compositor identity, independent of this core's runtime session ID. */
  paneId?: string;
  label: string;
  /** A retained window port cannot act on a replacement Core. */
  isCurrent?():boolean;
  snapshot(): ConversationSnapshot;
  subscribe(callback: () => void): () => void;
  submit(text: string): void|boolean;
  isImmediateCommand?(text: string): boolean;
  interrupt?(): void;
  answerApproval?(id: string, allow: boolean): void;
  answerInteraction?(id: string, value: unknown): void;
  cancelInteraction?(id: string): void;
  controllerInput?(id: string, input: ControllerInput, revision: number): number|undefined;
  controllerViewport?(id: string, columns: number, rows: number): void;
  cancelController?(id: string): void;
  editorInput?(id: string, input: ControllerInput, revision: number): number|undefined;
  editorViewport?(id: string, columns: number, rows: number, maxRows?:number): void;
}
