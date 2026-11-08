import { spawn } from 'node:child_process';
/** Explicit host process execution; this helper makes no sandbox claim. */
export async function spawnCommand(command: string, cwd: string, env?: Record<string, string>) {
  return spawn('/bin/sh', ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['ignore','pipe','pipe'], detached: true });
}
export function stopProcess(child: ReturnType<typeof spawn>): void {
  try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
  catch { child.kill('SIGKILL'); }
}
