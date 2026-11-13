import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const plugin = 'preview-notes';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const readState = fixture => readJson(join(fixture.state, 'extensions-state.json'));

export async function installDuringApproval({page, wait, click, capture, report, fixture}) {
  await page.keyboard.press('F5');
  await wait('Filter plugins');
  await page.keyboard.press('F9');
  await wait('yn kept');
  await wait('Approval pending');
  await wait('Main · Approval');
  await page.keyboard.press('/');
  await wait('Enter or Esc returns to results');
  await page.keyboard.type('missing-preview-item');
  await wait('missing-preview-item');
  await wait('No matching plugins');
  await page.keyboard.press('Control+u');
  await page.keyboard.type(plugin);
  await wait(plugin + '@preview-market');
  await wait('1 result');
  await wait('Catalog v1.0.0');
  await wait('Not installed');
  await wait('Not loaded');
  await page.keyboard.press('Enter');
  await wait('Enter run');
  await wait('yn kept');
  await wait('Approval pending');
  await capture('plugins-catalog-pending.png');
  await page.keyboard.press('Alt+y');
  await wait('Main · Approval');
  // Leaving the filter selects a result. A second Enter explicitly installs it.
  await assert.rejects(readFile(fixture.manifest), {code: 'ENOENT'});
  await page.keyboard.press('Enter');
  await wait('Installed v1.0.0');
  await wait('Saved off');
  assert.equal((await readJson(fixture.manifest)).version, '1.0.0');
  const installed = await readState(fixture);
  assert.equal(installed.installed[plugin].version, '1.0.0');
  assert.equal(installed.installed[plugin].scope, 'project');
  assert.ok(!installed.enabled?.includes(plugin));
  await click('Enable');
  await wait('Saved on');
  await wait('reload pending');
  await wait('Not loaded');
  assert.ok((await readState(fixture)).enabled.includes(plugin));
  await page.evaluate(() => visual.terminal.resize(48, 18));
  await page.waitForFunction(() => visual.terminal.cols === 48 && visual.terminal.rows === 18 &&
    ['Main · Approval', 'F5 Plugins', 'Saved on', 'Not loaded'].every(label => visual.text().includes(label)));
  await capture('plugins-enabled-pending-narrow.png');
  await page.keyboard.press('Alt+y');
  await wait('Main · Approval');
  await assert.rejects(readFile(join(fixture.cwd, 'main-note.txt')), {code: 'ENOENT'});
  await page.evaluate(() => visual.terminal.resize(100, 30));
  await wait('yn kept');
  await page.keyboard.press('F9');
  await page.waitForFunction(() => !visual.text().includes('yn kept'));
  await page.keyboard.press('F2');
  await wait('Approval required');
  report.checks.push('The manager and Main approval are tiled together. Filtering handles an empty result, installation is project-scoped and inactive, and enable stays pending. At 48×18 Alt+Y in the manager leaves the Main write pending');
}

async function publishLocalUpdate(fixture) {
  // Simulate a new upstream release. The installed checkout and its lock are exclusively owned by the app.
  const manifestPath = join(fixture.source, 'plugin.json');
  const catalogPath = join(fixture.catalogRoot, '.claude-plugin', 'marketplace.json');
  const hookPath = join(fixture.source, 'hooks.js');
  const manifest = await readJson(manifestPath);
  const catalog = await readJson(catalogPath);
  const hook = await readFile(hookPath, 'utf8');
  assert.equal(manifest.version, '1.0.0');
  assert.ok(hook.includes("'1.0.0'"));
  manifest.version = '1.1.0';
  catalog.plugins.find(row => row.name === plugin).version = manifest.version;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(hookPath, hook.replace("'1.0.0'", "'1.1.0'"));
  await writeFile(catalogPath, JSON.stringify(catalog));
}

export async function manageLoadedPlugin({page, wait, click, capture, report, fixture}) {
  const command = '/preview-note';
  async function submit(value) {
    await wait('Message Main…');
    await page.keyboard.type(value);
    await page.waitForFunction(value => {
      const lines = visual.text().split('\n');
      const editor = lines.findIndex(line => line.includes('Main · Ready'));
      return editor >= 0 && lines[editor + 1]?.includes(value);
    }, value);
    await page.keyboard.press('Enter');
  }
  async function verifyCommand(version) {
    await submit(command);
    await wait('Recorded preview note');
    const receipt = await readJson(fixture.receipt);
    assert.deepEqual(receipt, {version}, 'The command must execute its own version of the hook');
    await wait('Recorded preview note ' + version);
    return receipt;
  }

  await page.keyboard.press('F5');
  await wait('Loaded v1.0.0');
  await wait('Saved on');
  await capture('plugins-loaded.png');
  await page.keyboard.press('F2');
  const firstReceipt = await verifyCommand('1.0.0');
  await submit('request write');
  await wait('Tool: write');
  await page.keyboard.press('F5');
  await wait('Loaded v1.0.0');
  await publishLocalUpdate(fixture);
  await click('Refresh');
  await wait('Catalog v1.1.0');
  await click('Update');
  await wait('queued');
  await wait('Installed v1.0.0');
  await wait('Loaded v1.0.0');
  assert.equal((await readJson(fixture.manifest)).version, '1.0.0');
  assert.equal((await readState(fixture)).installed[plugin].version, '1.0.0');
  await capture('plugins-update-queued.png');
  await page.keyboard.press('F2');
  await wait('Tool: write');
  await click('Alt+N Deny');
  await wait('Main · Ready');
  await page.keyboard.press('F5');
  await wait('Installed v1.1.0');
  await wait('Loaded v1.1.0');
  assert.equal((await readJson(fixture.manifest)).version, '1.1.0');
  assert.ok((await readFile(join(fixture.cwd, '.agent-compositor', 'plugins', plugin, 'hooks.js'), 'utf8'))
    .includes("const version = '1.1.0'"));
  assert.equal((await readState(fixture)).installed[plugin].version, '1.1.0');
  await page.keyboard.press('F2');
  report.pluginCommandReceipts = [firstReceipt, await verifyCommand('1.1.0')];
  await page.keyboard.press('F5');
  await wait('Loaded v1.1.0');
  report.checks.push('The loaded /preview-note hook writes its own v1.0.0 receipt. A local v1.1.0 release is discovered on Refresh, Update queues without replacing files under a pending approval, and the hook writes a v1.1.0 receipt after Main is idle');
  await click('Disable');
  await wait('Saved off');
  await wait('Not loaded');
  assert.ok(!(await readState(fixture)).enabled?.includes(plugin));
  await page.keyboard.press('F2');
  await submit(command);
  await wait('Main reply: ' + command);
  assert.deepEqual(await readJson(fixture.receipt), {version: '1.1.0'});
  await page.keyboard.press('F5');
  await wait('Not loaded');
  await click('Remove');
  await wait('Confirm remove');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !visual.text().includes('Confirm remove'));
  assert.equal((await readJson(fixture.manifest)).version, '1.1.0');
  await click('Remove');
  await wait('Confirm remove');
  await click('Confirm remove');
  await wait('Not installed');
  await wait('Not loaded');
  assert.equal((await readState(fixture)).installed[plugin], undefined);
  await assert.rejects(readFile(fixture.manifest), {code: 'ENOENT'});
  await capture('plugins-removed.png');
  await page.keyboard.press('F2');
  await wait('Message Main…');
  report.checks.push('Disable unloads the plugin and the preview provider receives its former command. Cancelling removal keeps the package, and confirmed removal clears its project lock and installed files');
}
