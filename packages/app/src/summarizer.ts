import { summarizeChunks, type Summarizer } from '@agent-compositor/context';
import type { CompletionRequest, ProviderEvent } from '@agent-compositor/core';
/** Bind auxiliary calls to the owning agent's profile and budget. */
export function createSummarizer(stream: (request: CompletionRequest) => AsyncIterable<ProviderEvent>, window: () => number): Summarizer {
    return async (messages, { signal }) => summarizeChunks(messages, async (segment) => {
        let text = '';
        for await (const event of stream({ signal, tools: [], maxOutputTokens: Math.min(2048, Math.floor(window() / 8)), messages: [
                { role: 'system', content: 'Summarize this agent conversation. Preserve user requirements, decisions, file paths, tool outcomes and unfinished work.' },
                { role: 'user', content: segment },
            ] })) {
            if (event.type === 'text_delta')
                text += event.text;
            if (event.type === 'finish' && event.reason !== 'stop')
                throw Error(event.error ?? 'Summary did not complete');
        }
        return text;
    }, Math.min(8192, Math.floor(window() / 2)));
}
