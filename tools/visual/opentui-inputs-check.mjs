import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.VISUAL_OUTPUT ?? 'dist/visual-opentui-inputs');
const timeout = 15_000;
const report = {ok: false, checks: [], screenshots: [], errors: []};
let server, serverExit, browser, page;
await mkdir(output, {recursive: true});
for (const name of ['failure.txt', 'failure.png']) await rm(join(output, name), {force: true});

try {
  assert.ok(!process.env.VISUAL_EXECUTABLE, 'This scenario exercises the OpenTUI source fixture');
  server = spawn('bun', ['tools/visual/server.mjs'], {cwd: root, env: {
    ...process.env, VISUAL_OPENTUI: '1', VISUAL_OUTPUT: output, AGENT_GRAPHICS: 'off',
  }, stdio: ['ignore', 'pipe', 'inherit']});
  serverExit = new Promise(done => server.once('close', done));
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error('Visual server startup timed out')), timeout);
    let buffer = '';
    server.on('error', error => {clearTimeout(timer); fail(error);});
    serverExit.then(code => {clearTimeout(timer); fail(Error('Visual server exited ' + code));});
    server.stdout.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/VISUAL_URL=(http\S+)\s/);
      if (match) {clearTimeout(timer); done(match[1]);}
    });
  });
  browser = await chromium.launch({headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}),
  });
  page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => report.errors.push(error.message));
  const [socket] = await Promise.all([page.waitForEvent('websocket'), page.goto(url)]);
  const wait = value => page.waitForFunction(value => window.visual?.text().includes(value), value)
    .catch(error => {throw Error('Terminal did not display ' + JSON.stringify(value), {cause: error});});
  const absent = value => page.waitForFunction(value => !window.visual?.text().includes(value), value);
  const screen = () => page.evaluate(() => visual.text());
  const key = value => page.keyboard.press(value);
  async function type(value) {await page.keyboard.type(value); await wait(value);}
  async function burst(value) {
    // One public xterm input packet traverses the real websocket and PTY parser.
    await page.evaluate(value => visual.terminal.input(value, true), value);
  }
  async function click(label) {
    await wait(label);
    const footer = ['Back', 'Next', 'Submit', 'Cancel', 'Draft', 'Save settings'].includes(label);
    const attempt = Math.random();
    const point = await (await page.waitForFunction(({label, footer, attempt}) => {
      const lines = visual.text().split('\n');
      const row = lines.findIndex(line => line.includes(label));
      const column = row < 0 ? -1 : lines[row].indexOf(label) + Math.floor(label.length / 2);
      if (row < 0 || column < 0) {window.inputClickReadiness = undefined; return;}
      if (footer) {
        const y = lines.findIndex(line => line.includes(' · focused '));
        if (y < 0) {window.inputClickReadiness = undefined; return;}
        const x = lines[y].indexOf('┌'), right = lines[y].lastIndexOf('┐');
        const bottom = lines.findIndex((line, i) => i > y && line[x] === '└' && line[right] === '┘');
        if (row !== bottom - 4) {window.inputClickReadiness = undefined; return;}
      }
      // Native widgets can settle their flex geometry in a second paint.
      // Observe the same actual target over consecutive animation frames and
      // return its coordinates atomically, rather than rereading an old row.
      const signature = [row, column, visual.terminal.cols, visual.terminal.rows].join(':');
      const previous = window.inputClickReadiness;
      if (!previous || previous.attempt !== attempt || previous.signature !== signature) {
        window.inputClickReadiness = {attempt, signature, observations: 1};
        return;
      }
      if (++previous.observations < 3) return;
      const rect = document.querySelector('.xterm-screen').getBoundingClientRect();
      return {x: rect.x + (column + .5) * rect.width / visual.terminal.cols,
        y: rect.y + (row + .5) * rect.height / visual.terminal.rows};
    }, {label, footer, attempt})).jsonValue();
    await page.mouse.click(point.x, point.y);
  }
  async function capture(name) {
    await page.evaluate(() => new Promise((done, fail) => {
      const timer = setTimeout(() => {subscription.dispose(); fail(Error('Terminal paint timeout'));}, 5000);
      const subscription = visual.terminal.onRender(() => {
        subscription.dispose(); clearTimeout(timer);
        requestAnimationFrame(() => requestAnimationFrame(done));
      });
      visual.terminal.refresh(0, visual.terminal.rows - 1);
    }));
    await page.locator('#terminal').screenshot({path: join(output, name)});
    report.screenshots.push(name);
  }
  async function resize(cols, rows) {
    await page.evaluate(({cols, rows}) => visual.terminal.resize(cols, rows), {cols, rows});
    await page.waitForFunction(({cols, rows}) => visual.terminal.cols === cols && visual.terminal.rows === rows, {cols, rows});
  }
  const readJson = file => readFile(file, 'utf8').then(JSON.parse);
  async function observe(read, predicate, reason) {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = await read().catch(error => {if (error.code !== 'ENOENT') throw error;});
      if (value !== undefined && predicate(value)) return value;
      await delay(25);
    }
    throw Error('Independent observation failed: ' + reason + '; latest=' + JSON.stringify(value));
  }
  async function files(directory) {
    const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const result = [];
    for (const entry of entries) {
      if (entry.isDirectory()) result.push(...await files(join(directory, entry.name)));
      else if (entry.isFile()) result.push(join(directory, entry.name));
    }
    return result;
  }

  await wait('Message Main…');
  const {cwd} = await readJson(join(output, 'fixture-launch.json'));
  const fixture = await readJson(join(cwd, 'opentui-fixture.json'));
  await key('F9');
  await page.waitForFunction(() => !visual.text().includes('Message Side…'));
  const bench = {page, wait, absent, screen, key, type, burst, click, capture, resize, readJson, observe, files, fixture, report};
  await runInputs(bench);

  const [exit] = await Promise.all([
    socket.waitForEvent('framereceived', {predicate: frame => JSON.parse(String(frame.payload)).type === 'exit', timeout}),
    key('Control+c'),
  ]);
  report.ptyExitCode = JSON.parse(String(exit.payload)).code;
  assert.equal(report.ptyExitCode, 0);
  await bench.afterExit?.();
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack : String(error));
  await page?.screenshot({path: join(output, 'failure.png')}).catch(() => {});
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

async function runInputs(bench) {
  const {page, wait, absent, screen, key, type, burst, click, capture, resize, readJson, observe, files, fixture, report} = bench;
  assert.ok(fixture.inputsReceipt && fixture.formReceipt && fixture.modelTrace, 'The fixture must expose independent model/private-form receipts');
  const readReceipts = async () => {
    const text = await readFile(fixture.inputsReceipt, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
  };
  const answered = row => row.reply && typeof row.reply === 'object' && ('answer' in row.reply || 'answers' in row.reply);
  const successes = async () => (await readReceipts()).filter(answered);
  const successFor = (agent, prompt, start = 0) => observe(readReceipts, rows => rows.slice(start)
    .some(row => row.agent === agent && row.prompt === prompt && answered(row)), agent + ' receives ' + prompt)
    .then(rows => rows.slice(start).findLast(row => row.agent === agent && row.prompt === prompt && answered(row)));
  async function submit(prompt) {
    const agent = (await screen()).includes('─ Side · focused') ? 'Side' : 'Main';
    await wait('Message ' + agent + '…');
    await type(prompt);
    await key('Enter');
  }
  async function clearChat(agent) {
    await key(agent === 'Main' ? 'F2' : 'F3');
    await key('End');
    await key('Control+u');
    await wait('Message ' + agent + '…');
  }
  async function replaceField(value) {
    await key('End');
    await key('Control+u');
    await type(value);
  }
  async function currentPane(label) {
    return (await page.waitForFunction(label => {
      const rows = visual.text().split('\n');
      for (const [y, line] of rows.entries()) {
        const at = line.indexOf('─ ' + label + ' ');
        if (at < 0) continue;
        const x = line.lastIndexOf('┌', at), right = line.indexOf('┐', at);
        const bottom = rows.findIndex((row, index) => index > y && row[x] === '└' && row[right] === '┘');
        if (x >= 0 && right >= 0 && bottom >= 0) return {x, y, width: right - x + 1, height: bottom - y + 1};
      }
    }, label)).jsonValue();
  }
  async function moveCell(column, row, steps = 1) {
    const point = await page.evaluate(({column, row}) => {
      const rect = document.querySelector('.xterm-screen').getBoundingClientRect();
      return {x: rect.x + (column + .5) * rect.width / visual.terminal.cols,
        y: rect.y + (row + .5) * rect.height / visual.terminal.rows};
    }, {column, row});
    await page.mouse.move(point.x, point.y, {steps});
  }

  // Both questions are actual tools. Their following model request writes a receipt.
  await submit('request question');
  await wait('Choose destination for Main');
  await type('Main question draft');
  await key('F3');
  await wait('Message Side…');
  await submit('request question');
  await wait('Choose destination for Side');
  await type('Side question draft');
  await wait('Main · Question');
  await wait('Side · Question');
  await key('Alt+i');
  await wait('Local preview only');
  await wait('Preview (recommended)');
  await wait('[ ] Preview');
  await key('Alt+Enter');
  await wait('Complete each question with an allowed answer');
  await key('Enter');
  assert.equal((await successes()).length, 0, 'Enter may choose an option but must never submit a default answer');
  await key('F2');
  await wait('Main question draft');
  await key('Alt+i');
  await click('Production');
  await wait('[x] Production');
  await burst('\x1b[15~\x1b\r');
  await wait('Filter plugins');
  assert.equal((await successes()).length, 0, 'The previous chat cannot accept Alt+Enter after focus leaves in the same PTY packet');
  await wait('Main · Question');
  await key('F2');
  await wait('[x] Production');
  await key('Alt+Enter');
  const mainAnswer = await successFor('Main', 'request question');
  assert.deepEqual(mainAnswer.reply, {answer: 'Production'});
  await wait('Main received human answer');
  await wait('Main question draft');
  await wait('Side · Question');
  await key('F3');
  await wait('Choose destination for Side');
  // The Side Enter above selected Preview but did not submit it.
  await wait('[x] Preview');
  await click('Submit');
  const sideAnswer = await successFor('Side', 'request question');
  assert.deepEqual(sideAnswer.reply, {answer: 'Preview'});
  await wait('Side question draft');
  await capture('inputs-two-independent-questions.png');
  report.questionReceipts = [mainAnswer, sideAnswer];
  report.checks.push('Actual Main and Side question tools remain independent. No option is preselected; empty Submit validates and ordinary Enter only selects. A same-packet F5/Alt+Enter cannot answer Main, and each following model request receives only its own chosen answer and preserves its chat draft');

  await clearChat('Main');
  await submit('request custom');
  await wait('Choose custom destination for Main');
  await key('Alt+i');
  await key('Tab');
  await key('Tab');
  await type('Offline sandbox');
  await key('F10');
  await absent('Offline sandbox');
  await wait('Main · Question');
  await key('F2');
  await wait('Offline sandbox');
  await key('F9');
  await wait('Offline sandbox');
  await resize(48, 18);
  await wait('Offline sandbox');
  await wait('Submit');
  await wait('Cancel');
  await capture('inputs-custom-narrow.png');
  await key('Alt+Enter');
  const custom = await successFor('Main', 'request custom');
  assert.deepEqual(custom.reply, {answer: 'Offline sandbox'});
  await resize(100, 30);
  await wait('Message Main…');
  report.checks.push('A custom answer survives closing/reopening its window and remains editable with Submit/Cancel at 48×18. The following actual model request receives the complete free-text answer');

  await submit('request questionnaire');
  await wait('Choose environment');
  await key('Alt+i');
  await wait('Question 1/3');
  await click('Production');
  await click('Next');
  await wait('Which checks should run?');
  await click('Unit tests');
  await click('Browser tests');
  await key('Tab');
  await type('Load tests');
  await click('Back');
  await wait('Choose environment');
  await wait('[x] Production');
  await click('Next');
  await wait('Load tests');
  await wait('[x] Unit tests');
  await wait('[x] Browser tests');
  await click('Next');
  await wait('Who owns this setup?');
  await type('Build team');
  await click('Back');
  await wait('Which checks should run?');
  await wait('Load tests');
  await click('Next');
  await wait('Build team');
  await key('Alt+i');
  await type('Questionnaire chat draft');
  await key('Alt+i');
  await wait('Build team');
  await capture('inputs-questionnaire.png');
  await key('Alt+Enter');
  const questionnaire = await successFor('Main', 'request questionnaire');
  report.questionnaireReceipt = questionnaire;
  assert.deepEqual(questionnaire.reply, {answers: [
    {id: 'environment', selected: ['Production']},
    {id: 'checks', selected: ['Unit tests', 'Browser tests'], text: 'Load tests'},
    {id: 'owner', selected: [], text: 'Build team'},
  ]});
  await wait('Questionnaire chat draft');
  report.checks.push('A real three-question tool supports single and multiple choices, custom text and free text. Back/Next retain selections and input drafts, answer editing leaves the chat draft separate, and the actual model receives one validated ordered questionnaire result');

  // An immediate UI command is queued behind a foreground question. Stopping
  // only that turn must not cancel the command's independent form lifetime.
  await clearChat('Main');
  const countBeforeStop = (await successes()).length;
  await submit('request question');
  await wait('Choose destination for Main');
  await type('/preview-form');
  await key('Enter');
  await wait('Message Main…');
  await wait('Choose destination for Main');
  assert.ok(!(await screen()).includes('Preview settings'), 'The queued form must not compete with the active question');
  await key('Control+x');
  await wait('Preview settings');
  await wait('Main · Form');
  await absent('Choose destination for Main');
  assert.equal((await successes()).length, countBeforeStop, 'Stopping a question never fabricates an answer');
  await submit('Work while form waits');
  await wait('Main reply: Work while form waits');
  await wait('Main · Form');
  await wait('Preview settings');
  report.checks.push('The same Main agent accepts and completes an ordinary task while its private settings form remains pending in a separate user operation');
  await key('Alt+i');
  await wait('Access token');
  await key('Alt+Enter');
  await wait('Complete the form with valid fields and an offered action');
  await assert.rejects(readFile(fixture.formReceipt), {code: 'ENOENT'});
  await replaceField('CPU preview');
  await key('Tab');
  await replaceField('ftp://invalid.test/api');
  await key('Tab');
  const secret = 'SYNTHETIC_ONLY_47';
  await page.keyboard.type(secret);
  await wait('*'.repeat(secret.length));
  assert.ok(!(await screen()).includes(secret));
  await key('Tab');
  await key('ArrowRight');
  await wait('Fast');
  await key('Tab');
  await key('Space');
  await wait('[x] Enabled');
  await key('Alt+Enter');
  await wait('Complete the form with valid fields and an offered action');
  await assert.rejects(readFile(fixture.formReceipt), {code: 'ENOENT'});
  report.checks.push('An immediate trusted form waits behind Main’s active question. Ctrl+X cancels only the foreground turn and promotes the still-live form. Required-field and invalid-URL attempts remain pending without returning a private result');

  await key('F10');
  await wait('Main · Form');
  await absent('CPU preview');
  await key('F2');
  await wait('CPU preview');
  await key('F9');
  await wait('Access token');
  await key('Alt+Shift+Digit2');
  await wait('CPU preview');
  await key('Alt+Digit1');
  await key('F3');
  await wait('Side question draft');
  await key('End');
  await key('Control+u');
  await wait('Message Side…');
  await key('F9');
  await submit('Work while settings wait');
  await wait('Side reply: Work while settings wait');
  await key('Alt+Digit2');
  await wait('CPU preview');
  await wait('*'.repeat(secret.length));
  await capture('inputs-private-form-resumed.png');
  await resize(38, 18);
  await key('Shift+Tab');
  await key('Shift+Tab');
  await wait('Access token');
  await wait('*'.repeat(secret.length));
  await wait('Save settings');
  await wait('Cancel');
  await capture('inputs-private-form-narrow.png');
  await resize(100, 30);
  await key('Shift+Tab');
  await key('Shift+Tab');
  await wait('CPU preview');

  // The window's Escape handler must consume the key before the reactivated
  // input controller can interpret the same event as cancellation.
  await key('F9');
  await key('Alt+Shift+Digit1');
  await observe(() => readJson(fixture.layout), value => value.workspace === 1 && value.focused === 'main' && !value.fullscreen,
    'the form pane moves back beside Plugins');
  await wait('Filter plugins');
  await wait('CPU preview');
  const beforeDrag = await readJson(fixture.layout);
  const frame = await currentPane('Main');
  const separator = frame.x > 0 ? frame.x : frame.x + frame.width - 1;
  await moveCell(separator, frame.y + 3);
  await page.mouse.down();
  await moveCell(separator + (frame.x > 0 ? 4 : -4), frame.y + 3, 5);
  await wait('Drag · Esc cancel');
  await key('Escape');
  await page.mouse.up();
  await absent('Drag · Esc cancel');
  await wait('Preview settings');
  await wait('CPU preview');
  await assert.rejects(readFile(fixture.formReceipt), {code: 'ENOENT'});
  assert.deepEqual((await readJson(fixture.layout)).spaces, beforeDrag.spaces);
  await key('F9');
  await absent('Filter plugins');
  await wait('CPU preview');
  report.checks.push('A private form retains text and masked secret drafts through pane closure and workspace moves while Side completes another task. At 38×18 keyboard field navigation reaches the masked token with save/cancel controls visible. Escape cancels a separator gesture without also cancelling the reactivated form');

  // Focus the URL field directly and correct it; password must remain intact.
  await click('ftp://invalid.test/api');
  await replaceField('https://local.example.test/api');
  for (let index = 0; index < 4; index++) await key('Tab');
  await key('Enter');
  const form = await observe(() => readJson(fixture.formReceipt), value => value.action === 'save', 'trusted plugin receives its private form');
  assert.deepEqual(form, {action: 'save', values: {
    name: 'CPU preview', endpoint: 'https://local.example.test/api', mode: 'fast', enabled: true,
  }, passwordLength: secret.length, passwordHash: createHash('sha256').update(secret).digest('hex')});
  await wait('Preview settings saved');
  await absent('Access token');
  await wait('Message Main…');
  report.formReceipt = form;

  async function verifyPrivacy() {
    const terminal = await readFile(join(output, 'terminal.ansi'), 'utf8');
    assert.ok(!terminal.includes(secret), 'The actual terminal output must never contain a form secret');
    const trace = await readFile(fixture.modelTrace, 'utf8');
    assert.ok(trace.trim(), 'Privacy check must inspect actual model requests');
    assert.ok(!trace.includes(secret), 'The form secret must not enter any actual model request');
    const journals = await files(join(fixture.state, 'sessions'));
    assert.ok(journals.length, 'Privacy check must inspect actual session storage');
    for (const file of journals) assert.ok(!(await readFile(file, 'utf8')).includes(secret), 'Secret leaked into session storage: ' + file);
    report.privacy = {terminalOutput: true, modelRequests: true, sessionFiles: journals.length,
      inputLogExcluded: 'The bench deliberately records synthetic keyboard input; no real credentials are used'};
  }
  await verifyPrivacy();
  report.checks.push('The trusted plugin receives exact text/URL/select/toggle values and the expected private password hash. The synthetic token is absent from actual terminal output, model requests and real session journals');

  const cancelStart = (await readReceipts()).length;
  await submit('request custom');
  await wait('Choose custom destination for Main');
  await key('Alt+i');
  await key('Tab');
  await key('Tab');
  await type('Discard this answer');
  await click('Cancel');
  await wait('Main question cancelled');
  const cancelled = await observe(readReceipts, rows => rows.length > cancelStart, 'cancelled question returns an error to its model');
  assert.ok(!answered(cancelled.at(-1)), 'Cancellation cannot create a user answer');
  await wait('Message Main…');
  await submit('/preview-form');
  await wait('Preview settings');
  await key('Alt+i');
  await wait('Password…');
  assert.ok(!(await screen()).includes('*'.repeat(secret.length)), 'A fresh form must not retain its previous password');
  await click('Cancel');
  await absent('Access token');
  await wait('Preview settings cancelled');
  assert.deepEqual(await readJson(fixture.formReceipt), {cancelled: true});
  await wait('Message Main…');
  await submit('/preview-form');
  await wait('Preview settings');
  await key('Alt+i');
  await wait('Password…');
  await key('Escape');
  await absent('Access token');
  await wait('Preview settings cancelled');
  assert.deepEqual(await readJson(fixture.formReceipt), {cancelled: true});
  report.checks.push('Cancelling a drafted question returns an error rather than a fabricated answer. A fresh form starts with an empty password; its declared Cancel action returns null before required-field validation, and Escape separately closes another fresh form');

  await clearChat('Side');
  await submit('request question');
  await wait('Choose destination for Side');
  const beforeExit = await successes();
  await capture('inputs-pending-shutdown.png');
  bench.afterExit = async () => {
    assert.deepEqual(await successes(), beforeExit, 'Host shutdown must not fabricate an answer for a pending question');
    await verifyPrivacy();
    report.checks.push('Ctrl+C shuts down cleanly with a pending question and creates no answer; the final terminal/model/journal privacy checks remain clean');
  };
}
