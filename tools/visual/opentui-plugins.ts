import {z} from 'zod';
import type {AgentCore} from '@agent-compositor/core';
import type {BuiltApp} from '../../packages/app/src/build.js';
import type {
  PluginManagerAction, PluginManagerRow, PluginManagerSnapshot, PluginManagerSource,
} from '@agent-compositor/renderer-opentui';

const pluginName = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const entry = z.object({
  name: pluginName, description: z.string().optional(), version: z.string().optional(), source: z.unknown(),
});
const marketplaces = z.array(z.object({name: pluginName, plugins: z.array(entry)}));
const inventory = z.object({
  installed: z.record(pluginName, z.object({
    scope: z.enum(['project', 'user']).optional(), qualified: z.string().optional(), version: z.string().optional(),
  })),
  available: z.array(z.object({
    name: pluginName, version: z.string(), enabled: z.boolean(), bundled: z.boolean().optional(),
  })),
  enabled: z.array(z.string()),
});
const outcome = z.object({
  queued: z.boolean().optional(), unchanged: z.boolean().optional(), reloadRequired: z.boolean().optional(),
});
const past: Record<PluginManagerAction, string> = {
  install: 'Installed', enable: 'Enabled', disable: 'Disabled', update: 'Updated', remove: 'Removed',
};

/** The preview owns one managed Main core. Its independent Side core has a separate composition. */
export async function connectPluginManager(app: BuiltApp, main: AgentCore): Promise<PluginManagerSource & {
  submit(text: string): Promise<void>;
  disconnect(): Promise<void>;
}> {
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const pending = new Map<string, string>();
  let state: PluginManagerSnapshot = {rows: [], revision: 0, working: false};
  let task: Promise<void> | undefined;
  let wakeup: ReturnType<typeof setTimeout> | undefined;
  let submitting = 0;
  let retry = true;
  const busy = () => submitting > 0 || main.getState() === 'running' || main.hasActiveOperations;

  function publish(values: Partial<PluginManagerSnapshot>) {
    if (lifetime.signal.aborted) return;
    state = {...state, ...values, revision: state.revision + 1};
    for (const listener of listeners) listener();
  }

  async function service(name: 'service.extension.control' | 'service.marketplace.control', args: Record<string, unknown>) {
    const signal = lifetime.signal;
    signal.throwIfAborted();
    const {value} = await main.host.emit(name, {...args, signal}, signal);
    signal.throwIfAborted();
    const reply = value as {value?: unknown; deny?: string} | undefined;
    if (!reply || !Object.hasOwn(reply, 'value') || reply.deny !== undefined)
      throw Error(reply?.deny ?? 'Plugin management service returned no result');
    return reply.value;
  }

  async function readRows(): Promise<PluginManagerRow[]> {
    const [marketData, extensionData] = await Promise.all([
      service('service.marketplace.control', {action: 'list'}), service('service.extension.control', {action: 'list'}),
    ]);
    const markets = marketplaces.parse(marketData);
    const extensions = inventory.parse(extensionData);
    const entries = new Map<string, {name: string; marketplace?: string; description?: string; catalogVersion?: string}>();
    for (const market of markets) {
      for (const plugin of market.plugins) {
        if (typeof plugin.source !== 'string') continue;
        entries.set(plugin.name + '@' + market.name, {
          name: plugin.name, marketplace: market.name, description: plugin.description, catalogVersion: plugin.version,
        });
      }
    }

    // The installation's recorded source owns its controls. Same-named catalog
    // alternatives must never update or remove a different installed package.
    const locals = new Map(extensions.available.map(plugin => [plugin.name, plugin]));
    for (const name of new Set([...locals.keys(), ...Object.keys(extensions.installed)])) {
      const id = extensions.installed[name]?.qualified ?? name;
      if (!entries.has(id)) entries.set(id, {name, marketplace: id.split('@')[1]});
    }
    const rows: PluginManagerRow[] = [];
    for (const [id, info] of entries) {
      const {name} = info;
      const installed = extensions.installed[name];
      const owns = (installed?.qualified ?? name) === id;
      const managed = owns && installed?.scope === 'project';
      const local = owns ? locals.get(name) : undefined;
      const live = owns && main.host.hasPlugin(name) ? app.plugins.find(plugin => plugin.manifest.name === name) : undefined;
      const enabled = owns && (local?.enabled ?? (Boolean(installed) && extensions.enabled.includes(name)));
      const hint = pending.get(id);
      const actions: PluginManagerAction[] = [];
      if (hint !== 'update queued' && hint !== 'remove queued') {
        const config = app.config.config;
        const allowed = !config.disabledPlugins?.includes(name) && (!config.enabledPlugins || config.enabledPlugins.includes(name));
        if (local && !local.bundled && (enabled || allowed))
          actions.push(enabled ? 'disable' : 'enable');
        if (managed) actions.push('update', 'remove');
        if (!installed && !locals.has(name) && info.marketplace) actions.push('install');
      }
      rows.push({...info, id, enabled, actions, pending: hint,
        installedVersion: managed ? installed.version ?? 'unlocked' : undefined, loadedVersion: live?.manifest.version});
    }
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  function run(work: () => Promise<void>) {
    if (task || lifetime.signal.aborted) return;
    // Reserve the slot synchronously, including while a renderer subscriber
    // reacts to the working flag. New Main submissions wait out this operation.
    task = Promise.resolve().then(work).catch(async error => {
      if (lifetime.signal.aborted) return;
      // A service may fail after earlier work has already committed. Reread
      // the actual store before offering another action.
      const rows = await readRows().catch(() => []);
      publish({rows, error: String(error)});
    }).finally(() => {
      task = undefined;
      publish({working: false});
      wake();
    });
    publish({working: true, error: undefined});
  }

  function wake() {
    if (wakeup || !pending.size || !retry || task || lifetime.signal.aborted) return;
    // Terminal notifications precede idle state and queued prompt cleanup.
    // Check on the next tick, after both the event and its submit have settled.
    wakeup = setTimeout(() => {
      wakeup = undefined;
      if (!pending.size || !retry || task || lifetime.signal.aborted || busy()) return;
      run(async () => {
        retry = false; // A failed reload can be retried explicitly with Refresh.
        const message = await app.reloadPlugins(main);
        if (message.startsWith('Wait until')) { retry = true; return; }
        const rows = await readRows();
        for (const [id] of pending) {
          const row = rows.find(item => item.id === id);
          if (row?.enabled && !row.loadedVersion) {
            pending.set(id, 'reload pending');
            throw Error(row.name + ' did not load. ' + message.trim());
          }
        }
        pending.clear();
        retry = true;
        publish({status: 'Reloaded Main plugins', rows: await readRows()});
      });
    }, 0);
  }
  const unsubscribe = main.subscribe(event => {
    if (event.kind === 'catalog') wake();
  });

  function refresh() {
    run(async () => {
      publish({rows: await readRows()});
      retry = true;
    });
  }
  refresh();
  await task;
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => {listeners.delete(listener);}; },
    refresh,
    act(id, action, revision) {
      const row = state.rows.find(item => item.id === id);
      if (revision !== state.revision || !row?.actions.includes(action) || state.working) return;
      run(async () => {
        const rows = await readRows();
        const current = rows.find(item => item.id === id);
        if (!current?.actions.includes(action) || current.installedVersion !== row.installedVersion
          || current.catalogVersion !== row.catalogVersion || current.enabled !== row.enabled) {
          publish({rows, status: 'Plugin changed. Review the current selection.'});
          return;
        }
        const result = outcome.parse(await service('service.extension.control', {
          action, name: action === 'install' ? id : row.name, scope: 'project',
        }));
        let status = past[action] + ' ' + row.name;
        if (result.queued) {
          pending.set(id, action + ' queued');
          status = action + ' ' + row.name + ' queued';
        } else if (result.unchanged) {
          status = row.name + ' is already current';
        } else if (result.reloadRequired && (action !== 'install' || current.loadedVersion)) {
          pending.set(id, 'reload pending');
          status += ' · reload pending';
        }
        retry = true;
        publish({status, rows: await readRows()});
      });
    },
    async submit(text) {
      while (task) await task;
      if (lifetime.signal.aborted) return;
      submitting++;
      try { await main.submit(text); }
      finally { submitting--; wake(); }
    },
    async disconnect() {
      lifetime.abort();
      clearTimeout(wakeup);
      unsubscribe();
      listeners.clear();
      await task;
    },
  };
}
