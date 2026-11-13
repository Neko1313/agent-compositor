import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {storagePaths} from '@agent-compositor/config';

/** A local upstream release, installed and activated through the normal manager. */
export async function seedOpenTuiPlugin(cwd: string, home: string) {
  const catalogRoot = join(home, 'preview-market');
  const source = join(catalogRoot, 'preview-notes');
  await mkdir(join(catalogRoot, '.claude-plugin'), {recursive: true});
  await mkdir(source, {recursive: true});
  await writeFile(join(source, 'plugin.json'), JSON.stringify({
    name: 'preview-notes', version: '1.0.0', trust: 'trusted', main: 'hooks.js',
    description: 'Record a local preview note without a model request.',
    commands: [{name: '/preview-note', description: 'Record the loaded preview version', execution: 'immediate'}],
  }, null, 2));
  await writeFile(join(source, 'hooks.js'), `const version = '1.0.0';
export default {
  'command.invoke': async (event, $) => {
    if (event.name !== '/preview-note') return;
    await $.storage.set('last-run', {version});
    await $.ui.notify('Recorded preview note ' + version);
  },
};
`);
  await writeFile(join(catalogRoot, '.claude-plugin/marketplace.json'), JSON.stringify({
    name: 'preview-market', owner: {name: 'Local preview'}, plugins: [{
      name: 'preview-notes', version: '1.0.0', description: 'Record a local preview note without a model request.',
      source: './preview-notes', compositor: {format: 'native'},
    }],
  }, null, 2));
  const paths = storagePaths(cwd, {HOME: home, AGENT_HOME: join(home, '.agent-compositor')});
  const fixture = {
    cwd, home: paths.home, state: paths.state, catalogRoot, source,
    manifest: join(cwd, '.agent-compositor/plugins/preview-notes/plugin.json'),
    receipt: join(paths.state, 'plugin-state/preview-notes/last-run.json'),
  };
  await writeFile(join(cwd, 'opentui-fixture.json'), JSON.stringify(fixture, null, 2));
  return fixture;
}
