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
