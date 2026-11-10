import {createSummarizer} from "./summarizer.js";
import { harnessControls } from "./harness.js";
import { profileSettings } from "./provider-settings.js";
import { marketplaces } from "./marketplaces.js";
import { NetworkClient } from "@agent-compositor/provider";
import { ProjectStorage, mergeSettings, compositionSchema } from "@agent-compositor/config";
import { ApprovalSession } from "@agent-compositor/permissions";
import { extensionManager } from "./extensions.js";
import { authentication } from "./auth.js";
import { agentManager } from "./agents.js";
import { quotaReader } from "./quota.js";
import { installSessionServices, sessionControls } from "./sessions.js";
import { approvalStore } from "./approval-store.js";
import { realpathSync } from "node:fs";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { modelControls } from "./models.js";
import { projectInstructions, expandReferences } from "./project-context.js";
import { TokenBudget } from "@agent-compositor/context";
import { SkillRegistry } from "@agent-compositor/skills";
import { builtinTools, type ToolSpec } from "@agent-compositor/tools";
import * as path from "node:path";
import { AgentCore } from "@agent-compositor/core";
import {
  ProviderRouter,
  type ProviderProfile,
} from "@agent-compositor/provider";
import { SessionStore, SessionRepositoryRouter, validateSessionRepository, type SessionRepository, type SessionEvent } from "@agent-compositor/session";
import {
  savePlacementRule,
  loadConfig,
  type LoadedConfig,
} from "@agent-compositor/config";
import {
  loadPluginsFromDisk,
  type DiskPlugin,
} from "@agent-compositor/plugins";

export interface ProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  type?: ProviderProfile["type"];
  reasoningEffort?: string;
}

export interface BuildAppOptions {
  inheritedConfig?: LoadedConfig;
  /** Independent agents resume only if the selected repository contains their session. */
  resumeIfPresent?: boolean;
  inheritedSettings?: (name: string) => Promise<any>;
  agentHub?: boolean;
  sessionId?: string;
  maxTokensPerTurn?: number;
  maxTokensPerSession?: number;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** extra plugin dirs on top of the convention (global + cwd/plugins) */
  pluginDirs?: string[];
  /** injected provider for tests (ScriptedProvider) — wins over env/config */
  provider?: ConstructorParameters<typeof AgentCore>[0]["provider"];
  /** resume a persisted session by id (or prefix) */
  resumeSessionId?: string;
  systemPrompt?: string;
  maxSteps?: number;
  images?: import("@agent-compositor/core").ChatMessage["images"];
}

export interface BuiltApp {
  storage: ProjectStorage;
  close: () => Promise<void>;
  config: LoadedConfig;
  plugins: DiskPlugin[];
  pluginErrors: { dir: string; error: string }[];
  store: SessionRepositoryRouter;
  resumedEvents: SessionEvent[];
  savePlacement: (
    rule: NonNullable<
      NonNullable<LoadedConfig["config"]["ui"]>["rules"]
    >[number]
  ) => Promise<string>;
  commands: () => { name: string; description: string; usage?: string }[];
  reloadPlugins: (core: AgentCore) => Promise<string>;
  loadLayout: () => Promise<unknown>;
  saveLayout: (layout: unknown) => Promise<void>;
  resume: (
    id: string,
    approve: NonNullable<
      ConstructorParameters<typeof AgentCore>[0]["onApproval"]
    >,
    ask?: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onAsk"]>
  ) => Promise<AgentCore>;
  createCore: (
    onApproval: NonNullable<
      ConstructorParameters<typeof AgentCore>[0]["onApproval"]
    >,
    onAsk?: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onAsk"]>
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
  const config = await loadConfig({
    cwd: options.cwd,
    env,
    ...(options.inheritedConfig
      ? { global: false, system: false, projectRoot: options.cwd }
      : {}),
  });
  if (options.inheritedConfig) {
    config.config = mergeSettings(
      structuredClone(options.inheritedConfig.config),
      config.config
    );
    config.sources = [...options.inheritedConfig.sources, ...config.sources];
    config.origins = [...options.inheritedConfig.origins, ...config.origins];
  }
  compositionSchema.parse(config.config);
  const storage = new ProjectStorage(options.cwd, env);
  storage.inheritedSettings = options.inheritedSettings;
  await storage.init();
  const market = await marketplaces(
    options.cwd,
    env.HOME ?? env.USERPROFILE ?? options.cwd,
    storage.paths.state,
    storage.paths.home
  );
  const extensions = await extensionManager(
    options.cwd,
    env.HOME ?? env.USERPROFILE ?? options.cwd,
    storage.paths.state,
    market,
    storage.paths.home
  );
  const network = new NetworkClient();
  const settings = {
    ...resolveProvider(config.config, env),
    fetch: network.fetch("models"),
  };
  const localStore = new SessionStore({sessionsRoot:storage.paths.sessions});
  const store = new SessionRepositoryRouter(localStore);
  const profileConfig = (config.config.providers ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const profiles: Record<string, ProviderProfile> = { default: {...settings,...(/:\/\/(localhost|127\.0\.0\.1):11434(?:\/|$)/.test(settings.baseUrl)?{metadataProvider:"ollama" as const}:{})} };
  for (const [name, entry] of Object.entries(profileConfig)) {
    if (!entry || typeof entry !== "object") continue;
    const type = entry.type as ProviderProfile["type"];
    const baseUrl = String(
      entry.baseUrl ??
        (type === "anthropic"
          ? "https://api.anthropic.com/v1"
          : type === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta"
          : settings.baseUrl)
    );
    profiles[name] = {
      ...settings,
      ...entry,
      type,
      baseUrl,
      model: String(entry.model ?? settings.model),
      apiKey: String(
        entry.apiKeyEnv
          ? env[String(entry.apiKeyEnv)] ?? ""
          : entry.apiKey ?? settings.apiKey
      ),
    } as ProviderProfile;
  }
  profiles.default = { ...profiles.default, ...settings };
  if (config.config.small_model && !profiles.small)
    profiles.small = { ...settings, model: config.config.small_model };
  try {
    const saved = await storage.config('providers.json');
    for (const [name, entry] of Object.entries(saved.profiles ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || ['constructor','prototype'].includes(name)) continue;
      if (entry === null) { if (name !== 'default') delete profiles[name]; continue; }
      try { const saved=profileSettings(entry);profiles[name] = { ...profiles[name], ...saved, contextWindow:saved.contextWindow,maxOutputTokens:saved.maxOutputTokens,timeoutMs:saved.timeoutMs,apiKey: profiles[name]?.apiKey ?? '', fetch: network.fetch('models') }; }
      catch { config.warnings.push(`Saved provider profile ${name} is invalid and was skipped`); }
    }
  } catch { config.warnings.push('Saved provider connections could not be loaded'); }
  const router = new ProviderRouter(profiles);
  const auth = await authentication(
    env.HOME ?? env.USERPROFILE ?? options.cwd,
    env,
    profiles,
    router,
    network.fetch("models"),
    storage.paths.home
  );
  const readQuota = quotaReader(router);
  const remembered = await readFile(
    path.join(storage.paths.state, "model.json"),
    "utf8"
  )
    .then(JSON.parse)
    .catch(() => undefined);
  if (typeof remembered === "string" && !env.AGENT_MODEL)
    router.select(remembered);
  if (remembered && typeof remembered === 'object' && typeof remembered.profile === 'string' && typeof remembered.model === 'string' && profiles[remembered.profile] && !env.AGENT_MODEL) {
    router.select(remembered.profile); router.select(remembered.model);
  }
  if (env.AGENT_MODEL && profiles[env.AGENT_MODEL])
    router.select(env.AGENT_MODEL);
  const controls = modelControls(router, storage, auth, network.fetch("models")),
    sessionPlugin = sessionControls();
  const approvals = await approvalStore(
    options.cwd,
    env.HOME ?? env.USERPROFILE ?? options.cwd,
    storage.paths.home
  );

  const dirs = [
    ...defaultPluginDirs(options.cwd, env),
    path.join(storage.paths.home, "plugins"),
    ...(config.config.plugins ?? []).map((p) => resolveDir(p, options.cwd)),
    ...(options.pluginDirs ?? []),
    // Distribution defaults come last: user/project plugins retain precedence.
    path.join(path.dirname(realpathSync(process.execPath)), "plugins"),
  ];
  const disabled = () => [
    ...new Set([
      ...(config.config.disabledPlugins ?? []),
      ...extensions.disabled(),
    ]),
  ];
  const loaded = await loadPluginsFromDisk([...new Set(dirs)], disabled(), config.config.enabledPlugins);
  const plugins = loaded.plugins.filter(
      (p) => !config.config.disabledPlugins?.includes(p.manifest.name)
    ),
    errors = loaded.errors;

  const prepareRepository = async (source:DiskPlugin[]):Promise<SessionRepository> => {
    const owner=config.config.sessionProvider;
    if(!owner)return localStore;
    const factory=source.find(plugin=>plugin.manifest.name===owner)?.sessionRepository;
    if(!factory)throw new Error(`Selected session repository ${owner} is unavailable`);
    const lifetime=new AbortController();
    let repository:SessionRepository|undefined;
    try {
      repository=await factory({cwd:options.cwd,sessionsRoot:storage.paths.sessions,stateRoot:storage.paths.state,signal:lifetime.signal,config:name=>storage.config(name)});
      validateSessionRepository(repository);
      return new Proxy(repository,{get(target,key,receiver){
        if(key==='dispose')return async()=>{lifetime.abort(new Error('Session repository disposed'));await target.dispose?.();};
        const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
      }});
    } catch(error){lifetime.abort(error);await repository?.dispose?.();throw error;}
  };
  await store.replaceWith(()=>prepareRepository(plugins));
  const mcpServers = Object.assign(
    {},
    ...plugins.map((p) => p.mcpServers ?? {})
  );
  if (Object.keys(mcpServers).length)
    storage.contributions["mcp.json"] = { mcpServers };
  let resumedEvents: SessionEvent[] = [];
  let resumedSessionId: string | undefined;
  if (options.resumeSessionId) {
    const meta = await store.findByPrefix(options.resumeSessionId,options.cwd);
    if (!meta && !options.resumeIfPresent) throw new Error(`Session not found or ambiguous: ${options.resumeSessionId}`);
    if(meta){
      const session=await store.load(meta.id,options.cwd);
      resumedEvents=session.events;resumedSessionId=meta.id;
    }
  }

  const instructions = config.config.agent?.projectContext===false ? "" : await projectInstructions(
    options.cwd,
    storage.paths.home
  );
  const skills = new SkillRegistry({
    sources: [
      { name: "agents", dir: path.join(options.cwd, ".agents/skills") },
      {
        name: "workspace",
        dir: path.join(options.cwd, ".agent-compositor/skills"),
      },
      ...(config.config.skills ?? []).map((dir) => ({
        name: "config",
        dir: resolveDir(dir, options.cwd),
      })),
      {
        name: "user",
        dir: path.join(env.HOME ?? "", ".agent-compositor/skills"),
      },
      { name: "claude", dir: path.join(env.HOME ?? "", ".claude/skills") },
      { name: "cursor", dir: path.join(env.HOME ?? "", ".cursor/skills") },
    ],
  });
  const skillIndex = config.config.agent?.skills===false ? "" : await skills.renderIndex();
  const hub =
    options.agentHub === false || config.config.disabledPlugins?.includes("agent-hub") || (config.config.enabledPlugins && !config.config.enabledPlugins.includes("agent-hub"))
      ? undefined
      : await agentManager(
          options.cwd,
          async (record, channels) => {
            const child = await buildApp({
              ...options,
              inheritedConfig: config,
              inheritedSettings: (name) => storage.config(name),
              env: { ...env, AGENT_MODEL: router.active },
              agentHub: false,
              cwd: record.cwd,
              sessionId: record.sessionId,
              resumeSessionId: record.sessionId,
              resumeIfPresent: true,
              pluginDirs: [...new Set(dirs)],
              maxSteps: Math.min(record.maxSteps, options.maxSteps ?? 32),
              maxTokensPerTurn: Math.min(
                record.maxTokens,
                options.maxTokensPerTurn ?? Infinity
              ),
              maxTokensPerSession: record.maxTokens * 4,
              systemPrompt: [options.systemPrompt, instructions, skillIndex]
                .filter(Boolean)
                .join("\n\n"),
            });
            return {
              core: child.createCore(channels.approve, channels.ask),
              close: child.close,
            };
          },
          Math.min(
            16,
            Math.max(1, Number(config.config.agent?.maxAgents ?? 8))
          ),
          storage.paths.state
        );
  const skillTool: ToolSpec = {
    name: "skills",
    description: "Load the full instructions for an available skill by name.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    describe: () => ({ tool: "skills" }),
    execute: async (ctx, args) => {
      try {
        return {
          ok: true,
          data: await ctx.request("service.skills.load", args),
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  };
  const hostEnabled = (name:string,source=plugins) => !disabled().includes(name) &&
    (!config.config.enabledPlugins || config.config.enabledPlugins.includes(name)) && !source.some(p=>p.manifest.name===name);
  const sessionPlugins=new WeakMap<AgentCore,ReturnType<typeof sessionControls>>();
  const harnesses=new WeakMap<AgentCore,ReturnType<typeof harnessControls>>();
  const toolOverrides = (source=plugins) => Object.entries(config.config.toolProviders ?? {}).map(([name,owner])=>{
    const tool=source.find(p=>p.manifest.name===owner)?.tools.find(t=>t.name===name);
    if(!tool)throw new Error(`Selected tool provider ${owner} does not supply ${name}`);
    return tool as ToolSpec;
  });
  const createCore = (
    onApproval: NonNullable<
      ConstructorParameters<typeof AgentCore>[0]["onApproval"]
    >,
    onAsk?: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onAsk"]>,
    adopt?: { id: string; events: SessionEvent[] }
  ): AgentCore => {
    const sessionPlugin=sessionControls();
    const provider = options.provider ?? {
      name: "authenticated-router",
      capabilities: async (signal:AbortSignal,profile?:string) => {
        const caps=await router.capabilities(signal,profile);if(caps.source!=="fallback")return caps;
        const catalog=await storage.config("model-catalog.json");const known=catalog.models?.[profile?router.profiles[profile]?.model:router.model];
        return known&&Number.isSafeInteger(known.contextWindow)&&known.contextWindow>=2048?{contextWindow:known.contextWindow,maxOutputTokens:known.maxOutputTokens,source:"catalog" as const}:caps;
      },
      async *complete(
        request: import("@agent-compositor/core").CompletionRequest
      ) {
        await auth.refresh(
          request.profile ?? router.credentialProfile,
          request.signal
        );
        yield* router.complete(request);
      },
    };
    const harness = harnessControls(storage,config.config.agent??{},()=>core.sessionId);
    const builtinNames=config.config.agent?.builtinTools;
    if(builtinNames!==undefined && (!Array.isArray(builtinNames) || builtinNames.some(name=>!builtinTools.some(t=>t.name===name))))
      throw new Error("agent.builtinTools must list known built-in tool names");
    for(const key of ['tools','controlTools'])if(config.config.agent?.[key]!==undefined && (!Array.isArray(config.config.agent[key]) || config.config.agent[key].some((v:unknown)=>typeof v!=="string")))
      throw new Error(`agent.${key} must be an array of tool names`);
    const sessionApprovals = new ApprovalSession();
    sessionApprovals.restore(approvals.session.list());
    const coreOptions: ConstructorParameters<typeof AgentCore>[0] = {
      cwd: options.cwd,
      storage,
      toolEnv: () => network.environment(),
      fetch: network.fetch("tools"),
      auth: auth.provider,
      serviceProviders: config.config.serviceProviders,
      uiControllers:config.config.ui?.controllers,
      maxStepsPerTurn: options.maxSteps ?? (typeof config.config.agent?.maxSteps === "number" ? config.config.agent.maxSteps : 64),
      maxConsecutiveToolFailures:typeof config.config.agent?.maxConsecutiveToolFailures==='number'?config.config.agent.maxConsecutiveToolFailures:6,
      maxTokensPerTurn:
        options.maxTokensPerTurn ??
        (typeof config.config.agent?.maxTokensPerTurn === "number"
          ? config.config.agent.maxTokensPerTurn
          : undefined),
      maxTokensPerSession:
        options.maxTokensPerSession ??
        (typeof config.config.agent?.maxTokensPerSession === "number"
          ? config.config.agent.maxTokensPerSession
          : undefined),
      initialImages: options.images,
      model: () => router.model,
      preparePrompt: config.config.agent?.fileReferences===false ? undefined : (text) => expandReferences(options.cwd, text),
      services: {
        ...(hostEnabled("agent-harness") ? harness.services : {}),
        "service.network.configure": async ({ config }: { config: any }) => ({
          value: network.configure(config),
        }),
        "service.usage.quota": readQuota,
        "service.skills.load": async ({ name }: { name: string }) => ({
          value: await skills.load(name),
        }),
        ...(hub
          ? {
              "service.agent.control": async (args: any) => ({
                value: await hub.control(args, {
                  approve: onApproval,
                  ask: onAsk,
                }),
              }),
            }
          : {}),
      },
      sessionId: adopt?.id ?? resumedSessionId ?? options.sessionId,
      provider,
      approvals: sessionApprovals,
      persistApprovals: approvals.save,
      rules: [
        ...(config.config.permissions?.rules ?? []),
        { tool: "skills", decision: "allow" },
        { tool: "task_plan", decision: "allow" },
        { tool: "workflow_run", decision: "allow" },
        { tool: "extension_list", decision: "allow" },
        { tool: "agent_message", decision: "allow" },
      ],
      toolNames: config.config.agent?.tools as string[] | undefined,
      controlTools: config.config.agent?.controlTools as string[] | undefined,
      toolOverrides: toolOverrides(),
      tools: [
        ...builtinTools.filter(tool=>!builtinNames || (builtinNames as string[]).includes(tool.name)),
        ...(hostEnabled("agent-harness") ? [harness.tool] : []),
        ...(config.config.agent?.skills===false ? [] : [skillTool]),
        ...(hostEnabled(extensions.plugin.manifest.name) ? [extensions.tool] : []),
        ...(hostEnabled(market.plugin.manifest.name) ? [market.tool] : []),
        ...(hub && hostEnabled(hub.plugin.manifest.name) ? [hub.tool] : []),
      ],
      compaction:
        config.config.compaction?.enabled === false
          ? undefined
          : {
              budget: new TokenBudget({
                contextWindow: 32768,
                ...config.config.compaction,
              }),
              limits: () => config.config.compaction ?? {},
              summarize: createSummarizer(request=>core.streamModel(request),()=>core.getContextWindow()),
              fork: createSummarizer,
            },
      onApproval,
      onAsk,
      sessions: store,
      systemPrompt:
        [options.systemPrompt, instructions, skillIndex]
          .filter(Boolean)
          .join("\n\n") || undefined,
      plugins: [
        ...(hostEnabled(harness.plugin.manifest.name) ? [harness.plugin] : []),
        ...plugins.map((p) => ({
          manifest: p.manifest,
          hooks: p.hooks,
          tier: p.tier,
          events: p.events,
          controllers:p.controllers,
        })),
        ...[controls,sessionPlugin,extensions.plugin,market.plugin,auth.plugin,...(hub?[hub.plugin]:[])]
          .filter(plugin=>hostEnabled(plugin.manifest.name)),
      ],
      // PluginTool is a structural mirror of core's ToolSpec (validated by
      // the loader); cast to avoid a hard tools-dep in app.
      extraTools: plugins.flatMap(
        (p) => p.tools ?? []
      ) as unknown as NonNullable<
        ConstructorParameters<typeof AgentCore>[0]["extraTools"]
      >,
    };
    const events = adopt?.events ?? resumedEvents;
    const core =
      events.length > 0
        ? AgentCore.resume(coreOptions, events)
        : new AgentCore(coreOptions);
    harnesses.set(core,harness);sessionPlugins.set(core,sessionPlugin);
    hub?.bind({ approve: onApproval, ask: onAsk });
    installSessionServices(core, store, options.cwd);
    return core;
  };

  const resume: BuiltApp["resume"] = async (id, approve, ask) => {
    const meta = await store.findByPrefix(id, options.cwd);
    if (!meta) throw new Error("Session not found or ambiguous");
    const session = await store.load(meta.id, options.cwd);
    return createCore(approve, ask, { id: meta.id, events: session.events });
  };
  const reloadPlugins = async (core: AgentCore): Promise<string> => {
    if (core.getState() === "running")
      return "Wait until the current turn finishes before /reload.";
    const next = await loadPluginsFromDisk([...new Set(dirs)], disabled(), config.config.enabledPlugins);
    next.plugins = next.plugins.filter(
      (p) => !config.config.disabledPlugins?.includes(p.manifest.name)
    );
    await store.replaceWith(()=>prepareRepository(next.plugins),()=>{core.replacePlugins(
      [
        ...(hostEnabled("agent-harness",next.plugins) && harnesses.get(core) ? [harnesses.get(core)!.plugin] : []),
        ...next.plugins.map((p) => ({
          manifest: p.manifest,
          hooks: p.hooks,
          tier: p.tier,
          events: p.events,
          controllers:p.controllers,
        })),
        ...[controls,sessionPlugins.get(core)!,extensions.plugin,market.plugin,auth.plugin,...(hub?[hub.plugin]:[])]
          .filter(plugin=>hostEnabled(plugin.manifest.name,next.plugins)),
      ],
      next.plugins.flatMap((p) => p.tools) as NonNullable<
        ConstructorParameters<typeof AgentCore>[0]["extraTools"]
      >,
      toolOverrides(next.plugins)
    );});
    await Promise.allSettled(plugins.map((p) => p.dispose?.()));
    plugins.splice(0, plugins.length, ...next.plugins);
    const mcpServers = Object.assign(
      {},
      ...plugins.map((p) => p.mcpServers ?? {})
    );
    if (Object.keys(mcpServers).length)
      storage.contributions["mcp.json"] = { mcpServers };
    else delete storage.contributions["mcp.json"];
    await core.host.emit("session.reload", {
      plugins: plugins.map((p) => ({
        name: p.manifest.name,
        version: p.manifest.version,
        tier: p.tier,
      })),
    });
    return `Reloaded ${plugins.length} plugins. ${next.errors
      .map((e) => e.error)
      .join("; ")}`;
  };
  const commands = () =>
    [
      ...new Map([
        ...plugins
          .flatMap((plugin) => plugin.commands ?? [])
          .map((command) => [command.name, command] as const),
        [
          "/reload",
          { name: "/reload", description: "Reload disk plugins" },
        ] as const,
        [
          "/extensions",
          {
            name: "/extensions",
            description: "Manage extensions",
            usage:
              "/extensions list|install|update|enable|disable|remove [name] [ref]",
          },
        ] as const,
        ...(hub
          ? [
              [
                "/agents",
                {
                  name: "/agents",
                  description: "Manage independent agents",
                  usage:
                    "/agents [create|send|stop|archive|merge|parent] [id/name] [prompt]",
                },
              ] as const,
            ]
          : []),
        ...['/settings', '/providers', '/models', '/tasks', '/continue'].map(name => [name, {name,description:name==='/tasks'?'Show saved task progress':name==='/continue'?'Continue unfinished work':'Manage model providers and connections',usage:name}] as const),
        ...["/auth", "/login", "/logout"].map(
          (name) =>
            [
              name,
              {
                name,
                description: "Manage provider access",
                usage: `${name} [profile] [ENV_VAR]`,
              },
            ] as const
        ),
        ...[
          "/sessions",
          "/history",
          "/resume",
          "/fork",
          "/rename",
          "/archive",
          "/unarchive",
        ].map(
          (name) =>
            [
              name,
              {
                name,
                description: ["/history", "/sessions", "/resume"].includes(name) ? "Search and resume saved chats" : "Manage saved sessions",
                usage: `${name} [name, id or search]`,
              },
            ] as const
        ),
        [
          "/model",
          {
            name: "/model",
            description: "Choose a model profile",
            usage: "/model [profile or model]",
          },
        ] as const,
        [
          "/marketplace",
          {
            name: "/marketplace",
            description: "Manage plugin marketplaces",
            usage: "/marketplace [list|add source|update name|remove name]",
          },
        ] as const,
      ]).values(),
    ].filter(command=> {
      if(plugins.some(p=>p.commands?.some(c=>c.name===command.name)))return true;
      const owners:Record<string,string>={
        '/tasks':'agent-harness','/continue':'agent-harness',
        '/settings':controls.manifest.name,'/providers':controls.manifest.name,'/models':controls.manifest.name,'/model':controls.manifest.name,
        '/auth':auth.plugin.manifest.name,'/login':auth.plugin.manifest.name,'/logout':auth.plugin.manifest.name,
        '/extensions':extensions.plugin.manifest.name,'/marketplace':market.plugin.manifest.name,
        ...Object.fromEntries(['/sessions','/history','/resume','/fork','/rename','/archive','/unarchive'].map(name=>[name,sessionPlugin.manifest.name]))};
      return !owners[command.name] || hostEnabled(owners[command.name]);
    }).sort((a, b) => a.name.localeCompare(b.name));
  let savedRules = structuredClone(config.config.ui?.rules ?? []);
  let saveQueue = Promise.resolve();
  const savePlacement: BuiltApp["savePlacement"] = (rule) => {
    const operation = saveQueue.then(async () => {
      const result = await savePlacementRule(options.cwd, rule, savedRules);
      savedRules = result.rules;
      return result.path;
    });
    saveQueue = operation.then(
      () => {},
      () => {}
    );
    return operation;
  };
  const layoutPath = path.join(storage.paths.state, "layout.json");
  const loadLayout = () =>
    readFile(layoutPath, "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
  let layoutWrites = Promise.resolve();
  const saveLayout = (layout: unknown) => {
    const next = layoutWrites.then(async () => {
      await mkdir(path.dirname(layoutPath), { recursive: true });
      await writeFile(layoutPath + ".tmp", JSON.stringify(layout, null, 2));
      await rename(layoutPath + ".tmp", layoutPath);
    });
    layoutWrites = next.catch(() => {});
    return next;
  };
  return {
    close: async () => {
      await hub?.close();
      await store.dispose();
      await network.close();
      await Promise.allSettled(plugins.map((p) => p.dispose?.()));
    },
    storage,
    loadLayout,
    saveLayout,
    resume,
    config,
    plugins,
    pluginErrors: errors,
    store,
    resumedEvents,
    createCore,
    reloadPlugins,
    commands,
    savePlacement,
  };
}

function resolveProvider(
  config: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): ProviderSettings {
  const providers = (config.providers ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const def = providers.default ?? {};
  const type = def.type as ProviderProfile["type"];
  const baseUrl =
    (env.AGENT_BASE_URL as string) ??
    (def.baseUrl as string) ??
    (type === "anthropic"
      ? "https://api.anthropic.com/v1"
      : type === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : type === "openai-responses"
      ? "https://api.openai.com/v1"
      : "http://127.0.0.1:11434/v1");
  const apiKey =
    env.AGENT_API_KEY ??
    (def.apiKeyEnv ? env[String(def.apiKeyEnv)] : (def.apiKey as string)) ??
    (type ? "" : "ollama");
  const model =
    (env.AGENT_MODEL as string) ??
    (def.model as string) ??
    (config.model as string) ??
    "gemma4:31b-cloud";
  return {
    baseUrl,
    apiKey,
    model,
    type: def.type as ProviderProfile["type"],
    reasoningEffort: def.reasoningEffort as string | undefined,
  };
}

function defaultPluginDirs(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? "";
  const dirs: string[] = [];
  if (home) dirs.push(path.join(home, ".agent-compositor", "plugins"));
  dirs.push(
    path.join(cwd, "plugins"),
    path.join(cwd, ".agent-compositor/plugins")
  );
  return dirs;
}

function resolveDir(p: string, cwd: string): string {
  return path.isAbsolute(p) ? p : path.join(cwd, p);
}
