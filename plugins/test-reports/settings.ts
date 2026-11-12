export type Settings = { path: string; maxFailures: number; maxBytes: number };
export const DEFAULTS: Settings = { path: 'reports/tests.json', maxFailures: 10, maxBytes: 12000 };
export function settings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('test-reports.json must be a settings object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['path', 'maxFailures', 'maxBytes'].includes(key))) throw Error('Unknown test-reports.json setting.');
  const result = { ...DEFAULTS, ...input };
  if (typeof result.path !== 'string' || !result.path.trim() || result.path.length > 4000 || /[\u0000-\u001f\u007f-\u009f]/u.test(result.path))
    throw Error('Path must be nonempty, at most 4000 characters, without control characters.');
  if (typeof result.maxFailures !== 'number' || !Number.isInteger(result.maxFailures) || result.maxFailures < 1 || result.maxFailures > 50)
    throw Error('Maximum failures must be an integer from 1 to 50.');
  if (typeof result.maxBytes !== 'number' || !Number.isInteger(result.maxBytes) || result.maxBytes < 1024 || result.maxBytes > 64000)
    throw Error('Maximum bytes must be an integer from 1024 to 64000.');
  return result as Settings;
}
