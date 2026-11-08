import { resolve } from "@agent-compositor/events";
import type { EventDef } from "@agent-compositor/events";
import { parseManifest } from "./manifest.js";
import type { ChainTrace } from "./trace.js";
import { TIER_ORDER, defaultBudget, isNextMarker, next as makeNext } from "./types.js";
import type {
  Budget,
  EmitResult,
  Fault,
  HookContext,
  HookFn,
  PluginManifest,
  Tier,
} from "./types.js";

interface RegisteredHook {
  plugin: string;
  tier: Tier;
  event: string;
  fn: HookFn;
  budget: Budget;
}

interface PluginRecord {
  manifest: PluginManifest;
  tier: Tier;
}

interface WalkMeta {
  def: EventDef;
  trace: ChainTrace["write"];
  faults: Fault[];
}

const now = () => performance.now();

function isAsyncGenerator(v: unknown): v is AsyncGenerator<unknown, unknown, unknown> {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as AsyncGenerator)[Symbol.asyncIterator] === "function" &&
    typeof (v as AsyncGenerator).next === "function"
  );
}

export class Runtime {
  private plugins = new Map<string, PluginRecord>();
  private hooks: RegisteredHook[] = [];
  private trace: ChainTrace["write"];
  /** core behavior at the end of a chain: service.* events resolve to real operations */
  private resolvers = new Map<string, (input: any) => unknown>();
  private readonly providers: Record<string, string>;

  constructor(opts: { trace?: ChainTrace["write"]; providers?: Record<string, string> } = {}) {
    this.trace = opts.trace ?? (() => {});
    this.providers = { ...opts.providers };
  }

  /**
   * Register a plugin. `hooks` maps hook names (canonical or alias) to functions.
   * Tier ordering: prepend → user → append → builtin → core; stable within a tier.
   */
  register(manifestInput: PluginManifest, hooks: Record<string, HookFn>, tier: Tier = "user"): void {
    const manifest = parseManifest(manifestInput);
    if (this.plugins.has(manifest.name)) throw new Error(`plugin "${manifest.name}" already registered`);

    for (const [hookName, fn] of Object.entries(hooks)) {
      const def = resolve(hookName);
      if (!def) throw new Error(`plugin "${manifest.name}": unknown hook "${hookName}"`);
      if (manifest.trust === "render-only" && !def.name.startsWith("ui.")) {
        throw new Error(`plugin "${manifest.name}": render-only plugins may not hook "${def.name}"`);
      }
      const dupe = this.hooks.find((h) => h.plugin === manifest.name && h.event === def.name);
      if (dupe) throw new Error(`plugin "${manifest.name}": duplicate hook for "${def.name}"`);
      const timeout = manifest.trust === "trusted" ? manifest.hookTimeouts?.[def.name] : undefined;
      this.hooks.push({ plugin: manifest.name, tier, event: def.name, fn, budget: timeout ? { ownMs: timeout, threadMs: timeout, yieldMs: timeout } : { ...defaultBudget } });
    }
    this.plugins.set(manifest.name, { manifest, tier });
  }

  /** Remove a plugin (reload path). */
  unregister(name: string): boolean {
    if (!this.plugins.has(name)) return false;
    this.hooks = this.hooks.filter((h) => h.plugin !== name);
    return this.plugins.delete(name);
  }

  private hooksFor(event: string): RegisteredHook[] {
    return this.hooks
      .filter((h) => h.event === event)
      .filter(h => !this.providers[event] || !this.plugins.get(h.plugin)?.manifest.provides?.includes(event) || this.providers[event] === h.plugin)
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  }

  /**
   * Install a core resolver for an event: when the hook chain falls through
   * (every hook called next), the resolver performs the real operation and
   * its return value becomes the chain result.
   */
  setResolver(eventName: string, fn: (input: any) => unknown): void {
    const def = resolve(eventName);
    if (!def) throw new Error(`unknown event "${eventName}"`);
    this.resolvers.set(def.name, fn);
  }

  /**
   * Emit an event: run its onion chain.
   * Yields intermediate values from async-generator hooks, streaming, in chain order.
   * Returns the terminal response, or the (possibly rewritten) event that fell off the end.
   */
  async *emit(eventName: string, input: unknown): AsyncGenerator<unknown, EmitResult, void> {
    const def = resolve(eventName);
    if (!def) throw new Error(`unknown event "${eventName}"`);
    const parsed = def.input.parse(input);

    const faults: Fault[] = [];
    const meta: WalkMeta = { def, trace: (e) => this.trace(e), faults };

    const hooks = this.hooksFor(def.name);
    this.trace({ ts: Date.now(), event: def.name, phase: "enter", detail: `chain depth ${hooks.length}` });
    const final = yield* this.walk(0, hooks, parsed, meta, 0);
    this.trace({ ts: Date.now(), event: def.name, phase: "result", detail: summarize(final) });
    return { value: final, faults };
  }

  /**
   * One onion layer. Yields side-channel values (generator-hook yields) streaming upward;
   * returns the layer's outcome.
   */
  private async *walk(
    i: number,
    hooks: RegisteredHook[],
    input: unknown,
    meta: WalkMeta,
    depth: number,
  ): AsyncGenerator<unknown, unknown, void> {
    if (i >= hooks.length) {
      const resolver = this.resolvers.get(meta.def.name);
      return resolver ? await resolver(input) : input;
    }
    const h = hooks[i];
    const t0 = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("thread-budget"), h.budget.threadMs);
    let innerMs = 0;
    let result: unknown;

    const ctx: HookContext = {
      plugin: h.plugin,
      event: meta.def.name,
      signal: ctrl.signal,
      budget: h.budget,
      next: (event?: unknown) => makeNext(event),
    };

    // next(): run the rest of the chain; its wall time is credited to the caller (own vs thread).
    const callNext = async function* (event: unknown): AsyncGenerator<unknown, unknown, void> {
      const t = now();
      const inner = walkRest(event);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const step = await inner.next();
        if (step.done) {
          innerMs += now() - t;
          return step.value;
        }
        yield step.value;
      }
    };
    const walkRest = (event: unknown) => this.walk(i + 1, hooks, event, meta, depth + 1);

    const fault = (kind: Fault["kind"], message: string, ms?: number) => {
      meta.faults.push({ plugin: h.plugin, event: meta.def.name, kind, message, ...(ms !== undefined ? { ms: Math.round(ms) } : {}) });
      meta.trace({ ts: Date.now(), event: meta.def.name, phase: "fault", plugin: h.plugin, ms, detail: `${kind}: ${message}`, depth });
    };

    this.trace({ ts: Date.now(), event: meta.def.name, phase: "enter", plugin: h.plugin, depth });

    let outcome: "next" | "response" | "fault" = "next";
    let nextEvent: unknown = input;
    let responseKind: string | undefined;

    try {
      const ret = h.fn(input, ctx);
      if (isAsyncGenerator(ret)) {
        let ar = await ret.next();
        const tHookStart = now();
        let prevYieldAt = tHookStart;
        while (!ar.done) {
          if (now() - prevYieldAt > h.budget.yieldMs) {
            // gap since last yield (or hook start) exceeded the budget
            fault("yield-budget", `no yield within ${h.budget.yieldMs}ms`, now() - t0);
            await ret.return(undefined).catch(() => {});
            outcome = "fault";
            break;
          }
          yield ar.value; // stream the intermediate value upward
          prevYieldAt = now();
          ar = await ret.next();
        }
        if (outcome !== "fault") result = ar.value;
      } else {
        result = await ret;
      }
    } catch (err) {
      fault(ctrl.signal.aborted ? "thread-budget" : "error", err instanceof Error ? err.message : String(err), now() - t0);
      outcome = "fault";
    } finally {
      clearTimeout(timer);
    }

    if (outcome === "fault") {
      return yield* walkRest(input); // fail-operational: continue with the original event
    }

    const threadMs = now() - t0;
    const ownMs = threadMs - innerMs;
    if (ownMs > h.budget.ownMs) {
      fault("own-budget", `own ${Math.round(ownMs)}ms > ${h.budget.ownMs}ms`, threadMs);
      // fail-operational: the result still stands, the plugin is flagged
    }

    if (result === undefined || isNextMarker(result)) {
      outcome = "next";
      nextEvent = isNextMarker(result) && result.event !== undefined ? result.event : input;
    } else {
      // Match a response form by its discriminating key first: z.object with
      // z.unknown() fields would otherwise accept any object (z.unknown()
      // swallows the required-key check), so safeParse alone is not enough.
      const matched = meta.def.responses.find(
        (r) =>
          typeof result === "object" &&
          result !== null &&
          r.kind in result &&
          (result as Record<string, unknown>)[r.kind] !== undefined &&
          r.schema.safeParse(result).success,
      );
      if (!matched) {
        fault("invalid-response", `return value matches no response form of ${meta.def.name}`, threadMs);
        return yield* walkRest(input); // fail-operational
      }
      outcome = "response";
      responseKind = matched.kind;
      this.trace({ ts: Date.now(), event: meta.def.name, phase: "exit", plugin: h.plugin, ms: Math.round(threadMs), detail: `response:${responseKind}`, depth });
      return result; // terminal: short-circuits the rest of the chain
    }

    this.trace({ ts: Date.now(), event: meta.def.name, phase: "exit", plugin: h.plugin, ms: Math.round(threadMs), detail: "next", depth });
    return yield* callNext(nextEvent);
  }
}

function summarize(v: unknown): string | undefined {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 120 ? s.slice(0, 117) + "..." : s;
  } catch {
    return undefined;
  }
}
