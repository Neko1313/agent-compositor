import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentCore, ScriptedProvider } from '@agent-compositor/core';
import { buildApp } from '../src/build.js';
import { WorkflowEngine } from '../../../plugins/workflows/engine.js';
import cost from '../../../plugins/cost/hooks.js';
import autoReview, { reviewPolicy } from '../../../plugins/auto-approve/hooks.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true }); });
async function temp() { const root = await mkdtemp(join(tmpdir(), 'efficiency-')); roots.push(root); return root; }
const pluginDirs = [join(process.cwd(), 'plugins')];
describe('cost-aware harness', () => {
    it('inherits auto review and its root budget in workflow children, including fenced Anthropic JSON', async () => {
        const cwd = await temp();
        await mkdir(join(cwd, '.agent-compositor'));
        await writeFile(join(cwd, '.agent-compositor/auto.json'), JSON.stringify({ profile: 'small', maxReviews: 1 }));
        const provider = new ScriptedProvider([
            { toolCalls: [{ name: 'task', args: { prompt: 'Create a local file' } }] },
            { toolCalls: [{ name: 'write', args: { path: 'tokens.ts', content: '// token handling uses https://example.com\n' } }] },
            { text: '```json\n{"decision":"allow","risk":"low","reason":"Local reversible source edit"}\n```' },
            { text: 'Created' },
            { text: 'Done' },
            { toolCalls: [{ name: 'write', args: { path: 'another.ts', content: 'local' } }] },
            { text: 'Budget requires manual review' },
        ]);
        const app = await buildApp({ cwd, env: { HOME: cwd }, pluginDirs, provider });
        let asked = 0;
        const core = app.createCore(async () => { asked++; return false; });
        try {
            await core.submit('/auto on');
            await core.submit('Delegate creation');
            expect(await readFile(join(cwd, 'tokens.ts'), 'utf8')).toContain('token');
            expect(asked).toBe(0);
            expect(provider.requests.filter(r => r.profile === 'small')).toHaveLength(1);
            await core.submit('Create another file');
            expect(asked).toBe(1);
            expect(provider.requests.filter(r => r.profile === 'small')).toHaveLength(1);
        }
        finally {
            await app.close();
        }
    });
    it('checks effects instead of code vocabulary, keeping external/sensitive actions manual', () => {
        const cwd = '/project';
        expect(reviewPolicy({ tool: 'edit', input: { path: 'src/token.ts', newText: 'secret token curl https://docs' }, descriptor: { path: '/project/src/token.ts' } }, cwd)).toBeUndefined();
        for (const path of ['/etc/config', '/project/.env', '/project/.git/config', '/project/AGENTS.md'])
            expect(reviewPolicy({ tool: 'write', input: { path } }, cwd)).toMatch(/manual/);
        for (const command of ['git push origin main', 'rm -rf build', 'curl https://example.com'])
            expect(reviewPolicy({ tool: 'exec', input: { command } }, cwd)).toMatch(/manual/);
        expect(reviewPolicy({ tool: 'mcp_call', input: {} }, cwd)).toMatch(/manual/);
    });
    it('reserves input before charging a model request and bounds output by the remaining budget', async () => {
        const cwd = await temp(), provider = new ScriptedProvider([{ text: 'never requested' }]);
        const core = new AgentCore({ cwd, provider, maxTokensPerTurn: 100 });
        await core.submit('work');
        expect(provider.requests).toHaveLength(0);
        expect(core.failure).toContain('estimated request input');
        const bounded = new ScriptedProvider([{ text: 'done' }]), other = new AgentCore({ cwd, provider: bounded, maxTokensPerTurn: 10000 });
        await other.submit('work');
        expect(bounded.requests[0].maxOutputTokens).toBeLessThan(10000);
        expect(bounded.requests[0].tools.map(t => t.name)).toEqual([...bounded.requests[0].tools.map(t => t.name)].sort());
    });
    it('reserves total workflow tokens across parallel stages and charges failed attempts conservatively', async () => {
        const cwd = await temp();
        const allocations: number[] = [];
        let release!: () => void;
        const engine = new WorkflowEngine({ cwd, request: async (_event, args: any) => {
                allocations.push(args.maxTokens);
                if (allocations.length === 1)
                    await new Promise<void>(r => release = r);
                else
                    release();
                return { output: 'done', tokens: args.maxTokens } as any;
            } });
        try {
            const run = await engine.start({ maxTokensTotal: 1000, maxTokensPerStage: 700, concurrency: 2, stages: [{ id: 'a', prompt: 'one' }, { id: 'b', prompt: 'two' }, { id: 'c', prompt: 'three' }] });
            const done = await engine.wait(run.id);
            expect(allocations).toEqual([700, 300]);
            expect(done?.status).toBe('failed');
            expect(done?.tokensCharged).toBe(1000);
            expect(done?.error).toContain('budget exhausted');
        }
        finally {
            await engine.close();
        }
        const failed = new WorkflowEngine({ cwd: await temp(), request: async () => { throw Error('provider disconnected'); } });
        try {
            const run = await failed.start({ maxTokensTotal: 100, maxTokensPerStage: 100, stages: [{ id: 'a', prompt: 'work' }] });
            await failed.wait(run.id);
            await failed.control(run.id, 'retry', 'a');
            const result = await failed.wait(run.id);
            expect(result?.tokensCharged).toBe(100);
            expect(result?.status).toBe('failed');
        }
        finally {
            await failed.close();
        }
    });
    it('prices cache reads and writes separately and marks missing write prices unpriced', async () => {
        const state = new Map<string, any>();
        let prices: any = { default: { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: .2, cacheWriteInputPerMillion: 2.5 } };
        const $: any = { state: { get: (k: string) => state.get(k), set: (k: string, v: any) => state.set(k, v) }, session: { id: 'cost' }, fs: { read: async () => JSON.stringify(prices), write: async () => { } }, ui: { notify: async () => { } } };
        await cost['model.usage']({ inputTokens: 1000, outputTokens: 10, cachedInputTokens: 600, cacheWriteInputTokens: 300 }, $);
        expect(state.get('totals')).toMatchObject({ in: 1000, cached: 600, cacheWrite: 300 });
        expect(state.get('totals').cost).toBeCloseTo(.00117);
        prices = { default: { inputPerMillion: 2, outputPerMillion: 10 } };
        await cost['model.usage']({ inputTokens: 1000, outputTokens: 10, cacheWriteInputTokens: 300 }, $);
        expect(state.get('totals').unpriced).toBe(1);
    });
    it('retrieves plugin-owned guidance on demand without adding examples to repeated declarations', async () => {
        const provider = new ScriptedProvider([{ text: 'done' }]), core = new AgentCore({ cwd: await temp(), provider, extraTools: [{ name: 'custom', description: 'custom action', parameters: { type: 'object' }, usage: { when: 'Only for custom data', examples: [{ purpose: 'Inspect', args: { action: 'inspect' } }] }, describe: () => ({ tool: 'custom' }), execute: async () => ({ ok: true, data: {} }) }] });
        const help = await core.invokeTool('tool_help', { name: 'custom' });
        expect(help).toMatchObject({ ok: true, output: { usage: { when: 'Only for custom data' } } });
        expect(await core.invokeTool('tool_help', { name: 'missing' })).toMatchObject({ ok: false });
        await core.submit('work');
        expect(JSON.stringify(provider.requests[0].tools)).not.toContain('Only for custom data');
    });
});
it('covers every default tool with schema-shaped usage examples', async () => {
    const app = await buildApp({ cwd: await temp(), pluginDirs, provider: new ScriptedProvider([]) });
    try {
        const core = app.createCore(async () => false);
        const index = await core.invokeTool('tool_help', {});
        const validate = (schema: any, value: any) => {
            if (schema.enum)
                expect(schema.enum).toContain(value);
            if (schema.type === 'object') {
                for (const key of schema.required ?? [])
                    expect(value).toHaveProperty(key);
                for (const [key, v] of Object.entries(value)) {
                    expect(schema.properties).toHaveProperty(key);
                    validate(schema.properties[key], v);
                }
            }
            else if (schema.type === 'array') {
                expect(Array.isArray(value)).toBe(true);
                for (const v of value)
                    validate(schema.items, v);
            }
            else if (schema.type === 'integer')
                expect(Number.isInteger(value)).toBe(true);
            else if (schema.type)
                expect(typeof value).toBe(schema.type);
        };
        for (const tool of index.output as any[]) {
            const help = await core.invokeTool('tool_help', { name: tool.name });
            const data = help.output as any;
            expect(data.usage.examples.length, tool.name).toBeGreaterThan(0);
            for (const example of data.usage.examples)
                validate(data.parameters, example.args);
        }
    }
    finally {
        await app.close();
    }
});
it('accounts child usage exactly once in the parent and preserves a stage profile', async () => {
    const provider = new ScriptedProvider([{ text: 'done', usage: { inputTokens: 10, outputTokens: 2 } }]);
    const core = new AgentCore({ cwd: await temp(), provider });
    const usage: any[] = [];
    core.subscribe(e => { if (e.kind === 'catalog' && e.event === 'model.usage')
        usage.push(e.input); });
    await core.host.emit('service.agent.spawn', { prompt: 'Focused task', profile: 'cheap', detached: true });
    expect(provider.requests[0].profile).toBe('cheap');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ profile: 'cheap', inputTokens: 10, outputTokens: 2 });
    expect(core.getBudget().spentTokens).toBe(12);
});
it('uses the child profile for compaction as well as normal workflow requests', async () => {
    const { createSummarizer } = await import('../src/summarizer.js');
    const { TokenBudget } = await import('@agent-compositor/context');
    const pressures: any[] = [];
    const requests: any[] = [];
    let normal = 0;
    const cwd = await temp();
    await writeFile(join(cwd, 'evidence.txt'), 'evidence '.repeat(400));
    await writeFile(join(cwd, 'recent.txt'), 'evidence '.repeat(1600));
    const provider: any = { name: 'fixture', capabilities: async () => ({ contextWindow: 7000, maxOutputTokens: 256, source: 'configured' }), async *complete(request: any) {
            requests.push(request);
            const summary = request.messages[0]?.content.startsWith('Summarize');
            if (!summary)
                normal++;
            if (!summary && normal <= 2) {
                yield { type: 'tool_call', id: 'read-' + normal, name: 'read', args: { path: normal === 1 ? 'evidence.txt' : 'recent.txt' } };
            }
            else
                yield { type: 'text_delta', text: summary ? 'Preserved goal: inspect history.' : 'Completed inspection' };
            yield { type: 'usage', inputTokens: 100, outputTokens: 10 };
            yield { type: 'finish', reason: !summary && normal <= 2 ? 'tool_calls' : 'stop' };
        } };
    const core = new AgentCore({ cwd, provider, plugins: [{ manifest: { name: "pressure-fixture", version: "1.0.0", trust: "trusted" }, hooks: { "context.pressure": (e: any) => { pressures.push(e); } } }], compaction: { budget: new TokenBudget({ contextWindow: 7000 }), cooldownMessages: 0, summarize: async () => { throw Error('Parent summarizer must not handle child context'); }, fork: createSummarizer } });
    const result = await core.host.emit('service.agent.spawn', { prompt: 'Inspect this history: ' + 'evidence '.repeat(500), profile: 'cheap', detached: true, maxTokens: 20000 });
    expect(requests.some(r => r.messages[0]?.content.startsWith('Summarize')), JSON.stringify({ result, pressures })).toBe(true);
    expect(requests.every(r => r.profile === 'cheap')).toBe(true);
    expect(core.getBudget().spentTokens).toBe(requests.length * 110);
});
it('uses the selected stage model on the actual provider wire, without the parent model overriding it', async () => {
    const { ProviderRouter } = await import('@agent-compositor/provider');
    let body: any;
    const fetcher = (async (_url: any, init: any) => { body = JSON.parse(init.body); return new Response('data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"done"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\ndata: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream' } }); }) as typeof fetch;
    const router = new ProviderRouter({ default: { type: 'anthropic', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'expensive-parent', fetch: fetcher }, cheap: { type: 'anthropic', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'cheap-stage', fetch: fetcher } });
    const core = new AgentCore({ cwd: await temp(), provider: router, model: () => router.model });
    await core.host.emit('service.agent.spawn', { prompt: 'Inspect a bounded task', profile: 'cheap', detached: true });
    expect(body.model).toBe('cheap-stage');
    expect(router.model).toBe('expensive-parent');
    expect(core.getBudget().spentTokens).toBe(22);
});
it('audits read-only workflow inspection without a reviewer call or profile', async () => {
    const state = new Map<string, any>([['enabled', true]]);
    let writes = 0;
    const $: any = { state: { get: (k: string) => state.get(k), set: (k: string, v: any) => state.set(k, v) }, session: { id: 'auto', cwd: await temp() }, signal: new AbortController().signal, storage: { config: async () => { throw Error('No model configuration should be read'); } }, fs: { write: async () => { writes++; } }, model: { complete: async () => { throw Error('No model call'); } }, ui: { view: async () => { } } };
    const result = await autoReview['service.permission.review']({ tool: 'workflow_run', callId: 'inspect', input: { action: 'status', id: 'known-run' } }, $);
    expect(result).toMatchObject({ value: { decision: 'allow', risk: 'low' } });
    expect(writes).toBe(1);
    expect(state.get('reviews')).toBeUndefined();
});

it('does not reset the parent session allowance for each new background child', async () => {
    const provider = new ScriptedProvider([{ text: 'first stage', usage: { inputTokens: 9500, outputTokens: 0 } }, { text: 'must not be sent' }]);
    const core = new AgentCore({ cwd: await temp(), provider, maxTokensPerSession: 10000 });
    await core.host.emit('service.agent.spawn', { prompt: 'first bounded stage', detached: true });
    const next = await core.host.emit('service.agent.spawn', { prompt: 'another stage', detached: true });
    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(next)).toContain('budget');
});
