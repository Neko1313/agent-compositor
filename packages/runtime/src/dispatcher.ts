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
  priority: number;
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
  private extensions = new Map<string, { owner: string; definition: EventDef }>();

  resolve(name: string): EventDef | undefined {
    return resolve(name) ?? this.extensions.get(name)?.definition;
  }

  constructor(opts: { trace?: ChainTrace["write"]; providers?: Record<string, string> } = {}) {
    this.trace = opts.trace ?? (() => {});
    this.providers = { ...opts.providers };
  }

  /**
   * Register a plugin. `hooks` maps hook names (canonical or alias) to functions.
   * Tier ordering: prepend → user → append → builtin → core; stable within a tier.
   */
  register(manifestInput: PluginManifest, hooks: Record<string, HookFn>, tier: Tier = "user", events: readonly EventDef[] = []): void {
    const manifest = parseManifest(manifestInput);
    if (this.plugins.has(manifest.name)) throw new Error(`plugin "${manifest.name}" already registered`);

    const definitions = new Map<string, EventDef>();
    for (const def of events) {
      if (manifest.trust !== "trusted" || !def.name.startsWith(`plugin.${manifest.name}:`) ||
          typeof def.input?.parse!=="function" || !Array.isArray(def.responses) || !Number.isInteger(def.version) || def.version < 1 ||
          typeof def.summary!=="string" || !/^\d+\.\d+\.\d+$/.test(def.since) ||
          def.responses.some(response=>typeof response.kind!=="string" || typeof response.schema?.safeParse!=="function"))
        throw new Error(`plugin "${manifest.name}": invalid extension event definition`);
      for (const name of [def.name, ...(def.aliases ?? [])]) {
        if (!name.startsWith(`plugin.${manifest.name}:`) || this.resolve(name) || definitions.has(name))
          throw new Error(`plugin "${manifest.name}": event collision or foreign namespace "${name}"`);
        definitions.set(name, def);
      }
    }
    const pending: RegisteredHook[] = [];
    for (const [hookName, fn] of Object.entries(hooks)) {
      const def = definitions.get(hookName) ?? this.resolve(hookName);
      if (!def) throw new Error(`plugin "${manifest.name}": unknown hook "${hookName}"`);
      if (typeof fn !== "function") throw new Error(`plugin "${manifest.name}": hook is not callable`);
      if (manifest.trust === "render-only" && !def.name.startsWith("ui."))
        throw new Error(`plugin "${manifest.name}": render-only plugins may not hook "${def.name}"`);
      if (pending.some(h => h.event === def.name))
        throw new Error(`plugin "${manifest.name}": duplicate hook for "${def.name}"`);
      const timeout = manifest.trust === "trusted" ? manifest.hookTimeouts?.[def.name] : undefined;
      pending.push({ plugin: manifest.name, tier, event: def.name, fn, priority: manifest.priority ?? 0,
        budget: timeout ? { ownMs: timeout, threadMs: timeout, yieldMs: timeout } : { ...defaultBudget } });
    }
    // Validate the whole contribution before making any hook or definition visible.
    for (const [name, definition] of definitions) this.extensions.set(name, { owner: manifest.name, definition });
    this.hooks.push(...pending);
    this.plugins.set(manifest.name, { manifest, tier });
  }

  /** Remove a plugin (reload path). */
  unregister(name: string): boolean {
    if (!this.plugins.has(name)) return false;
    this.hooks = this.hooks.filter((h) => h.plugin !== name);
    for (const [event, entry] of this.extensions) if (entry.owner === name) {
      this.extensions.delete(event);this.resolvers.delete(entry.definition.name);
    }
    return this.plugins.delete(name);
  }

  private hooksFor(event: string): RegisteredHook[] {
    return this.hooks
      .filter((h) => h.event === event)
      .filter(h => !this.providers[event] || !this.plugins.get(h.plugin)?.manifest.provides?.includes(event) || this.providers[event] === h.plugin)
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.priority - b.priority);
  }

  /**
   * Install a core resolver for an event: when the hook chain falls through
   * (every hook called next), the resolver performs the real operation and
   * its return value becomes the chain result.
   */
  setResolver(eventName: string, fn: (input: any) => unknown): void {
    const def = this.resolve(eventName);
    if (!def) throw new Error(`unknown event "${eventName}"`);
    this.resolvers.set(def.name, fn);
  }

  /**
   * Emit an event: run its onion chain.
   * Yields intermediate values from async-generator hooks, streaming, in chain order.
   * Returns the terminal response, or the (possibly rewritten) event that fell off the end.
   */
  async *emit(eventName: string, input: unknown): AsyncGenerator<unknown, EmitResult, void> {
    const def = this.resolve(eventName);
    if (!def) throw new Error(`unknown event "${eventName}"`);
    const selected = this.providers[def.name];
    if (selected && !this.hooks.some(h => h.event === def.name && h.plugin === selected && this.plugins.get(selected)?.manifest.provides?.includes(def.name)))
      throw new Error(`Selected provider "${selected}" is unavailable for ${def.name}`);
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
    const started = now(), ctrl = new AbortController();
    type Item = { kind: "yield"; value: unknown; resume:()=>void } | { kind: "done"; value: unknown } | { kind: "error"; error: unknown };
    const queue: Item[] = [];
    let wake: (() => void) | undefined;
    const put = (item: Item) => { queue.push(item); wake?.(); wake = undefined; };
    let yields=0;
    const output = async (value:unknown) => {
      // Preserve generator backpressure and allow deadline timers to run even
      // when a generator and its consumer produce only resolved promises.
      if(++yields%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
      await wait(new Promise<void>(resume=>put({kind:"yield",value,resume})));
    };
    let active = true, inner: Promise<unknown> | undefined, innerResult: unknown;
    let ownStarted = now(), ownSpent = 0, ownTimer: ReturnType<typeof setTimeout> | undefined;
    let threadTimer: ReturnType<typeof setTimeout> | undefined;
    let generator: AsyncGenerator<unknown, unknown, void> | undefined;
    const fail = (kind: Fault["kind"], message: string) => {
      meta.faults.push({ plugin: h.plugin, event: meta.def.name, kind, message, ms: Math.round(now() - started) });
      meta.trace({ ts: Date.now(), event: meta.def.name, phase: "fault", plugin: h.plugin, detail: message, depth });
    };
    const pauseOwn = () => { clearTimeout(ownTimer); ownSpent += now() - ownStarted; };
    const resumeOwn = () => {
      ownStarted = now();
      ownTimer = setTimeout(() => ctrl.abort("own-budget"), Math.max(0, h.budget.ownMs - ownSpent));
    };
    const downstream = (event: unknown = input): Promise<unknown> => {
      if (inner) return inner;
      if (!active) return Promise.reject(new Error("Hook invocation has ended"));
      const parsed = meta.def.input.parse(event);
      pauseOwn();
      inner = (async () => {
        const iterator = this.walk(i + 1, hooks, parsed, meta, depth + 1);
        while (true) {
          const item = await iterator.next();
          if (item.done) { innerResult = item.value; return item.value; }
          await output(item.value);
        }
      })().finally(() => { if (active) resumeOwn(); });
      return inner;
    };
    const ctx: HookContext = {
      plugin: h.plugin, event: meta.def.name, signal: ctrl.signal, budget: h.budget,
      next: (event?: unknown) => ({ ...makeNext(event), then: (accept, reject) => downstream(event ?? input).then(accept, reject) }),
    };
    const wait = async <T>(value: PromiseLike<T> | T, yieldMs?: number): Promise<T> => {
      let listener: (() => void) | undefined, yieldTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.resolve(value),
          new Promise<never>((_resolve, reject) => {
            listener = () => reject(new Error(String(ctrl.signal.reason)));
            if (ctrl.signal.aborted) listener();
            else ctrl.signal.addEventListener("abort", listener, { once: true });
            if (yieldMs !== undefined) yieldTimer = setTimeout(() => ctrl.abort("yield-budget"), yieldMs);
          }),
        ]);
      } finally {
        if (listener) ctrl.signal.removeEventListener("abort", listener);
        clearTimeout(yieldTimer);
      }
    };
    meta.trace({ ts: Date.now(), event: meta.def.name, phase: "enter", plugin: h.plugin, depth });
    const produce = async () => {
      let result: unknown;
      resumeOwn();
      threadTimer = setTimeout(() => ctrl.abort("thread-budget"), h.budget.threadMs);
      try {
        const returned = h.fn(input, ctx);
        if (isAsyncGenerator(returned)) {
          generator = returned;
          while (true) {
            const item = await wait(generator.next(), h.budget.yieldMs);
            if (item.done) { result = item.value; break; }
            await output(item.value);
          }
        } else result = await wait(returned);
        // Returning an unawaited continuation also executes downstream exactly once.
        if (isNextMarker(result)) result = await downstream(result.event ?? input);
        else if (result === undefined) result = await downstream();
        else if (!(inner && result === innerResult)) {
          const matched = meta.def.responses.find(r => typeof result === "object" && result !== null &&
            r.kind in result && (result as Record<string, unknown>)[r.kind] !== undefined && r.schema.safeParse(result).success);
          if (!matched) {
            fail("invalid-response", `return value matches no response form of ${meta.def.name}`);
            result = await downstream();
          } else meta.trace({ ts: Date.now(), event: meta.def.name, phase: "exit", plugin: h.plugin, detail: `response:${matched.kind}`, depth });
        }
      } catch (error) {
        const reason = ctrl.signal.aborted ? String(ctrl.signal.reason) : "error";
        if(reason==="consumer-closed")throw error;
        fail(["own-budget", "thread-budget", "yield-budget"].includes(reason) ? reason as Fault["kind"] : "error", error instanceof Error ? error.message : String(error));
        if (!inner && this.providers[meta.def.name]===h.plugin)
          throw new Error(`Selected provider "${h.plugin}" failed for ${meta.def.name}: ${error instanceof Error?error.message:String(error)}`);
        // A wrapper fault after next() must never replay an already executed action.
        result = await downstream();
      } finally {
        active = false;
        clearTimeout(ownTimer); clearTimeout(threadTimer);
        // Cooperative cleanup must not hold up the fallback path.
        if (generator) void generator.return(undefined).catch(() => {});
      }
      meta.trace({ ts: Date.now(), event: meta.def.name, phase: "exit", plugin: h.plugin, detail: "complete", depth });
      return result;
    };
    void produce().then(value => put({ kind: "done", value }), error => put({ kind: "error", error }));
    let drained = false;
    try {
      while (true) {
        if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
        const item = queue.shift()!;
        if (item.kind === "done") { drained = true; return item.value; }
        if (item.kind === "error") throw item.error;
        try {yield item.value;} finally {item.resume();}
      }
    } finally {
      active = false; if (!drained) ctrl.abort("consumer-closed");
      clearTimeout(ownTimer); clearTimeout(threadTimer);
    }
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
