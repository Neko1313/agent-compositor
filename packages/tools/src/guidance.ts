import type { ToolSpec } from './types.js';
export interface ToolUsage {
    when: string;
    avoid?: string;
    examples: {
        purpose: string;
        args: Record<string, unknown>;
    }[];
}
const recipe = (when: string, avoid: string, purpose: string, args: Record<string, unknown>): ToolUsage => ({ when, avoid, examples: [{ purpose, args }] });
/** Retrieved on demand, rather than repeating examples in every model request. */
export const toolUsage: Record<string, ToolUsage> = {
    extension_control: recipe("Manage installed extensions and inspect installation state.", "Installation changes executable code; obtain authorization and reload explicitly.", "List installations", { action: "list" }),
    marketplace_control: recipe("Manage explicit marketplace registrations and updates.", "Do not refresh or install executable plugins as an incidental side effect.", "List registered catalogs", { action: "list" }),
    agent_control: recipe("Manage persistent independent agent sessions and optional worktrees.", "Use task for a short isolated delegation; avoid duplicate work and unbounded agent creation.", "Inspect agent states", { action: "list" }),
    tool_help: recipe("Retrieve only the guidance needed for an unfamiliar tool.", "Do not fetch the whole index repeatedly.", "Inspect one tool", { name: "edit" }),
    glob: recipe('Find paths by filename pattern.', 'Do not read every matching file.', 'Locate tests', { pattern: '**/*.test.ts', limit: 20 }),
    grep: recipe('Find literal content in a known file or narrow directory. Copy returned readArgs into read before editing.', 'Use code_query for semantic callers; page large results.', 'Find a configuration name', { pattern: 'timeoutMs', path: 'src', limit: 20, maxTokens: 1000 }),
    code_query: recipe('Resolve symbol identity, outline, callers, dependencies or impact. read_symbol returns guarded source.', 'For a known-path literal edit, narrow grep/read may cost less. Disambiguate with the returned ID.', 'Read one symbol before editing', { action: 'read_symbol', pattern: 'calculateTotal', path: 'src/total.ts', maxTokens: 1500 }),
    read: recipe('Read a bounded text page; preserve its edit anchor. Follow nextCursor before nextOffset.', 'Do not repeatedly dump large files.', 'Inspect a relevant range', { path: 'src/total.ts', offset: 20, limit: 30 }),
    edit: recipe('Change existing text using a fresh read/read_symbol anchor.', 'Copy editRef verbatim; it supplies path, so do not repeat path or calculate offsets. If no reference is returned, preserve all explicit expectedHash/range/strict fields. Re-read stale snapshots; fix argument errors directly. Exact newText must differ from oldText.', 'Guarded replacement; substitute the actual returned editRef', { oldText: 'a - b', newText: 'a + b', editRef: '<copy editRef verbatim from the read result>' }),
    write: recipe('Create a file or intentionally replace its complete content.', 'Use edit for focused changes; preserve unrelated code.', 'Create a small file', { path: 'notes.txt', content: 'Verified behavior\n' }),
    exec: recipe('Run project tests/builds or commands that need the host shell. cwd is already the project.', 'Prefer search/read tools for navigation. Run independent checks separately: an exact command grant does not authorize extra chained commands or redirection. Never bypass denied actions; bound output and runtime.', 'Execute project checks', { command: 'npm test', timeoutMs: 30000 }),
    exec_output: recipe('Read output from an already started background command.', 'Do not busy-poll or restart the same job.', 'Read a job buffer', { id: '<returned shellId>' }),
    exec_kill: recipe('Stop a specific background job owned by this runtime.', 'Never guess IDs or kill unrelated processes.', 'Stop a known job', { id: '<returned shellId>' }),
    todo: recipe('Maintain a small session task list.', 'For durable acceptance/evidence use task_plan when available.', 'Record progress', { todos: [{ content: 'Inspect failure', status: 'completed' }, { content: 'Verify fix', status: 'pending' }] }),
    task_plan: recipe('Save substantial work goals, acceptance, evidence and next action.', 'A plan is not verification. Keep it aligned with actual tool evidence.', 'Record acceptance and the next action', { goal: 'Fix rounding', tasks: [{ id: 'verify', title: 'Verify rounding cases', status: 'pending', acceptance: 'Project tests pass' }], nextAction: 'Read rounding tests' }),
    task: recipe('Delegate an independent bounded task to a fresh context.', 'Do simple work directly; avoid duplicating exploration across agents.', 'Delegate a focused investigation', { prompt: 'Inspect src/total.ts and its tests; report the rounding contract without editing.' }),
    ask_questions: recipe("Collect related product decisions in one reviewed questionnaire.","Inspect available context first; never fabricate answers or replace permission checks.","Choose implementation preferences",{title:"Implementation choices",questions:[{id:"language",question:"Which language?",options:[{label:"TypeScript",description:"Match the current application",recommended:true},{label:"JavaScript",description:"Use plain JavaScript"}]}]}),
    ask_user: recipe('Resolve missing user intent or essential information.', 'Do not ask for facts available in project files or repeat existing authorization.', 'Resolve a real product choice', { question: 'Should rounding happen per item or after summing?', options: ['Per item', 'After summing'] }),
    skills: recipe('Load relevant project workflow instructions before applying them.', 'Use actual available skill names.', 'Load a listed skill', { name: '<available skill name>' }),
    run_python: recipe('Perform bounded pure computation in the selected Python sandbox.', 'It is not a host shell or repository editor.', 'Calculate a value', { code: 'sum([1, 2, 3])' }),
    workflow: recipe('Execute Python/Monty task orchestration with replay journals.', 'Use workflow_run for a persistent background dependency graph. Do simple tasks directly.', 'Run isolated calculation', { code: 'result = 6 * 7' }),
    workflow_run: recipe('Start or manage durable dependency stages. Set bounded fan-out, concurrency and total tokens; reuse status/results.', 'Do not busy-poll, duplicate tasks or fan out without a clear benefit. Supply concise dependency outputs.', 'Start bounded independent investigation', { action: 'start', maxTokensTotal: 30000, maxTokensPerStage: 15000, concurrency: 1, stages: [{ id: 'inspect', prompt: 'Inspect the failing test and report a precise fix with evidence.' }] }),
    web_fetch: recipe('Read a specific HTTP(S) page as bounded text.', 'Repository facts should come from local tools. Do not send secrets in URLs.', 'Read official documentation', { url: 'https://example.com/docs' }),
    web_search: recipe('Find external information when no exact source URL is known.', 'Prefer authoritative sources; search results alone are not verified evidence.', 'Find API documentation', { query: 'official API prompt caching documentation' }),
    mcp_call: recipe('Call a configured MCP server tool using its actual discovered schema.', 'Never invent tool names; MCP can have external effects and requires permissions.', 'Discover configured tools', { action: 'list' }),
    checkpoint: recipe('Inspect recorded local checkpoints; restoration is an interactive operation.', 'Restoration can overwrite work and does not undo external side effects.', 'List available checkpoints', { action: 'list' }),
};
export function createToolHelp(tools: () => ToolSpec[], preview?: (tool: ToolSpec, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>): ToolSpec {
    return {
        name: 'tool_help',
        loopGuard: 'query',
        description: 'Get on-demand tool usage, pitfalls and argument examples. Specify name for details; omit it for the available tool index. Examples are templates, not executed calls.' + (preview ? ' Optional preview: pass name and preview containing proposed tool arguments to inspect current rules/session approvals without executing or asking for approval. This is not authorization; execution still checks plugins and review.' : ''),
        parameters: { type: 'object', properties: { name: { type: 'string' }, ...(preview ? { preview: { type: 'object', additionalProperties: true, description: 'Proposed arguments for the named tool. Preview rules/session approvals only; never executes the tool or grants authorization.' } } : {}) }, additionalProperties: false },
        describe: () => ({ tool: 'tool_help' }),
        async execute(ctx, args: any) {
            const available = tools();
            const wantsPreview = !!args && Object.hasOwn(args, 'preview');
            if (wantsPreview && (!preview || typeof args.name !== 'string' || !args.name || !args.preview || typeof args.preview !== 'object' || Array.isArray(args.preview)))
                return { ok: false, error: 'Permission preview requires host support, a tool name and an argument object.' };
            if (!args?.name)
                return { ok: true, data: available.map(t => ({ name: t.name, when: (t.usage ?? toolUsage[t.name])?.when ?? t.description })) };
            const tool = available.find(t => t.name === args.name);
            if (!tool)
                return { ok: false, error: 'Unknown or unavailable tool' };
            ctx.signal.throwIfAborted();
            const permission = wantsPreview ? await preview!(tool, args.preview, ctx.signal) : undefined;
            ctx.signal.throwIfAborted();
            return { ok: true, data: { name: tool.name, description: tool.description, usage: tool.usage ?? toolUsage[tool.name] ?? { when: tool.description, examples: [] }, parameters: tool.parameters, ...(wantsPreview ? { permission } : {}) } };
        }
    };
}
