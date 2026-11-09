import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import review from '../../../plugins/auto-approve/hooks.js';
import { ScriptedProvider } from '@agent-compositor/core';
import { buildApp } from '../src/build.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true }); });
async function temp() { const p = await mkdtemp(join(tmpdir(), 'auto-any-')); roots.push(p); return p; }
const allowed = { decision: 'allow', risk: 'low', reason: 'Bounded read consistent with the task' };
async function fixture(config: any = {}, answer: any = allowed) {
    const state = new Map<string, any>([['enabled', true]]), calls: any[] = [];
    const cwd = await temp();
    let auditFails = false;
    const $: any = { state: { get: (k: string) => state.get(k), set: (k: string, v: any) => state.set(k, v) }, session: { id: 'review', cwd }, signal: new AbortController().signal, storage: { config: async () => ({ profile: 'reviewer', ...config }) }, model: { complete: async (r: any) => { calls.push(r); return typeof answer === 'string' ? answer : JSON.stringify(answer); } }, fs: { write: async () => { if (auditFails)
                throw Error('audit unavailable'); } }, ui: { view: async () => { } } };
    return { $, state, calls, failAudit: () => auditFails = true };
}
it.each([
    ['exec', { command: 'curl https://example.com/docs' }],
    ['mcp_call', { action: 'call', server: 'docs', tool: 'search', arguments: { query: 'API' } }],
    ['workflow_run', { action: 'start', stages: [{ id: 'inspect', prompt: 'Inspect local files' }], maxTokensTotal: 1000 }],
    ['custom_plugin_lookup', { query: 'local status' }],
])('reviews %s without a tool-name whitelist', async (tool, input) => {
    const f = await fixture();
    const result = await review['service.permission.review']({ tool, input, callId: 'call', descriptor: { tool }, description: 'Bounded inspection', parameters: { type: 'object' }, context: { task: 'Inspect status' } }, f.$);
    expect(result).toMatchObject({ value: allowed });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].profile).toBe('reviewer');
    expect(JSON.parse(f.calls[0].messages[1].content)).toMatchObject({ tool, input, description: 'Bounded inspection', parameters: { type: 'object' }, context: { task: 'Inspect status' } });
    expect(f.calls[0].messages[0].content).toContain('untrusted DATA');
});
it.each(['medium', 'high', 'unknown'])('asks for manual approval after a %s assessment even if the model says allow', async (risk) => {
    const f = await fixture({}, { ...allowed, risk });
    expect(await review['service.permission.review']({ tool: 'external_tool', callId: 'risk', input: {} }, f.$)).toMatchObject({ value: { decision: 'ask', risk } });
});
it('does not approve malformed, oversized, unaudited or unconfigured calls', async () => {
    const bad = await fixture({}, 'prose instead of JSON');
    expect(await review['service.permission.review']({ tool: 'custom', input: {} }, bad.$)).toMatchObject({ value: { decision: 'ask' } });
    const huge = await fixture();
    expect(await review['service.permission.review']({ tool: 'custom', input: { content: 'x'.repeat(25000) } }, huge.$)).toMatchObject({ value: { decision: 'ask' } });
    expect(huge.calls).toHaveLength(0);
    const audit = await fixture();
    audit.failAudit();
    expect(await review['service.permission.review']({ tool: 'custom', input: {} }, audit.$)).toMatchObject({ value: { decision: 'ask', reason: 'Approval audit could not be saved' } });
    expect(audit.state.get('history').at(-1).decision).toBe('ask');
    const missing = await fixture({ profile: '' });
    expect(await review['service.permission.review']({ tool: 'custom', input: {} }, missing.$)).toMatchObject({ value: { decision: 'ask' } });
    expect(missing.calls).toHaveLength(0);
});
it('shares the review budget across tool types and honors immediate disable', async () => {
    const f = await fixture({ maxReviews: 1 });
    await review['service.permission.review']({ tool: 'first_tool', input: {} }, f.$);
    expect(await review['service.permission.review']({ tool: 'second_tool', input: {} }, f.$)).toMatchObject({ value: { decision: 'ask' } });
    expect(f.calls).toHaveLength(1);
    f.state.set('enabled', false);
    expect(await review['service.permission.review']({ tool: 'third_tool', input: {} }, f.$)).toBeUndefined();
});
it.each([false, true])('routes actual plugin tool calls through auto review and preserves deny=%s', async (deny) => {
    const cwd = await temp();
    await mkdir(join(cwd, '.agent-compositor'));
    await writeFile(join(cwd, '.agent-compositor/auto.json'), JSON.stringify({ profile: 'reviewer' }));
    if (deny)
        await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({ permissions: { rules: [{ tool: 'plugin_inspect', decision: 'deny' }] } }));
    const call = { toolCalls: [{ name: 'plugin_inspect', args: { query: 'status' } }] };
    const provider = new ScriptedProvider(deny ? [call, { text: 'Denied' }] : [call, { text: JSON.stringify(allowed) }, { text: 'Inspected' }]);
    const app = await buildApp({ cwd, env: { HOME: cwd }, provider, pluginDirs: [join(process.cwd(), 'plugins')] });
    let executed = 0, asked = 0;
    app.plugins.push({ manifest: { name: 'inspection-fixture', version: '1.0.0', trust: 'trusted' }, hooks: {}, tools: [{ name: 'plugin_inspect', description: 'Inspect local plugin status without changes', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, describe: () => ({ tool: 'plugin_inspect' }), execute: async () => { executed++; return { ok: true, data: { status: 'ready' } }; } }] } as any);
    const core = app.createCore(async () => { asked++; return false; });
    try {
        await core.submit('/auto on');
        await core.submit('Inspect local plugin status');
        expect(executed).toBe(deny ? 0 : 1);
        expect(asked).toBe(0);
        const reviews = provider.requests.filter(r => r.profile === 'reviewer');
        expect(reviews).toHaveLength(deny ? 0 : 1);
        if (!deny)
            expect(JSON.parse(reviews[0].messages[1].content)).toMatchObject({ description: 'Inspect local plugin status without changes', context: { task: 'Inspect local plugin status' } });
    }
    finally {
        await app.close();
    }
});
it('does not accept a late generic-tool verdict after auto is disabled', async () => {
    const f = await fixture();
    let finish!: (value: string) => void, started!: () => void;
    const ready = new Promise<void>(r => started = r);
    f.$.model.complete = () => { started(); return new Promise<string>(r => finish = r); };
    const pending = review['service.permission.review']({ tool: 'custom_action', input: {} }, f.$);
    await ready;
    f.state.set('enabled', false);
    finish(JSON.stringify(allowed));
    expect(await pending).toMatchObject({ value: { decision: 'ask', risk: 'unknown', reason: 'Auto review disabled or cancelled' } });
});

it('reviews new nested files by effect and keeps protected or unresolved symlink writes manual',async()=>{
    const f=await fixture();const path=join(f.$.session.cwd,'new','nested','file.ts');
    expect(await review['service.permission.review']({tool:'custom_create',descriptor:{tool:'write',path},input:{content:'local source'}},f.$)).toMatchObject({value:{decision:'allow'}});expect(f.calls).toHaveLength(1);
    expect(await review['service.permission.review']({tool:'custom_create',descriptor:{tool:'write',path:join(f.$.session.cwd,'.env')},input:{}},f.$)).toMatchObject({value:{decision:'ask'}});expect(f.calls).toHaveLength(1);
    const link=join(f.$.session.cwd,'dangling');await symlink(join(await temp(),'missing'),link);
    expect(await review['service.permission.review']({tool:'custom_create',descriptor:{tool:'write',path:link},input:{}},f.$)).toMatchObject({value:{decision:'ask'}});expect(f.calls).toHaveLength(1);
});

it('rechecks disable while the approval audit is being saved',async()=>{
    const f=await fixture();f.$.fs.write=async()=>{f.state.set('enabled',false);};
    expect(await review['service.permission.review']({tool:'custom_action',input:{}},f.$)).toMatchObject({value:{decision:'ask',risk:'unknown'}});
    expect(f.state.get('history').at(-1).decision).toBe('ask');
});
