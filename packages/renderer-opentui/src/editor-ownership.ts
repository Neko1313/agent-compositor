/** Live ownership is checked before host navigation, even within one key packet. */
export function createEditorInputOwnership() {
  const owners = new Map<object, () => boolean>();
  const listeners = new Set<() => void>();
  const ownsInput = () => [...owners.values()].some(current => current());
  let selected = false;
  function refresh() {
    const next = ownsInput();
    if (selected === next) return;
    selected = next;
    for (const listener of listeners) listener();
  }
  return {
    ownsInput,
    refresh,
    snapshot: () => selected,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    register(owner: object, current: () => boolean) {
      owners.set(owner, current);refresh();
      return () => {if (owners.get(owner) === current) {owners.delete(owner);refresh();}};
    },
  };
}
export type EditorInputOwnership = ReturnType<typeof createEditorInputOwnership>;
