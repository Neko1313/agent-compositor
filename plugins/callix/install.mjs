// Explicit installation only. Loading the plugin never downloads or executes installers.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '1.7.0';
// Digests published on the official v1.7.0 GitHub release.
const platforms = {
  'linux-x64': ['linux-x86_64', '38eb61f0afc5e64a247f94a14e575c7b86864e83e52b10dc9b0d4bb67374cdf4'],
  'linux-arm64': ['linux-aarch64', '9ce04ae75f29bab1c824a5b4dbc07491f7c4b8cdaefaab468b706f4131cf1a8e'],
  'darwin-arm64': ['macos-aarch64', '9db0a1ff3766b5a625fa1e67d97ca05a59e3184750318be7f43b5bf27c6e2118'],
  'darwin-x64': ['macos-x86_64', 'e56c100f163590770cc7a921b4bcbbeaf90c914f03035bc38cd16363af6b0bc0'],
};
const platform = platforms[`${process.platform}-${process.arch}`];
if (!platform) throw new Error('No supported Callix release for this platform; install manually and set CALLIX_BIN.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--archive')) throw new Error('Usage: node install.mjs [--archive /path/to/release.tar.gz]');
const temp = await mkdtemp(join(tmpdir(), 'callix-install-'));
try {
  const name = `callix-${version}-${platform[0]}.tar.gz`;
  let bytes;
  if (args[0] === '--archive') bytes = await readFile(args[1]);
  else {
    const response = await fetch(`https://github.com/Callix-Tools/callix/releases/download/v${version}/${name}`, { signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== platform[1]) throw new Error('Callix archive checksum mismatch; refusing installation.');
  const archive = join(temp, name); await writeFile(archive, bytes);
  const exec = promisify(execFile);
  const { stdout: listing } = await exec('tar', ['-tzf', archive], { timeout: 10000 });
  const entries = listing.trim().split('\n').filter(path => /(^|\/)callix$/.test(path));
  if (entries.length !== 1) throw new Error('Unexpected Callix archive layout');
  const { stdout: binary } = await exec('tar', ['-xOzf', archive, '--', entries[0]], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 10000 });
  const dir = fileURLToPath(new URL('./bin/', import.meta.url)); await mkdir(dir, { recursive: true });
  const staged = join(dir, `callix-${process.pid}.tmp`); await writeFile(staged, binary, { mode: 0o755 });
  await rename(staged, join(dir, 'callix'));
  console.log(`Installed verified Callix ${version}: ${join(dir, 'callix')}`);
} finally { await rm(temp, { recursive: true, force: true }); }
