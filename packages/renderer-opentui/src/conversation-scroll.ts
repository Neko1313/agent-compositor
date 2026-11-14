/** Public native scroll state; conversation inputs and widgets stay outside this memory. */
export interface ConversationScrollBoxLike {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly viewport: {readonly height: number};
  readonly isDestroyed?: boolean;
  afterLayout(callback: () => void): void;
  scrollTo(top: number): void;
}

type Position = {top: number; followBottom: boolean};
type Restore = {active: boolean};

/** Panes share a conversation, but retain independent positions in its transcript. */
export function createConversationScrollMemory() {
  const positions = new Map<string, Position>();
  const pending = new Map<ConversationScrollBoxLike, Restore>();
  let epoch: unknown = Symbol('initial conversation');

  function cancel(box: ConversationScrollBoxLike) {
    const previous = pending.get(box);
    if (previous) previous.active = false;
    pending.delete(box);
  }
  function range(box: ConversationScrollBoxLike): number | undefined {
    if (box.isDestroyed) return;
    const height = box.viewport.height, content = box.scrollHeight;
    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(content) || content < 0) return;
    return Math.max(0, content - height);
  }

  return {
    capture(paneId: string, box: ConversationScrollBoxLike): boolean {
      cancel(box);
      const maximum = range(box);
      if (maximum === undefined || !Number.isFinite(box.scrollTop)) return false;
      const top = Math.max(0, Math.min(maximum, box.scrollTop));
      positions.set(paneId, {top, followBottom: top >= maximum});
      return true;
    },
    restore(paneId: string, box: ConversationScrollBoxLike): () => void {
      cancel(box);
      if (box.isDestroyed) return () => {};
      const attempt: Restore = {active: true};
      pending.set(box, attempt);
      box.afterLayout(() => {
        if (!attempt.active || pending.get(box) !== attempt) return;
        attempt.active = false;
        pending.delete(box);
        const maximum = range(box);
        if (maximum === undefined) return;
        // Another resident/read-only instance can capture this pane before layout.
        const position = positions.get(paneId);
        box.scrollTo(!position || position.followBottom ? Infinity : Math.min(position.top, maximum));
      });
      return () => {
        attempt.active = false;
        if (pending.get(box) === attempt) pending.delete(box);
      };
    },
    reset(nextEpoch: unknown): void {
      if (Object.is(epoch, nextEpoch)) return;
      epoch = nextEpoch;
      positions.clear();
      for (const attempt of pending.values()) attempt.active = false;
      pending.clear();
    },
  };
}
