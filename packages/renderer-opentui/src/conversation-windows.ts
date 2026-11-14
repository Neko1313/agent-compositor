import type {ConversationSession} from './session.js';

/** A window has its own compositor identity and a guarded port to one conversation. */
export interface ConversationWindow {
  id: string;
  label: string;
  session: ConversationSession;
}

/** Includes closed windows; the layout remains authoritative for visibility. */
export interface ConversationWindowRegistry {
  snapshot(): readonly ConversationWindow[];
  subscribe(listener: () => void): () => void;
}

export interface ConversationWindowGroup {
  id: string;
  windows: readonly ConversationWindow[];
}

/** Copies share a logical input owner, never two different live Core generations. */
export function groupConversationWindows(windows: readonly ConversationWindow[]): readonly ConversationWindowGroup[] {
  if (windows.length > 256) throw Error('Too many conversation windows');
  const ids = new Set<string>(), groups = new Map<string, ConversationWindow[]>();
  for (const window of windows) {
    const identity = window.session.conversationId ?? window.session.id;
    if (!window.id || window.id.length > 128 || ids.has(window.id) || !identity || !window.label || window.label.length > 512)
      throw Error('Conversation windows require distinct bounded identities and labels');
    ids.add(window.id);
    const group = groups.get(identity) ?? [];
    if (group.length && (group[0].session.id !== window.session.id||group[0].session.generation!==window.session.generation))
      throw Error('Window copies must refer to one conversation generation');
    group.push(window);groups.set(identity, group);
  }
  return [...groups].map(([id, windows]) => ({id, windows}));
}

/** Closing a pane parks its input owner; only an explicit focus selects another. */
export function conversationInputWindow(group: ConversationWindowGroup, focused: string, previous?: string): ConversationWindow {
  if(!group.windows.length)throw Error('A conversation needs a window identity');
  return group.windows.find(window => window.id === focused)
    ?? group.windows.find(window => window.id === previous)
    ?? group.windows[0];
}
