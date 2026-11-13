import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.VISUAL_OUTPUT ?? 'dist/visual-opentui');
const timeout = 15_000;
const mainDraft = 'Main unsent';
const sideDraft = 'Side unsent';
const pastedLine = 'second line 日本語';
const sideTask = 'Check side';
const sideReply = 'Side reply: ' + sideTask;
const report = { ok: false, checks: [], screenshots: [], errors: [] };
let server, serverExit, browser, page;

await mkdir(output, { recursive: true });
for (const name of ['failure.txt', 'failure.png']) await rm(join(output, name), { force: true });

try {
  assert.ok(!process.env.VISUAL_EXECUTABLE, 'This scenario exercises the OpenTUI source fixture');
  const environment = { ...process.env };
  // The bench negotiates Kitty with an isolated emulator, independent of the invoking terminal.
  for (const key of ['NO_COLOR', 'TERM_PROGRAM', 'KITTY_WINDOW_ID', 'TMUX', 'STY', 'OPENTUI_GRAPHICS', 'OPENTUI_IMAGE_PROTOCOL']) {
    delete environment[key];
  }
  server = spawn('bun', ['tools/visual/server.mjs'], {
    cwd: root,
    env: { ...environment, VISUAL_OPENTUI: '1', VISUAL_OUTPUT: output,
      AGENT_GRAPHICS: 'kitty', VISUAL_GRAPHICS: 'kitty', AGENT_REDUCED_MOTION: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  serverExit = new Promise(done => server.once('close', done));
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error('Visual server startup timed out')), timeout);
    let buffer = '';
    server.on('error', error => { clearTimeout(timer); fail(error); });
    serverExit.then(code => { clearTimeout(timer); fail(Error('Visual server exited ' + code)); });
    server.stdout.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/VISUAL_URL=(http\S+)\s/);
      if (match) { clearTimeout(timer); done(match[1]); }
    });
  });

  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => report.errors.push(error.message));
  const [socket] = await Promise.all([page.waitForEvent('websocket'), page.goto(url)]);
  const wait = value => page.waitForFunction(value => window.visual?.text().includes(value), value);
  const screen = () => page.evaluate(() => visual.text());
  async function type(value) {
    await page.keyboard.type(value);
    await wait(value);
  }
  async function click(label) {
    await wait(label);
    const point = await page.evaluate(label => {
      const lines = visual.text().split('\n');
      const row = lines.findIndex(line => line.includes(label));
      const col = lines[row].indexOf(label) + Math.floor(label.length / 2);
      const rect = document.querySelector('.xterm-screen').getBoundingClientRect();
      return {
        x: rect.x + (col + 0.5) * rect.width / visual.terminal.cols,
        y: rect.y + (row + 0.5) * rect.height / visual.terminal.rows,
      };
    }, label);
    await page.mouse.click(point.x, point.y);
  }
  async function capture(name) {
    await page.locator('#terminal').screenshot({ path: join(output, name) });
    report.screenshots.push(name);
  }
  const waitForArtwork = () => page.waitForFunction(() => visual.graphics.active === 1);

  await wait('F2 Main');
  await wait('F3 Side');
  await wait('Message Main…');
  // Sample only the image placement on the transparent Kitty protocol canvas.
  // OpenTUI may transmit different frames under the same image ID.
  await waitForArtwork();
  report.graphics = await (await page.waitForFunction(() => {
    const { canvas, stats, active } = visual.graphics;
    const area = stats.lastPlacement;
    if (!active || !area || stats.lastWidth !== 228 || stats.lastHeight !== 228) return;
    const cw = canvas.width / visual.terminal.cols, ch = canvas.height / visual.terminal.rows;
    const pixels = canvas.getContext('2d').getImageData(area.x * cw, area.y * ch, area.c * cw, area.r * ch).data;
    let hash = 2166136261, colored = 0;
    for (const [i, byte] of pixels.entries()) {
      hash = Math.imul(hash ^ byte, 16777619);
      if (i % 4 === 3 && byte) colored++;
    }
    if (!colored || colored === pixels.length / 4) return;
    (window.observedGhostFrames ??= new Set()).add(hash);
    if (window.observedGhostFrames.size >= 2) return {
      width: stats.lastWidth, height: stats.lastHeight, placement: area,
      frameHashes: [...window.observedGhostFrames].map(value => (value >>> 0).toString(16)),
    };
  })).jsonValue();
  report.checks.push('A 228×228 Kitty image beside the editor displays changing pixels over a transparent background');
  await capture('01-main-ready.png');
  await type('hold main');
  await page.keyboard.press('Enter');
  await wait('Main is working');
  await wait('Running');
  await type(mainDraft);
  await waitForArtwork();
  await capture('02-main-running.png');
  report.checks.push('Submitting Main through the terminal shows its streaming reply and leaves the editor usable');

  await page.keyboard.press('F3');
  await wait('Message Side…');
  assert.ok(!(await screen()).includes(mainDraft));
  await type(sideTask);
  await click('Send');
  await wait(sideReply);
  await wait('Message Side…');
  await type(sideDraft);
  await page.keyboard.press('Control+j');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  await page.evaluate(value => navigator.clipboard.writeText(value), pastedLine);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Shift+Insert');
  await page.waitForFunction(expected => {
    const rows = visual.text().split('\n');
    return rows.some((row, i) => row.includes('Side unsent') && rows[i + 1]?.includes(expected));
  }, pastedLine);
  assert.ok(!(await screen()).includes('Main is working'));
  await waitForArtwork();
  await capture('03-side-reply.png');
  report.checks.push('F3 selects Side, its Send button submits to Side, and a Unicode clipboard paste fills the second draft line after Ctrl+J');

  await click('F2 Main');
  await wait(mainDraft);
  await wait('Main is working');
  await wait('Running');
  assert.ok(!(await screen()).includes(sideReply));
  assert.ok(!(await screen()).includes(sideDraft));
  await click('F3 Side');
  await wait(sideReply);
  await wait(sideDraft);
  await wait(pastedLine);
  report.checks.push('Mouse tab switches restore both drafts and keep the running Main and completed Side transcripts separate');

  await page.evaluate(() => visual.terminal.resize(48, 18));
  await page.waitForFunction(expected => {
    const lines = visual.text().split('\n');
    return visual.terminal.cols === 48 && visual.terminal.rows === 18 && visual.graphics.active === 0 &&
      lines.slice(-3).some(line => line.includes('Enter send') && !line.includes('PgUp')) &&
      lines.slice(-7).some(line => line.includes(expected));
  }, pastedLine);
  await wait(sideReply);
  await capture('04-side-narrow.png');
  await page.keyboard.press('F2');
  await wait(mainDraft);
  await wait('Main is working');
  await page.keyboard.press('F3');
  await wait(sideDraft);
  await wait(pastedLine);
  assert.ok(!(await screen()).includes(mainDraft));
  report.checks.push('At 48×18 the composer and reply remain visible, and F2/F3 restore each draft');

  await page.evaluate(() => visual.terminal.resize(100, 30));
  await wait('PgUp/PgDn history');
  await page.keyboard.press('F4');
  await wait('Preview workflow');
  await wait('completed');
  assert.ok(!(await screen()).includes('Workflow: Preview workflow'));
  assert.ok(!(await screen()).includes(sideDraft));
  await page.keyboard.press('Enter');
  await wait('Workflow: Preview workflow');
  await capture('05-workflow-expanded.png');
  await click('Preview workflow');
  await page.waitForFunction(() => !visual.text().includes('Workflow: Preview workflow'));
  await page.evaluate(() => visual.terminal.resize(48, 18));
  await wait('Workflow: Preview workflow');
  await wait('State: completed');
  await click('Preview workflow');
  await page.waitForFunction(() => visual.text().split('\n').filter(line => line.includes('Workflow: Preview workflow')).length > 1);
  await capture('06-workflow-narrow.png');
  await page.keyboard.press('F3');
  await wait(sideDraft);
  await wait(pastedLine);
  await wait(sideReply);
  report.checks.push('Enter expands the selected workflow, clicks collapse and expand its row at 100×30 and 48×18, and F3 restores the Side draft');

  const [exit] = await Promise.all([
    socket.waitForEvent('framereceived', { predicate: frame => JSON.parse(String(frame.payload)).type === 'exit', timeout }),
    page.keyboard.press('Control+c'),
  ]);
  report.ptyExitCode = JSON.parse(String(exit.payload)).code;
  assert.equal(report.ptyExitCode, 0);
  const inputs = (await readFile(join(output, 'input.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(inputs.some(event => event.type === 'resize' && event.cols === 48 && event.rows === 18));
  assert.ok(inputs.some(event => event.type === 'input' && event.data === '\x03'));
  assert.ok(inputs.some(event => event.type === 'input' && event.data === '\x1b[200~' + pastedLine + '\x1b[201~'));
  report.checks.push('Ctrl+C exits the PTY child successfully while the Main turn is still held');
  assert.deepEqual(await page.evaluate(() => visual.graphics.stats.errors), []);
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack : String(error));
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (page) await writeFile(join(output, 'failure.txt'), await page.evaluate(() => window.visual?.text() ?? '').catch(() => ''));
} finally {
  await browser?.close();
  if (server) {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    await serverExit;
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
