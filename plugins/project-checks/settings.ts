export type Limits = { maxChars: number; timeoutMs: number };
export const DEFAULTS: Limits = { maxChars: 16000, timeoutMs: 120000 };
export function limits(value: unknown): Limits {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('project-checks.json must be a settings object.');
  const record = value as Record<string, unknown>;
  const result = { ...DEFAULTS };
  for (const [key, min, max] of [['maxChars', 1000, 64000], ['timeoutMs', 100, 300000]] as const) {
    const v = record[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new Error(`project-checks.json ${key} must be an integer from ${min} to ${max}.`);
    result[key] = v;
  }
  return result;
}
