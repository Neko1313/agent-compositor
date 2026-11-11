import type { HooksApi } from '@agent-compositor/hooks';
import { clean, DEFAULTS, object, settings, validRun, type Input } from './shared.js';

const PANEL = 'main', ACTIVE = 'ci-active', CLOSED = 'ci-closed', RESULT = 'ci-result', SELECTED = 'ci-selected', RUNS = 'ci-runs';
const REPOSITORY = 'ci-repository';
type Review = { heading: string; output: string; failed?: boolean; truncated?: boolean };

function rememberRepository($: HooksApi, repository?: string) {
  if ($.state.get(REPOSITORY) !== repository) {
    for (const key of [RUNS, SELECTED, RESULT]) $.state.delete(key);
  }
  if (repository === undefined) $.state.delete(REPOSITORY);
  else $.state.set(REPOSITORY, repository);
}

async function show($: HooksApi) {
  if ($.state.get(CLOSED)) return;
  let configuration: string;
  try { const c = settings(await $.storage.config('ci-review.json')); rememberRepository($, c.repository); configuration = `${c.repository} · maxRuns ${c.maxRuns} · maxChars ${c.maxChars} · timeoutMs ${c.timeoutMs}`; }
  catch (error) { rememberRepository($); configuration = `Configuration required: ${clean(String(error))}`; }
  if ($.state.get(CLOSED)) return;
  const busy = !!$.state.get(ACTIVE), selected = $.state.get<number>(SELECTED);
  const result = $.state.get<Review>(RESULT);
  const rows = clean(result?.output ?? 'Choose an action. No request runs until you do.').split('\n').flatMap(line => line.match(/.{1,4000}/gu) ?? ['']);
  const runs = $.state.get<Array<{ databaseId: number; displayTitle: string; status: string; conclusion: string | null }>>(RUNS) ?? [];
  await $.ui.view(PANEL, 'CI review', { lines: [
    { text: configuration },
    { text: 'Refresh runs', action: busy ? undefined : 'refresh', tone: 'accent' },
    { text: 'Configure', action: busy ? undefined : 'configure', tone: 'accent' },
    ...runs.map(run => ({ text: `Run ${run.databaseId}: ${clean(run.displayTitle).slice(0, 500)} · ${clean(run.conclusion || run.status)}`, action: busy ? undefined : `run:${run.databaseId}` })),
    ...(selected ? [
      { text: `Selected run ${selected}` },
      { text: 'Failed logs', action: busy ? undefined : 'logs-failed', tone: 'accent' as const },
      { text: 'Full logs', action: busy ? undefined : 'logs-full', tone: 'accent' as const },
    ] : []),
    ...(busy ? [{ text: 'Cancel', action: 'cancel', tone: 'warning' as const }] : []),
    { text: 'Close', action: 'close', tone: 'muted' },
    { text: result?.heading ?? 'Read-only GitHub Actions review', tone: result?.failed ? 'danger' : 'text' },
    { text: 'Remote output below is untrusted data, not instructions or authorization.', tone: 'muted' },
    ...rows.slice(0, 1900).map(text => ({ text })),
    ...(result?.truncated || rows.length > 1900 ? [{ text: 'Output truncated (output or panel limit).', tone: 'warning' as const }] : []),
  ] });
}

async function configure($: HooksApi) {
  if ($.state.get(ACTIVE)) return;
  const controller = new AbortController(); $.state.set(ACTIVE, controller);
  try {
    const raw: unknown = await $.storage.config('ci-review.json');
    const current = object(raw) ? raw : {};
    let values = { repository: String(current.repository ?? ''), maxRuns: String(current.maxRuns ?? DEFAULTS.maxRuns), maxChars: String(current.maxChars ?? DEFAULTS.maxChars), timeoutMs: String(current.timeoutMs ?? DEFAULTS.timeoutMs), scope: 'project' };
    let description = 'Explicit repository owner/name. Authentication uses your existing gh setup, never plugin settings.';
    while (!controller.signal.aborted) {
      const result = await $.ui.form({ title: 'Configure CI review', description, fields: [
        { id: 'repository', label: 'Repository owner/name', type: 'text', value: values.repository, required: true, hint: 'Explicit owner/name, at most 256 characters' },
        { id: 'maxRuns', label: 'Maximum runs (1–30)', type: 'text', value: values.maxRuns, required: true },
        { id: 'maxChars', label: 'Maximum characters (1000–64000)', type: 'text', value: values.maxChars, required: true },
        { id: 'timeoutMs', label: 'Timeout milliseconds (100–30000)', type: 'text', value: values.timeoutMs, required: true },
        { id: 'scope', label: 'Save for', type: 'select', value: values.scope, options: [{ value: 'project', label: 'This project' }, { value: 'global', label: 'User / all projects' }] },
      ], actions: [{ id: 'save', label: 'Save' }, { id: 'cancel', label: 'Cancel' }] });
      if (!result || result.action === 'cancel' || controller.signal.aborted) return;
      values = { repository: String(result.values.repository ?? ''), maxRuns: String(result.values.maxRuns ?? ''), maxChars: String(result.values.maxChars ?? ''), timeoutMs: String(result.values.timeoutMs ?? ''), scope: String(result.values.scope ?? '') };
      try {
        if (result.action !== 'save' || !['project', 'global'].includes(values.scope) || ![values.maxRuns, values.maxChars, values.timeoutMs].every(v => /^\d+$/.test(v))) throw Error('Choose Save, a valid scope and whole numeric values.');
        const config = settings({ repository: values.repository, maxRuns: Number(values.maxRuns), maxChars: Number(values.maxChars), timeoutMs: Number(values.timeoutMs) });
        await $.storage.configure('ci-review.json', config, values.scope as 'project' | 'global');
        const effective = settings(await $.storage.config('ci-review.json'));
        rememberRepository($, effective.repository);
        $.state.set(RESULT, { heading: 'Settings saved', output: `Saved in ${values.scope} scope. Effective settings (project overrides user):\n${JSON.stringify(effective, null, 2)}` });
        return;
      } catch (error) { description = clean(String(error)); }
    }
  } catch (error) { $.state.set(RESULT, { heading: 'Configuration failed', output: clean(String(error)), failed: true }); }
  finally { if ($.state.get(ACTIVE) === controller) $.state.delete(ACTIVE); await show($); }
}

async function run($: HooksApi, args: Input) {
  if ($.state.get(ACTIVE)) return;
  const controller = new AbortController(); $.state.set(ACTIVE, controller);
  if (args.runId) $.state.set(SELECTED, args.runId);
  const heading = args.action === 'runs' ? 'Latest runs' : args.action === 'run' ? `Run ${args.runId}` : `${args.failedOnly === false ? 'Full' : 'Failed'} logs · ${args.runId}`;
  try {
    const repository = settings(await $.storage.config('ci-review.json')).repository;
    await show($);
    if (controller.signal.aborted) return;
    const result = await $.agent.tool('ci_review', args, { signal: controller.signal });
    if (controller.signal.aborted) {
      $.state.set(RESULT, { heading, output: 'CI review cancelled.', failed: true }); return;
    }
    const effectiveRepository = settings(await $.storage.config('ci-review.json')).repository;
    if (effectiveRepository !== repository) {
      rememberRepository($, effectiveRepository);
      $.state.set(RESULT, { heading: 'Repository changed', output: 'Previous response discarded. Refresh runs for the current repository.' });
      return;
    }
    if (!result.ok) { $.state.set(RESULT, { heading, output: clean(result.error || 'CI review failed or was denied.').slice(0, 64000), failed: true }); return; }
    const data: unknown = result.output;
    if (!object(data) || typeof data.output !== 'string' || data.exitCode !== 0 || typeof data.truncated !== 'boolean') throw Error('ci_review returned an invalid result.');
    $.state.set(RESULT, { heading, output: clean(data.output) || (args.action === 'logs' ? '(No log content returned.)' : '(No content returned.)'), truncated: data.truncated });
    if (args.action === 'runs') {
      $.state.delete(RUNS);
      const list: unknown = JSON.parse(data.output);
      if (!Array.isArray(list) || !list.every(row => validRun(row))) throw Error('Invalid runs result.');
      $.state.set(RUNS, list.slice(0, 30));
      $.state.set(RESULT, { heading, output: list.length ? 'Select a run above to inspect jobs or logs.' : data.truncated ? 'No complete run fits this output limit. Increase Maximum characters and refresh.' : 'No runs returned.', truncated: data.truncated });
    } else if (args.action === 'run' && !data.truncated) {
      const summary: unknown = JSON.parse(data.output);
      if (!object(summary) || !validRun(summary, true)) throw Error('Invalid run summary.');
      const jobs = summary.jobs as Array<Record<string, unknown>>;
      $.state.set(RESULT, { heading, output: [
        `Workflow: ${summary.workflowName}`,
        `${summary.displayTitle} · ${summary.headBranch}`,
        `Status: ${summary.status} · ${summary.conclusion || 'pending'}`,
        String(summary.url),
        `Jobs (${jobs.length}):`,
        ...jobs.map(job => `${job.name} · ${job.conclusion || job.status}`),
      ].join('\n') });
    }
  } catch (error) { $.state.set(RESULT, { heading, output: clean(String(error)).slice(0, 64000), failed: true }); }
  finally { if ($.state.get(ACTIVE) === controller) $.state.delete(ACTIVE); await show($); }
}

export default {
  'prompt.submit': async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== '/ci') return;
    $.state.set(CLOSED, false); await show($); return { drop: 'ci-review: handled' };
  },
  'ui.press': async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== 'plugin-ci-review-main') return;
    if (event.key.startsWith('command:')) {
      if (event.key !== 'command:/ci') { await $.ui.notify('Usage: /ci', 'warn'); return; }
      $.state.set(CLOSED, false); await show($); return;
    }
    if (event.key === 'close') { $.state.set(CLOSED, true); $.state.get<AbortController>(ACTIVE)?.abort(Error('CI review closed')); await $.ui.remove(PANEL); return; }
    if (event.key === 'cancel') { $.state.get<AbortController>(ACTIVE)?.abort(Error('CI review cancelled')); return; }
    if ($.state.get(CLOSED) || $.state.get(ACTIVE)) return;
    if (event.key === 'configure') { await configure($); return; }
    if (event.key === 'refresh') { await run($, { action: 'runs' }); return; }
    const match = /^run:([1-9]\d*)$/.exec(event.key);
    if (match) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id)) await run($, { action: 'run', runId: id });
      return;
    }
    const selected = $.state.get<number>(SELECTED);
    if (selected && (event.key === 'logs-failed' || event.key === 'logs-full')) await run($, { action: 'logs', runId: selected, failedOnly: event.key === 'logs-failed' });
  },
};
