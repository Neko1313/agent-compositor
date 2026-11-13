export type Message = {role: 'user' | 'assistant'; text: string};
export interface ConversationSnapshot {
  messages: readonly Message[];
  running: boolean;
  error?: string;
}

/** The renderer subscribes to the session it displays. The host owns its lifetime. */
export interface ConversationSession {
  id: string;
  label: string;
  snapshot(): ConversationSnapshot;
  subscribe(callback: () => void): () => void;
  submit(text: string): void;
}
