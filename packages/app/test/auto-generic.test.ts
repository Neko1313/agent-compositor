import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import review from '../../../plugins/auto-approve/hooks.js';
import { ScriptedProvider } from '@agent-compositor/core';
import {buildAppWithPlugins as buildApp} from './plugin-fixture.js';
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
    [true, 'medium', 'allow'], [false, 'high', 'deny'], [null, 'unknown', 'ask'],
    [true, 'high', 'ask'], [true, 'unknown', 'ask'],
])('interprets structured approval=%s risk=%s as %s', async (approved, risk, decision) => {
    const f=await fixture({}, {approved,risk,reason:'Concrete action evaluated against the user task'});
    const result=await review['service.permission.review']({tool:'project_check',input:{action:'run',name:'test'},context:{task:'Run the configured project test script'}},f.$);
    expect(result).toMatchObject({value:{decision,risk}});
    if(decision==='allow')expect(result).toMatchObject({value:{policy:'task-context'}});
});
it.each([
    {approved:'yes',risk:'low',reason:'bad type'},
    {approved:true,risk:'low',reason:'',extra:'data'},
    {approved:true,risk:'low',reason:'mixed formats',decision:'allow'},
])('keeps invalid structured approval manual: %j',async answer=>{
    const f=await fixture({},answer);
    expect(await review['service.permission.review']({tool:'project_check',context:{task:'Run tests'}},f.$)).toMatchObject({value:{decision:'ask',risk:'unknown'}});
});
it('does not widen a medium-risk approval when there is no user task context',async()=>{
    const f=await fixture({}, {approved:true,risk:'medium',reason:'No task supplied'});
    expect(await review['service.permission.review']({tool:'project_check'},f.$)).toMatchObject({value:{decision:'ask'}});
});
it.each([[true,'medium',1,0],[false,'high',0,0],[null,'unknown',0,1]] as const)('uses the actual auto hook for approval=%s risk=%s',async(approved,risk,effects,questions)=>{
    const cwd=await temp();let executed=0,asked=0;
    const provider=new ScriptedProvider([
        {toolCalls:[{name:'ci_check',args:{script:'test'}}]},
        {text:JSON.stringify({approved,risk,reason:'Evaluated the configured project check against the task'})},
        {text:'Check outcome reported'},
    ]);
    const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins')]});
    app.plugins.push({manifest:{name:'ci-fixture',version:'1.0.0',trust:'trusted'},hooks:{},tools:[{
        name:'ci_check',description:'Run one configured project test script',parameters:{type:'object',properties:{script:{type:'string'}},required:['script']},
        describe:()=>({tool:'ci_check'}),execute:async()=>{executed++;return{ok:true,data:'CI check completed'};},
    }]} as any);
    const core=app.createCore(async()=>{asked++;return false;});
    try{
        await core.submit('/auto on');await core.submit('Run the configured project test script');
        expect(executed).toBe(effects);expect(asked).toBe(questions);
        expect(JSON.parse(provider.requests[1].messages[1].content)).toMatchObject({tool:'ci_check',input:{script:'test'},context:{task:'Run the configured project test script'}});
        if(approved===false)expect(core.getMessages().find(message=>message.role==='tool')?.content).toContain('denied by automatic review');
    }finally{await app.close();}
});
it('drops a late refusal after auto is disabled while saving its audit',async()=>{
    const f=await fixture({}, {approved:false,risk:'high',reason:'Refused'});
    f.$.fs.write=async()=>{f.state.set('enabled',false);};
    expect(await review['service.permission.review']({tool:'ci_check',context:{task:'Run tests'}},f.$)).toMatchObject({value:{decision:'ask',risk:'unknown'}});
});
it('removes task-policy metadata when the approval audit fails',async()=>{
    const f=await fixture({}, {approved:true,risk:'medium',reason:'Requested test run'});f.failAudit();
    const result=await review['service.permission.review']({tool:'ci_check',context:{task:'Run tests'}},f.$);
    expect(result).toMatchObject({value:{decision:'ask',risk:'unknown'}});
    expect(result?.value).not.toHaveProperty('policy');expect(f.state.get('history').at(-1)).not.toHaveProperty('policy');
});
it('runs /auto off immediately during a pending structured refusal and restores manual control',async()=>{
    const cwd=await temp();let asked=0,executed=0;
    const provider=new ScriptedProvider([{toolCalls:[{name:'ci_check',args:{}}]},
        {text:JSON.stringify({approved:false,risk:'high',reason:'Late refusal'}),hold:true},{text:'Outcome reported'}]);
    const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins')]});
    app.plugins.push({manifest:{name:'ci-fixture',version:'1.0.0',trust:'trusted'},hooks:{},tools:[{name:'ci_check',description:'Run configured tests',parameters:{type:'object'},describe:()=>({tool:'ci_check'}),execute:async()=>{executed++;return{ok:true,data:'checked'};}}]} as any);
    const core=app.createCore(async()=>{asked++;return false;});
    try{
        await core.submit('/auto on');const main=core.submit('Run configured tests');
        await expect.poll(()=>provider.requests.length).toBe(2);await core.submit('/auto off');
        expect(core.getState()).toBe('running');expect(provider.requests).toHaveLength(2);
        provider.release();await main;expect(asked).toBe(1);expect(executed).toBe(0);
        expect(core.getMessages().filter(message=>message.role==='user').map(message=>message.content)).toEqual(['Run configured tests']);
    }finally{provider.release();await app.close();}
});
it('reviews with the active provider when no dedicated reviewer profile was configured', async () => {
    const f = await fixture({profile: undefined});
    expect(await review['service.permission.review']({tool: 'project_check', input: {action: 'run', name: 'test'}, context: {task: 'Run the project tests'}}, f.$))
        .toMatchObject({value: allowed});
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].profile).toBeUndefined();
    expect(JSON.parse(f.calls[0].messages[1].content)).toMatchObject({tool: 'project_check', context: {task: 'Run the project tests'}});
});
it.each(['', '   ', 42])('does not silently switch providers for an invalid explicit reviewer profile %s', async profile => {
    const f = await fixture({profile});
    expect(await review['service.permission.review']({tool: 'project_check', input: {action: 'run', name: 'test'}}, f.$))
        .toMatchObject({value: {decision: 'ask', risk: 'unknown'}});
    expect(f.calls).toHaveLength(0);
});
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
it.each([[false, true], [true, true], [false, false], [true, false]])('routes actual plugin tool calls through auto review and preserves deny=%s, dedicated=%s', async (deny, dedicated) => {
    const cwd = await temp();
    await mkdir(join(cwd, '.agent-compositor'));
    if (dedicated) await writeFile(join(cwd, '.agent-compositor/auto.json'), JSON.stringify({ profile: 'reviewer' }));
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
        const reviews = provider.requests.filter(r => r.messages[0]?.content.includes('You assess one proposed tool action'));
        expect(reviews).toHaveLength(deny ? 0 : 1);
        if (!deny) {
            expect(reviews[0].profile).toBe(dedicated ? 'reviewer' : undefined);
            expect(JSON.parse(reviews[0].messages[1].content)).toMatchObject({ description: 'Inspect local plugin status without changes', context: { task: 'Inspect local plugin status' } });
        }
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
