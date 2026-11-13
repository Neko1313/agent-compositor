import { z } from 'zod';
const id = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine(value => !['constructor','prototype'].includes(value));
export const uiFormSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  fields: z.array(z.object({
    id, label: z.string().min(1).max(100),
    type: z.enum(['text','password','url','select','toggle']),
    value: z.union([z.string().max(4096),z.boolean()]).optional(),
    hint: z.string().max(300).optional(), required: z.boolean().optional(),
    options: z.array(z.object({value:z.string().max(200),label:z.string().max(200)})).max(200).optional(),
  }).strict().refine(field => field.type !== 'password' || !field.value, 'Secret fields must not publish initial values')).min(1).max(24),
  actions: z.array(z.object({id,label:z.string().min(1).max(50)})).min(1).max(6),
}).strict().refine(form => new Set([...form.fields.map(f=>f.id),...form.actions.map(a=>a.id)]).size === form.fields.length + form.actions.length, 'Form identifiers must be unique');
export type UiForm = z.infer<typeof uiFormSchema>;
export interface UiFormResult { action:string; values:Record<string,string|boolean>; }
export type UiFormHandler = (plugin:string, request:UiForm, signal:AbortSignal)=>Promise<UiFormResult|null>;

/** Validate a private form response without placing submitted values in errors. */
export function validateUiFormResult(request: UiForm, value: unknown): UiFormResult {
  const result = value as UiFormResult | undefined;
  if (!result || !request.actions.some(action => action.id === result.action)
    || !result.values || typeof result.values !== 'object' || Array.isArray(result.values))
    throw Error('Invalid form action or values');
  const values: UiFormResult['values'] = {};
  for (const field of request.fields) {
    const entry = result.values[field.id];
    if (field.type === 'toggle' ? typeof entry !== 'boolean' : typeof entry !== 'string')
      throw Error('Invalid form field type');
    if (field.required && !String(entry).trim()) throw Error('Complete all required fields');
    if (typeof entry === 'string' && entry.length > 4096) throw Error('Form field exceeds its limit');
    if (field.type === 'select' && !field.options?.some(option => option.value === entry))
      throw Error('Choose an offered option');
    if (field.type === 'url' && entry) {
      try { if (!['http:', 'https:'].includes(new URL(String(entry)).protocol)) throw Error(); }
      catch { throw Error('Enter an HTTP or HTTPS URL'); }
    }
    values[field.id] = entry;
  }
  return {action: result.action, values};
}
