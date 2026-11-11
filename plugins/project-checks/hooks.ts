import type { HooksApi } from '@agent-compositor/hooks';
import { limits, DEFAULTS } from './settings.js';

type Result = { heading: string; output: string; failed?: boolean; truncated?: boolean };
type Script = { name: string; command: string };
const ACTIVE = 'active', CLOSED = 'closed', RESULT = 'result', SCRIPTS = 'scripts';
async function show($: HooksApi) {
  if ($.state.get(CLOSED)) return;
  const active = $.state.get<AbortController>(ACTIVE);
  const result = $.state.get<Result>(RESULT);
  const scripts = $.state.get<Script[]>(SCRIPTS) ?? [];
  const rows = (result?.output ?? 'Refresh scripts to discover checks. No process runs until you choose Run.').split('\n').flatMap(line => line.match(/.{1,10000}/gu) ?? ['']);
  await $.ui.view('main', 'Project checks', { lines: [
    { text: 'Refresh scripts', action: active ? undefined : 'refresh', tone: 'accent' },
    { text: 'Configure limits', action: active ? undefined : 'configure', tone: 'accent' },
    ...(active ? [{ text: active.signal.aborted ? 'Cancelling run…' : 'Cancel run', action: 'cancel', tone: 'warning' as const }] : []),
    { text: 'Close', action: 'close', tone: 'muted' },
    ...(active ? [{ text: 'Running · waiting for guarded operation…', tone: 'warning' as const }] : []),
    ...scripts.map(s => ({ text: `Run ${s.name}`, action: active ? undefined : `run:${s.name}`, tone: 'accent' as const })),
    { text: result?.heading ?? 'Local npm scripts', tone: result?.failed ? 'danger' : 'text' },
    ...rows.slice(0, 1800).map(text => ({ text })),
    ...(result?.truncated || rows.length > 1800 ? [{ text: 'Output truncated (tool or panel limit).', tone: 'warning' as const }] : []),
  ] });
}
async function operation($: HooksApi, name?: string) {
  if ($.state.get(ACTIVE)) return;
  const controller = new AbortController();
  // Retain only the cleanup capability across the initiating hook's deadline.
  const cleanup = $.background();
  $.state.set(ACTIVE, controller);
  const heading = name === undefined ? 'Scripts' : `Check ${name}`;
  $.state.set(RESULT, { heading: `${heading} · running`, output: 'Waiting for the guarded tool result.' });
  try {
    await show($);
    const result = await $.agent.tool('project_check', name === undefined ? { action: 'list' } : { action: 'run', name }, { signal: controller.signal });
    if (!result.ok) {
      $.state.set(RESULT, { heading, output: result.error || 'Check failed or was denied.', failed: true });
    } else {
      const data = result.output as { scripts?: Script[]; stdout?: string; stderr?: string; exitCode?: number; truncated?: boolean } | undefined;
      if (name === undefined && data && Array.isArray(data.scripts)) {
        $.state.set(SCRIPTS, data.scripts);
        $.state.set(RESULT, { heading, output: data.scripts.map(s => `${s.name}: ${s.command}`).join('\n') || '(No scripts.)', truncated: data.truncated });
      } else if (name !== undefined && data && data.exitCode === 0 && typeof data.stdout === 'string' && typeof data.stderr === 'string' && typeof data.truncated === 'boolean') {
        $.state.set(RESULT, { heading: `${heading} · passed (exit 0)`, output: `stdout:\n${data.stdout}\nstderr:\n${data.stderr}`, truncated: data.truncated });
      } else $.state.set(RESULT, { heading, output: 'project_check returned an invalid result.', failed: true });
    }
  } catch (error) {
    if (!cleanup.signal.aborted) cleanup.state.set(RESULT, { heading, output: `Check failed: ${String(error)}`, failed: true });
  } finally {
    if (!cleanup.signal.aborted) {
      if (cleanup.state.get(ACTIVE) === controller) cleanup.state.delete(ACTIVE);
      await show(cleanup);
    }
  }
}
async function configure($: HooksApi) {
  if ($.state.get(ACTIVE)) return;
  try {
    const current = await $.storage.config('project-checks.json');
    let maxChars = String(current.maxChars ?? DEFAULTS.maxChars), timeoutMs = String(current.timeoutMs ?? DEFAULTS.timeoutMs), scope = 'project';
    let description = 'Limit combined stdout/stderr characters and execution time.';
    for (;;) {
      const result = await $.ui.form({ title: 'Configure project checks', description, fields: [
        { id: 'maxChars', label: 'Maximum output characters', type: 'text', value: maxChars, required: true, hint: 'Integer 1000–64000' },
        { id: 'timeoutMs', label: 'Timeout (milliseconds)', type: 'text', value: timeoutMs, required: true, hint: 'Integer 100–300000' },
        { id: 'scope', label: 'Save for', type: 'select', value: scope, options: [{ value: 'project', label: 'This project' }, { value: 'global', label: 'All projects' }] },
      ], actions: [{ id: 'save', label: 'Save' }, { id: 'cancel', label: 'Cancel' }] });
      if (!result || result.action === 'cancel' || $.state.get(CLOSED)) return;
      maxChars = String(result.values.maxChars ?? ''); timeoutMs = String(result.values.timeoutMs ?? ''); scope = String(result.values.scope ?? '');
      let saved;
      try {
        if (!/^\d+$/.test(maxChars) || !/^\d+$/.test(timeoutMs) || !['project', 'global'].includes(scope)) throw new Error('Enter whole numbers and a valid scope.');
        saved = limits({ maxChars: Number(maxChars), timeoutMs: Number(timeoutMs) });
      } catch (error) { description = String(error); continue; }
      await $.storage.configure('project-checks.json', saved, scope as 'project' | 'global');
      const effective = limits(await $.storage.config('project-checks.json'));
      $.state.set(RESULT, { heading: 'Settings saved', output: `Saved to ${scope}: maxChars ${saved.maxChars}, timeoutMs ${saved.timeoutMs}\nEffective in this project: maxChars ${effective.maxChars}, timeoutMs ${effective.timeoutMs} (project settings override global).` });
      return;
    }
  } catch (error) { $.state.set(RESULT, { heading: 'Settings failed', output: String(error), failed: true }); }
  finally { await show($); }
}
export default {
  'prompt.submit': async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== '/checks') return;
    $.state.set(CLOSED, false); await show($);
    return { drop: 'project-checks: handled' };
  },
  'ui.press': async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== 'plugin-project-checks-main') return;
    if (event.key === 'command:/checks') { $.state.set(CLOSED, false); await show($); return; }
    if (event.key.startsWith('command:')) { await $.ui.notify('Usage: /checks', 'warn'); return; }
    if (event.key === 'close') {
      $.state.set(CLOSED, true); $.state.get<AbortController>(ACTIVE)?.abort(Error('Project checks closed'));
      await $.ui.remove('main'); return;
    }
    if ($.state.get(CLOSED)) return;
    if (event.key === 'cancel') { $.state.get<AbortController>(ACTIVE)?.abort(Error('Project check cancelled')); await show($); }
    else if (event.key === 'refresh') await operation($);
    else if (event.key.startsWith('run:')) await operation($, event.key.slice(4));
    else if (event.key === 'configure') await configure($);
  },
};
