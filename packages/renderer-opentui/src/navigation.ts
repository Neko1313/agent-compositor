export interface WindowNavigationEntry {
  id: string;
  title: string;
  workspace?: number;
  state: 'open' | 'closed' | 'available' | 'unavailable';
}

/** Keyboard data only; toolkit events never cross into the host. */
export type WindowNavigationInput =
  | {kind: 'key'; key: string; text?: string; modifiers?: readonly string[]; repeated?: boolean}
  | {kind: 'paste'; text: string};

export interface WindowNavigationSnapshot {
  revision: number;
  mode: 'normal' | 'arrange' | 'finder';
  query: string;
  entries: readonly WindowNavigationEntry[];
  selected?: string;
  focusedLabel?: string;
  error?: string;
  opening?: string;
  selectionRevision?: number;
}

/** Optional host-owned input mode and private window inventory. */
export interface WindowNavigationSource {
  snapshot(): WindowNavigationSnapshot;
  subscribe(listener: () => void): () => void;
  /** Remote admission may be asynchronous; later native input waits for it. */
  handle(input: WindowNavigationInput): boolean|Promise<boolean>;
  toggleArrange(): void;
  openFinder(): void;
  choose(id: string, revision: number): void;
  changeQuery(text: string, revision: number): void;
  select(id: string, revision: number): void;
}
