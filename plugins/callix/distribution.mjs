// Pinned native dependency shared by explicit setup and release builds.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CALLIX_VERSION = '1.7.0';
const platforms = Object.freeze({
  'linux-x64': ['linux-x86_64', '38eb61f0afc5e64a247f94a14e575c7b86864e83e52b10dc9b0d4bb67374cdf4'],
  'linux-arm64': ['linux-aarch64', '9ce04ae75f29bab1c824a5b4dbc07491f7c4b8cdaefaab468b706f4131cf1a8e'],
  'darwin-arm64': ['macos-aarch64', '9db0a1ff3766b5a625fa1e67d97ca05a59e3184750318be7f43b5bf27c6e2118'],
  'darwin-x64': ['macos-x86_64', 'e56c100f163590770cc7a921b4bcbbeaf90c914f03035bc38cd16363af6b0bc0'],
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);

export function callixRelease(platform = `${process.platform}-${process.arch}`) {
  const target = Object.hasOwn(platforms, platform) ? platforms[platform] : undefined;
  if (!target) throw new Error(`No supported Callix release for ${platform}; install manually and set CALLIX_BIN.`);
  const archive = `callix-${CALLIX_VERSION}-${target[0]}.tar.gz`;
  return { version: CALLIX_VERSION, platform, archive, archiveSha256: target[1], source: `https://github.com/Callix-Tools/callix/releases/download/v${CALLIX_VERSION}/${archive}` };
}

/** Installs only verified upstream bytes; never copies a developer's local bin/. */
export async function installCallix({ destination, archivePath, platform } = {}) {
  if (!destination) throw new Error('Callix destination is required');
  const release = callixRelease(platform);
  let bytes;
  if (archivePath) bytes = await readFile(archivePath);
  else {
    const response = await fetch(release.source, { signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Callix download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (sha256(bytes) !== release.archiveSha256) throw new Error('Callix archive checksum mismatch; refusing installation.');
  const temp = await mkdtemp(join(tmpdir(), 'callix-install-'));
  let staged;
  try {
    const archive = join(temp, release.archive);
    await writeFile(archive, bytes);
    const { stdout } = await exec('tar', ['-tzf', archive], { timeout: 30000 });
    const entries = stdout.trim().split('\n');
    const base = release.archive.slice(0, -'.tar.gz'.length);
    for (const required of [`${base}/callix`, `${base}/LICENSE`]) {
      if (entries.filter(entry => entry === required).length !== 1) throw new Error(`Unexpected Callix archive layout: missing or duplicate ${required}`);
    }
    // Stream the two known files. Archive paths are never extracted onto disk.
    const extract = async file => (await exec('tar', ['-xOzf', archive, '--', `${base}/${file}`], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 30000 })).stdout;
    const binary = await extract('callix');
    const license = await extract('LICENSE');
    if (!binary.length || !license.toString('utf8').includes('MIT License')) throw new Error('Invalid Callix binary or license');
    const metadata = { ...release, binarySha256: sha256(binary), licenseSha256: sha256(license), license: 'MIT' };
    const bin = join(destination, 'bin');
    await mkdir(bin, { recursive: true });
    staged = await mkdtemp(join(bin, '.install-'));
    await writeFile(join(staged, 'callix'), binary, { mode: 0o755 });
    await writeFile(join(staged, 'LICENSE'), license);
    await writeFile(join(staged, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
    for (const name of ['LICENSE', 'release.json', 'callix']) await rename(join(staged, name), join(bin, name));
    return metadata;
  } finally {
    if (staged) await rm(staged, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
}
