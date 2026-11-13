import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.VISUAL_OUTPUT ?? 'dist/visual-opentui-windows');
const timeout = 15_000;
const report = {ok: false, checks: [], screenshots: [], errors: []};
const leaves = tree => !tree ? [] : tree.surface ? [tree.surface] : tree.children.flatMap(leaves);
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
  page = await browser.newPage({viewport: {width: 1850, height: 1100}});
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => report.errors.push(error.message));
  const [socket] = await Promise.all([page.waitForEvent('websocket'), page.goto(url)]);
  const wait = value => page.waitForFunction(value => window.visual?.text().includes(value), value)
    .catch(error => {throw Error('Terminal did not display ' + JSON.stringify(value), {cause: error});});
  const absent = value => page.waitForFunction(value => !window.visual?.text().includes(value), value);
  const screen = () => page.evaluate(() => visual.text());
  const key = value => page.keyboard.press(value);
  async function type(value) {await page.keyboard.type(value); await wait(value);}
  async function point(col, row) {
    return page.evaluate(({col, row}) => {
      const rect = document.querySelector('.xterm-screen').getBoundingClientRect();
      return {x: rect.x + (col + .5) * rect.width / visual.terminal.cols,
        y: rect.y + (row + .5) * rect.height / visual.terminal.rows};
    }, {col, row});
  }
  async function move(col, row, steps = 1) {
    const p = await point(col, row);
    await page.mouse.move(p.x, p.y, {steps});
  }
  async function click(col, row) {
    const p = await point(col, row);
    await page.mouse.click(p.x, p.y);
  }
  async function workspacePoint(id) {
    return page.evaluate(id => {
      const lines = visual.text().split('\n');
      const row = lines.findIndex(line => /^\s*WS\s/.test(line));
      const column = row < 0 ? -1 : lines[row].indexOf(' ' + id + ' ') + 1;
      if (row < 0 || column < 1) throw Error('Workspace button is not visible: ' + id);
      return {column, row};
    }, id);
  }
  async function capture(name) {
    await page.evaluate(() => new Promise(resolve => {
      const subscription = visual.terminal.onRender(() => {
        subscription.dispose(); requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      visual.terminal.refresh(0, visual.terminal.rows - 1);
    }));
    await page.locator('#terminal').screenshot({path: join(output, name)});
    report.screenshots.push(name);
  }
  async function pane(label) {
    return (await page.waitForFunction(label => {
      const lines = visual.text().split('\n');
      for (const [y, line] of lines.entries()) {
        const title = line.indexOf('─ ' + label + ' ');
        if (title < 0) continue;
        const x = line.lastIndexOf('┌', title), right = line.indexOf('┐', title);
        if (x < 0 || right < 0) continue;
        const bottom = lines.findIndex((row, i) => i > y && row[x] === '└' && row[right] === '┘');
        if (bottom >= 0) return {x, y, width: right - x + 1, height: bottom - y + 1};
      }
    }, label)).jsonValue();
  }
  async function geometry(labels) {return Object.fromEntries(await Promise.all(labels.map(async label => [label, await pane(label)])));}
  async function geometryWhen(predicate, reason, labels = ['Main', 'Side', 'Workflows']) {
    const deadline = Date.now() + timeout;
    let frames;
    while (Date.now() < deadline) {
      frames = await geometry(labels);
      if (predicate(frames)) return frames;
      await delay(25);
    }
    throw Error('Visible panes did not satisfy ' + reason + ': ' + JSON.stringify(frames));
  }
  await wait('Message Main…');
  await page.evaluate(() => visual.terminal.resize(160, 45));
  await page.waitForFunction(() => visual.terminal.cols === 160 && visual.terminal.rows === 45);
  await wait('Message Side…');
  const {cwd} = JSON.parse(await readFile(join(output, 'fixture-launch.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(join(cwd, 'opentui-fixture.json'), 'utf8'));
  assert.ok(fixture.layout, 'The fixture must disclose the actual isolated layout path');
  const readLayout = () => readFile(fixture.layout, 'utf8').then(JSON.parse);
  async function layoutWhen(predicate, reason) {
    const deadline = Date.now() + timeout;
    let state;
    while (Date.now() < deadline) {
      state = await readLayout().catch(() => undefined);
      if (state && predicate(state)) return state;
      await delay(25);
    }
    throw Error('Saved layout did not satisfy ' + reason + ': ' + JSON.stringify(state));
  }

  // Distinct live editor contents establish which native instance receives input.
  await type('Main window draft');
  await key('F3');
  await type('Window history');
  await key('Enter');
  await wait('Side reply: Window history');
  await wait('Message Side…');
  await type('Side window draft');
  await key('Home');
  for (let i = 0; i < 4; i++) await key('ArrowRight');
  await key('F10');
  await layoutWhen(state => !state.spaces.flatMap(space => leaves(space.tree)).includes('side'), 'closed Side is absent');
  await absent('Side window draft');
  await key('F3');
  await wait('Side window draft');
  await type('X');
  await wait('SideX window draft');
  await key('F10');
  await absent('SideX window draft');
  await key('F3');
  await wait('SideX window draft');
  await key('Control+z');
  await wait('Side window draft');
  await absent('SideX window draft');
  await key('Control+y');
  await wait('SideX window draft');
  await wait('Side reply: Window history');
  await capture('windows-close-reopen.png');
  report.checks.push('Closing Side hides its pane without discarding its transcript or native editor. Reopening retains draft, cursor and undo history, verified by inserting X at its original position and undoing/redoing it with Ctrl+Z/Ctrl+Y after a second close/reopen');

  await key('F2');
  await wait('Main window draft');
  await key('F4');
  await wait('Preview workflow');
  await key('F7');
  const nested = await geometryWhen(frames => frames.Main.x === frames.Workflows.x
    && frames.Main.y < frames.Workflows.y && frames.Side.x > frames.Main.x, 'nested vertical split');
  assert.equal(nested.Main.x, nested.Workflows.x);
  assert.ok(nested.Main.y < nested.Workflows.y);
  assert.ok(nested.Side.x > nested.Main.x);
  await capture('windows-three-nested.png');
  await key('Alt+k');
  await layoutWhen(state => state.focused === 'main', 'directional focus reaches Main');
  await type(' direction');
  await wait('Main window draft direction');
  await key('Alt+l');
  await layoutWhen(state => state.focused === 'side', 'directional focus reaches Side');
  report.checks.push('Three panes occupy a nested tree simultaneously. F7 changes the nearest split and Alt+k/l moves input geometrically between live conversations');

  // Move Workflows to the top of Side using only a native title drag.
  let frames = await geometry(['Main', 'Side', 'Workflows']);
  await move(frames.Workflows.x + 5, frames.Workflows.y);
  await page.mouse.down();
  await move(frames.Side.x + Math.floor(frames.Side.width / 2), frames.Side.y + 2, 10);
  await page.mouse.up();
  await layoutWhen(state => state.focused === 'workflows', 'drag focuses the moved workflow');
  frames = await geometryWhen(current => current.Workflows.x === current.Side.x
    && current.Workflows.y < current.Side.y && current.Main.x < current.Side.x, 'workflow above Side after edge drop');
  assert.equal(frames.Workflows.x, frames.Side.x);
  assert.ok(frames.Workflows.y < frames.Side.y);
  assert.ok(frames.Main.x < frames.Side.x);
  await capture('windows-title-edge-drop.png');

  const beforeResize = await readLayout();
  // The lower pane's top row is its draggable title. The preceding bottom
  // border is the separator handle for this same split.
  const boundary = frames.Side.y - 1, column = frames.Side.x + Math.floor(frames.Side.width / 2);
  await move(column, boundary);
  await page.mouse.down();
  await move(column, boundary + 3, 8);
  await page.mouse.up();
  await page.waitForFunction(({label, oldY}) => visual.text().split('\n').some((line, y) =>
    y > oldY && line.includes('─ ' + label + ' ')), {label: 'Side', oldY: frames.Side.y});
  const resized = await layoutWhen(state => JSON.stringify(state.spaces) !== JSON.stringify(beforeResize.spaces), 'separator resize persists');
  const afterResize = await geometryWhen(current => current.Workflows.height > frames.Workflows.height
    && current.Side.height < frames.Side.height, 'separator resize');
  assert.ok(afterResize.Workflows.height > frames.Workflows.height);
  assert.ok(afterResize.Side.height < frames.Side.height);
  await capture('windows-separator-resized.png');
  await move(column, afterResize.Side.y - 1);
  await page.mouse.down();
  await move(column, afterResize.Side.y + 1, 8);
  await key('Escape');
  await absent('Drag · Esc cancel');
  await page.mouse.up();
  await layoutWhen(state => JSON.stringify(state.spaces) === JSON.stringify(resized.spaces), 'Escape restores the pre-drag tree');
  assert.deepEqual(await geometryWhen(current => JSON.stringify(current) === JSON.stringify(afterResize), 'cancelled separator resize'), afterResize);
  report.checks.push('Dragging a native title to another pane edge reparents it. Dragging its separator resizes the visible rectangles and saved tree; Escape cancels another resize exactly');

  // A center drop swaps leaves while preserving their native editor instances.
  frames = await geometry(['Main', 'Side', 'Workflows']);
  await move(frames.Workflows.x + 5, frames.Workflows.y);
  await page.mouse.down();
  await move(frames.Main.x + Math.floor(frames.Main.width / 2), frames.Main.y + Math.floor(frames.Main.height / 2), 10);
  await page.mouse.up();
  const swapped = await geometryWhen(current => JSON.stringify(current.Main) === JSON.stringify(frames.Workflows)
    && JSON.stringify(current.Workflows) === JSON.stringify(frames.Main), 'center title swap');
  assert.deepEqual(swapped.Main, frames.Workflows);
  assert.deepEqual(swapped.Workflows, frames.Main);
  await wait('Main window draft direction');
  await wait('SideX window draft');
  await capture('windows-title-center-swap.png');
  report.checks.push('Dropping a title in another pane center swaps their exact rectangles and retains independent native drafts');

  // A native terminal resize can cancel a logical gesture while the pointer
  // remains held. Mouse capture must be released without changing modes during
  // an illegal native transition, and the next real widget click must work.
  const resizeBoundary = swapped.Main.x > 0 ? swapped.Main.x : swapped.Main.x + swapped.Main.width - 1;
  await move(resizeBoundary, swapped.Main.y + 3);
  await page.mouse.down();
  await move(resizeBoundary + (swapped.Main.x > 0 ? 3 : -3), swapped.Main.y + 3, 5);
  await wait('Drag · Esc cancel');
  await page.evaluate(() => visual.terminal.resize(140, 42));
  await page.waitForFunction(() => visual.terminal.cols === 140 && visual.terminal.rows === 42);
  await absent('Drag · Esc cancel');
  await geometryWhen(current => current.Workflows.width < swapped.Workflows.width
    && current.Main.x + current.Main.width <= 140 && current.Side.x + current.Side.width <= 140,
    'terminal resize cancels the held gesture and reprojects all panes');
  await page.mouse.up();
  const workflowPoint = await page.evaluate(() => {
    const lines = visual.text().split('\n');
    const row = lines.findIndex(line => line.includes('Preview workflow'));
    return {column: lines[row].indexOf('Preview workflow') + 5, row};
  });
  await click(workflowPoint.column, workflowPoint.row);
  await wait('Workflow: Preview workflow');
  await click(workflowPoint.column, workflowPoint.row);
  await absent('Workflow: Preview workflow');
  await page.evaluate(() => visual.terminal.resize(160, 45));
  await page.waitForFunction(() => visual.terminal.cols === 160 && visual.terminal.rows === 45);
  assert.deepEqual(await geometryWhen(current => JSON.stringify(current) === JSON.stringify(swapped),
    'restored geometry after viewport-interrupted drag'), swapped);
  assert.ok(!(await readFile(join(output, 'terminal.ansi'), 'utf8'))
    .includes('Cannot change native scene mouse modes during a terminal transition or suspension'));
  await capture('windows-resize-during-drag.png');
  report.checks.push('Resizing the actual terminal during a held separator drag cancels the logical gesture, preserves its prior geometry, and leaves native mouse routing usable for the next Workflow expansion/collapse without a mouse-mode transition exception');

  // Hiding the streaming Main window is independent of cancelling its model turn.
  await key('F2');
  await key('Control+u');
  await wait('Message Main…');
  await type('hold main');
  await key('Enter');
  await wait('Main is working');
  await type('Held Main draft');
  await key('F10');
  await absent('Held Main draft');
  await wait('Main · Running');
  await key('F2');
  await wait('Held Main draft');
  await wait('Main is working');
  report.checks.push('Closing and reopening Main preserves its held stream and unsent draft; window closure does not stop the agent');

  await key('F3');
  await wait('SideX window draft');
  await key('Alt+Shift+Digit2');
  const moved = await layoutWhen(state => state.workspace === 2 && state.focused === 'side'
    && leaves(state.spaces.find(space => space.id === 2)?.tree).includes('side'), 'move Side to workspace 2');
  await wait('SideX window draft');
  await absent('Held Main draft');
  await key('Alt+Digit1');
  await layoutWhen(state => state.workspace === 1, 'switch back to workspace 1');
  await wait('Main is working');
  await absent('SideX window draft');
  await key('Alt+Digit2');
  await layoutWhen(state => state.workspace === 2 && state.focused === 'side', 'restore workspace focus');
  await wait('Side reply: Window history');
  await wait('SideX window draft');
  await capture('windows-workspace-two.png');
  assert.equal(moved.spaces.flatMap(space => leaves(space.tree)).filter(id => id === 'side').length, 1);
  report.checks.push('Shift+Alt+2 moves Side to workspace 2 without duplication. Alt+1/2 switches layouts and restores each workspace focus and live draft');

  // Return to a nontrivial tree for the small-screen projection, then persist
  // an intentionally closed pane and selected workspace across a real restart.
  const sideOnTwo = await pane('Side');
  const firstWorkspace = await workspacePoint(1), secondWorkspace = await workspacePoint(2);
  await move(sideOnTwo.x + 5, sideOnTwo.y);
  await page.mouse.down();
  await move(firstWorkspace.column, firstWorkspace.row, 10);
  await page.mouse.up();
  await layoutWhen(state => state.workspace === 1 && state.focused === 'side', 'title drop moves Side to workspace 1');
  await wait('SideX window draft');
  await click(secondWorkspace.column, secondWorkspace.row);
  await layoutWhen(state => state.workspace === 2, 'mouse selects workspace 2');
  await wait('Empty workspace');
  await click(firstWorkspace.column, firstWorkspace.row);
  await layoutWhen(state => state.workspace === 1 && state.focused === 'side', 'mouse restores workspace 1');
  await wait('SideX window draft');
  report.checks.push('A captured native title drag releases on the workspace bar and moves Side there. Mouse workspace buttons switch to an empty workspace and return with the editor intact');
  const wide = await geometry(['Main', 'Side', 'Workflows']);
  const savedWide = await readLayout();
  await page.evaluate(() => visual.terminal.resize(38, 18));
  await page.waitForFunction(() => visual.terminal.cols === 38 && visual.terminal.rows === 18);
  await wait('SideX window draft');
  await key('F2');
  await wait('Held Main draft');
  await key('F4');
  await wait('Preview workflow');
  await key('F3');
  await wait('SideX window draft');
  await page.evaluate(() => visual.terminal.resize(160, 45));
  await page.waitForFunction(() => visual.terminal.cols === 160 && visual.terminal.rows === 45);
  assert.deepEqual(await geometryWhen(current => JSON.stringify(current) === JSON.stringify(wide), 'wide geometry restoration'), wide);
  const afterNarrow = await layoutWhen(state => state.focused === 'side', 'focused Side after widening');
  assert.deepEqual(afterNarrow.spaces, savedWide.spaces);
  await capture('windows-wide-restored.png');
  report.checks.push('At 38×18 each collapsed pane remains reachable through its real shortcut. Widening restores exact frame geometry and the saved tree ratios');

  await key('F5');
  await key('F10');
  await layoutWhen(state => !state.spaces.flatMap(space => leaves(space.tree)).includes('plugins'), 'closed Plugins remains absent');
  await key('F3');
  await key('Alt+Shift+Digit2');
  await key('Alt+Digit1');
  await key('F2');
  const beforeCustom = await layoutWhen(state => state.workspace === 1 && state.focused === 'main', 'focus the remaining Main split');
  const viewport = await page.evaluate(() => {
    const lines = visual.text().split('\n');
    const y = lines.findIndex(line => line.startsWith('┌'));
    const footer = lines.findLastIndex(line => /^\s*F\d+ Focus/.test(line));
    return {x: 0, y, width: visual.terminal.cols, height: footer - y};
  });
  assert.deepEqual(viewport, {x: 0, y: 2, width: 160, height: 42});
  const remainingGeometry = state => {
    const tree = state.spaces.find(space => space.id === 1)?.tree;
    assert.equal(tree?.axis, 'vertical', 'The remaining workspace must have a top/bottom split');
    assert.deepEqual(tree.children.map(child => child.surface).sort(), ['main', 'workflows']);
    const firstHeight = Math.max(6, Math.min(viewport.height - 6, Math.floor(viewport.height * tree.ratio)));
    const labels = {main: 'Main', workflows: 'Workflows'};
    return Object.fromEntries(tree.children.map((child, index) => [labels[child.surface], {
      x: viewport.x, y: viewport.y + (index ? firstHeight : 0), width: viewport.width,
      height: index ? viewport.height - firstHeight : firstHeight,
    }]));
  };
  const sameFrames = (actual, expected) => Object.keys(expected).every(label =>
    JSON.stringify(actual[label]) === JSON.stringify(expected[label]));
  const beforeFrames = remainingGeometry(beforeCustom);
  const actualBefore = await geometryWhen(current => sameFrames(current, beforeFrames),
    'rendered pre-resize two-pane split must match its persisted ratio', ['Main', 'Workflows']);
  assert.deepEqual(actualBefore, beforeFrames);
  await capture('windows-before-custom-ratio.png');
  await key('Alt+ArrowRight');
  const customized = await layoutWhen(state => state.workspace === 1 && JSON.stringify(state.spaces)
    !== JSON.stringify(beforeCustom.spaces), 'custom split ratio before restart');
  assert.ok(JSON.stringify(customized.spaces).includes('ratio'), 'Restart must cover a real remaining split');
  const beforeTree = beforeCustom.spaces.find(space => space.id === 1).tree;
  const expectedRatio = Math.max(.15, Math.min(.85, beforeTree.ratio + (beforeTree.children[0].surface === 'main' ? .05 : -.05)));
  assert.equal(customized.spaces.find(space => space.id === 1).tree.ratio, expectedRatio);
  const expectedCustomFrames = remainingGeometry(customized);
  const customFrames = await geometryWhen(current => sameFrames(current, expectedCustomFrames),
    'rendered custom split must match the persisted resized boundary', ['Main', 'Workflows']);
  assert.deepEqual(customFrames, expectedCustomFrames);
  report.customSplit = {viewport, before: {saved: beforeCustom, frames: actualBefore},
    customized: {saved: customized, frames: customFrames}};
  await capture('windows-custom-ratio.png');
  await key('Alt+Digit2');
  await key('F9');
  const beforeRestart = await layoutWhen(state => state.workspace === 2 && state.focused === 'side' && state.fullscreen,
    'saved selected workspace, focus and fullscreen');
  const generation = await page.evaluate(() => visual.generation);
  await page.click('#restart');
  await page.waitForFunction(generation => visual.generation > generation && visual.frames > 0 &&
    visual.text().includes('Message Side…'), generation);
  const afterRestart = await readLayout();
  assert.deepEqual(afterRestart, beforeRestart);
  await absent('Filter plugins');
  await absent('Held Main draft');
  await capture('windows-layout-restarted.png');
  await key('Alt+Digit1');
  await wait('Message Main…');
  await wait('Preview workflow');
  await absent('Filter plugins');
  assert.deepEqual(await geometry(['Main', 'Workflows']), customFrames);
  const restoredTree = await readLayout();
  assert.deepEqual(restoredTree.spaces, beforeRestart.spaces);
  report.layoutBeforeRestart = beforeRestart;
  report.layoutAfterRestart = afterRestart;
  report.checks.push('A real PTY restart restores the exact serialized nested tree, custom split ratio, selected workspace, focus, fullscreen and deliberately closed Plugins pane. Conversation history and drafts are not claimed to survive restart');

  await key('Alt+Digit9');
  const empty = await layoutWhen(state => state.workspace === 9
    && leaves(state.spaces.find(space => space.id === 9)?.tree).length === 0, 'persist empty workspace 9');
  await absent('Message Main…');
  await absent('Message Side…');
  const emptyGeneration = await page.evaluate(() => visual.generation);
  await page.click('#restart');
  await page.waitForFunction(generation => visual.generation > generation && visual.frames > 0 &&
    visual.text().includes('F2 Main'), emptyGeneration);
  assert.deepEqual(await readLayout(), empty);
  await absent('Message Main…');
  await absent('Message Side…');
  await capture('windows-empty-workspace-restarted.png');
  report.emptyWorkspaceAfterRestart = await readLayout();
  report.checks.push('An empty selected workspace also survives a real PTY restart without reopening hidden panes or returning to workspace 1');

  const [exit] = await Promise.all([
    socket.waitForEvent('framereceived', {predicate: frame => JSON.parse(String(frame.payload)).type === 'exit', timeout}),
    key('Control+c'),
  ]);
  report.ptyExitCode = JSON.parse(String(exit.payload)).code;
  assert.equal(report.ptyExitCode, 0);
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
