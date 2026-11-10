import { realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

export async function contained(root: string, path: string) {
  const base = await realpath(root), file = await realpath(resolve(root, path));
  const rel = relative(base, file);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw Error('Plugin path escapes root');
  return file;
}
