import type { HooksApi } from '@agent-compositor/hooks';
import type { UiTextView } from '@agent-compositor/events';
import { stripVTControlCharacters } from 'node:util';
import { DEFAULTS, settings } from './settings.js';
import type { Report } from './tools.js';

const PANEL = 'main', SITE = 'plugin-test-reports-main';
const ACTIVE = 'active', CLOSED = 'closed', DRAFT = 'path', RESULT = 'result', STATUS = 'status', SELECTED = 'selected', INPUT = 'input-generation', ACTION = 'action';
type Loaded = { path: string; report: Report };
type Status = { text: string; failed?: boolean };
const clean = (text: string) => stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
const label = (text: string) => clean(text).replace(/[\r\n\t]/g, ' ').slice(0, 500);
function valid(value: unknown): value is Report {
  if (!value || typeof value !== 'object') return false;
  const r = value as Report;
  return [r.total, r.passed, r.failed, r.skipped].every(n => Number.isSafeInteger(n) && n >= 0)
    && r.total === r.passed + r.failed + r.skipped && typeof r.truncated === 'boolean'
    && Array.isArray(r.failures) && r.failures.length <= 50 && r.failures.length <= r.failed
    && r.failures.every(f => f && typeof f.name === 'string' && typeof f.file === 'string' && typeof f.message === 'string');
}
async function show($: HooksApi) {
  if ($.state.get(CLOSED)) return;
  let config = DEFAULTS, configError = '';
  try { config = settings(await $.storage.config('test-reports.json')); }
  catch (error) { configError = clean(String(error)).slice(0, 1024); }
  const draft = $.state.get<string>(DRAFT) ?? config.path;
  const active = $.state.get<AbortController>(ACTIVE), loaded = $.state.get<Loaded>(RESULT), status = $.state.get<Status>(STATUS);
  const selected = $.state.get<number>(SELECTED) ?? 0, failure = loaded?.report.failures[selected];
  const details = failure ? clean(failure.message).split('\n').flatMap(line => line.match(/.{1,10000}/gu) ?? ['']) : [];
  const actions = active ? ['cancel', 'close'] : ['read', 'configure', 'close'];
  const action = actions[$.state.get<number>(ACTION) ?? 0];
  const lines: UiTextView['lines'] = [
    { text: 'Read report', action: active ? undefined : 'read', selected: action === 'read', tone: 'accent' },
    { text: 'Configure report defaults', action: active ? undefined : 'configure', selected: action === 'configure', tone: 'accent' },
    ...(active ? [{ text: active.signal.aborted ? 'Cancelling read…' : 'Cancel read', action: 'cancel', selected: action === 'cancel', tone: 'warning' as const }] : []),
    { text: 'Close', action: 'close', selected: action === 'close', tone: 'muted' },
    { text: `Limits: ${config.maxFailures} failures · ${config.maxBytes} bytes`, tone: 'muted' },
    ...(configError ? [{ text: configError, tone: 'danger' as const }] : []),
    ...(status ? [{ text: label(status.text), tone: status.failed ? 'danger' as const : 'text' as const }] : []),
    ...(loaded ? [
      { text: `Last loaded: ${label(loaded.path)}`, tone: 'muted' as const },
      { text: `${loaded.report.total} tests · ${loaded.report.passed} passed · ${loaded.report.failed} failed · ${loaded.report.skipped} skipped`, bold: true, tone: loaded.report.failed ? 'warning' as const : 'text' as const },
      ...loaded.report.failures.map((f, i) => ({ text: `${i + 1}. ${label(f.name).slice(0, 160)}`, action: `failure:${i}`, selected: selected === i, tone: 'accent' as const })),
      ...(loaded.report.truncated ? [{ text: 'Report details shortened by limits; counts are complete.', tone: 'warning' as const }] : []),
      ...(failure ? [
        { text: `Failure ${selected + 1}: ${label(failure.name)}`, bold: true },
        { text: `File: ${label(failure.file)}`, tone: 'muted' as const },
        ...details.slice(0, 1800).map(text => ({ text })),
        ...(details.length > 1800 ? [{ text: 'Panel line limit reached.', tone: 'warning' as const }] : []),
      ] : [{ text: loaded.report.failed ? 'No failure detail fits the output limit. Increase the limits and read again.' : 'No failed assertions in this report.' }]),
    ] : [{ text: 'Enter a Vitest/Jest JSON report path above, then choose Read report.' }]),
  ];
  await $.ui.view(PANEL, 'Test reports', { input: { id: `report-path:${$.state.get<number>(INPUT) ?? 0}`, label: 'Report path', value: draft.slice(0, 4000), placeholder: DEFAULTS.path }, lines, hint: 'Type path · Tab actions · Enter activate · ↑↓ failures · Esc close · Alt+i message' });
}
async function read($: HooksApi) {
  if ($.state.get(ACTIVE)) return;
  const cleanup = $.background(), controller = new AbortController();
  $.state.set(ACTIVE, controller);
  let status: Status, loaded: Loaded | undefined;
  try {
    const config = settings(await $.storage.config('test-reports.json'));
    const path = $.state.get<string>(DRAFT) ?? config.path;
    $.state.set(STATUS, { text: `Reading: ${label(path)}` });
    await show($);
    controller.signal.throwIfAborted();
    const result = await $.agent.tool('test_report', { path, maxFailures: config.maxFailures, maxBytes: config.maxBytes }, { signal: controller.signal });
    $.signal.throwIfAborted(); controller.signal.throwIfAborted();
    if (!result.ok) status = { text: result.error || 'Report could not be read. Check the path and permissions.', failed: true };
    else if (!valid(result.output) || Buffer.byteLength(JSON.stringify(result.output)) > config.maxBytes) status = { text: 'test_report returned an invalid or oversized result.', failed: true };
    else { loaded = { path, report: result.output }; status = { text: 'Report loaded.' }; }
  } catch (error) {
    status = { text: $.signal.aborted || controller.signal.aborted ? 'Report read cancelled. Previous results retained.' : `Read failed: ${clean(String(error))}`, failed: true };
  } finally {
    if (!cleanup.signal.aborted && cleanup.state.get(ACTIVE) === controller) {
      cleanup.state.delete(ACTIVE);
      if (loaded) { cleanup.state.set(RESULT, loaded); cleanup.state.set(SELECTED, 0); }
      cleanup.state.set(STATUS, status!);
      await show(cleanup);
    }
  }
}
async function configure($: HooksApi) {
  if ($.state.get(ACTIVE)) return;
  const cleanup = $.background(), controller = new AbortController();
  $.state.set(ACTIVE, controller);
  try {
    const current = await $.storage.config('test-reports.json');
    let path = String(current.path ?? DEFAULTS.path), maxFailures = String(current.maxFailures ?? DEFAULTS.maxFailures), maxBytes = String(current.maxBytes ?? DEFAULTS.maxBytes), scope = 'project';
    let description = 'Set the starting report path and default output bounds. Saving does not read a file.';
    for (;;) {
      const form = await $.ui.form({ title: 'Configure test reports', description, fields: [
        { id: 'path', label: 'Starting report path', type: 'text', value: path, required: true },
        { id: 'maxFailures', label: 'Maximum failures', type: 'text', value: maxFailures, required: true, hint: 'Integer 1–50' },
        { id: 'maxBytes', label: 'Maximum output bytes', type: 'text', value: maxBytes, required: true, hint: 'Integer 1024–64000' },
        { id: 'scope', label: 'Save for', type: 'select', value: scope, options: [{ value: 'project', label: 'This project' }, { value: 'global', label: 'All projects' }] },
      ], actions: [{ id: 'save', label: 'Save' }, { id: 'cancel', label: 'Cancel' }] });
      if (!form || form.action === 'cancel' || $.state.get(CLOSED) || controller.signal.aborted) return;
      path = String(form.values.path ?? ''); maxFailures = String(form.values.maxFailures ?? ''); maxBytes = String(form.values.maxBytes ?? ''); scope = String(form.values.scope ?? '');
      try {
        if (!/^\d+$/.test(maxFailures) || !/^\d+$/.test(maxBytes) || !['project', 'global'].includes(scope)) throw Error('Enter whole-number limits and choose a valid scope.');
        const next = settings({ path, maxFailures: Number(maxFailures), maxBytes: Number(maxBytes) });
        await $.storage.configure('test-reports.json', next, scope as 'project' | 'global');
        const effective = settings(await $.storage.config('test-reports.json'));
        $.state.set(DRAFT, effective.path);
        $.state.set(INPUT, ($.state.get<number>(INPUT) ?? 0) + 1);
        $.state.set(STATUS, { text: `Settings saved in ${scope} scope. Effective: ${effective.maxFailures} failures · ${effective.maxBytes} bytes (project overrides global).` });
        return;
      } catch (error) { description = clean(String(error)).slice(0, 1024); }
    }
  } catch (error) { $.state.set(STATUS, { text: `Settings failed: ${clean(String(error))}`, failed: true }); }
  finally {
    if (!cleanup.signal.aborted && cleanup.state.get(ACTIVE) === controller) { cleanup.state.delete(ACTIVE); await show(cleanup); }
  }
}
export default {
  'prompt.submit': async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== '/test-report') return;
    $.state.set(CLOSED, false); await show($); return { drop: 'test-reports: handled' };
  },
  'ui.change': async (event: { site: string; id: string; value: string }, $: HooksApi) => {
    if (event.site === SITE && event.id === `report-path:${$.state.get<number>(INPUT) ?? 0}` && !$.state.get(CLOSED)) { const action = $.state.get<number>(ACTION) ?? 0; $.state.set(DRAFT, event.value.slice(0, 4000)); $.state.set(ACTION, 0); if (action !== 0) await show($); }
  },
  'ui.press': async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== SITE) return;
    if (event.key === 'command:/test-report') { $.state.set(CLOSED, false); await show($); return; }
    if (event.key.startsWith('command:')) { await $.ui.notify('Usage: /test-report', 'warn'); return; }
    let key = event.key;
    const actions = $.state.get(ACTIVE) ? ['cancel', 'close'] : ['read', 'configure', 'close'];
    if (key === 'tab') { $.state.set(ACTION, (($.state.get<number>(ACTION) ?? 0) + 1) % actions.length); await show($); return; }
    if (key === 'enter') key = actions[$.state.get<number>(ACTION) ?? 0] ?? 'read';
    if (key === 'escape') key = 'close';
    if (key === 'close') { $.state.set(CLOSED, true); $.state.get<AbortController>(ACTIVE)?.abort(Error('Report panel closed')); await $.ui.remove(PANEL); return; }
    if ($.state.get(CLOSED)) return;
    if (key === 'cancel') { $.state.get<AbortController>(ACTIVE)?.abort(Error('Read cancelled')); await show($); return; }
    if (key === 'read') { await read($); return; }
    if (key === 'configure') { await configure($); return; }
    if (key === 'up' || key === 'down') { const loaded = $.state.get<Loaded>(RESULT); if (loaded?.report.failures.length) { const next = Math.max(0, Math.min(loaded.report.failures.length - 1, ($.state.get<number>(SELECTED) ?? 0) + (key === 'down' ? 1 : -1))); $.state.set(SELECTED, next); await show($); } return; }
    const match = /^failure:(\d+)$/.exec(key);
    if (match) { const selected = Number(match[1]), loaded = $.state.get<Loaded>(RESULT); if (loaded && selected < loaded.report.failures.length) { $.state.set(SELECTED, selected); await show($); } }
  },
};
