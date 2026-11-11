import type { ToolContext, ToolSpec } from '@agent-compositor/tools';

const DEFAULT_MAX_CHARS = 16000;
const TIMEOUT_MS = 8000;
type ReviewData = { output: string; exitCode: 0; truncated: boolean };

function validateArgs(value: unknown): { action: 'status' | 'diff'; staged: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('git_review expects an object with action "status" or "diff".');
  const args = value as Record<string, unknown>;
  if (args.action !== 'status' && args.action !== 'diff')
    throw new Error('git_review action must be exactly "status" or "diff".');
  if (args.staged !== undefined && typeof args.staged !== 'boolean')
    throw new Error('git_review staged must be a boolean (default false; used only for diff).');
  if (Object.keys(args).some(key => key !== 'action' && key !== 'staged'))
    throw new Error('git_review accepts only action and staged; command and path arguments are not supported.');
  return { action: args.action, staged: args.staged === true };
}

function maxChars(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('git-review.json must be a settings object with maxChars an integer from 4000 to 64000.');
  const value = (settings as Record<string, unknown>).maxChars;
  if (value === undefined) return DEFAULT_MAX_CHARS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 4000 || value > 64000)
    throw new Error('git-review.json maxChars must be an integer from 4000 to 64000 (default 16000).');
  return value;
}

// The execution service owns cancellation and waits for process cleanup. Do not
// race it with an early rejection that would report cancellation before cleanup.
async function cancellable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const value = await run();
  signal.throwIfAborted();
  return value;
}

const tool: ToolSpec<unknown, ReviewData> = {
  name: 'git_review',
  description: 'Read Git working-tree status or staged/unstaged diff in the selected project. No writes, staging, commits, fetches or arbitrary commands/paths.',
  usage: {
    when:'Review actual Git status and separate staged or working changes before editing or committing.',
    avoid:'Output can be truncated. This tool cannot stage, commit, fetch or execute arbitrary commands. Use the panel to configure its output bound.',
    examples:[{purpose:'Inspect working-tree status',args:{action:'status'}},{purpose:'Review staged changes',args:{action:'diff',staged:true}}],
  },
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'diff'] },
      staged: { type: 'boolean', default: false, description: 'Only for diff: true reviews the index; false reviews working-tree changes.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  describe: () => ({ tool: 'git_review', readOnly: true }),
  async execute(ctx: ToolContext, input: unknown) {
    let limit = DEFAULT_MAX_CHARS;
    try {
      ctx.signal.throwIfAborted();
      const args = validateArgs(input);
      if (!ctx.settings) throw new Error('Scoped settings are unavailable; cannot read git-review.json.');
      limit = maxChars(await cancellable(ctx.signal, () => ctx.settings!('git-review.json')));
      const gitArgs = [
        '--no-pager', '--no-optional-locks',
        '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
        '-c', 'color.ui=false',
        ...(args.action === 'status'
          ? ['status', '--porcelain=v1', '--branch', '--untracked-files=normal', '--ignore-submodules=all']
          : ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all', ...(args.staged ? ['--cached'] : [])]),
      ];
      const result = await cancellable(ctx.signal, () => ctx.request<unknown>('service.exec.run', {
        plugin: 'git-review', cmd: 'git', args: gitArgs, timeoutMs: TIMEOUT_MS,
      }));
      ctx.signal.throwIfAborted();
      if (!result || typeof result !== 'object') throw new Error('Git execution service returned no result.');
      const exec = result as { exitCode?: unknown; stdout?: unknown; stderr?: unknown };
      if (typeof exec.exitCode !== 'number' || typeof exec.stdout !== 'string' || typeof exec.stderr !== 'string')
        throw new Error('Git execution service returned an invalid result.');
      if (exec.exitCode !== 0)
        throw new Error(`Git ${args.action} failed (exit ${exec.exitCode}): ${exec.stderr.trim() || exec.stdout.trim() || 'no diagnostic; check Git availability, repository, timeout and service permissions'}`);
      return { ok: true, data: { output: exec.stdout.slice(0, limit), exitCode: 0, truncated: exec.stdout.length > limit } };
    } catch (error) {
      const message = ctx.signal.aborted ? 'Git review cancelled.' : `Git review: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, error: message.slice(0, limit) };
    }
  },
};

export default [tool];
