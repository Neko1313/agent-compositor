import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CALLIX_VERSION, callixRelease, installCallix } from '../../../plugins/callix/distribution.mjs';
const roots = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temp() { const root = await mkdtemp(join(tmpdir(), 'callix-distribution-')); roots.push(root); return root; }

describe('Callix release dependency', () => {
  it.each(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])('pins %s to an immutable archive checksum', platform => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const release = callixRelease(platform);
    expect(release.version).toBe(CALLIX_VERSION);
    expect(release.platform).toBe(platform);
    expect(release.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(release.source).toBe(`https://github.com/Callix-Tools/callix/releases/download/v${CALLIX_VERSION}/${release.archive}`);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['win32-x64', 'linux-riscv64', '__proto__'])('rejects unsupported target %s before downloading', async platform => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(installCallix({ destination: '/unused', platform })).rejects.toThrow(/No supported Callix release/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses a corrupt offline archive without replacing an installed binary or notices', async () => {
    const root = await temp(), destination = join(root, 'plugin'), archive = join(root, 'bad.tar.gz');
    await mkdir(join(destination, 'bin'), { recursive: true });
    await writeFile(join(destination, 'bin/callix'), 'previous binary');
    await writeFile(join(destination, 'bin/LICENSE'), 'previous license');
    await writeFile(archive, 'untrusted archive');
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(installCallix({ destination, archivePath: archive, platform: 'linux-x64' })).rejects.toThrow(/checksum mismatch/);
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(join(destination, 'bin/callix'), 'utf8')).toBe('previous binary');
    expect(await readFile(join(destination, 'bin/LICENSE'), 'utf8')).toBe('previous license');
  });
  it('fails closed on download failure and substituted archive bytes', async () => {
    const root = await temp(), destination = join(root, 'not-created');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });
    await expect(installCallix({ destination, platform: 'linux-x64' })).rejects.toThrow(/HTTP 503/);
    fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    await expect(installCallix({ destination, platform: 'linux-x64' })).rejects.toThrow(/checksum mismatch/);
    await expect(access(destination)).rejects.toThrow();
  });
  it('requires an explicit destination and keeps invalid setup arguments offline', async () => {
    await expect(installCallix()).rejects.toThrow(/destination is required/);
    await expect(promisify(execFile)(process.execPath, [resolve('plugins/callix/install.mjs'), '--unknown'], { timeout: 10000 })).rejects.toThrow(/Usage: node install.mjs/);
  });
});
