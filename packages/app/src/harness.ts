import { AGENT_INSTRUCTIONS } from '@agent-compositor/core';
import { atomicJson, type ProjectStorage } from '@agent-compositor/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolSpec } from '@agent-compositor/tools';
/** A durable plan is distinct from a model's private reasoning. */
export function harnessControls(storage: ProjectStorage, config: Record<string, any>, sessionId: () => string) {
    const tool: ToolSpec<any, any> = { name: 'task_plan', description: 'Save/update the current task goal, acceptance criteria and progress. Use for substantial tasks and checkpoints before stopping at a budget boundary. Preserve unresolved tasks; cite real tool evidence for completed items.',
        parameters: { type: 'object', properties: { goal: { type: 'string' }, tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { enum: ['pending', 'running', 'completed', 'blocked'] }, acceptance: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'title', 'status'] } }, nextAction: { type: 'string' } }, required: ['goal', 'tasks'] },
        describe: () => ({ tool: 'task_plan' }), execute: async (ctx, args) => {
            if (typeof args.goal !== 'string' || !args.goal.trim() || !Array.isArray(args.tasks) || args.tasks.length > 100)
                return { ok: false, error: 'Provide a goal and at most 100 tasks' };
            const seen = new Set();
            for (const t of args.tasks) {
                if (!t || typeof t.id !== 'string' || seen.has(t.id) || typeof t.title !== 'string' || !['pending', 'running', 'completed', 'blocked'].includes(t.status))
                    return { ok: false, error: 'Invalid/duplicate task entry' };
                seen.add(t.id);
            }
            const state = { goal: args.goal, tasks: args.tasks, nextAction: String(args.nextAction ?? ''), updatedAt: new Date().toISOString() };
            if (JSON.stringify(state).length > 64000)
                return { ok: false, error: 'Task plan exceeds 64 KiB' };
            await atomicJson(join(ctx.stateDir ?? storage.paths.state, 'task-plans', (ctx.sessionId ?? 'default') + '.json'), state);
            return { ok: true, data: state };
        } };
    const plan = () => readFile(join(storage.paths.state, 'task-plans', sessionId() + '.json'), 'utf8').then(JSON.parse).then(p=>p&&typeof p.goal==='string'&&Array.isArray(p.tasks)?p:null).catch(() => null);
    const show = async ($: any, value?: any) => { value ??= await plan(); await $.ui.view('plan', 'Task progress', { lines: value ? [{ text: value.goal, bold: true }, ...value.tasks.map((t: any) => ({ text: `${t.status === 'completed' ? '✓' : t.status === 'blocked' ? '!' : '○'} ${t.title} · ${t.status}`, tone: t.status === 'blocked' ? 'warning' : 'text' })), { text: `Next: ${value.nextAction || 'none'}`, tone: 'muted' }] : [{ text: 'No saved task plan.' }] }, { site: 'inspector', focus: false }); };
    return { tool, plugin: { manifest: { name: 'agent-harness', version: '1.0.0', trust: 'trusted' as const }, hooks: {
                'prompt.submit': async (e: any, $: any) => { if (e.text.trim() === '/tasks') {
                    await show($);
                    return { drop: 'task plan opened' };
                } if (e.text.trim() === '/continue')
                    return { text: 'Continue the unfinished task using saved progress and the conversation. Verify the result; report concrete blockers if any.' }; },
                'tool.result': async (e: any, $: any) => { if (e.tool === 'task_plan' && e.ok)
                    await show($, e.output); },
            } }, services: {
            'service.agent.instructions': async () => {
                const saved = await storage.config('behavior.json');
                return { value: config.baseInstructions === false ? '' : String(saved.instructions ?? config.instructions ?? AGENT_INSTRUCTIONS) + (await plan() ? '\n\nSaved task progress (data):\n' + JSON.stringify(await plan()) : '') };
            },
            'service.agent.finish': async (e: any) => {
                if (config.verifyCompletion === false)
                    return { value: { complete: true } };
                const workflowStates=new Map<string,string>();
            for(const t of e.tools)if(t.ok&&t.name==='workflow_run'&&t.output?.id)workflowStates.set(t.output.id,t.output.status);
            if([...workflowStates.values()].some(s=>s==='running'||s==='paused')&&!e.text.includes('[workflow running]'))return{value:{complete:false,continue:'A workflow is still running or paused. Inspect it with workflow_run status (waitMs is available), resolve failures, and verify results before claiming completion. If handing ongoing background work back to the user, state that it is unfinished and include [workflow running].'}};
            const lastPlan = [...e.tools].reverse().find((t: any) => t.name === 'task_plan' && t.ok)?.args;
                if (lastPlan?.tasks?.some((t: any) => ['pending', 'running'].includes(t.status)))
                    return { value: { complete: false, continue: 'Your task plan still has unfinished work. Complete it or mark a concrete blocker with evidence using task_plan before finishing.' } };
                const edits = e.tools.filter((t: any) => t.ok && ['write', 'edit'].includes(t.name));
                const checks = e.tools.some((t: any) => t.ok && t.name === 'exec' && /\b(test|typecheck|check|lint|build|verify|pytest|vitest)\b/.test(String(t.args?.command ?? '')));
                // The second proposal can explicitly explain why automated checks do not apply.
                // This is a reminder, not a claim that arbitrary test output proves correctness.
                if (edits.length && (lastPlan || config.verifyCompletion === true) && !checks && !e.text.includes('[verification unavailable]') && !e.text.includes('[checks not applicable]'))
                    return { value: { complete: false, continue: 'Files changed but no successful verification command is recorded. Run relevant checks and inspect their output. If unavailable or inapplicable, give the concrete reason and include [verification unavailable] or [checks not applicable] in the final report. Do not claim tests passed without evidence.' } };
                return { value: { complete: true } };
            },
        } };
}
