import type { ToolResult } from './types.js';

/** Keep service data intact and add the action only to recognized model-facing receipts. */
export function fileResult<T extends { path: string; bytes?: number; replacements?: number }>(
  fileAction: 'edited' | 'wrote', target: string, data: T,
): ToolResult<T> {
  const result = { ok: true as const, data };
  if (data?.path !== target || Object.hasOwn(data, 'fileAction')) return result;

  const count = fileAction === 'edited' ? data.replacements : data.bytes;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < (fileAction === 'edited' ? 1 : 0)) return result;

  try {
    return { ...result, modelText: JSON.stringify({ fileAction, ...data }) };
  } catch {
    return result;
  }
}
