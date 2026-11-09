import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine } from '../../../plugins/workflows/engine.js';
import { discoverCapabilities, ProviderRouter } from '@agent-compositor/provider';
import { AgentCore, ScriptedProvider, AGENT_INSTRUCTIONS } from '@agent-compositor/core';
import { TokenBudget, compactTranscript, summarizeChunks } from '@agent-compositor/context';
import { buildApp } from '../src/build.js';
const roots: string[] = [];
afterEach(async () => { for (const d of roots.splice(0))
    await rm(d, { recursive: true, force: true }); });
async function temp() { const d = await mkdtemp(join(tmpdir(), 'harness-')); roots.push(d); return d; }
const signal = new AbortController().signal;
describe('effective model context', () => {
    it('resolves explicit, Ollama runtime, native metadata and fallback limits without paid calls', async () => {
        const calls: string[] = [];
        const fetcher = vi.fn(async (url: any) => { calls.push(String(url)); return Response.json(String(url).endsWith('/api/ps') ? { models: [{ name: 'local', context_length: 4096 }] } : { model_info: { 'llama.context_length': 131072 }, parameters: 'num_ctx 8192' }); }) as unknown as typeof fetch;
        const p = { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'local', metadataProvider: 'ollama' as const, fetch: fetcher };
        expect(await discoverCapabilities({ ...p, contextWindow: 16384 }, signal)).toMatchObject({ contextWindow: 16384, source: 'configured' });
        expect(calls).toHaveLength(0);
        expect(await discoverCapabilities(p, signal)).toMatchObject({ contextWindow: 4096, source: 'provider' });
        expect(calls).toHaveLength(2);
        expect(await discoverCapabilities({ ...p, metadataProvider: undefined }, signal)).toMatchObject({ source: 'fallback' });
        expect(await discoverCapabilities({ ...p, type: 'gemini', metadataProvider: undefined, fetch: (async () => Response.json({ inputTokenLimit: 100000, outputTokenLimit: 8192 })) as typeof fetch }, signal)).toMatchObject({ contextWindow: 100000, maxOutputTokens: 8192 });
        expect(await discoverCapabilities({ ...p, fetch: (async () => { throw Error('offline'); }) as typeof fetch }, signal)).toMatchObject({ source: 'fallback' });
        const router = new ProviderRouter({ default: { ...p, contextWindow: 4096 }, large: { ...p, contextWindow: 64000 } });
        expect((await router.capabilities(signal)).contextWindow).toBe(4096);
        router.select('large');
        expect((await router.capabilities(signal)).contextWindow).toBe(64000);
        expect((await router.capabilities(signal, 'default')).contextWindow).toBe(4096);
    });
    it('bounds summary inputs, preserves tool pairs, preserves transcript on failure and rejects larger summaries', async () => {
        const rows: any[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'a'.repeat(3000) }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'b'.repeat(3000) }, { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read', args: {} }] }, { role: 'tool', toolCallId: 't', content: 'value' }, { role: 'user', content: 'continue' }];
        const result = await compactTranscript(rows, async () => 'Goal: fix issue. Next: verify.', { keepTail: 2 });
        expect(result.foldedCount).toBeGreaterThan(0);
        const call = result.messages.findIndex((m: any) => m.toolCalls?.[0]?.id === 't');
        expect(call).toBeGreaterThan(0);
        expect((result.messages[call + 1] as any).toolCallId).toBe('t');
        expect((await compactTranscript(rows, async () => { throw Error('offline'); }, { keepTail: 2 })).messages).toBe(rows);
        expect((await compactTranscript(rows, async () => 'z'.repeat(10000), { keepTail: 2 })).foldedCount).toBe(0);
        const chunks: string[] = [];
        expect(await summarizeChunks(rows, async (text) => { chunks.push(text); return 'short'; }, 1024)).toContain('short');
        expect(chunks.length).toBeGreaterThan(1);
        expect(Math.max(...chunks.map(s => s.length))).toBeLessThan(1000);
    });
    it('compacts despite cooldown at a hard boundary and retries a context overflow only once', async () => {
        const provider = new ScriptedProvider([{ finish: 'error', error: 'context window exceeded' }, { text: 'done' }]);
        const core = new AgentCore({ cwd: await temp(), provider, tools: [], compaction: { budget: new TokenBudget({ contextWindow: 50000 }), summarize: async () => 'preserved goal', cooldownMessages: 8 } });
        const old: any[] = [{ role: 'system', content: 'rules' }, ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'history '.repeat(300) }))];
        // Restore via the public context service, then trigger the overflow recovery path.
        await core.host.emit('service.context.control', { action: 'restore', messages: old });
        await core.submit('continue');
        expect(core.failure).toBeUndefined();
        expect(provider.requests).toHaveLength(2);
        expect(provider.requests[1].messages.some(m => m.content.includes('preserved goal'))).toBe(true);
    });
});
describe('dynamic workflow scheduler', () => {
    it('fans out, joins, branches and records real results/attempts without blocking the caller', async () => {
        const cwd = await temp();
        let active = 0, max = 0, workers = 0;
        let releaseWorkers!: () => void;
        const workerGate = new Promise<void>(resolve => { releaseWorkers = resolve; });
        const calls: string[] = [];
        const engine = new WorkflowEngine({ cwd, request: async (_e, p: any) => { calls.push(p.agentId); expect(p.detached).toBe(true); active++; max = Math.max(max, active); if (p.prompt.startsWith('worker')) { if (++workers === 2) releaseWorkers(); await workerGate; } active--; return { output: p.prompt.startsWith('discover') ? JSON.stringify([{ id: 'a', prompt: 'worker a' }, { id: 'b', prompt: 'worker b' }]) : 'verified', tokens: 12 } as any; } });
        const run = await engine.start({ title: 'Audit', concurrency: 2, stages: [{ id: 'discover', prompt: 'discover', expand: true }, { id: 'join', prompt: 'combine', dependsOn: ['discover'] }, { id: 'skip', prompt: 'never run', dependsOn: ['join'], when: { stage: 'join', includes: 'absent' } }] });
        expect(run.status).toBe('running');
        const done = await engine.wait(run.id);
        expect(done?.status).toBe('completed');
        expect(max).toBe(2);
        expect(done?.stages.find(s => s.id === 'join')?.dependsOn).toEqual(['discover', 'discover-a', 'discover-b']);
        expect(done?.stages.find(s => s.id === 'skip')?.status).toBe('skipped');
        expect(calls).toHaveLength(4);
        const restored = new WorkflowEngine({ cwd, request: async () => { throw Error('must not run'); } });
        await restored.load();
        expect(restored.runs.get(run.id)?.status).toBe('completed');
        expect(restored.runs.get(run.id)?.stages[0].tokens).toBe(12);
        await engine.close();
        await restored.close();
    });
    it('retries a failure without repeating completed dependencies and validates plans', async () => {
        const cwd = await temp(), calls: string[] = [];
        let fail = true;
        const engine = new WorkflowEngine({ cwd, request: async (_e, p: any) => { calls.push(p.agentId); if (p.agentId.endsWith('-b') && fail)
                throw Error('temporary failure'); return { output: 'ok', tokens:12 } as any; } });
        await expect(engine.start({ stages: [{ id: 'a', prompt: 'a', dependsOn: ['b'] }, { id: 'b', prompt: 'b', dependsOn: ['a'] }] })).rejects.toThrow('cycle');
        const run = await engine.start({ stages: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b', dependsOn: ['a'] }] });
        expect((await engine.wait(run.id))?.status).toBe('failed');
        fail = false;
        await engine.control(run.id, 'retry', 'b');
        const done = await engine.wait(run.id);
        expect(done?.status).toBe('completed');
        expect(calls.filter(c => c.endsWith('-a'))).toHaveLength(1);
        expect(done?.stages[1].attempts).toBe(2);
        await engine.close();
    });
    it('pauses scheduling, stops active work and recovers interrupted stages conservatively', async () => {
        const cwd = await temp();
        let release!: () => void;
        const started = vi.fn();
        const engine = new WorkflowEngine({ cwd, request: async (_e, p: any) => { started(); await Promise.race([new Promise<void>(r => { release = r; }), new Promise<void>(r => p.signal.addEventListener('abort', () => r(), { once: true }))]); p.signal.throwIfAborted(); return { output: 'ok', tokens:12 } as any; } });
        const run = await engine.start({ concurrency: 1, stages: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b', dependsOn: ['a'] }] });
        await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
        await engine.control(run.id, 'pause');
        release();
        expect((await engine.wait(run.id))?.status).toBe('paused');
        expect(engine.runs.get(run.id)?.stages[1].status).toBe('pending');
        await engine.control(run.id, 'resume');
        await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2));
        await engine.control(run.id, 'stop');
        expect(engine.runs.get(run.id)?.status).toBe('stopped');
        await engine.close();
        const file = join(cwd, '.agent-compositor', 'workflows', 'runs', run.id + '.json'), saved = JSON.parse(await readFile(file, 'utf8'));
        saved.status = 'running';
        saved.stages[1].status = 'running';
        await writeFile(file, JSON.stringify(saved));
        const restored = new WorkflowEngine({ cwd, request: async () => { throw Error('no automatic replay'); } });
        await restored.load();
        expect(restored.runs.get(run.id)?.status).toBe('paused');
        expect(restored.runs.get(run.id)?.stages[1].status).toBe('pending');
        await restored.close();
    });
});
describe('agent behavior and completion', () => {
    it('injects replaceable behavior and keeps working when a plan is unfinished', async () => {
        const cwd = await temp();
        const provider = new ScriptedProvider([{ toolCalls: [{ name: 'task_plan', args: { goal: 'Investigate', tasks: [{ id: 'a', title: 'Inspect', status: 'pending' }] } }] }, { text: 'finished too early' }, { toolCalls: [{ name: 'task_plan', args: { goal: 'Investigate', tasks: [{ id: 'a', title: 'Inspect', status: 'completed', evidence: 'inspected' }] } }] }, { text: 'done' }]);
        const app = await buildApp({ cwd, env: { HOME: cwd }, provider });
        const core = app.createCore(async () => false);
        await core.submit('Investigate the issue');
        expect(core.failure).toBeUndefined();
        expect(provider.requests).toHaveLength(4);
        expect(provider.requests[0].messages[0].content).toBe(AGENT_INSTRUCTIONS);
        expect(provider.requests[2].messages.some(m => m.content.includes('unfinished work'))).toBe(true);
        expect(JSON.parse(await readFile(join(app.storage.paths.state, 'task-plans', core.sessionId + '.json'), 'utf8')).tasks[0].status).toBe('completed');
        await app.close();
    });
});

describe('harness failure boundaries',()=>{
 it('stops repetitive failures instead of spending the full turn budget',async()=>{
  const provider=new ScriptedProvider(Array.from({length:20},()=>({toolCalls:[{name:'missing_tool',args:{}}]})));
  const core=new AgentCore({cwd:await temp(),provider,tools:[]});await core.submit('do work');expect(provider.requests).toHaveLength(6);expect(core.failure).toContain('Repeated tool failures');expect(core.getMessages().some(m=>m.content.includes('Harness recovery'))).toBe(true);
 });
 it('hard pressure bypasses cooldown and provider plugins replace limits and instructions',async()=>{
  const provider=new ScriptedProvider([{text:'continued'}]);const core=new AgentCore({cwd:await temp(),provider,tools:[],compaction:{budget:new TokenBudget({contextWindow:32768}),cooldownMessages:999,summarize:async()=> 'Preserved goal and next action'}});
  core.host.registerPlugin({name:'custom-harness',version:'1.0.0',trust:'trusted'},{'service.model.capabilities':()=>({value:{contextWindow:4096,source:'provider'}}),'service.agent.instructions':()=>({value:'Custom agent behavior'})});
  await core.host.emit('service.context.control',{action:'restore',messages:Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:'history '.repeat(400)}))});await core.submit('Continue');expect(core.failure).toBeUndefined();expect(core.getContextWindow()).toBe(4096);expect(provider.requests[0].messages[0].content).toBe('Custom agent behavior');expect(provider.requests[0].messages.some(m=>m.content.includes('Preserved goal'))).toBe(true);
 });
 it('failed verification is not counted as a passed check',async()=>{
  const cwd=await temp(),provider=new ScriptedProvider([
   {toolCalls:[{name:'task_plan',args:{goal:'Check changes',tasks:[{id:'fix',title:'Fix',status:'completed',evidence:'edited'}]}}]},
   {toolCalls:[{name:'write',args:{path:'result.txt',content:'result'}}]},
   {toolCalls:[{name:'exec',args:{command:'node --test missing.test.mjs'}}]},
   {text:'Everything passed'},
   {text:'[verification unavailable] The configured test file is missing; verification did not pass.'},
  ]);
  const app=await buildApp({cwd,env:{HOME:cwd},provider});const core=app.createCore(async()=>true);await core.submit('Make and verify the change');expect(core.failure).toBeUndefined();expect(provider.requests).toHaveLength(5);expect(provider.requests[4].messages.some(m=>m.content.includes('no successful verification'))).toBe(true);await app.close();
 });
 it('prevents two schedulers from owning the same run',async()=>{
  const cwd=await temp();const owner=new WorkflowEngine({cwd,request:async(_e,p:any)=>{await new Promise(r=>p.signal.addEventListener('abort',r,{once:true}));throw Error('stopped');}});
  const run=await owner.start({stages:[{id:'a',prompt:'work'}]});await vi.waitFor(()=>expect(owner.runs.get(run.id)?.stages[0].status).toBe('running'));
  const observer=new WorkflowEngine({cwd,request:async()=>{throw Error('duplicate execution');}});await observer.load();await expect(observer.control(run.id,'resume')).rejects.toThrow('owned by a running process');await owner.close();await observer.close();
 });
});

it('clearing a saved context override does not resurrect a legacy limit on restart',async()=>{
 const root=await temp();const {ProjectStorage}=await import('@agent-compositor/config');const storage=new ProjectStorage(root,{HOME:root});await storage.init();
 await writeFile(join(root,'agent-compositor.json'),JSON.stringify({providers:{default:{contextWindow:8192}}}));
 await storage.configure('providers.json',{profiles:{default:{baseUrl:'http://fake-provider.invalid/v1',model:'test',type:'openai-compat',contextWindow:null}}});
 const app=await buildApp({cwd:root,env:{HOME:root,AGENT_BASE_URL:'http://fake-provider.invalid/v1',AGENT_MODEL:'test'}});const core=app.createCore(async()=>false);
 const result:any=await core.host.emit('service.model.capabilities',{});expect(result.value.value).toMatchObject({contextWindow:32768,source:'fallback'});await app.close();
});

it('rebinds workflow UI updates when the application changes its foreground session',async()=>{
 const cwd=await temp(),provider=new ScriptedProvider([{text:'worker result',hold:true}]);
 const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[new URL('../../../plugins/workflows',import.meta.url).pathname]});const first=app.createCore(async()=>false);await first.start();
 const started=await first.invokeTool('workflow_run',{action:'start',title:'Session switch',stages:[{id:'a',prompt:'inspect'}]});expect(started.ok).toBe(true);const id=(started.output as any).id;
 await vi.waitFor(()=>expect(provider.requests).toHaveLength(1));const next=app.createCore(async()=>false),events:any[]=[];next.subscribe(e=>events.push(e));await next.start();provider.release();
 const status=await next.invokeTool('workflow_run',{action:'status',id,waitMs:1000});expect((status.output as any).status).toBe('completed');expect(events.some(e=>e.kind==='catalog'&&e.event==='ui.surface'&&e.input.title==='Workflows'&&e.input.text.includes('Session switch · completed'))).toBe(true);await app.close();
});
