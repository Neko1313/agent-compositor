import { stripVTControlCharacters } from 'node:util';

export type Settings = { repository: string; maxRuns: number; maxChars: number; timeoutMs: number };
export type Input = { action: 'runs' | 'run' | 'logs'; runId?: number; failedOnly?: boolean };
export const DEFAULTS = { maxRuns: 10, maxChars: 16000, timeoutMs: 15000 };
export function clean(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function settings(value: unknown): Settings {
  if (!object(value)) throw Error('ci-review.json must be a settings object; configure repository owner/name.');
  if (Object.keys(value).some(k => !['repository', 'maxRuns', 'maxChars', 'timeoutMs'].includes(k)))
    throw Error('Unknown ci-review.json setting. Only repository, maxRuns, maxChars and timeoutMs are supported.');
  if (typeof value.repository !== 'string' || value.repository.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value.repository) || ['.', '..'].includes(value.repository.split('/')[1]!))
    throw Error('ci-review.json repository must be explicit owner/name, at most 256 characters.');
  const result: Settings = { repository: value.repository, ...DEFAULTS };
  for (const [key, min, max] of [['maxRuns', 1, 30], ['maxChars', 1000, 64000], ['timeoutMs', 100, 30000]] as const) {
    if (Object.hasOwn(value, key)) {
      const n = value[key];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw Error(`${key} must be an integer from ${min} to ${max}.`);
      result[key] = n;
    }
  }
  return result;
}
export function input(value: unknown): Input {
  if (!object(value) || Object.keys(value).some(k => !['action', 'runId', 'failedOnly'].includes(k))) throw Error('Only action, runId and failedOnly are accepted.');
  const { action, runId, failedOnly } = value;
  if (action !== 'runs' && action !== 'run' && action !== 'logs') throw Error('action must be runs, run or logs.');
  if (action === 'runs' ? Object.hasOwn(value, 'runId') : typeof runId !== 'number' || !Number.isSafeInteger(runId) || runId <= 0)
    throw Error('run/logs require a positive safe-integer runId; runs accepts no runId.');
  if (Object.hasOwn(value, 'failedOnly') && (action !== 'logs' || typeof failedOnly !== 'boolean')) throw Error('failedOnly must be boolean and is only meaningful for logs.');
  return { action, ...(typeof runId === 'number' ? { runId } : {}), ...(action === 'logs' ? { failedOnly: failedOnly !== false } : {}) };
}
export function validRun(value: unknown, summary = false): boolean {
  if (!object(value) || typeof value.databaseId !== 'number' || !Number.isSafeInteger(value.databaseId) || value.databaseId <= 0) return false;
  if (!['workflowName', 'displayTitle', 'headBranch', 'status', 'url'].every(k => typeof value[k] === 'string')) return false;
  if (value.conclusion !== null && typeof value.conclusion !== 'string') return false;
  if (!summary) return typeof value.createdAt === 'string';
  return Array.isArray(value.jobs) && value.jobs.every(job => object(job) && typeof job.databaseId === 'number' && Number.isSafeInteger(job.databaseId) && job.databaseId > 0 && typeof job.name === 'string' && typeof job.status === 'string' && (job.conclusion === null || typeof job.conclusion === 'string'));
}
