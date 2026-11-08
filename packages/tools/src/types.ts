import type { ToolCallDescriptor } from "@agent-compositor/permissions";

/** The $ API handle every tool receives. Wired by the loop to the hooks
 *  dispatcher: plugins see these as service.* events and can intercept. */
export interface ToolContext {
  request<T = unknown>(service: string, payload: unknown): Promise<T>;
  /** session-scoped undo log; resolvers for fs ops append inverse entries */
  undo: UndoStore;
  cwd: string;
  signal: AbortSignal;
}

export interface UndoEntry {
  tool: string;
  path: string;
  /** inverse operation payload, consumed by tools.applyUndo */
  inverse: unknown;
  at: number;
}

export class UndoStore {
  private entries: UndoEntry[] = [];
  push(entry: Omit<UndoEntry, "at">, now: () => number = Date.now): void {
    this.entries.push({ ...entry, at: now() });
  }
  pop(): UndoEntry | undefined {
    return this.entries.pop();
  }
  get size(): number {
    return this.entries.length;
  }
}

export interface ToolSpec<Args = unknown, Result = unknown> {
  name: string;
  description: string;
  /** JSON-schema-ish shape for the model; loose by design (renderers display it) */
  parameters: Record<string, unknown>;
  /** reduce a call to what permission rules match on */
  describe(args: Args): ToolCallDescriptor;
  execute(ctx: ToolContext, args: Args): Promise<ToolResult<Result>>;
}

/** Discriminated tool results — errors are VALUES (fail-operational loop). */
export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; denied?: boolean };
