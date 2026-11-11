import type { ToolContext, ToolSpec } from '@agent-compositor/tools';
import { resolve, dirname } from 'node:path';
import { DEFAULTS, limits } from './settings.js';

type Args = { action: 'list' } | { action: 'run'; name: string };
function validName(name: string): boolean {
  return name.length > 0 && name.length <= 48 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name);
}
function validate(value: unknown): Args {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('project_check expects an object.');
  const a = value as Record<string, unknown>;
  if (a.action !== 'list' && a.action !== 'run') throw new Error('action must be list or run.');
  if (Object.keys(a).some(k => k !== 'action' && !(a.action === 'run' && k === 'name')))
    throw new Error('Only action and (for run) name are supported.');
  if (a.action === 'list') return { action: 'list' };
  if (typeof a.name !== 'string' || !validName(a.name)) throw new Error('Script name must be nonempty, at most 48 characters, without control characters.');
  return { action: 'run', name: a.name };
}
async function scripts(ctx: ToolContext): Promise<Record<string, string>> {
  const path = resolve(ctx.cwd, 'package.json');
  if (!ctx.resolvePath) throw new Error('Host filesystem path resolution is unavailable.');
  const resolved = await ctx.resolvePath(path);
  // Do not follow a package.json symlink outside the selected project.
  if (dirname(resolved) !== resolve(ctx.cwd)) throw new Error('package.json must be confined to ctx.cwd.');
  const text = await ctx.request<unknown>('service.fs.read', { plugin: 'project-checks', path: resolved });
  if (typeof text !== 'string') throw new Error('package.json read returned invalid content.');
  const pkg: unknown = JSON.parse(text);
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must be an object.');
  const map = (pkg as Record<string, unknown>).scripts;
  if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some(v => typeof v !== 'string'))
    throw new Error('package.json scripts must be a string map.');
  for (const name of Object.keys(map)) if (!validName(name)) throw new Error(`Unsupported script name: ${JSON.stringify(name).slice(0, 100)}.`);
  return map as Record<string, string>;
}
const tool: ToolSpec<unknown, unknown> = {
  name: 'project_check',
  description: 'List local package.json scripts or run one exact script with npm run -- name (including npm pre/post hooks). Runs may mutate project code. Never installs dependencies.',
  usage: {
    when: 'Discover available npm checks, then run an exact existing script name. Scripts execute trusted project code, including pre/post hooks.',
    avoid: 'Never invent script names or install dependencies. Listing previews and execution output may be truncated.',
    examples: [{ purpose: 'Discover local checks', args: { action: 'list' } }, { purpose: 'Run the existing test script', args: { action: 'run', name: 'test' } }],
  },
  parameters: {
    type: 'object', properties: { action: { type: 'string', enum: ['list', 'run'] }, name: { type: 'string', minLength: 1, maxLength: 48 } },
    required: ['action'], additionalProperties: false,
  },
  describe(input) {
    const a = validate(input);
    return a.action === 'list' ? { tool: 'project_check', readOnly: true }
      : { tool: 'project_check', readOnly: false, command: ['npm', 'run', '--', a.name] };
  },
  async execute(ctx, input) {
    let bound = DEFAULTS.maxChars;
    try {
      ctx.signal.throwIfAborted();
      const a = validate(input);
      if (!ctx.settings) throw new Error('Scoped settings unavailable.');
      const config = limits(await ctx.settings('project-checks.json'));
      bound = config.maxChars;
      const map = await scripts(ctx);
      ctx.signal.throwIfAborted();
      if (a.action === 'list') {
        const entries = Object.entries(map);
        const previews: { name: string; command: string }[] = [];
        let remaining = bound, truncated = entries.length > 128;
        for (const [name, command] of entries.slice(0, 128)) {
          if (name.length > remaining) { truncated = true; break; }
          remaining -= name.length;
          const preview = command.slice(0, remaining);
          previews.push({ name, command: preview });
          remaining -= preview.length;
          if (preview.length !== command.length) truncated = true;
        }
        return { ok: true, data: { scripts: previews, truncated } };
      }
      if (!Object.prototype.hasOwnProperty.call(map, a.name)) throw new Error(`Unknown package script: ${a.name}.`);
      // The SDK owns cancellation and process reaping. Always await its settlement.
      const result = await ctx.request<unknown>('service.exec.run', {
        plugin: 'project-checks', cmd: 'npm', args: ['run', '--', a.name], timeoutMs: config.timeoutMs,
      });
      ctx.signal.throwIfAborted();
      if (!result || typeof result !== 'object') throw new Error('Execution returned no result.');
      const r = result as { stdout?: unknown; stderr?: unknown; exitCode?: unknown; truncated?: unknown };
      if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string' || typeof r.exitCode !== 'number')
        throw new Error(`Invalid execution result: ${JSON.stringify(result).slice(0, bound)}`);
      if (r.exitCode !== 0) throw new Error(`npm run -- ${a.name} failed (exit ${r.exitCode}):\n${r.stderr}\n${r.stdout}`);
      const stdout = r.stdout.slice(0, bound);
      const stderr = r.stderr.slice(0, bound - stdout.length);
      return { ok: true, data: { name: a.name, stdout, stderr, exitCode: 0, truncated: r.truncated === true || r.stdout.length + r.stderr.length > bound } };
    } catch (error) {
      return { ok: false, error: (ctx.signal.aborted ? 'Project check cancelled.' : `Project checks: ${error instanceof Error ? error.message : String(error)}`).slice(0, bound) };
    }
  },
};
export default [tool];
