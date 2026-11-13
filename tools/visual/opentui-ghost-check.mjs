import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { inflateSync } from 'node:zlib';
import { decode, defaultPack } from '../../plugins/mascot/animations.ts';

// Exercise the actual renderer with the visual bench's POSIX PTY. Only the
// terminal's Kitty query reply is emulated. Inspect the emitted pixel payload.
const output = resolve(process.env.VISUAL_OUTPUT ?? 'dist/visual-opentui-ghost');
const report = { ok: false, queries: 0, sources: {}, uploads: [], placements: 0, loopMilliseconds: {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), 'compositor-ghost-check-'));
let child, exit, timer;
try {
  for (const state of ['idle', 'thinking']) {
    const frames = await decode(join(defaultPack, state + '.apng'), false);
    report.sources[state] = frames.map(frame => ({ sha256: hash(Buffer.from(frame.rgba, 'base64')), delay: frame.delay }));
  }
  const env = { ...process.env, HOME: workspace, AGENT_HOME: join(workspace, '.agent-compositor'),
    XDG_CONFIG_HOME: join(workspace, 'xdg'), VISUAL_COLS: '100', VISUAL_ROWS: '30', AGENT_GRAPHICS: 'auto' };
  for (const key of ['TERM_PROGRAM', 'KITTY_WINDOW_ID', 'TMUX', 'STY', 'NO_COLOR', 'AGENT_REDUCED_MOTION',
    'OPENTUI_GRAPHICS', 'OPENTUI_IMAGE_PROTOCOL']) delete env[key];
  child = spawn(process.env.PYTHON ?? 'python3', [join(import.meta.dirname, 'pty_bridge.py'), 'bun',
    join(import.meta.dirname, 'opentui-sample.ts'), workspace], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'inherit'] });
  exit = new Promise((done, fail) => { child.once('error', fail); child.once('close', done); });
  timer = setTimeout(() => child.kill('SIGTERM'), 20000);
  const input = data => child.stdin.write(JSON.stringify({ type: 'input', data }) + '\n');
  const started = performance.now();
  let pending = '', upload, submitted = false, quit = false, tail = '';
  for await (const line of createInterface({ input: child.stdout })) {
    const { data } = JSON.parse(line);
    pending += data;
    tail = (tail + data).slice(-1000);
    // The bridge may split either end of an APC or any base64 chunk.
    let start;
    while ((start = pending.indexOf('\x1b_G')) >= 0) {
      pending = pending.slice(start);
      const end = pending.indexOf('\x1b\\', 3);
      if (end < 0) break;
      const [header, payload = ''] = pending.slice(3, end).split(';');
      pending = pending.slice(end + 2);
      const keys = Object.fromEntries(header.split(',').map(pair => pair.split('=')));
      if (keys.a === 'q') {
        report.queries++;
        input(`\x1b_Gi=${keys.i};OK\x1b\\`);
      } else if (keys.a === 'p') {
        assert.deepEqual([keys.c, keys.r], ['8', '4']);
        report.placements++;
      } else if (keys.a === 't' || (!keys.a && keys.m !== undefined)) {
        if (keys.a === 't') {
          assert.deepEqual([keys.f, keys.s, keys.v], ['32', '228', '228']);
          upload = { compressed: keys.o === 'z', data: '' };
        }
        assert.ok(upload, 'Kitty continuation without an upload');
        upload.data += payload;
        if (keys.m === '1') continue;
        const bytes = Buffer.from(upload.data, 'base64');
        const digest = hash(upload.compressed ? inflateSync(bytes) : bytes);
        upload = undefined;
        const state = Object.keys(report.sources).find(name => report.sources[name].some(frame => frame.sha256 === digest));
        assert.ok(state, `Kitty payload differs from all original RGBA frames: ${digest}`);
        const index = report.sources[state].findIndex(frame => frame.sha256 === digest);
        report.uploads.push({ milliseconds: Math.round(performance.now() - started), state, index, sha256: digest });
        if (index !== 0) continue;
        const source = report.sources[state];
        const cycle = report.uploads.slice(-(source.length + 1));
        if (cycle.length !== source.length + 1 ||
            !cycle.every((frame, i) => frame.state === state && frame.index === i % source.length)) continue;
        const duration = cycle.at(-1).milliseconds - cycle[0].milliseconds;
        const expected = source.reduce((sum, frame) => sum + frame.delay, 0);
        // Observe one full in-order cycle within a source frame of its nominal
        // duration. Under load the player may skip late frames; allow another cycle.
        if (Math.abs(duration - expected) > source[0].delay) continue;
        report.loopMilliseconds[state] = duration;
        if (!submitted && state === 'idle') {
          submitted = true;
          input('hold main\r');
        } else if (!quit && state === 'thinking') {
          quit = true;
          input('\x03');
        }
      }
    }
    if (start < 0) pending = pending.slice(-2);
  }
  assert.equal(await exit, 0, `OpenTUI fixture exited before a clean shutdown. PTY tail ${JSON.stringify(tail)}`);
  assert.ok(report.queries > 0 && report.placements > 0 && submitted && quit,
    'Expected a negotiated Kitty placement and a complete idle and thinking loop');
  report.ok = true;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exit?.catch(() => {});
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.ok ? 'Passed' : 'Failed'} Ghost PTY check: ${report.error ?? output}`);
}
