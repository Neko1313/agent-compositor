import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.VISUAL_OUTPUT ?? 'dist/visual-window-controls');
const timeout = 15_000;
const report = {ok: false, mode: process.env.VISUAL_EXECUTABLE ? 'binary' : 'source', checks: [], screenshots: [], errors: [], fixtures: []};
const leaves = tree => !tree ? [] : tree.surface ? [tree.surface] : tree.children.flatMap(leaves);
const splitFor = (tree, id) => !tree || tree.surface ? undefined
  : tree.children.map(child => splitFor(child, id)).find(Boolean)
    ?? (leaves(tree).includes(id) ? tree : undefined);
await mkdir(output, {recursive: true});

async function eventually(read, predicate, description) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await delay(25);
  }
  throw Error(description + ': ' + JSON.stringify(last));
}

async function runFixture(name, fixtureEnv, scenario) {
  const directory = join(output, name);
  await mkdir(directory, {recursive: true});
  for (const file of ['failure.png', 'failure.txt']) await rm(join(directory, file), {force: true});
  let server, serverExit, browser, page, identity;
  const fixtureReport = {name, checks: [], errors: []};
  report.fixtures.push(fixtureReport);
  try {
    assert.ok(!process.env.VISUAL_EXECUTABLE || !process.env.VISUAL_PLUGIN_DIR, 'Native proof cannot override bundled plugin directories');
    server = spawn('bun', ['tools/visual/server.mjs'], {cwd: root, env: {
      ...process.env, ...fixtureEnv, VISUAL_OUTPUT: directory,
      VISUAL_WINDOW_CONTROLS: '1', VISUAL_IDENTITY_PLUGIN: '', AGENT_GRAPHICS: 'off',
      AGENT_API_KEY: 'visual-window-controls',
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
    page = await browser.newPage({viewport: {width: 1700, height: 1100}});
    page.setDefaultTimeout(timeout);
    page.on('pageerror', error => fixtureReport.errors.push(error.message));
    const [socket] = await Promise.all([page.waitForEvent('websocket'), page.goto(url)]);
    let ptyExit;
    socket.on('framereceived', ({payload}) => {
      try {const message = JSON.parse(String(payload)); if (message.type === 'exit') ptyExit = message.code;} catch {}
    });
    const key = value => page.keyboard.press(value);
    const screen = () => page.evaluate(() => visual.text());
    const wait = value => page.waitForFunction(value => window.visual?.text().replaceAll('▏', '').includes(value), value)
      .catch(error => {throw Error('Terminal did not display ' + JSON.stringify(value), {cause: error});});
    const absent = value => page.waitForFunction(value => !window.visual?.text().includes(value), value)
      .catch(error => {throw Error('Terminal retained ' + JSON.stringify(value), {cause: error});});
    const waitExact = value => page.waitForFunction(value => window.visual?.text().includes(value), value)
      .catch(error => {throw Error('Terminal did not display exact ' + JSON.stringify(value), {cause: error});});
    async function resize(cols, rows) {
      const before = await page.evaluate(() => visual.frames);
      await page.evaluate(({cols, rows}) => visual.terminal.resize(cols, rows), {cols, rows});
      await page.waitForFunction(({cols, rows, before}) => visual.frames > before
        && visual.terminal.cols === cols && visual.terminal.rows === rows
        && visual.terminal.buffer.active.getLine(rows - 1)?.translateToString(true).trim(), {cols, rows, before});
    }
    async function capture(label) {
      await page.evaluate(() => new Promise(done => {
        const subscription = visual.terminal.onRender(() => {
          subscription.dispose(); requestAnimationFrame(() => requestAnimationFrame(done));
        });
        visual.terminal.refresh(0, visual.terminal.rows - 1);
      }));
      await page.locator('#terminal').screenshot({path: join(directory, label + '.png')});
      await writeFile(join(directory, label + '.txt'), await screen());
      report.screenshots.push(name + '/' + label + '.png');
    }
    async function click(value) {
      await wait(value);
      const point = await page.evaluate(value => {
        const lines = visual.text().split('\n'), row = lines.findIndex(line => line.includes(value));
        const col = lines[row].indexOf(value) + 1;
        const rect = document.querySelector('.xterm-screen').getBoundingClientRect();
        return {x: rect.x + (col + .5) * rect.width / visual.terminal.cols,
          y: rect.y + (row + .5) * rect.height / visual.terminal.rows};
      }, value);
      await page.mouse.click(point.x, point.y);
    }
    async function command(value) {
      await key('Alt+i'); await page.keyboard.type(value); await wait('› ' + value); await key('Enter');
    }
    const readLayout = () => readFile(join(identity.state, 'layout.json'), 'utf8').then(JSON.parse);
    const layoutWhen = (predicate, description) => eventually(readLayout, predicate, description);
    const currentTree = layout => layout.windows.spaces.find(space => space.id === layout.windows.workspace)?.tree;
    async function geometry(titles) {
      return eventually(async () => {
        const lines = (await screen()).split('\n'), frames = {};
        for (const title of titles) for (let row = 1; row < lines.length; row++) {
          const at = lines[row].indexOf(title);
          if (at < 0) continue;
          const x = lines[row].lastIndexOf('│', at), right = lines[row].indexOf('│', at + title.length);
          if (x < 0 || right < 0 || lines[row - 1]?.[x] !== '┌') continue;
          const bottom = lines.findIndex((line, index) => index > row && line[x] === '└' && line[right] === '┘');
          if (bottom >= 0) {frames[title] = {x, y: row - 1, width: right - x + 1, height: bottom - row + 2}; break;}
        }
        return frames;
      }, frames => Object.keys(frames).length === titles.length, 'Actual rendered pane geometry missing');
    }
    async function events() {
      const paths = await readdir(join(identity.state, 'sessions')).catch(() => []);
      return (await Promise.all(paths.filter(path => path.endsWith('.jsonl')).map(async path =>
        (await readFile(join(identity.state, 'sessions', path), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)))).flat();
    }
    const check = description => {fixtureReport.checks.push(description); report.checks.push(description);};
    async function picker(query) {
      await key('F2'); await wait('Find:');
      if (query) {await page.keyboard.type(query); await wait('Find: ' + query);}
    }
    async function pick(query) {
      await picker(query); await key('Enter'); await absent('Find:'); await absent('WINDOW MODE');
    }
    await wait('Describe your task');
    identity = await eventually(() => readFile(join(directory, 'window-controls-launch.json'), 'utf8').then(JSON.parse).catch(() => null), Boolean, 'Fixture launch identity missing');
    assert.ok(identity.cwd.includes('compositor-visual-'), 'Only the isolated bench project may be inspected');
    assert.equal(identity.mode, report.mode);
    if (process.env.VISUAL_EXECUTABLE) {
      assert.equal(identity.executable, resolve(process.env.VISUAL_EXECUTABLE));
      assert.equal(identity.sha256, createHash('sha256').update(await readFile(identity.executable)).digest('hex'));
      report.executable = {path: identity.executable, sha256: identity.sha256};
    }
    await command('/mascot off');
    await absent('Message ·');
    await resize(140, 42); await wait('[Windows]');
    await key('Alt+t'); await wait('No tools called yet.');
    await layoutWhen(layout => leaves(currentTree(layout)).length >= 3, 'Fixture must have a genuinely nested three-pane tree');
    await scenario({page, key, wait, waitExact, absent, screen, resize, capture, click, command, picker, pick,
      readLayout, layoutWhen, currentTree, geometry, events, check, directory, identity});
    await writeFile(join(directory, 'session-events.json'), JSON.stringify(await events(), null, 2));
    await writeFile(join(directory, 'saved-layout.json'), JSON.stringify(await readLayout(), null, 2));
    await key('Control+c');
    await eventually(async () => ptyExit, value => value === 0, 'PTY did not exit cleanly');
    fixtureReport.ptyExitCode = ptyExit;
    assert.equal(fixtureReport.errors.length, 0);
  } catch (error) {
    fixtureReport.errors.push(String(error));
    if (page) {
      await writeFile(join(directory, 'failure.txt'), await page.evaluate(() => window.visual?.text() ?? '').catch(() => '')).catch(() => {});
      await page.screenshot({path: join(directory, 'failure.png')}).catch(() => {});
    }
    if (identity) await readFile(join(identity.state, 'layout.json')).then(data => writeFile(join(directory, 'failure-layout.json'), data)).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (server?.exitCode === null) {server.kill('SIGTERM'); await serverExit;}
  }
}

try {
  await runFixture('approval', {VISUAL_UX: '1'}, async bench => {
    const {page, key, wait, waitExact, absent, screen, resize, capture, click, command, picker, pick,
      readLayout, layoutWhen, currentTree, geometry, events, check, directory} = bench;
    await key('Alt+i');
    await page.keyboard.type('WINDOW draft KeEp 47'); await wait('› WINDOW draft KeEp 47');
    await key('Home'); await waitExact('› ▏WINDOW draft KeEp 47');
    await key('ArrowRight'); await waitExact('› W▏INDOW draft KeEp 47');
    const editorFocus = (await readLayout()).windows.focused;
    await picker('Todos');
    await wait('WS 1');
    await capture('01-inventory');
    await key('Escape'); await absent('Find:');
    await layoutWhen(layout => layout.windows.focused === editorFocus, 'Picker Escape must restore exact focus');
    await page.keyboard.type('_'); await wait('› W_INDOW draft KeEp 47');
    check('Inventory filtering and Escape preserve the exact message draft, cursor and previous input focus');

    await pick('Todos');
    const todos = (await readLayout()).windows.focused;
    assert.match(todos, /todos/);
    await key('Alt+w'); await wait('WINDOW MODE'); await wait('b/v split');
    await key('v');
    await layoutWhen(layout => splitFor(currentTree(layout), todos)?.axis === 'vertical', 'v must orient nearest split vertically');
    await key('b');
    const beforeResize = await layoutWhen(layout => splitFor(currentTree(layout), todos)?.axis === 'horizontal', 'b must orient nearest split horizontally');
    const ratio = splitFor(currentTree(beforeResize), todos).ratio;
    await key('+');
    await layoutWhen(layout => splitFor(currentTree(layout), todos)?.ratio !== ratio, '+ must resize nearest split');
    await key('-');
    await layoutWhen(layout => Math.abs(splitFor(currentTree(layout), todos)?.ratio - ratio) < 1e-9, '- must reverse the resize');
    const treeBeforeMove = JSON.stringify(currentTree(await readLayout()));
    await key('Shift+ArrowLeft');
    await layoutWhen(layout => JSON.stringify(currentTree(layout)) !== treeBeforeMove && layout.windows.focused === todos,
      'Shift+direction must move the same pane in the nested tree');
    const beforeTab = (await readLayout()).windows.focused;
    await key('Tab');
    await layoutWhen(layout => layout.windows.focused !== beforeTab && layout.windows.focused !== 'input', 'Tab must cycle content focus');
    await wait('WINDOW MODE'); await capture('02-window-mode');
    await key('i'); await absent('WINDOW MODE'); await wait('› W_INDOW draft KeEp 47');
    check('Persistent WINDOW mode controls nearest split orientation, nested pane movement, reversible resize and content cycling without changing the draft');

    // Clear through the default editor's grapheme-aware Backspace path.
    await key('End');
    for (let i = 0; i < 'W_INDOW draft KeEp 47'.length; i++) await key('Backspace');
    await command('/windows'); await wait('Find:'); await key('Escape'); await absent('Find:');
    assert.ok(!(await events()).some(event => event.type === 'prompt.submit' && event.text === '/windows'), '/windows must remain host-owned');
    await command('Review window controls');
    await wait('Approval needed'); await wait('Tool: exec');
    const before = await events();
    const prompts = before.filter(event => ['prompt.submit', 'prompt.steer'].includes(event.type) && !String(event.text).startsWith('/')).map(event => event.text);
    assert.deepEqual(prompts, ['Review window controls']);
    assert.equal(before.filter(event => event.type === 'tool.result' && event.tool === 'exec').length, 0);
    await key('Alt+w'); await wait('WINDOW MODE');
    await page.keyboard.type('yn'); await key('Enter');
    await absent('WINDOW MODE'); await wait('Approval needed');
    await picker('Conversation'); await wait('WS 1'); await key('Enter'); await absent('Find:');
    const original = (await readLayout()).windows.focused;
    assert.equal(original, 'session');
    await key('Alt+w'); await key('q');
    await layoutWhen(layout => !layout.windows.spaces.flatMap(space => leaves(space.tree)).includes(original), 'q must close Conversation');
    await picker('Conversation'); await wait('Closed'); await capture('03-closed-conversation');
    await click('› Conversation'); await absent('Find:');
    const reopened = await layoutWhen(layout => layout.windows.focused === original, 'Picker must reopen original Conversation identity');
    assert.equal(reopened.windows.spaces.flatMap(space => leaves(space.tree)).filter(id => id === original).length, 1);
    assert.equal((reopened.views ?? []).filter(view => view.kind === 'session').length, 0, 'Reopening the original must not create a duplicate Conversation view');
    await key('PageUp'); await wait('Review window controls'); await wait('Approval needed');
    const pending = await events();
    assert.deepEqual(pending.filter(event => ['prompt.submit', 'prompt.steer'].includes(event.type) && !String(event.text).startsWith('/')).map(event => event.text), prompts);
    assert.equal(pending.filter(event => event.type === 'tool.result' && event.tool === 'exec').length, 0);
    await capture('04-reopened-pending');
    check('WINDOW mode y/n/Enter and searchable closed-Conversation recovery leave approval pending, retain history and reopen one existing pane without a model prompt');

    await key('Alt+i'); await wait('Tool: exec'); await key('n');
    await wait('Permission review complete.');
    const denied = await eventually(events, rows => rows.some(event => event.type === 'tool.result' && event.tool === 'exec'), 'Explicit denial must settle the real tool');
    assert.equal(denied.find(event => event.type === 'tool.result' && event.tool === 'exec').ok, false);
    check('Only explicit denial outside WINDOW mode settles the pending print-only exec request');

    await pick('Todos');
    await key('Alt+w'); await wait('WINDOW MODE');
    // Digit2 selects the physical key; Shift+2 in Playwright retains text "2".
    await key('Shift+Digit2');
    await layoutWhen(layout => leaves(layout.windows.spaces.find(space => space.id === 2)?.tree).includes(todos), 'Shift+2 must move pane to workspace 2');
    await key('2');
    await layoutWhen(layout => layout.windows.workspace === 2 && layout.windows.focused === todos, '2 must switch to moved pane workspace');
    await key('f'); await wait('FULLSCREEN');
    await key('f'); await absent('FULLSCREEN');
    await resize(48, 18); await wait('WINDOW MODE'); await capture('05-narrow-mode');
    assert.ok((await screen()).includes('Esc'), 'Narrow WINDOW mode must retain its exit affordance');
    await resize(38, 18); await wait('WINDOW MODE'); await capture('05b-small-mode');
    assert.ok((await screen()).includes('Esc'), 'Small WINDOW mode must retain its exit affordance');
    await resize(48, 18); await wait('WINDOW MODE');
    await key('Escape'); await absent('WINDOW MODE');
    await key('F2'); await wait('Find:'); await capture('06-narrow-inventory');
    await key('Escape'); await absent('Find:');
    await resize(140, 42); await wait('[Windows]');
    await click('[Windows]'); await wait('Find:');
    await page.keyboard.type('Conversation'); await wait('WS 1');
    await key('Escape'); await absent('Find:');
    check('Workspace move/switch, fullscreen, narrow mode and inventory remain discoverable; clickable Windows opens all-workspace inventory');

    await key('Alt+w'); await wait('WINDOW MODE'); await key('1');
    await layoutWhen(layout => layout.windows.workspace === 1, 'Mode workspace switch back to 1');
    await key('Escape'); await absent('WINDOW MODE');
    await pick('Conversation');
    await key('Alt+/'); await wait('Window controls');
    await layoutWhen(layout => leaves(currentTree(layout)).length >= 3, 'Saved workspace must retain a nested three-pane tree');
    await pick('Conversation');
    await key('Alt+w'); await wait('WINDOW MODE');
    await key('v');
    const oriented = await layoutWhen(layout => splitFor(currentTree(layout), 'session')?.axis === 'vertical', 'Saved nearest split must actually be vertical');
    const previousRatio = splitFor(currentTree(oriented), 'session').ratio;
    await key('+');
    await layoutWhen(layout => splitFor(currentTree(layout), 'session')?.ratio !== previousRatio, 'Saved nearest split must actually have a custom ratio');
    await key('Escape'); await absent('WINDOW MODE');
    const saved = await readLayout();
    const titles = ['Conversation', 'Tools', 'Window controls'];
    const beforeGeometry = await geometry(titles);
    await writeFile(join(directory, 'before-restart-layout.json'), JSON.stringify(saved, null, 2));
    await writeFile(join(directory, 'before-restart-geometry.json'), JSON.stringify(beforeGeometry, null, 2));
    const generation = await page.evaluate(() => visual.generation);
    await page.click('#restart');
    await page.waitForFunction(generation => visual.generation > generation && visual.frames > 0 && visual.text().includes('[Windows]'), generation);
    const restored = await layoutWhen(layout => JSON.stringify(layout.windows.spaces) === JSON.stringify(saved.windows.spaces), 'Restart must restore exact nested tree, ratios, workspaces and focus');
    assert.equal(restored.windows.workspace, saved.windows.workspace);
    assert.deepEqual(await geometry(titles), beforeGeometry, 'Restart must reproduce actual rendered pane geometry');
    await capture('07-restored-tree');
    await picker('Todos'); await wait('WS 2'); await key('Enter'); await absent('Find:');
    await layoutWhen(layout => layout.windows.workspace === 2 && layout.windows.focused === todos, 'Inventory Enter must switch to existing pane workspace after restart');
    check('Process restart restores the complete nested tree and custom ratios; inventory navigates to the existing pane on another workspace');
  });

  await runFixture('question', {VISUAL_QUESTIONS: '1'}, async ({page, key, wait, absent, capture, command, picker, events, check}) => {
    await command('Configure project'); await wait('Where should the application run?');
    await key('Alt+w'); await wait('WINDOW MODE');
    await page.keyboard.type('yn'); await key('Tab'); await key('Enter');
    await absent('WINDOW MODE'); await wait('Answer needed');
    await picker('Conversation'); await key('Enter'); await absent('Find:');
    await key('F2'); await wait('Find:'); await page.keyboard.type('Production');
    await wait('Find: Production'); await key('Enter'); await wait('Find: Production');
    await key('Escape'); await absent('Find:'); await wait('Answer needed');
    const rows = await events();
    assert.deepEqual(rows.filter(event => ['prompt.submit', 'prompt.steer'].includes(event.type) && !String(event.text).startsWith('/')).map(event => event.text), ['Configure project']);
    assert.equal(rows.filter(event => event.type === 'tool.result' && event.tool === 'ask_questions').length, 0);
    await capture('08-question-still-pending');
    await key('Alt+i'); await wait('Where should the application run?');
    await key('Escape');
    await eventually(events, rows => rows.some(event => event.type === 'tool.result' && event.tool === 'ask_questions'), 'Explicit Escape must settle the question');
    await eventually(events, rows => rows.some(event => ['turn.complete', 'turn.failed'].includes(event.type)), 'Cancelled question turn must settle');
    check('Window mode and inventory text/Enter/Escape do not answer a pending questionnaire or submit prompts; explicit question cancellation remains available');
  });
} catch (error) {
  report.errors.push(String(error));
} finally {
  report.ok = report.errors.length === 0 && report.fixtures.every(fixture => fixture.errors.length === 0);
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
