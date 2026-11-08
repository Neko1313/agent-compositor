import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
export async function editDraft(draft: string, suspend: (callback: () => Promise<void>) => Promise<void>, env = process.env): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compositor-editor-')), file = join(dir, 'prompt.md');
  try {
    await writeFile(file, draft, { mode: 0o600 });
    await suspend(() => new Promise<void>((resolve, reject) => {
      // EDITOR is a user-owned shell command; the draft path is a separate argv.
      const editor = env.VISUAL ?? env.EDITOR ?? 'vi';
      const child = spawn('/bin/sh', ['-c', `${editor} "$1"`, 'editor', file], { stdio: 'inherit', env });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Editor exited ${code}`)));
    }));
    return await readFile(file, 'utf8');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
