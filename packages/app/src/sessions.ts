import type { CorePlugin, AgentCore } from '@agent-compositor/core';
import type { HooksApi } from '@agent-compositor/hooks';
import type { SessionStore, SessionMeta } from '@agent-compositor/session';
export function installSessionServices(core: AgentCore, store: SessionStore, cwd: string): void {
  const resolver = async (args: { action: string; id?: string; name?: string; search?: string; includeArchived?: boolean }) => {
    if (!core.controlsReady) return { deny: 'Wait until the current turn finishes' };
    const meta = args.id ? await store.findByPrefix(args.id, cwd) : undefined;
    const id = meta?.id ?? core.sessionId;
    if (args.id && !meta) return { deny: 'Session not found or ambiguous' };
    if (args.action === 'list') return { value: (await store.list(cwd, { includeArchived: args.includeArchived })).filter(m => !args.search || `${m.id} ${m.name ?? ''}`.toLowerCase().includes(args.search.toLowerCase())) };
    await store.create(cwd, { id: core.sessionId });
    if (args.action === 'rename') return { value: await store.rename(id, args.name ?? '', cwd) };
    if (args.action === 'archive') return { value: await store.archive(id, cwd) };
    if (args.action === 'unarchive') return { value: await store.unarchive(id, cwd) };
    if (args.action === 'fork') return { value: await store.fork(id, { name: args.name }, cwd) };
    return { deny: 'Session switching is unavailable in this host; use --resume' };
  };
  core.runtime.setResolver('service.session.control', resolver);
  core.runtime.setResolver('service.session.store', resolver);
}
async function service($: HooksApi, action: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await $.emit('service.session.control', { action, ...args }) as { value?: unknown; deny?: string };
  if (result.deny) throw new Error(result.deny); return result.value;
}
export function sessionControls(): CorePlugin {
  const show = async ($: HooksApi, search = '') => {
    const sessions = await service($, 'list', { search, includeArchived: true }) as SessionMeta[];
    $.state.set('sessions', sessions);
    await $.ui.view('sessions', 'Sessions', { lines: [
      { text: 'Local sessions', bold: true }, { text: `Current: ${$.session.id.slice(0, 8)}`, tone: 'muted' },
      { text: '[ Fork current ]', action: 'fork', tone: 'accent' },
      { text: '[ Archive current ]', action: 'archive', tone: 'muted' },
      ...sessions.slice(0, 100).flatMap(m => [
        { text: `${m.archived ? 'archived · ' : ''}${m.name ?? m.id.slice(0, 8)}`, action: `resume:${m.id}`, selected: m.id === $.session.id },
        { text: `${m.id.slice(0, 8)} · ${m.eventCount} events${m.parentId ? ` · fork of ${m.parentId.slice(0, 8)}` : ''}`, tone: 'muted' as const },
      ]),
    ] }, { site: 'inspector', size: .4, focus: false });
  };
  return { manifest: { name: 'session-manager', version: '1.0.0', trust: 'trusted' }, hooks: {
    'prompt.submit': async (event, $) => {
      const [command, ...rest] = event.text.trim().split(/\s+/); const value = rest.join(' ');
      if (!['/sessions', '/resume', '/fork', '/rename', '/archive', '/unarchive'].includes(command)) return;
      if (command === '/sessions') await show($, value);
      else if (command === '/rename') { await service($, 'rename', { name: value }); await show($); }
      else if (command === '/fork') { const meta = await service($, 'fork', { name: value }); await $.ui.notify(`Fork created: ${meta.id}`); await show($); }
      else { const result = await service($, command.slice(1), value ? { id: value } : {}); if (command !== '/resume') { await show($); void result; } }
      return { drop: 'session-manager: handled' };
    },
    'ui.press': async (event, $) => {
      if (event.site !== 'plugin-session-manager-sessions') return;
      try {
        if (event.key.startsWith('resume:')) await service($, 'resume', { id: event.key.slice(7) });
        else if (['fork','archive'].includes(event.key)) { await service($, event.key); await show($); }
      } catch (error) { await $.ui.notify(String(error), 'error'); }
    },
  } };
}
