import {describe, expect, it, vi} from 'vitest';
import {NativeProvider} from '../../packages/provider/src/native.js';
import type {CompletionRequest, ProviderEvent} from '../../packages/core/src/provider.js';
import {normalizeResponsesRequest, parseResponsesTerminal, RESPONSES_MODEL, ResponsesContractError, type ResponsesRequestPolicy} from './responses-contract.js';

const policy: ResponsesRequestPolicy = {model: RESPONSES_MODEL, maxOutputTokens: 16};
const body = () => ({model: RESPONSES_MODEL, stream: true, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: 64,
  input: [{role: 'system', content: [{type: 'input_text', text: 'Instructions'}]}, {role: 'user', content: [{type: 'input_text', text: 'Inspect a.ts'}]}],
  tools: [{type: 'function', name: 'read', description: 'Read a local file', parameters: {type: 'object', properties: {path: {type: 'string'}}}, strict: false}]});
const terminal = (kind: 'completed' | 'incomplete' = 'completed') => ({type: 'response.' + kind, response: {id: 'resp_fixture', status: kind, model: RESPONSES_MODEL, service_tier: 'default',
  usage: {input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: {cached_tokens: 3, cache_write_tokens: 2}, output_tokens_details: {reasoning_tokens: 2}}}});
function error(run: () => unknown, code: string, field?: string) {
  let result: unknown;try {run();} catch (failure) {result = failure;}
  expect(result).toBeInstanceOf(ResponsesContractError);expect(result).toMatchObject({code, ...(field ? {field} : {})});return result as ResponsesContractError;
}

describe('pure Responses request contract', () => {
  it('pins the exact model, Standard tier and output ceiling without mutating semantic input', () => {
    const original = {...body(), prompt_cache_key: 'project-cache', prompt_cache_retention: 'in_memory', tool_choice: 'none'};
    const normalized = normalizeResponsesRequest(original, policy);
    expect(normalized).toEqual({...original, service_tier: 'default', max_output_tokens: 16});
    expect(original.max_output_tokens).toBe(64);expect(original).not.toHaveProperty('service_tier');
    expect(normalized.input).not.toBe(original.input);expect(normalized.tools).not.toBe(original.tools);
    expect(normalizeResponsesRequest({...body(), max_output_tokens: 8, service_tier: 'default'}, policy).max_output_tokens).toBe(8);
    expect(normalizeResponsesRequest({...body(), tools: []}, policy).tools).toEqual([]);
  });

  it('preserves function strings, call IDs and opaque returned reasoning semantic JSON exactly', () => {
    const reasoning = {type: 'reasoning', id: 'rs_opaque', encrypted_content: 'opaque+/=\u0000ciphertext', status: null,
      summary: [{type: 'summary_text', text: 'summary'}], content: [{type: 'reasoning_text', text: 'retained'}]};
    const input = [reasoning, {type: 'function_call', id: 'fc_item', call_id: 'call_unchanged', name: 'read', arguments: ' { "path" : "a.ts" } ', status: 'completed'},
      {type: 'function_call_output', call_id: 'call_unchanged', output: '{"literal_url":"https://example.invalid/is-text"}'}];
    const normalized = normalizeResponsesRequest({...body(), input}, policy);
    expect(normalized.input).toEqual(input);expect((normalized.input as unknown[])[0]).not.toBe(reasoning);
  });

  it('validates only the declared profile reasoning effort and safe in-memory caching', () => {
    expect(normalizeResponsesRequest({...body(), reasoning: {effort: 'high'}}, {...policy, reasoningEffort: 'high'}).reasoning).toEqual({effort: 'high'});
    error(() => normalizeResponsesRequest({...body(), reasoning: {effort: 'high'}}, policy), 'request', 'reasoning.effort');
    error(() => normalizeResponsesRequest(body(), {...policy, reasoningEffort: 'high'}), 'request', 'reasoning.effort');
    error(() => normalizeResponsesRequest({...body(), reasoning: {effort: 'max'}}, {...policy, reasoningEffort: 'high'}), 'request', 'reasoning.effort');
    error(() => normalizeResponsesRequest(body(), {...policy, model: 'another-model'}), 'request', 'policy.model');
    error(() => normalizeResponsesRequest(body(), {...policy, maxOutputTokens: 0}), 'request', 'policy.maxOutputTokens');
  });

  it.each(['model', 'stream', 'store', 'input', 'tools', 'include', 'max_output_tokens'])('rejects a missing required Native field %s', key => {
    const value: Record<string, unknown> = body();delete value[key];error(() => normalizeResponsesRequest(value, policy), 'request');
  });
  it.each([null, [], '', {}, {...body(), stream: false}, {...body(), store: true}, {...body(), max_output_tokens: 0}, {...body(), max_output_tokens: 1.5}, {...body(), model: 'gpt-6-astra'}])('rejects malformed or out-of-policy requests %#', value => {
    error(() => normalizeResponsesRequest(value, policy), 'request');
  });
  it.each([
    {previous_response_id: 'resp_PRIVATE'}, {conversation: 'conv_PRIVATE'}, {background: true}, {instructions: 'PRIVATE'},
    {service_tier: 'auto'}, {service_tier: 'priority'}, {service_tier: 'flex'}, {service_tier: 'fast'}, {service_tier: 'ultrafast'},
    {prompt_cache_retention: '24h'}, {prompt_cache_options: {mode: 'explicit', ttl: '12h'}}, {truncation: 'auto'}, {metadata: {private: 'PRIVATE'}},
    {parallel_tool_calls: true}, {tool_choice: {type: 'web_search'}}, {include: ['web_search_call.results']}, {text: {format: {type: 'json_object'}}},
  ])('rejects unknown or billable/stateful controls without echoing private values %#', extra => {
    const failure = error(() => normalizeResponsesRequest({...body(), ...extra}, policy), 'request');
    expect(failure.message).not.toMatch(/PRIVATE|resp_|conv_|web_search|12h/);
  });
  it.each([
    {input: [{role: 'user', content: [{type: 'input_image', image_url: 'https://PRIVATE.invalid/image'}]}]},
    {input: [{role: 'user', content: [{type: 'input_file', file_id: 'file_PRIVATE'}]}]},
    {input: [{type: 'item_reference', id: 'rs_PRIVATE'}]},
    {input: [{type: 'reasoning', id: 'rs_PRIVATE'}]},
    {input: [{role: 'system', content: [{type: 'input_text', text: 'hello', prompt_cache_breakpoint: {mode: 'explicit'}}]}]},
    {tools: [{type: 'web_search'}]}, {tools: [{type: 'file_search', vector_store_ids: ['vs_PRIVATE']}]},
    {tools: [{type: 'mcp', server_url: 'https://PRIVATE.invalid'}]},
    {tools: [{...body().tools[0], strict: true}]},
    {tools: [{...body().tools[0], parameters: {$ref: 'https://PRIVATE.invalid/schema'}}]},
    {input: [{type: 'function_call', call_id: 'c', name: 'read', arguments: 'not JSON'}]},
    {input: [{type: 'function_call_output', call_id: 'c', output: [{type: 'input_image', image_url: 'https://PRIVATE.invalid'}]}]},
  ])('rejects unsupported resources, tools and malformed function data %#', extra => {
    const failure = error(() => normalizeResponsesRequest({...body(), ...extra}, policy), 'request');expect(failure.message).not.toContain('PRIVATE');
  });
  it('rejects non-JSON data and accessors without evaluating them', () => {
    const getter = vi.fn(() => 'PRIVATE'), value = body();Object.defineProperty(value, 'private', {enumerable: true, get: getter});
    error(() => normalizeResponsesRequest(value, policy), 'request');expect(getter).not.toHaveBeenCalled();
    for (const item of [undefined, Infinity, new Date(), 1n]) error(() => normalizeResponsesRequest({...body(), input: [item]}, policy), 'request');
    const cycle: Record<string, unknown> = {};cycle.self = cycle;error(() => normalizeResponsesRequest({...body(), extra: cycle}, policy), 'request');
  });
});

describe('pure Responses terminal settlement facts', () => {
  it.each(['completed', 'incomplete'] as const)('returns validated %s usage without settling any authority', kind => {
    expect(parseResponsesTerminal(terminal(kind))).toEqual({kind, responseId: 'resp_fixture', inputTokens: 10, outputTokens: 4, cachedInputTokens: 3, cacheWriteInputTokens: 2});
  });
  it('accepts omitted optional response identity/status and cache details in existing provider fixtures', () => {
    expect(parseResponsesTerminal({type: 'response.completed', response: {service_tier: 'default', usage: {input_tokens: 0, output_tokens: 0}}}))
      .toEqual({kind: 'completed', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0});
  });
  it.each([undefined, null, 'auto', 'priority', 'flex', 'ultrafast', 'PRIVATE_TIER'])('returns a distinct pricing error for unconfirmed actual tier %#', service_tier => {
    const value = terminal();(value.response as Record<string, unknown>).service_tier = service_tier;
    const failure = error(() => parseResponsesTerminal(value), 'pricing', 'response.service_tier');expect(failure.message).not.toContain('PRIVATE_TIER');
  });
  it.each([
    undefined, null, {}, {input_tokens: 1}, {input_tokens: -1, output_tokens: 1}, {input_tokens: 1.5, output_tokens: 1},
    {input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 1}, {input_tokens: 1, output_tokens: NaN},
    {input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1}, {input_tokens: 10, output_tokens: 1, total_tokens: 99},
    {input_tokens: 10, output_tokens: 1, input_tokens_details: {cached_tokens: 11}},
    {input_tokens: 10, output_tokens: 1, input_tokens_details: {cached_tokens: 8, cache_write_tokens: 3}},
    {input_tokens: 10, output_tokens: 1, input_tokens_details: {cached_tokens: -1}},
    {input_tokens: 10, output_tokens: 1, input_tokens_details: {unknown: 1}},
    {input_tokens: 10, output_tokens: 1, output_tokens_details: {reasoning_tokens: 2}},
  ])('keeps missing/malformed/inconsistent usage distinct from a pricing fault %#', usage => {
    error(() => parseResponsesTerminal({type: 'response.completed', response: {service_tier: 'default', usage}}), 'usage');
  });
  it('accepts known zero hosted-tool counters and rejects unknown or charged counters', () => {
    for(const tool_usage of [null,{}, {web_search:{num_requests:0},image_gen:{input_tokens:0,output_tokens:0,total_tokens:0}}])
      expect(parseResponsesTerminal({type:'response.completed',response:{...terminal().response,tool_usage}}).kind).toBe('completed');
    for(const tool_usage of [{web_search:{num_requests:1}},{web_search:{num_requests:-1}},{image_gen:{input_tokens_details:{image_tokens:1}}},{unknown:0},{image_gen:{unknown:0}},{web_search:null}])
      error(()=>parseResponsesTerminal({type:'response.completed',response:{...terminal().response,tool_usage}}),'pricing');
  });
  it('validates cache write lifetime subtotals against the reported total',()=>{
    const response=terminal().response;
    const withDetails=(details:unknown)=>({type:'response.completed',response:{...response,usage:{...response.usage,input_tokens_details:details}}});
    expect(parseResponsesTerminal(withDetails({cache_write_tokens:0,cache_write_tokens_details:{ttl_12h_tokens:0,ttl_30m_tokens:0}})).cacheWriteInputTokens).toBe(0);
    for(const details of [{cache_write_tokens:0,cache_write_tokens_details:{ttl_12h_tokens:1}},{cache_write_tokens:0,cache_write_tokens_details:{unknown:0}},{cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:-1}}])
      error(()=>parseResponsesTerminal(withDetails(details)),'usage');
  });
  it('rejects mismatched terminal status and unknown charged output categories', () => {
    error(() => parseResponsesTerminal({type: 'response.completed', response: {...terminal().response, status: 'incomplete'}}), 'terminal');
    error(() => parseResponsesTerminal({type: 'response.failed', response: terminal().response}), 'terminal');
    error(() => parseResponsesTerminal({type: 'response.completed', response: {...terminal().response, model: 'another-model'}}), 'pricing');
    error(() => parseResponsesTerminal({type: 'response.completed', response: {...terminal().response, tool_usage: {image_gen: {output_tokens: 1}}}}), 'pricing');
    error(() => parseResponsesTerminal({type: 'response.completed', response: {...terminal().response, output: [{type: 'web_search_call'}]}}), 'pricing');
  });
});

it('round-trips actual NativeProvider serialized reasoning and function continuations with zero HTTP', async () => {
  const returnedReasoning = {type: 'reasoning', id: 'rs_from_actual_output', summary: [], content: [{type: 'reasoning_text', text: 'opaque continuation'}], status: 'completed', encrypted_content: 'ciphertext+/=UNCHANGED'};
  const returnedCall = {type: 'function_call', call_id: 'call_from_actual_output', name: 'read', arguments: '{"path":"a.ts"}'};
  const captures: Record<string, unknown>[] = [], fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    expect(String(url)).toBe('https://responses-contract.invalid/v1/responses');captures.push(JSON.parse(String(init?.body)));
    const events = captures.length === 1 ? [{type: 'response.output_item.done', item: returnedReasoning}, {type: 'response.output_item.done', item: returnedCall}, terminal()]
      : [{type: 'response.output_text.delta', delta: 'Done'}, terminal()];
    return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {headers: {'content-type': 'text/event-stream'}});
  });
  const provider = new NativeProvider({type: 'openai-responses', baseUrl: 'https://responses-contract.invalid/v1', apiKey: 'SYNTHETIC_CONTRACT_KEY', model: RESPONSES_MODEL, reasoningEffort: 'high', retries: 0, fetch});
  const initial: CompletionRequest = {messages: [{role: 'system', content: 'Instructions'}, {role: 'user', content: 'Read a.ts'}],
    tools: [{name: 'read', description: 'Read local file', parameters: {type: 'object', properties: {path: {type: 'string'}}}}], signal: new AbortController().signal, maxOutputTokens: 64};
  const events: ProviderEvent[] = [];for await (const event of provider.complete(initial)) events.push(event);
  const metadata = events.find(event => event.type === 'metadata'), call = events.find(event => event.type === 'tool_call');
  expect(metadata?.type).toBe('metadata');expect(call?.type).toBe('tool_call');if (metadata?.type !== 'metadata' || call?.type !== 'tool_call') throw Error('Actual provider continuation missing');
  const continuation: CompletionRequest = {...initial, toolChoice: 'none', messages: [...initial.messages,
    {role: 'assistant', content: '', metadata: metadata.data, toolCalls: [{id: call.id, name: call.name, args: call.args}]},
    {role: 'tool', content: 'ACTUAL_CALLER_RESULT', toolCallId: call.id}]};
  for await (const event of provider.complete(continuation)) expect(event.type).toMatch(/text_delta|usage|finish/);
  expect(fetch).toHaveBeenCalledTimes(2);
  const normalized = captures.map(value => normalizeResponsesRequest(value, {...policy, reasoningEffort: 'high'}));
  expect(normalized[0]).toMatchObject({model: RESPONSES_MODEL, store: false, stream: true, service_tier: 'default', max_output_tokens: 16, reasoning: {effort: 'high'}});
  expect(normalized[1].input).toEqual(captures[1].input);
  expect((normalized[1].input as unknown[]).slice(-3)).toEqual([returnedReasoning, returnedCall, {type: 'function_call_output', call_id: returnedCall.call_id, output: 'ACTUAL_CALLER_RESULT'}]);
  expect(normalized[1].tool_choice).toBe('none');expect(normalized[1].tools).toEqual(captures[1].tools);
});
