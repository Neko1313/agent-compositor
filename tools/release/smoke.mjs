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
import { callixRelease } from '../../plugins/callix/distribution.mjs';
const exec = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), 'compositor-release-'));
const asset = `compositor-${process.platform}-${process.arch}.tar.gz`;
const archive = await readFile(resolve('dist/release', asset));
const digest = createHash('sha256').update(archive).digest('hex');
const expected = JSON.parse(await readFile('package.json')).version;
const installer = resolve('install.sh');
let corrupt = true;
let callixResult, workflowResult, guardedEditResult;
const server = createServer(async (req, res) => {
  if (req.url.endsWith('/SHA256SUMS')) { res.end(`${corrupt ? '0'.repeat(64) : digest}  ${asset}\n`); return; }
  if (req.url.endsWith(`/${asset}`)) { res.end(archive); return; }
  if (req.url === '/v1/chat/completions') {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
    if(request.messages.some(m=>m.role==='user'&&m.content.startsWith('WORKFLOW_WORKER_CHECK'))){
      res.end(frame({content:'WORKFLOW_WORKER_OK'},'stop')+'data: [DONE]\n\n');
    } else if(request.messages.some(m=>m.role==='user'&&m.content==='WORKFLOW_DISTRIBUTION_CHECK')){
      const tool=request.messages.filter(m=>m.role==='tool').at(-1);
      if(!tool)res.end(frame({tool_calls:[{index:0,id:'workflow-start',type:'function',function:{name:'workflow_run',arguments:JSON.stringify({action:'start',title:'Packaged workflow',stages:[{id:'worker',prompt:'WORKFLOW_WORKER_CHECK'}]})}}]},'tool_calls')+'data: [DONE]\n\n');
      else {const run=JSON.parse(tool.content);if(run.status==='completed'){workflowResult=run;res.end(frame({content:'WORKFLOW_DISTRIBUTION_OK'},'stop')+'data: [DONE]\n\n');}
      else res.end(frame({tool_calls:[{index:0,id:'workflow-status-'+request.messages.length,type:'function',function:{name:'workflow_run',arguments:JSON.stringify({action:'status',id:run.id,waitMs:1000})}}]},'tool_calls')+'data: [DONE]\n\n');}
    } else if(request.messages.some(m=>m.role==='user'&&m.content==='CALLIX_SYMBOL_EDIT_CHECK')){
      const tool=request.messages.filter(m=>m.role==='tool').at(-1);
      if(!tool)res.end(frame({tool_calls:[{index:0,id:'symbol-read',type:'function',function:{name:'code_query',arguments:JSON.stringify({action:'read_symbol',pattern:'leaf',path:'leaf.ts'})}}]},'tool_calls')+'data: [DONE]\n\n');
      else if(JSON.parse(tool.content).edit){const source=JSON.parse(tool.content);res.end(frame({tool_calls:[{index:0,id:'symbol-edit',type:'function',function:{name:'edit',arguments:JSON.stringify({...source.edit,oldText:'value + 1',newText:'value + 2'})}}]},'tool_calls')+'data: [DONE]\n\n');}
      else{guardedEditResult=JSON.parse(tool.content);res.end(frame({content:'CALLIX_SYMBOL_EDIT_OK'},'stop')+'data: [DONE]\n\n');}
    } else if (request.messages.some(m => m.role === 'user' && m.content === 'CALLIX_DISTRIBUTION_CHECK')) {
      const tool = request.messages.filter(m => m.role === 'tool').at(-1);
      if (!tool) {
        res.end(frame({ tool_calls: [{ index: 0, id: 'callix-check', type: 'function', function: { name: 'code_query', arguments: JSON.stringify({ action: 'callers', pattern: 'leaf' }) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
      } else {
        try { callixResult = JSON.parse(tool.content); } catch { callixResult = { error: tool.content }; }
        res.end(frame({ content: 'CALLIX_TOOL_RETURNED' }, 'stop') + 'data: [DONE]\n\n');
      }
    } else res.end(frame({ content: 'RELEASE_SMOKE_OK' }, 'stop') + 'data: [DONE]\n\n');
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
  assert.match((await exec(binary,['-p','WORKFLOW_DISTRIBUTION_CHECK'],options)).stdout,/WORKFLOW_DISTRIBUTION_OK/);
  assert.equal(workflowResult?.stages?.[0]?.output,'WORKFLOW_WORKER_OK');
  // Test the packaged mascot decoder/assets and Monty bridge, not source modules.
  const [distribution] = (await readdir(join(prefix, 'share/agent-compositor'))).filter(name => name.startsWith(`v${expected}-`));
  const directory = join(prefix, 'share/agent-compositor', distribution);
  const callixDirectory = join(directory, 'plugins/callix/bin');
  const provenance = JSON.parse(await readFile(join(callixDirectory, 'release.json'), 'utf8'));
  for (const [key, value] of Object.entries(callixRelease())) assert.equal(provenance[key], value);
  assert.equal(createHash('sha256').update(await readFile(join(callixDirectory, 'callix'))).digest('hex'), provenance.binarySha256);
  const license = await readFile(join(callixDirectory, 'LICENSE'));
  assert.equal(createHash('sha256').update(license).digest('hex'), provenance.licenseSha256);
  assert.match(license.toString('utf8'), /MIT License/);
  const noPath = join(temp, 'empty-path'); await mkdir(noPath);
  const callixOptions = { ...options, timeout: 120000, env: { ...env, CALLIX_BIN: '', PATH: noPath } };
  assert.equal((await exec(join(callixDirectory, 'callix'), ['--version'], callixOptions)).stdout.trim(), `callix ${provenance.version}`);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'callix-release-check', private: true, type: 'module' }));
  await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] }));
  await writeFile(join(project, 'leaf.ts'), 'export function leaf(value: number): number { return value + 1; }\n');
  await writeFile(join(project, 'main.ts'), 'import { leaf } from "./leaf.js";\nexport function start(): number { return leaf(1); }\n');
  assert.match((await exec(binary, ['-p', 'CALLIX_DISTRIBUTION_CHECK'], callixOptions)).stdout, /CALLIX_TOOL_RETURNED/);
  assert.equal(callixResult?.provider, 'callix', JSON.stringify(callixResult));
  assert.ok(callixResult?.relations?.some(r => r.kind === 'calls'), JSON.stringify(callixResult));
  assert.ok(callixResult?.nodes?.some(n => n.name === 'start'), JSON.stringify(callixResult));
  assert.ok(callixResult?.symbols?.some(n => n.name === 'leaf'), JSON.stringify(callixResult));
  await writeFile(join(project,'agent-compositor.json'),JSON.stringify({permissions:{rules:[{tool:'edit',path:join(project,'leaf.ts'),decision:'allow'}]}}));
  assert.match((await exec(binary,['-p','CALLIX_SYMBOL_EDIT_CHECK'],callixOptions)).stdout,/CALLIX_SYMBOL_EDIT_OK/);
  assert.equal(guardedEditResult?.match,'exact',JSON.stringify(guardedEditResult));assert.match(guardedEditResult?.hashAfter??'',/^[a-f0-9]{64}$/);assert.match(await readFile(join(project,'leaf.ts'),'utf8'),/value \+ 2/);
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
  console.log(`Release smoke passed: ${asset}, checksum rejection, versioned/latest install, default plugins, model response, background workflow, bundled Callix cross-file analysis and guarded symbol editing without PATH, state preservation`);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
