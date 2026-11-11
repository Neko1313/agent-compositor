import { summarizeChunks, type Summarizer } from '@agent-compositor/context';
import type { CompletionRequest, ProviderEvent } from '@agent-compositor/core';
/** Bind auxiliary calls to the owning agent's profile and budget. */
export function createSummarizer(stream: (request: CompletionRequest) => AsyncIterable<ProviderEvent>, window: () => number): Summarizer {
    return async (messages, { signal }) => summarizeChunks(messages, async (segment) => {
        const ceiling = Math.min(8192, Math.floor(window() / 4));
        let outputLimit = Math.min(2048, Math.floor(window() / 8));
        for (;;) {
            signal.throwIfAborted();
            let text = '', finish: Extract<ProviderEvent,{type:'finish'}> | undefined;
            for await (const event of stream({ signal, tools: [], maxOutputTokens: outputLimit, messages: [
                    { role: 'system', content: 'Summarize this agent conversation. Preserve user requirements, decisions, file paths, tool outcomes and unfinished work.' },
                    { role: 'user', content: segment },
                ] })) {
                if (event.type === 'text_delta')
                    text += event.text;
                if (event.type === 'finish') finish = event;
            }
            signal.throwIfAborted();
            if (finish?.reason === 'stop') return text;
            // Reasoning can consume a small output allowance before producing a
            // complete summary. Retry only this segment, with bounded extra space.
            if (finish?.reason === 'length' && outputLimit < ceiling) {
                outputLimit = Math.min(ceiling, outputLimit * 2);
                continue;
            }
            throw Error(finish?.error ?? (finish?.reason === 'length'
                ? 'Summary reached its output limit after bounded retries'
                : 'Summary stream did not complete'));
        }
    }, Math.min(8192, Math.floor(window() / 2)));
}
