import {expect, it} from 'vitest';
import {NativeProvider, OpenAICompatProvider} from '../src/index.js';
import type {CompletionRequest} from '@agent-compositor/core';

for (const type of ['openai-compat', 'openai-responses', 'anthropic', 'gemini'] as const) {
 for (const withTools of [false, true]) {
  it.each([undefined, 'none'] as const)(`${type} serializes choice %s with tools=${withTools}`, async toolChoice => {
   let body: Record<string, unknown> | undefined;
   const fetch: typeof globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const event = type === 'anthropic' ? {type: 'message_stop'}
     : type === 'gemini' ? {candidates: [{content: {parts: [{text: 'Summary'}]}, finishReason: 'STOP'}]}
     : type === 'openai-responses' ? {type: 'response.completed', response: {status: 'completed'}}
     : {choices: [{delta: {content: 'Summary'}, finish_reason: 'stop'}]};
    return new Response(`data: ${JSON.stringify(event)}\n\n`, {headers: {'content-type': 'text/event-stream'}});
   };
   const config = {baseUrl: 'http://provider.invalid/v1', apiKey: '', model: 'fixture', fetch, retries: 0};
   const provider = type === 'openai-compat' ? new OpenAICompatProvider(config)
    : new NativeProvider({...config, type});
   const request: CompletionRequest = {
    signal: new AbortController().signal,
    messages: [{role: 'user', content: 'Summarize only'}], toolChoice,
    tools: withTools ? [{name: 'exec', description: 'Execute', parameters: {type: 'object'}}] : [],
   };
   const events = [];
   for await (const event of provider.complete(request)) events.push(event);
   expect(events.at(-1)).toMatchObject({type: 'finish', reason: 'stop'});
   expect(body).toBeDefined();
   if (type === 'gemini') {
    expect(body?.toolConfig).toEqual(toolChoice ? {functionCallingConfig: {mode: 'NONE'}} : undefined);
    expect(body).not.toHaveProperty('tool_choice');
   } else {
    expect(body?.tool_choice).toEqual(toolChoice ? type === 'anthropic' ? {type: 'none'} : 'none' : undefined);
    expect(body).not.toHaveProperty('toolConfig');
   }
  });
 }
}
