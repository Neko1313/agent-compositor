import type { ModelCapabilities } from '@agent-compositor/core';
import type { ProviderProfile } from './router.js';
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 256 && Number(n) <= 10000000;
/** Limits are scoped to endpoint+model, never inferred from usage/billing totals. */
export async function discoverCapabilities(profile: ProviderProfile, signal: AbortSignal): Promise<ModelCapabilities> {
    if (positive(profile.contextWindow))
        return { contextWindow: profile.contextWindow, maxOutputTokens: profile.maxOutputTokens, source: 'configured' };
    const fallback: ModelCapabilities = { contextWindow: 32768, maxOutputTokens: profile.maxOutputTokens, source: 'fallback' };
    const base = new URL(profile.baseUrl), fetcher = profile.fetch ?? fetch;
    // Native metadata requires an explicit provider hint; arbitrary compatible gateways
    // must not receive Ollama-specific requests or speculative credentials.
    if (profile.metadataProvider !== 'ollama' && profile.type !== 'gemini' && !profile.metadataUrl)
        return fallback;
    const headers: Record<string, string> = { Accept: 'application/json', ...profile.headers };
    if (profile.apiKey)
        headers[profile.type === 'gemini' ? 'x-goog-api-key' : 'Authorization'] = profile.type === 'gemini' ? profile.apiKey : `Bearer ${profile.apiKey}`;
    const request = async (url: URL, init: RequestInit = {}) => {
        if (url.origin !== base.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw Error('Invalid metadata endpoint');
        const response = await fetcher(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
        if (!response.ok) {
            await response.body?.cancel();
            throw Error('Metadata unavailable');
        }
        const reader = response.body?.getReader();
        let text = '';
        if (reader) {
            try {
                while (true) {
                    const v = await reader.read();
                    if (v.done)
                        break;
                    text += new TextDecoder().decode(v.value);
                    if (text.length > 1000000)
                        throw Error('Metadata too large');
                }
            }
            finally {
                await reader.cancel().catch(() => { });
                reader.releaseLock();
            }
        }
        return JSON.parse(text);
    };
    try {
        let data: any;
        if (profile.metadataProvider === 'ollama') {
            data = await request(new URL('/api/show', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: profile.model }) });
            const info = data.model_info ?? {};
            let window = Object.entries(info).find(([k, v]) => k.endsWith('.context_length') && positive(v))?.[1];
            const configured = String(data.parameters ?? '').match(/(?:^|\n)num_ctx\s+(\d+)/)?.[1];
            if (configured && positive(Number(configured)))
                window = Number(configured);
            // A currently loaded model can have a lower configured runtime window.
            const running = await request(new URL('/api/ps', base)).catch(() => null);
            const current = running?.models?.find((m: any) => m.name === profile.model || m.model === profile.model)?.context_length;
            if (positive(current))
                window = current;
            return positive(window) ? { contextWindow: window, maxOutputTokens: profile.maxOutputTokens, source: 'provider' } : fallback;
        }
        const url = profile.metadataUrl ? new URL(profile.metadataUrl, base) : new URL(profile.baseUrl.replace(/\/$/, '') + '/models/' + encodeURIComponent(profile.model.replace(/^models\//, '')));
        data = await request(url);
        const window = data.inputTokenLimit ?? data.context_window ?? data.context_length ?? data.max_input_tokens;
        const output = data.outputTokenLimit ?? data.max_output_tokens;
        return positive(window) ? { contextWindow: window, maxOutputTokens: profile.maxOutputTokens ?? (positive(output) ? output : undefined), source: 'provider' } : fallback;
    }
    catch {
        signal.throwIfAborted();
        return fallback;
    }
}
