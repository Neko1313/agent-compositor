/** Pure, deliberately narrow contract for the retained text/function evaluation lane. */
export const RESPONSES_MODEL = 'gpt-6.1-sol';
export type ResponsesContractCode = 'request' | 'terminal' | 'usage' | 'pricing';
export class ResponsesContractError extends Error {
  readonly name = 'ResponsesContractError';
  constructor(readonly code: ResponsesContractCode, readonly field: string) {
    super(`Responses ${code} contract rejected: ${field}`);
  }
}
export interface ResponsesRequestPolicy {model: string; maxOutputTokens: number; reasoningEffort?: string}
export interface ResponsesTerminal {
  kind: 'completed' | 'incomplete'; responseId?: string;
  inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number;
}
type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type RecordValue = Record<string, unknown>;
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
function reject(code: ResponsesContractCode, field: string): never {throw new ResponsesContractError(code, field);}
const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function record(value: unknown, code: ResponsesContractCode, field: string): RecordValue {
  if (!object(value)) reject(code, field);return value;
}
function keys(value: RecordValue, allowed: readonly string[], code: ResponsesContractCode, field: string) {
  // Never echo an untrusted key or value into an error or an authority receipt.
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) reject(code, field);
}
function text(value: unknown, code: ResponsesContractCode, field: string, max = 200_000, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.length)) reject(code, field);
}
function integer(value: unknown, code: ResponsesContractCode, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) reject(code, field);
}
function identifier(value: unknown, field: string) {
  text(value, 'request', field, 512, true);
  if (/[\u0000-\u001f\u007f]/u.test(value)) reject('request', field);
}
function functionName(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(value)) reject('request', field);
}
function json(value: unknown, field: string, depth = 0): Json {
  if (depth > 64) reject('request', field);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Array.from(value, item => json(item, field, depth + 1));
  if (!object(value)) reject('request', field);
  const entries = Reflect.ownKeys(value).map(key => {
    if (typeof key !== 'string') reject('request', field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) reject('request', field);
    return [key, json(descriptor.value, field, depth + 1)] as const;
  });
  return Object.fromEntries(entries);
}
function parameters(value: unknown, field: string) {
  record(value, 'request', field);
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {item.forEach(visit);return;}
    if (!object(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if ((key === '$ref' || key === '$dynamicRef') && (typeof child !== 'string' || !child.startsWith('#'))) reject('request', field);
      visit(child);
    }
  };
  visit(value);
}
function reasoningItem(value: RecordValue, field: string) {
  keys(value, ['type', 'id', 'encrypted_content', 'summary', 'content', 'status'], 'request', field);
  // An ID alone would borrow server-side state. The ciphertext stays opaque.
  text(value.encrypted_content, 'request', field + '.encrypted_content', 200_000, true);
  if (value.id !== undefined) identifier(value.id, field + '.id');
  if (value.status !== undefined && value.status !== null && !['in_progress', 'completed', 'incomplete'].includes(value.status as string)) reject('request', field + '.status');
  for (const [key, type] of [['summary', 'summary_text'], ['content', 'reasoning_text']] as const) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key])) reject('request', field + '.' + key);
    for (const item of value[key]) {
      const part = record(item, 'request', field + '.' + key);
      keys(part, ['type', 'text'], 'request', field + '.' + key);
      if (part.type !== type) reject('request', field + '.' + key);
      text(part.text, 'request', field + '.' + key);
    }
  }
}
function inputItem(raw: unknown, index: number) {
  const field = `input[${index}]`, value = record(raw, 'request', field);
  if (value.type === 'reasoning') {reasoningItem(value, field);return;}
  if (value.type === 'function_call') {
    keys(value, ['type', 'call_id', 'name', 'arguments', 'id', 'status'], 'request', field);
    identifier(value.call_id, field + '.call_id');functionName(value.name, field + '.name');
    text(value.arguments, 'request', field + '.arguments');
    try {json(JSON.parse(value.arguments), field + '.arguments');} catch {reject('request', field + '.arguments');}
    if (value.id !== undefined) identifier(value.id, field + '.id');
    if (value.status !== undefined && !['in_progress', 'completed', 'incomplete'].includes(value.status as string)) reject('request', field + '.status');
    return;
  }
  if (value.type === 'function_call_output') {
    keys(value, ['type', 'call_id', 'output'], 'request', field);
    identifier(value.call_id, field + '.call_id');text(value.output, 'request', field + '.output');return;
  }
  keys(value, ['type', 'role', 'content'], 'request', field);
  if (value.type !== undefined && value.type !== 'message' || !['system', 'user', 'assistant'].includes(value.role as string)) reject('request', field);
  if (!Array.isArray(value.content) || !value.content.length) reject('request', field + '.content');
  for (const item of value.content) {
    const part = record(item, 'request', field + '.content');keys(part, ['type', 'text'], 'request', field + '.content');
    if (part.type !== (value.role === 'assistant' ? 'output_text' : 'input_text')) reject('request', field + '.content');
    text(part.text, 'request', field + '.content');
  }
}

/** Normalizes only the declared tier/output ceiling; semantic input JSON is never translated. */
export function normalizeResponsesRequest(value: unknown, policy: ResponsesRequestPolicy): Record<string, unknown> {
  if (policy.model !== RESPONSES_MODEL) reject('request', 'policy.model');
  integer(policy.maxOutputTokens, 'request', 'policy.maxOutputTokens');
  if (policy.maxOutputTokens < 1 || policy.maxOutputTokens > 8192) reject('request', 'policy.maxOutputTokens');
  if (policy.reasoningEffort !== undefined && !efforts.has(policy.reasoningEffort)) reject('request', 'policy.reasoningEffort');
  const body = record(json(value, 'request'), 'request', 'request');
  keys(body, ['model', 'stream', 'store', 'input', 'tools', 'include', 'max_output_tokens', 'reasoning', 'tool_choice', 'service_tier', 'prompt_cache_key', 'prompt_cache_retention'], 'request', 'request');
  if (body.model !== policy.model) reject('request', 'model');
  if (body.stream !== true) reject('request', 'stream');
  if (body.store !== false) reject('request', 'store');
  if (body.service_tier !== undefined && body.service_tier !== 'default') reject('request', 'service_tier');
  integer(body.max_output_tokens, 'request', 'max_output_tokens');
  if (body.max_output_tokens < 1) reject('request', 'max_output_tokens');
  if (!Array.isArray(body.input)) reject('request', 'input');body.input.forEach(inputItem);
  if (!Array.isArray(body.include) || body.include.length !== 1 || body.include[0] !== 'reasoning.encrypted_content') reject('request', 'include');
  if (!Array.isArray(body.tools) || body.tools.length > 128) reject('request', 'tools');
  const names = new Set<string>();
  for (const raw of body.tools) {
    const tool = record(raw, 'request', 'tools');keys(tool, ['type', 'name', 'description', 'parameters', 'strict'], 'request', 'tools');
    if (tool.type !== 'function' || tool.strict !== false) reject('request', 'tools');
    functionName(tool.name, 'tools.name');text(tool.description, 'request', 'tools.description');parameters(tool.parameters, 'tools.parameters');
    if (names.has(tool.name as string)) reject('request', 'tools.name');names.add(tool.name as string);
  }
  if (body.tool_choice !== undefined && body.tool_choice !== 'none') reject('request', 'tool_choice');
  if (body.reasoning !== undefined) {
    const reasoning = record(body.reasoning, 'request', 'reasoning');keys(reasoning, ['effort'], 'request', 'reasoning');
    if (!efforts.has(reasoning.effort as string) || reasoning.effort !== policy.reasoningEffort) reject('request', 'reasoning.effort');
  } else if (policy.reasoningEffort !== undefined) reject('request', 'reasoning.effort');
  if (body.prompt_cache_key !== undefined) identifier(body.prompt_cache_key, 'prompt_cache_key');
  if (body.prompt_cache_retention !== undefined && body.prompt_cache_retention !== 'in_memory') reject('request', 'prompt_cache_retention');
  return {...body, service_tier: 'default', max_output_tokens: Math.min(body.max_output_tokens, policy.maxOutputTokens)};
}

/** Validates only the terminal settlement facts. It never prices or mutates a budget. */
export function parseResponsesTerminal(value: unknown): ResponsesTerminal {
  const event = record(value, 'terminal', 'event');
  if (event.type !== 'response.completed' && event.type !== 'response.incomplete') reject('terminal', 'event.type');
  const kind = event.type === 'response.completed' ? 'completed' : 'incomplete', response = record(event.response, 'terminal', 'response');
  if (response.service_tier !== 'default') reject('pricing', 'response.service_tier');
  if (response.model !== undefined && response.model !== RESPONSES_MODEL) reject('pricing', 'response.model');
  if (response.status !== undefined && response.status !== kind) reject('terminal', 'response.status');
  if (response.id !== undefined) text(response.id, 'terminal', 'response.id', 512, true);
  if (response.error !== undefined && response.error !== null) reject('terminal', 'response.error');
  if (response.tool_usage !== undefined && response.tool_usage !== null) {
    const zero = (value:unknown, fields:Record<string,unknown>) => {
      const data=record(value,'pricing','response.tool_usage');keys(data,Object.keys(fields),'pricing','response.tool_usage');
      for(const [key,item] of Object.entries(data)) {
        if(fields[key]===0) {if(item!==0)reject('pricing','response.tool_usage');}
        else zero(item,fields[key] as Record<string,unknown>);
      }
    };
    zero(response.tool_usage,{
      web_search:{num_requests:0},
      image_gen:{input_tokens:0,output_tokens:0,total_tokens:0,cached_tokens:0,
        input_tokens_details:{image_tokens:0,text_tokens:0},output_tokens_details:{image_tokens:0,text_tokens:0},
        cached_tokens_details:{cached_image_tokens:0,cached_text_tokens:0}},
    });
  }
  if (response.output !== undefined) {
    if (!Array.isArray(response.output) || response.output.some(item => !object(item) || !['message', 'reasoning', 'function_call'].includes(item.type as string))) reject('pricing', 'response.output');
  }
  const usage = record(response.usage, 'usage', 'response.usage');
  keys(usage, ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details'], 'usage', 'response.usage');
  integer(usage.input_tokens, 'usage', 'usage.input_tokens');integer(usage.output_tokens, 'usage', 'usage.output_tokens');
  const total = usage.input_tokens + usage.output_tokens;if (!Number.isSafeInteger(total)) reject('usage', 'usage.total_tokens');
  if (usage.total_tokens !== undefined) {integer(usage.total_tokens, 'usage', 'usage.total_tokens');if (usage.total_tokens !== total) reject('usage', 'usage.total_tokens');}
  let cachedInputTokens = 0, cacheWriteInputTokens = 0;
  if (usage.input_tokens_details !== undefined) {
    const details = record(usage.input_tokens_details, 'usage', 'usage.input_tokens_details');
    keys(details, ['cached_tokens', 'cache_write_tokens', 'cache_write_tokens_details'], 'usage', 'usage.input_tokens_details');
    if (details.cached_tokens !== undefined) {integer(details.cached_tokens, 'usage', 'usage.cached_tokens');cachedInputTokens = details.cached_tokens;}
    if (details.cache_write_tokens !== undefined) {integer(details.cache_write_tokens, 'usage', 'usage.cache_write_tokens');cacheWriteInputTokens = details.cache_write_tokens;}
    if(details.cache_write_tokens_details!==undefined){
      const writes=record(details.cache_write_tokens_details,'usage','usage.cache_write_tokens_details');
      keys(writes,['ttl_12h_tokens','ttl_30m_tokens'],'usage','usage.cache_write_tokens_details');
      let sum=0;for(const count of Object.values(writes)){integer(count,'usage','usage.cache_write_tokens_details');sum+=count;}
      if(details.cache_write_tokens===undefined||!Number.isSafeInteger(sum)||sum!==cacheWriteInputTokens)reject('usage','usage.cache_write_tokens_details');
    }
    if (cachedInputTokens + cacheWriteInputTokens > usage.input_tokens) reject('usage', 'usage.input_tokens_details');
  }
  if (usage.output_tokens_details !== undefined) {
    const details = record(usage.output_tokens_details, 'usage', 'usage.output_tokens_details');keys(details, ['reasoning_tokens'], 'usage', 'usage.output_tokens_details');
    if (details.reasoning_tokens !== undefined) {integer(details.reasoning_tokens, 'usage', 'usage.reasoning_tokens');if (details.reasoning_tokens > usage.output_tokens) reject('usage', 'usage.reasoning_tokens');}
  }
  return {kind, ...(response.id === undefined ? {} : {responseId: response.id as string}), inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens, cachedInputTokens, cacheWriteInputTokens};
}
