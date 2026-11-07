/** Shared types for the dispatcher. */

export type TrustClass = "trusted" | "sandboxed" | "render-only";

export type Tier = "prepend" | "user" | "append" | "builtin" | "core";

/** Execution budgets, per hook invocation (mods-compatible defaults). */
export interface Budget {
  /** max time inside the hook itself, excluding awaits on next() */
  ownMs: number;
  /** max wall time from hook entry to exit */
  threadMs: number;
  /** max gap between generator yields */
  yieldMs: number;
}

export const defaultBudget: Budget = { ownMs: 1000, threadMs: 2000, yieldMs: 10_000 };

export const TIER_ORDER: Record<Tier, number> = {
  prepend: 0,
  user: 1,
  append: 2,
  builtin: 3,
  core: 4,
};

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  trust: TrustClass;
  capabilities?: string[];
}

const NEXT: unique symbol = Symbol("agent-compositor.next");

/** Marker returned by ctx.next(event) to continue the chain, possibly rewritten. */
export interface NextMarker {
  readonly [NEXT]: true;
  readonly event?: unknown;
}

export function next(event?: unknown): NextMarker {
  return { [NEXT]: true, event };
}

export function isNextMarker(v: unknown): v is NextMarker {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[NEXT] === true;
}

export interface HookContext {
  plugin: string;
  event: string;
  /** aborted when the thread budget fires */
  signal: AbortSignal;
  budget: Readonly<Budget>;
  next: (event?: unknown) => NextMarker;
}

/** A hook: sync, async, or async-generator (yield = intermediate value). */
export type HookFn = (event: any, ctx: HookContext) => unknown;

export interface Fault {
  plugin: string;
  event: string;
  kind: "error" | "thread-budget" | "own-budget" | "yield-budget" | "invalid-response";
  message: string;
  ms?: number;
}

export interface TraceEntry {
  /** epoch ms; sinks fill it in if omitted */
  ts?: number;
  event: string;
  phase: "enter" | "exit" | "yield" | "fault" | "result";
  plugin?: string;
  ms?: number;
  detail?: string;
  depth?: number;
}

export interface EmitResult {
  /** final chain value (terminal response or the event that fell off the end) */
  value: unknown;
  faults: Fault[];
}
