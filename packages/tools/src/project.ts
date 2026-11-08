import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, realpath, readFile, stat } from 'node:fs/promises';
import { resolve, relative, join, dirname, sep } from 'node:path';
const exec = promisify(execFile);
const excluded = /(^|\/)(\.git|node_modules|dist|\.agent-compositor)(\/|$)/;
export async function confinedPath(root: string, value: string, missing = false): Promise<string> {
  const base = await realpath(root), target = resolve(base, value);
  if (target !== base && !target.startsWith(base + sep)) throw new Error('Path escapes project');
  let resolved: string;
  try { resolved = await realpath(target); }
  catch (error) { if (!missing) throw error; resolved = await confinedPath(base, dirname(target), true); }
  if (resolved !== base && !resolved.startsWith(base + sep)) throw new Error('Symlink escapes project');
  return target;
}
export async function projectFiles(root: string, limit = 20000): Promise<string[]> {
  let files: string[];
  try { files = (await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 10000 })).stdout.split('\0').filter(Boolean); }
  catch {
    files = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        const path = join(dir, entry.name).replaceAll('\\', '/');
        if (excluded.test(path) || files.length >= limit) continue;
        if (entry.isDirectory()) await visit(path); else if (entry.isFile()) files.push(path);
      }
    }; await visit('');
  }
  let ignores: RegExp[] = [];
  for (const file of ['.agentignore', '.geminiignore']) {
    const text = await readFile(join(root, file), 'utf8').catch(() => '');
    ignores.push(...text.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(glob));
  }
  return [...new Set(files)].filter(file => !excluded.test(file) && !ignores.some(re => re.test(file))).slice(0, limit).sort();
}
export function glob(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  return new RegExp(`^(?:${source})(?:/.*)?$`);
}
export async function queryProject(raw: unknown): Promise<unknown> {
  const args = raw as { cwd: string; action: 'glob' | 'grep'; pattern: string; path?: string; regex?: boolean; limit?: number };
  const files = (await projectFiles(args.cwd)).filter(file => !args.path || file === args.path || file.startsWith(args.path.replace(/\/$/, '') + '/'));
  const limit = Math.min(args.limit ?? 100, 1000);
  if (!files.length) return args.action === "glob" ? { files: [] } : { matches: [], truncated: false };
  if (args.action === 'glob') return { files: files.filter(file => glob(args.pattern).test(file)).slice(0, limit) };
  const matches: { path: string; line: number; text: string }[] = [];
  if (args.regex) {
    // ripgrep supplies bounded execution for user-provided regular expressions.
    try {
      const result = await exec('rg', ['--json', '--max-count', String(limit), '-e', args.pattern, '--', ...files], { cwd: args.cwd, maxBuffer: 2 * 1024 * 1024, timeout: 10000 });
      for (const line of result.stdout.split('\n')) {
        if (!line) continue; const record = JSON.parse(line);
        if (record.type === 'match') matches.push({ path: record.data.path.text, line: record.data.line_number, text: record.data.lines.text.slice(0, 2000) });
        if (matches.length >= limit) break;
      }
    } catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
  } else for (const file of files) {
    if (matches.length >= limit) break;
    const path = await confinedPath(args.cwd, file);
    if ((await stat(path)).size > 1024 * 1024) continue;
    const text = await readFile(path, 'utf8'); if (text.includes('\0')) continue;
    for (const [index, line] of text.split('\n').entries()) {
      if (line.includes(args.pattern)) matches.push({ path: file, line: index + 1, text: line.slice(0, 2000) });
      if (matches.length >= limit) break;
    }
  }
  return { matches, truncated: matches.length >= limit };
}
