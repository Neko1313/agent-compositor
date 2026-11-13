export type Message = {role: 'user' | 'assistant'; text: string};
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
}

/** The renderer subscribes to the session it displays. The host owns its lifetime. */
export interface ConversationSession {
  id: string;
  /** Stable compositor identity, independent of this core's runtime session ID. */
  paneId?: string;
  label: string;
  snapshot(): ConversationSnapshot;
  subscribe(callback: () => void): () => void;
  submit(text: string): void;
  answerApproval?(id: string, allow: boolean): void;
}
