import type { QuestionOption, Questionnaire, QuestionnaireResult } from "@agent-compositor/events";
import { UiControllerRegistry, validateControllers, type UiControllers, type UiControllerKind, type UiControllerFactory, type UiControllerLease } from "./controllers.js";
import { uiFormSchema, type UiForm, type UiFormResult, type UiFormHandler } from "@agent-compositor/events";
import type {
  SurfacePlacement,
  UiAppearance,
  UiTextView,
} from "@agent-compositor/events";
import { AsyncLocalStorage } from "node:async_hooks";
import {runPluginProcess} from './exec.js';
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { Runtime } from "@agent-compositor/runtime";
import type {
  HookContext,
  NextHandle,
  PluginManifest,
  Tier,
} from "@agent-compositor/runtime";
import type {
  AuthProvider,
  HooksHostConfig,
  ModelRequest,
  NotifySink,
  TelemetrySink,
} from "./providers.js";

/** User-facing hook: (event, $) — mods-style. */
export type UserHookFn = (event: any, $: HooksApi) => unknown;

/** The plugin-facing $ object. Services use the event chain; local forms and private settings use guarded host callbacks. */
export interface HooksApi {
  /** Trusted plugin lifetime, independent of a foreground turn; revoked on unload. */
  background():HooksApi;
  readonly plugin: string;
  /** continue the chain, optionally with a rewritten event */
  readonly next: (event?: unknown) => NextHandle;
  /** aborted when the hook's thread budget fires */
  readonly signal: AbortSignal;
  readonly session: { id: string; cwd: string };
  storage: {
    configure(name: string, value: Record<string, unknown>, scope?: "project" | "global"): Promise<void>;
    paths?: { home: string; state: string; project: string };
    config(name?: string): Promise<any>;
    get(
      key: string,
      scope?: "project" | "global" | "session" | "cache"
    ): Promise<unknown>;
    set(
      key: string,
      value: unknown,
      scope?: "project" | "global" | "session" | "cache"
    ): Promise<void>;
  };
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
  exec: {
    run(
      cmd: string,
      args?: string[],
      opts?: { timeoutMs?: number }
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  model: {
    complete(request: ModelRequest): Promise<unknown>;
  };
  auth: {
    login(provider?: string): Promise<{ status: string }>;
    /** Await for the selected service; fields retain the legacy host snapshot. */
    status(): { loggedIn: boolean; provider?: string } & PromiseLike<{ loggedIn: boolean; provider?: string }>;
  };
  ui: {
    /** Read-only host view capabilities. Older hosts may omit this method. */
    supports?(feature:string):boolean;
    controller(kind:UiControllerKind,data:unknown,fallback:UiControllerFactory,invalidate:()=>void,state?:unknown):UiControllerLease;
    ask(request:{question:string;options?:QuestionOption[];multi?:boolean;allowOther?:boolean}):Promise<string|string[]>;
    questionnaire(request:Questionnaire):Promise<QuestionnaireResult>;
    /** Local human input, returned directly to the requesting plugin; never a catalog payload. */
    form(request: UiForm): Promise<UiFormResult | null>;
    remove(id: string): Promise<void>;
    configure(appearance: UiAppearance | null): Promise<void>;
    view(
      id: string,
      title: string,
      view: UiTextView,
      placement?: SurfacePlacement
    ): Promise<void>;
    notify(message: string, level?: "info" | "warn" | "error"): Promise<void>;
    surface(
      id: string,
      title: string,
      text: string,
      placement?: SurfacePlacement
    ): Promise<void>;
  };
  /** session-level agent controls — /compact and /clear for plugins */
  agent: {
    tool(
      name: string,
      args: unknown,
      options?: {signal?:AbortSignal}
    ): Promise<{ ok: boolean; output?: unknown; error?: string }>;
    compact(reason?: string): Promise<void>;
    clear(): Promise<void>;
  };
  telemetry: {
    log(event: string, data?: Record<string, unknown>): Promise<void>;
    measure<T>(name: string, fn: () => Promise<T>): Promise<T>;
  };
  /** emit any catalog event through the dispatcher; returns the chain result */
  emit(event: string, input: unknown): Promise<unknown>;
}

export class PermissionError extends Error {
  constructor(readonly by: string, reason: string) {
    super(`denied by ${by}: ${reason}`);
    this.name = "PermissionError";
  }
}

export class HooksHost {
  readonly controllers:UiControllerRegistry;
  private readonly pluginTrust = new Map<string, string>();
  private readonly pluginLifetimes = new Map<string, AbortController>();
  private formHandler?: UiFormHandler;
  private formHandlerBinding?: object;
  setFormHandler(handler?: UiFormHandler) {
    const binding = {};
    this.formHandlerBinding = binding;
    this.formHandler = handler;
    return () => {
      if (this.formHandlerBinding !== binding) return;
      this.formHandlerBinding = undefined;
      this.formHandler = undefined;
    };
  }
  private readonly pluginState = new Map<string, Map<string, unknown>>();
  private readonly rendering = new AsyncLocalStorage<string>();
  private readonly userInteraction = new AsyncLocalStorage<boolean>();
  private readonly serviceSignal = new AsyncLocalStorage<AbortSignal>();
  get currentSignal():AbortSignal|undefined{return this.serviceSignal.getStore();}
  private readonly workspaceRoot: string;

  /** The workspace the $ API confines fs/exec to. */
  get root(): string {
    return this.workspaceRoot;
  }
  private readonly fsReadMax: number;
  private readonly fsWriteMax: number;

  constructor(
    private readonly runtime: Runtime,
    private readonly config: HooksHostConfig
  ) {
    this.controllers=new UiControllerRegistry(config.uiControllers,(owner,fn)=>this.rendering.run(owner,fn));
    this.workspaceRoot = resolvePath(
      config.workspaceRoot ?? config.session.cwd
    );
    this.fsReadMax = config.limits?.fsReadMaxBytes ?? 1_048_576;
    this.fsWriteMax = config.limits?.fsWriteMaxBytes ?? 10_485_760;
    this.installResolvers();
  }

  /** Register a plugin with user-facing hooks (event, $). */
  registerPlugin(
    manifest: PluginManifest,
    hooks: Record<string, UserHookFn>,
    tier: Tier = "user",
    events: readonly import("@agent-compositor/events").EventDef[] = [],
    controllers?:UiControllers
  ): void {
    const wrapped: Record<string, (event: any, ctx: HookContext) => unknown> =
      {};
    for (const [name, fn] of Object.entries(hooks)) {
      const isUiRender = name === "ui.render";
      wrapped[name] = (event: any, ctx: HookContext) => {
        if(name==='command.invoke'&&event.plugin!==manifest.name)return;
        const execute=()=>{
          const api=this.buildApi(manifest.name,ctx);
          if (["service.agent.run","service.agent.batch","service.context.manage","service.context.compact"].includes(name) && typeof event.context?.withSignal === "function")
            event = {...event,context:event.context.withSignal(api.signal)};
          if (!isUiRender) return fn(event, api);
          return this.rendering.run(manifest.name, () => fn(event, api));
        };
        return ["ui.press","ui.change","command.invoke"].includes(name)?this.userInteraction.run(true,execute):execute();
      };
    }
    validateControllers(controllers);
    if(controllers && manifest.trust!=="trusted")throw new Error("Private UI controllers require a trusted plugin");
    this.runtime.register(manifest, wrapped, tier, events);
    this.pluginTrust.set(manifest.name, manifest.trust);
    this.pluginLifetimes.set(manifest.name,new AbortController());
    this.pluginState.set(manifest.name, new Map());
    this.controllers.register(manifest.name,controllers,this.pluginLifetimes.get(manifest.name)!.signal);
  }

  unregisterPlugin(name: string): boolean {
    this.pluginLifetimes.get(name)?.abort(new Error("Plugin unloaded"));
    this.pluginLifetimes.delete(name);
    this.controllers.remove(name);
    this.pluginTrust.delete(name);
    this.pluginState.delete(name);
    const removed = this.runtime.unregister(name);
    if (removed) this.config.onPluginRemoved?.(name);
    return removed;
  }

  /** Host lifetime lookup for owned follow-ups; configuration snapshots may lag unload. */
  hasPlugin(name:string,trust?:string):boolean{
    return this.pluginTrust.has(name)&&(!trust||this.pluginTrust.get(name)===trust)&&!this.pluginLifetimes.get(name)?.signal.aborted;
  }
  close():void{for(const name of [...this.pluginTrust.keys()])this.unregisterPlugin(name);}

  /** Consume one emission fully; returns the chain result. */
  async emit(
    event: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<{ value: unknown; faults: unknown[] }> {
    if(signal)return this.serviceSignal.run(signal,()=>this.emit(event,input));
    const gen = this.runtime.emit(event, input);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const step = await gen.next();
      if (step.done) return step.value as { value: unknown; faults: unknown[] };
    }
  }

  // ---- $ API ----------------------------------------------------------------

  private buildApi(plugin: string, ctx: HookContext, detached=false): HooksApi {
    const host = this;
    // Explicit user controls and interface actions outlive the foreground model turn.
    const operation=this.serviceSignal.getStore()??(this.userInteraction.getStore()?undefined:this.config.signal?.());
    const signal=detached?this.pluginLifetimes.get(plugin)!.signal:AbortSignal.any([ctx.signal,this.pluginLifetimes.get(plugin)!.signal,...(operation?[operation]:[])]);
    const stateGuard = (op: string) => {
      signal.throwIfAborted();
      if (host.rendering.getStore() !== undefined) {
        throw new Error(
          `$.state.${op}: writing plugin state during ui.render is forbidden`
        );
      }
    };
    const state = this.pluginState.get(plugin)!;

    const access = (event: string) => {
      signal.throwIfAborted();
      const canonical = host.runtime.resolve(event)?.name ?? event;
      const reads = ["service.storage.config", "service.storage.read", "service.fs.read", "service.file.read", "service.file.readText", "service.project.query", "service.auth.status"];
      const rendering = host.rendering.getStore() !== undefined;
      if (rendering && !reads.includes(canonical)) throw new Error(`${canonical}: effects during ui.render are forbidden`);
      if (host.pluginTrust.get(plugin) === "render-only" && !reads.includes(canonical) && !canonical.startsWith("ui.") && !canonical.startsWith("service.ui."))
        throw new Error(`render-only plugins may not call ${canonical}`);
    };

    const callService = async (
      event: string,
      input: Record<string, unknown>,
      operationSignal=signal
    ): Promise<unknown> => {
      access(event);
      if (
        [
          "service.storage.write",
          "service.permission.invalidate",
          "service.ui.configure",
          "service.ui.surface",
          "service.ui.view",
          "service.ui.inputTarget",
          "service.ui.remove",
          "service.ui.ask",
          "service.ui.questionnaire",
          "ui.reaction",
        ].includes(event)
      )
        stateGuard(event);
      const res = await host.emit(event, { plugin, ...input },operationSignal);
      const v = res.value as Record<string, unknown> | undefined;
      if (
        v &&
        typeof v === "object" &&
        "deny" in v &&
        typeof v.deny === "string"
      ) {
        throw new PermissionError("chain interceptor", v.deny);
      }
      if (v && typeof v === "object" && "value" in v) return v.value;
      return v; // passthrough (no resolver answer): return whatever the chain produced
    };

    return {
      background:()=>{access('service.agent.enqueue');if(this.pluginTrust.get(plugin)!=='trusted')throw Error('Only trusted plugins may retain background capabilities');return host.buildApi(plugin,ctx,true);},
      plugin,
      next: (event?: unknown) => {if(detached)throw Error('Background callbacks cannot continue a completed hook');return ctx.next(event);},
      signal,
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
      storage: {
        configure: async (name, value, scope = "project") => {
          stateGuard("storage.configure");
          if (this.pluginTrust.get(plugin) !== "trusted") throw new Error("Only trusted plugins may change shared settings");
          if (!this.config.storage?.configure) throw new Error("Settings persistence is unavailable");
          await this.config.storage.configure(name, value, scope);
        },
        paths: this.config.storage?.paths,
        config: (name = plugin + ".json") =>
          callService("service.storage.config", { name }),
        get: (key, scope = "project") =>
          callService("service.storage.read", { key, scope }),
        set: async (key, value, scope = "project") => {
          stateGuard("storage.set");
          const accepted = await callService("service.storage.write", {
            key,
            value,
            scope,
          });
          if (accepted !== true) throw Error("Storage write was not accepted");
        },
      },
      fs: {
        read: (path) =>
          callService("service.fs.read", { path }) as Promise<string>,
        write: (path, content) =>
          callService("service.fs.write", { path, content }) as Promise<void>,
      },
      exec: {
        run: (cmd, args, opts) =>
          callService("service.exec.run", {
            cmd,
            args,
            timeoutMs: opts?.timeoutMs,
          }) as Promise<{
            exitCode: number;
            stdout: string;
            stderr: string;
          }>,
      },
      model: {
        complete: (request) =>
          callService("service.model.complete", { request }),
      },
      auth: {
        login: (provider) =>
          callService("service.auth.login", { provider }) as Promise<{
            status: string;
          }>,
        status: () => ({...(this.config.auth?.status() ?? {loggedIn:false}),
          then:(accept,reject)=>(callService("service.auth.status", {}) as Promise<{loggedIn:boolean;provider?:string}>).then(accept,reject)}),
      },
      ui: {
        controller:(kind,data,fallback,invalidate,state)=>{
          stateGuard("ui.controller");
          if(this.pluginTrust.get(plugin)!=="trusted")throw new Error("Private UI controllers require a trusted plugin");
          return this.controllers.create(kind,data,fallback,invalidate,state,this.pluginLifetimes.get(plugin)!.signal);
        },
        ask: async request => {
          const result = await callService("service.ui.ask", { ...request, signal }) as { answer: string | string[] };
          return result.answer;
        },
        questionnaire: request => callService("service.ui.questionnaire", {
          ...request, signal,
        }) as Promise<QuestionnaireResult>,
        form: async request => {
          stateGuard("ui.form");
          if (this.pluginTrust.get(plugin) !== "trusted") throw new Error("Only trusted plugins may request local forms");
          if (!this.formHandler) throw new Error("Forms require an interactive UI");
          return this.formHandler(plugin, uiFormSchema.parse(request), signal);
        },
        supports:feature=>feature==='table'||feature==='tabs',
        view: async (id, title, view, placement) => {
          await callService("service.ui.view", { id, title, view, placement });
        },
        remove: async (id) => {
          await callService("service.ui.remove", { id });
        },
        configure: async (appearance) => {
          stateGuard("ui.configure");
          await callService("service.ui.configure", { appearance });
        },
        surface: async (id, title, text, placement) => {
          await callService("service.ui.surface", {
            id,
            title,
            text,
            placement,
          });
        },
        notify: (message, level) =>
          callService("service.ui.notify", { message, level }) as Promise<void>,
      },
      agent: {
        tool: (name, args, options) => {
          stateGuard("agent.tool");
          return callService("service.agent.tool", { name, args },options?.signal?AbortSignal.any([signal,options.signal]):signal) as Promise<{
            ok: boolean;
            output?: unknown;
            error?: string;
          }>;
        },
        compact: async (reason) => {
          await callService("service.agent.compact", { reason });
        },
        clear: async () => {
          await callService("service.agent.clear", {});
        },
      },
      telemetry: {
        log: (event, data) =>
          callService("service.telemetry.log", {
            event,
            data,
          }) as Promise<void>,
        measure: async (name, fn) => {
          const t0 = performance.now();
          try {
            return await fn();
          } finally {
            await callService("service.telemetry.log", {
              event: "measure",
              data: { name, ms: Math.round(performance.now() - t0) },
            });
          }
        },
      },
      emit: async (event, input) => {
        access(event);
        if (
          [
            "ui.invalidate",
            "service.storage.write",
            "service.permission.invalidate",
            "service.ui.configure",
            "service.ui.surface",
            "service.ui.view",
            "service.ui.inputTarget",
            "service.ui.remove",
            "ui.reaction",
            "service.network.configure",
          ].includes(event)
        )
          stateGuard(event);
        return (await host.emit(event, input,signal)).value;
      },
    };
  }

  // ---- core resolvers: the real operations at the end of each chain --------

  private installResolvers(): void {
    const r = this.runtime;
    const root = this.workspaceRoot;

    r.setResolver("service.agent.compact", async ({reason}) => {
      await this.config.agent?.compact(reason); return {value:true};
    });
    r.setResolver("service.agent.clear", async () => {
      await this.config.agent?.clear(); return {value:true};
    });
    r.setResolver("service.auth.status", () => ({value:this.config.auth?.status() ?? {loggedIn:false}}));

    const confine = (p: string): string => {
      const abs = resolvePath(root, p);
      if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`path escapes workspace: ${p}`);
      }
      return abs;
    };

    r.setResolver(
      "service.storage.config",
      async ({ name }: { name: string }) => ({
        value: (await this.config.storage?.config(name)) ?? {},
      })
    );
    r.setResolver(
      "service.storage.read",
      async ({
        plugin,
        key,
        scope,
      }: {
        plugin: string;
        key: string;
        scope: string;
      }) => {
        if (!this.config.storage) return { value: undefined };
        try {
          return {
            value: await this.config.storage.read(
              plugin,
              key,
              scope,
              this.config.session.id
            ),
          };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT")
            return { value: undefined };
          throw e;
        }
      }
    );
    r.setResolver(
      "service.storage.write",
      async ({
        plugin,
        key,
        value,
        scope,
      }: {
        plugin: string;
        key: string;
        value: unknown;
        scope: string;
      }) => {
        if (!this.config.storage)
          throw Error("No persistent storage configured");
        const text = JSON.stringify(value);
        if (text === undefined || Buffer.byteLength(text) > this.fsWriteMax)
          throw Error("Storage value exceeds limit or is not JSON");
        await this.config.storage.write(
          plugin,
          key,
          value,
          scope,
          this.config.session.id
        );
        return { value: true };
      }
    );
    r.setResolver("service.fs.read", async ({ path }: { path: string }) => {
      if (this.config.storage && /^\.agent-compositor[\\/]/.test(path)) {
        const text = await this.config.storage.legacyRead(path);
        if (Buffer.byteLength(text) > this.fsReadMax)
          throw Error("Storage file exceeds read limit");
        return { value: text };
      }
      const abs = this.config.resolveWorkspacePath?await this.config.resolveWorkspacePath(path):confine(path);
      const st = await stat(abs);
      if (st.size > this.fsReadMax)
        throw new Error(`file exceeds read limit (${this.fsReadMax} bytes)`);
      return { value: await readFile(abs, "utf8") };
    });

    r.setResolver(
      "service.fs.write",
      async ({ path, content }: { path: string; content: string }) => {
        if (content.length > this.fsWriteMax)
          throw new Error(
            `content exceeds write limit (${this.fsWriteMax} bytes)`
          );
        if (this.config.storage && /^\.agent-compositor[\\/]/.test(path)) {
          await this.config.storage.legacyWrite(path, content);
          return { value: undefined };
        }
        const abs = this.config.resolveWorkspacePath?await this.config.resolveWorkspacePath(path,true):confine(path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return { value: undefined };
      }
    );

    r.setResolver(
      "service.exec.run",
      async ({
        plugin,
        cmd,
        args,
        timeoutMs,
      }: {
        plugin: string;
        cmd: string;
        args?: string[];
        timeoutMs?: number;
      }) => {
        const operation=this.serviceSignal.getStore()??(this.userInteraction.getStore()?undefined:this.config.signal?.());
        const lifetime=this.pluginLifetimes.get(plugin)?.signal;
        const signal=AbortSignal.any([...(operation?[operation]:[]),...(lifetime?[lifetime]:[])]);
        return {
          value: await runPluginProcess(cmd,args??[],{cwd:root,env:{...process.env,...this.config.execEnvironment?.()},signal,timeoutMs:timeoutMs??30000}),
        };
      }
    );

    r.setResolver(
      "service.model.complete",
      async ({ request }: { request: ModelRequest }) => {
        const provider = this.config.model;
        if (!provider) throw new Error("no model provider configured");
        return { value: await provider.complete(request) };
      }
    );

    r.setResolver(
      "service.auth.login",
      async ({ provider }: { provider?: string }) => {
        const auth = this.config.auth;
        if (!auth) throw new Error("no auth provider configured");
        return { value: await auth.login(provider) };
      }
    );

    r.setResolver(
      "service.ui.notify",
      ({
        plugin,
        message,
        level,
      }: {
        plugin: string;
        message: string;
        level?: "info" | "warn" | "error";
      }) => {
        const sink: NotifySink | undefined = this.config.notify;
        if (sink) sink(message, level ?? "info", plugin);
        return { value: undefined };
      }
    );

    r.setResolver(
      "service.telemetry.log",
      ({ event, data }: { event: string; data?: Record<string, unknown> }) => {
        const sink: TelemetrySink | undefined = this.config.telemetry;
        if (sink) sink(event, data ?? {});
        return { value: undefined };
      }
    );
  }
}

export function attach(runtime: Runtime, config: HooksHostConfig): HooksHost {
  return new HooksHost(runtime, config);
}
