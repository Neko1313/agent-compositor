import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { Runtime } from "@agent-compositor/runtime";
import type { HookContext, NextMarker, PluginManifest, Tier } from "@agent-compositor/runtime";
import type {
  AuthProvider,
  HooksHostConfig,
  ModelRequest,
  NotifySink,
  TelemetrySink,
} from "./providers.js";

/** User-facing hook: (event, $) — mods-style. */
export type UserHookFn = (event: any, $: HooksApi) => unknown;

/** The plugin-facing $ object. Every service method emits its service.* event. */
export interface HooksApi {
  readonly plugin: string;
  /** continue the chain, optionally with a rewritten event */
  readonly next: (event?: unknown) => NextMarker;
  /** aborted when the hook's thread budget fires */
  readonly signal: AbortSignal;
  readonly session: { id: string; cwd: string };
  state: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    delete(key: string): boolean;
    keys(): string[];
  };
  fs: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
  };
  model: {
    complete(request: ModelRequest): Promise<unknown>;
  };
  auth: {
    login(provider?: string): Promise<{ status: string }>;
    status(): { loggedIn: boolean; provider?: string };
  };
  ui: {
    notify(message: string, level?: "info" | "warn" | "error"): Promise<void>;
  };
  telemetry: {
    log(event: string, data?: Record<string, unknown>): Promise<void>;
    measure<T>(name: string, fn: () => Promise<T>): Promise<T>;
  };
  /** emit any catalog event through the dispatcher; returns the chain result */
  emit(event: string, input: unknown): Promise<unknown>;
}

export class PermissionError extends Error {
  constructor(
    readonly by: string,
    reason: string,
  ) {
    super(`denied by ${by}: ${reason}`);
    this.name = "PermissionError";
  }
}

export class HooksHost {
  private readonly pluginState = new Map<string, Map<string, unknown>>();
  private readonly rendering = new Set<string>();
  private readonly workspaceRoot: string;
  private readonly fsReadMax: number;
  private readonly fsWriteMax: number;

  constructor(
    private readonly runtime: Runtime,
    private readonly config: HooksHostConfig,
  ) {
    this.workspaceRoot = resolvePath(config.workspaceRoot ?? config.session.cwd);
    this.fsReadMax = config.limits?.fsReadMaxBytes ?? 1_048_576;
    this.fsWriteMax = config.limits?.fsWriteMaxBytes ?? 10_485_760;
    this.installResolvers();
  }

  /** Register a plugin with user-facing hooks (event, $). */
  registerPlugin(manifest: PluginManifest, hooks: Record<string, UserHookFn>, tier: Tier = "user"): void {
    const wrapped: Record<string, (event: any, ctx: HookContext) => unknown> = {};
    for (const [name, fn] of Object.entries(hooks)) {
      const isUiRender = name === "ui.render";
      wrapped[name] = (event: any, ctx: HookContext) => {
        if (!isUiRender) return fn(event, this.buildApi(manifest.name, ctx));
        this.rendering.add(manifest.name);
        try {
          return fn(event, this.buildApi(manifest.name, ctx));
        } finally {
          this.rendering.delete(manifest.name);
        }
      };
    }
    this.runtime.register(manifest, wrapped, tier);
    this.pluginState.set(manifest.name, new Map());
  }

  unregisterPlugin(name: string): boolean {
    this.pluginState.delete(name);
    return this.runtime.unregister(name);
  }

  /** Consume one emission fully; returns the chain result. */
  async emit(event: string, input: unknown): Promise<{ value: unknown; faults: unknown[] }> {
    const gen = this.runtime.emit(event, input);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const step = await gen.next();
      if (step.done) return step.value as { value: unknown; faults: unknown[] };
    }
  }

  // ---- $ API ----------------------------------------------------------------

  private buildApi(plugin: string, ctx: HookContext): HooksApi {
    const host = this;
    const stateGuard = (op: string) => {
      if (host.rendering.has(plugin)) {
        throw new Error(`$.state.${op}: writing plugin state during ui.render is forbidden`);
      }
    };
    const state = this.pluginState.get(plugin)!;

    const callService = async (event: string, input: Record<string, unknown>): Promise<unknown> => {
      const res = await host.emit(event, { plugin, ...input });
      const v = res.value as Record<string, unknown> | undefined;
      if (v && typeof v === "object" && "deny" in v && typeof v.deny === "string") {
        throw new PermissionError("chain interceptor", v.deny);
      }
      if (v && typeof v === "object" && "value" in v) return v.value;
      return v; // passthrough (no resolver answer): return whatever the chain produced
    };

    return {
      plugin,
      next: (event?: unknown) => ctx.next(event),
      signal: ctx.signal,
      session: { ...this.config.session },
      state: {
        get: (key) => state.get(key) as never,
        set: (key, value) => {
          stateGuard("set");
          state.set(key, value);
        },
        delete: (key) => {
          stateGuard("delete");
          return state.delete(key);
        },
        keys: () => [...state.keys()],
      },
      fs: {
        read: (path) => callService("service.fs.read", { path }) as Promise<string>,
        write: (path, content) => callService("service.fs.write", { path, content }) as Promise<void>,
      },
      model: {
        complete: (request) => callService("service.model.complete", { request }),
      },
      auth: {
        login: (provider) =>
          callService("service.auth.login", { provider }) as Promise<{ status: string }>,
        status: () => this.config.auth?.status() ?? { loggedIn: false },
      },
      ui: {
        notify: (message, level) =>
          callService("service.ui.notify", { message, level }) as Promise<void>,
      },
      telemetry: {
        log: (event, data) => callService("service.telemetry.log", { event, data }) as Promise<void>,
        measure: async (name, fn) => {
          const t0 = performance.now();
          try {
            return await fn();
          } finally {
            await host.emit("service.telemetry.log", {
              plugin,
              event: "measure",
              data: { name, ms: Math.round(performance.now() - t0) },
            });
          }
        },
      },
      emit: async (event, input) => (await host.emit(event, input)).value,
    };
  }

  // ---- core resolvers: the real operations at the end of each chain --------

  private installResolvers(): void {
    const r = this.runtime;
    const root = this.workspaceRoot;

    const confine = (p: string): string => {
      const abs = resolvePath(root, p);
      if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`path escapes workspace: ${p}`);
      }
      return abs;
    };

    r.setResolver("service.fs.read", async ({ path }: { path: string }) => {
      const abs = confine(path);
      const st = await stat(abs);
      if (st.size > this.fsReadMax) throw new Error(`file exceeds read limit (${this.fsReadMax} bytes)`);
      return { value: await readFile(abs, "utf8") };
    });

    r.setResolver("service.fs.write", async ({ path, content }: { path: string; content: string }) => {
      if (content.length > this.fsWriteMax) throw new Error(`content exceeds write limit (${this.fsWriteMax} bytes)`);
      const abs = confine(path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      return { value: undefined };
    });

    r.setResolver("service.model.complete", async ({ request }: { request: ModelRequest }) => {
      const provider = this.config.model;
      if (!provider) throw new Error("no model provider configured");
      return { value: await provider.complete(request) };
    });

    r.setResolver("service.auth.login", async ({ provider }: { provider?: string }) => {
      const auth = this.config.auth;
      if (!auth) throw new Error("no auth provider configured");
      return { value: await auth.login(provider) };
    });

    r.setResolver("service.ui.notify", ({ plugin, message, level }: { plugin: string; message: string; level?: "info" | "warn" | "error" }) => {
      const sink: NotifySink | undefined = this.config.notify;
      if (sink) sink(message, level ?? "info", plugin);
      return { value: undefined };
    });

    r.setResolver("service.telemetry.log", ({ event, data }: { event: string; data?: Record<string, unknown> }) => {
      const sink: TelemetrySink | undefined = this.config.telemetry;
      if (sink) sink(event, data ?? {});
      return { value: undefined };
    });
  }
}

export function attach(runtime: Runtime, config: HooksHostConfig): HooksHost {
  return new HooksHost(runtime, config);
}
