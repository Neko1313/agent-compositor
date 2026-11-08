import * as path from "node:path";
import { AgentCore } from "@agent-compositor/core";
import { OpenAICompatProvider } from "@agent-compositor/provider";
import { SessionStore, type SessionEvent } from "@agent-compositor/session";
import { loadConfig, type LoadedConfig } from "@agent-compositor/config";
import { loadPluginsFromDisk, type DiskPlugin } from "@agent-compositor/plugins";

export interface ProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface BuildAppOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** extra plugin dirs on top of the convention (global + cwd/plugins) */
  pluginDirs?: string[];
  /** injected provider for tests (ScriptedProvider) — wins over env/config */
  provider?: ConstructorParameters<typeof AgentCore>[0]["provider"];
  /** resume a persisted session by id (or prefix) */
  resumeSessionId?: string;
  systemPrompt?: string;
}

export interface BuiltApp {
  config: LoadedConfig;
  plugins: DiskPlugin[];
  pluginErrors: { dir: string; error: string }[];
  store: SessionStore;
  resumedEvents: SessionEvent[];
  createCore: (
    onApproval: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onApproval"]>,
    onAsk?: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onAsk"]>,
  ) => AgentCore;
}

/**
 * The wiring that turns libraries into the product:
 *
 *   agent-compositor.json (config layers) + env
 *     → provider settings
 *     → plugin dirs (global ~/.agent-compositor/plugins, cwd/plugins, --plugins)
 *     → AgentCore (or AgentCore.resume when --resume)
 *
 * Everything is injected through options so tests run the whole assembly
 * with a scripted provider and tmp dirs.
 */
export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const env = options.env ?? process.env;
  const config = await loadConfig({ cwd: options.cwd });
  const settings = resolveProvider(config.config, env);
  const store = new SessionStore();

  const dirs = [
    ...defaultPluginDirs(options.cwd, env),
    ...(config.config.plugins ?? []).map((p) => resolveDir(p, options.cwd)),
    ...(options.pluginDirs ?? []),
  ];
  const { plugins, errors } = await loadPluginsFromDisk([...new Set(dirs)]);

  let resumedEvents: SessionEvent[] = [];
  if (options.resumeSessionId) {
    const meta = await store.findByPrefix(options.resumeSessionId, options.cwd).catch(() => undefined);
    if (meta) {
      const session = await store.load(meta.id, options.cwd).catch(() => undefined);
      resumedEvents = session?.events ?? [];
    }
  }

  const createCore = (
    onApproval: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onApproval"]>,
    onAsk?: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onAsk"]>,
  ): AgentCore => {
    const coreOptions: ConstructorParameters<typeof AgentCore>[0] = {
      cwd: options.cwd,
      provider:
        options.provider ??
        new OpenAICompatProvider({
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          timeoutMs: settings.timeoutMs,
        }),
      onApproval,
      onAsk,
      sessions: store,
      systemPrompt: options.systemPrompt,
      plugins: plugins.map((p) => ({ manifest: p.manifest, hooks: p.hooks as never, tier: p.tier })),
      // PluginTool is a structural mirror of core's ToolSpec (validated by
      // the loader); cast to avoid a hard tools-dep in app.
      extraTools: plugins.flatMap((p) => p.tools ?? []) as unknown as NonNullable<
        ConstructorParameters<typeof AgentCore>[0]["extraTools"]
      >,
    };
    if (resumedEvents.length > 0) return AgentCore.resume(coreOptions, resumedEvents);
    return new AgentCore(coreOptions);
  };

  return { config, plugins, pluginErrors: errors, store, resumedEvents, createCore };
}

function resolveProvider(config: Record<string, unknown>, env: NodeJS.ProcessEnv): ProviderSettings {
  const providers = (config.providers ?? {}) as Record<string, Record<string, unknown>>;
  const def = providers.default ?? {};
  const baseUrl = (env.AGENT_BASE_URL as string) ?? (def.baseUrl as string) ?? "http://127.0.0.1:11434/v1";
  const apiKey = (env.AGENT_API_KEY as string) ?? (def.apiKey as string) ?? "ollama";
  const model = (env.AGENT_MODEL as string) ?? (config.model as string) ?? "qwen2.5-coder:14b";
  return { baseUrl, apiKey, model };
}

function defaultPluginDirs(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? "";
  const dirs: string[] = [];
  if (home) dirs.push(path.join(home, ".agent-compositor", "plugins"));
  dirs.push(path.join(cwd, "plugins"));
  return dirs;
}

function resolveDir(p: string, cwd: string): string {
  return path.isAbsolute(p) ? p : path.join(cwd, p);
}
