// Exercise the release exactly as an end user, outside the source tree.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), 'compositor-release-'));
const asset = `compositor-${process.platform}-${process.arch}.tar.gz`;
const archive = await readFile(resolve('dist/release', asset));
const digest = createHash('sha256').update(archive).digest('hex');
const expected = JSON.parse(await readFile('package.json')).version;
const installer = resolve('install.sh');
let corrupt = true;
const server = createServer(async (req, res) => {
  if (req.url.endsWith('/SHA256SUMS')) { res.end(`${corrupt ? '0'.repeat(64) : digest}  ${asset}\n`); return; }
  if (req.url.endsWith(`/${asset}`)) { res.end(archive); return; }
  if (req.url === '/v1/chat/completions') {
    for await (const _chunk of req) { /* Consume the request before responding. */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"RELEASE_SMOKE_OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const prefix = join(temp, 'install with spaces');
const project = join(temp, 'project'), home = join(temp, 'home');
await mkdir(project); await mkdir(home);
const env = { ...process.env, HOME: home, AGENT_HOME: join(home, '.agent-compositor'), AGENT_BASE_URL: `${base}/v1`, AGENT_MODEL: 'release-smoke', AGENT_API_KEY: '', COMPOSITOR_RELEASE_BASE_URL: `${base}/releases` };
try {
  const options = { env, cwd: project, timeout: 60000, maxBuffer: 2_000_000 };
  if (process.platform === 'linux') {
    const oldLibc = join(temp, 'old-libc');
    await mkdir(oldLibc);
    await writeFile(join(oldLibc, 'getconf'), "#!/bin/sh\nprintf 'glibc 2.35\\n'\n", { mode: 0o755 });
    await assert.rejects(exec('sh', [installer, '--prefix', prefix], { ...options, env: { ...env, PATH: `${oldLibc}:${env.PATH}` } }), /requires glibc 2.38/);
  }
  await assert.rejects(exec('sh', [installer, '--prefix', prefix], options), /Checksum mismatch/);
  await assert.rejects(access(join(prefix, 'bin/compositor')));
  corrupt = false;
  await exec('sh', [installer, '--version', `v${expected}`, '--prefix', prefix], options);
  const binary = join(prefix, 'bin/compositor');
  assert.equal((await exec(binary, ['--version'], options)).stdout.trim(), `compositor ${expected}`);
  assert.match((await exec(binary, ['--help'], options)).stdout, /--plugins/);
  const plain = exec(binary, ['--plain'], options);
  // EOF exits the line interface without contacting a model.
  plain.child.stdin.end();
  const { stdout } = await plain;
  assert.doesNotMatch(stdout, /plugin load errors/);
  for (const name of ['mascot', 'monty', 'callix', 'todos', 'ui-theme', 'mcp', 'workflows']) assert.match(stdout, new RegExp(`${name}@`));
  const reply = await exec(binary, ['-p', 'Reply with the smoke marker'], options);
  assert.match(reply.stdout, /RELEASE_SMOKE_OK/);
  // Test the packaged mascot decoder/assets and Monty bridge, not source modules.
  const [distribution] = (await readdir(join(prefix, 'share/agent-compositor'))).filter(name => name.startsWith(`v${expected}-`));
  const directory = join(prefix, 'share/agent-compositor', distribution);
  const verify = join(temp, 'verify.mjs');
  await writeFile(verify, `import hooks from ${JSON.stringify(pathToFileURL(join(directory, 'plugins/monty/hooks.js')).href)};
const result = await hooks['service.sandbox.run']({language:'python',code:'6 * 7'}, {signal:new AbortController().signal});
if (result.value?.output !== 42) throw new Error(JSON.stringify(result));
console.log('MONTY_OK');
`);
  assert.match((await exec(process.execPath, [verify], options)).stdout, /MONTY_OK/);
  assert.equal((await readdir(join(directory, 'plugins/mascot/assets'))).filter(name => name.endsWith('.png') || name.endsWith('.apng')).length, 10);
  const marker = join(env.AGENT_HOME, 'preserve-me');
  await writeFile(marker, 'user state');
  await exec('sh', [installer, '--prefix', prefix], options);
  assert.equal(await readFile(marker, 'utf8'), 'user state');
  console.log(`Release smoke passed: ${asset}, checksum rejection, versioned/latest install, default plugins, model response, state preservation`);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
