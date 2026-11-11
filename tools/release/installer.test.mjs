import {it, expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, readdir, readlink, symlink, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';
const exec = promisify(execFile);

for (const failOn of ['archive', 'checksums']) {
  it.skipIf(!['linux', 'darwin'].includes(process.platform))(`bounds ${failOn} download failure and preserves an existing installation`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'compositor-install-network-'));
    try {
      const bin = join(root, 'commands'), scratch = join(root, 'scratch');
      const prefix = join(root, 'install with spaces'), home = join(root, 'home');
      await Promise.all([mkdir(bin), mkdir(scratch), mkdir(join(prefix, 'bin'), {recursive: true}), mkdir(home)]);
      const oldBinary = join(prefix, 'old-compositor'), link = join(prefix, 'bin', 'compositor');
      await writeFile(oldBinary, 'existing release');
      await symlink(oldBinary, link);
      await writeFile(join(home, 'state.json'), '{"draft":"keep me"}\n');
      const log = join(root, 'calls.jsonl');
      // A failing transport records admission limits and leaves partial data,
      // like curl timing out mid-response. Neither download may reach extraction.
      await writeFile(join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.INSTALL_TEST_LOG, JSON.stringify(args) + '\\n');
fs.writeFileSync(args[args.indexOf('-o') + 1], 'partial download');
const checksums = args.some(arg => arg.endsWith('/SHA256SUMS'));
if (process.env.INSTALL_TEST_FAIL === 'archive' || checksums) {
  console.error('curl: (28) simulated transfer timeout');
  process.exit(28);
}

`, {mode: 0o755});
      const result = await exec('sh', [resolve('install.sh'), '--version', 'v0.7.0', '--prefix', prefix], {
        env: {...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: scratch,
          COMPOSITOR_RELEASE_BASE_URL: 'https://mirror.invalid/releases',
          INSTALL_TEST_LOG: log, INSTALL_TEST_FAIL: failOn},
        timeout: 5000,
      }).then(() => null, error => error);
      expect(result?.code).toBe(28);
      expect(result?.stderr).toContain('simulated transfer timeout');
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
      expect(calls).toHaveLength(failOn === 'archive' ? 1 : 2);
      for (const args of calls) {
        for (const [flag, value] of [['--connect-timeout', '15'], ['--speed-limit', '1024'],
          ['--speed-time', '60'], ['--max-time', '900'], ['--retry', '3'], ['--retry-max-time', '1200']]) {
          expect(args[args.indexOf(flag) + 1], flag).toBe(value);
        }
      }
      expect(await readlink(link)).toBe(oldBinary);
      expect(await readFile(oldBinary, 'utf8')).toBe('existing release');
      expect(await readFile(join(home, 'state.json'), 'utf8')).toBe('{"draft":"keep me"}\n');
      expect(await readdir(scratch)).toEqual([]);
      expect(await readdir(prefix)).toEqual(['bin', 'old-compositor']);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
}


it.skipIf(!['linux', 'darwin'].includes(process.platform))('stops a stalled HTTP response through real curl and cleans partial downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compositor-install-stall-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, {'content-length': '100000'});
    res.write('x'); // Keep the response open without completing the body.
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const curl = (await exec('sh', ['-c', 'command -v curl'])).stdout.trim();
    const bin = join(root, 'commands'), scratch = join(root, 'scratch');
    await Promise.all([mkdir(bin), mkdir(scratch)]);
    // Scale only existing production time limits; do not introduce a missing
    // limit. Real curl still performs HTTP and detects the incomplete response.
    await writeFile(join(bin, 'curl'), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
for (const [flag, value] of [['--connect-timeout', '1'], ['--speed-time', '1'], ['--max-time', '2'], ['--retry', '0']]) {
  const index = args.indexOf(flag);
  if (index >= 0) args[index + 1] = value;
}
const result = spawnSync(${JSON.stringify(curl)}, args, {stdio: 'inherit', timeout: 4000});
process.exit(result.status ?? 99);
`, {mode: 0o755});
    const result = await exec('sh', [resolve('install.sh'), '--prefix', join(root, 'prefix')], {
      env: {...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: scratch,
        COMPOSITOR_RELEASE_BASE_URL: `http://127.0.0.1:${server.address().port}/releases`,
        NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1'},
      timeout: 6000,
    }).then(() => null, error => error);
    expect(result?.code).toBe(28);
    expect(result?.stderr).toMatch(/curl: \(28\)/);
    expect(await readdir(scratch)).toEqual([]);
    expect(await readdir(root)).not.toContain('prefix');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
}, 10000);
