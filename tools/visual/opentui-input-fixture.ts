import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {storagePaths} from '@agent-compositor/config';

/** A trusted user command exercises the private form channel without a model. */
export async function seedOpenTuiInputs(cwd: string, home: string) {
  const inputPluginDir = join(home, 'preview-inputs');
  await mkdir(inputPluginDir, {recursive: true});
  await writeFile(join(inputPluginDir, 'plugin.json'), JSON.stringify({
    name: 'preview-inputs', version: '1.0.0', trust: 'trusted', main: 'hooks.js',
    hookTimeouts: {'command.invoke': 300000},
    commands: [{name: '/preview-form', execution: 'immediate', description: 'Open private preview settings'}],
  }, null, 2));
  await writeFile(join(inputPluginDir, 'hooks.js'), `import {createHash} from 'node:crypto';
export default {
  'command.invoke': async (event, $) => {
    if (event.name !== '/preview-form') return;
    const result = await $.ui.form({
      title: 'Preview settings', description: 'Local demonstration. No remote connection is made.',
      fields: [
        {id: 'name', label: 'Profile name', type: 'text', value: 'Local profile', required: true},
        {id: 'endpoint', label: 'Endpoint URL', type: 'url', value: 'https://example.test/api', required: true},
        {id: 'password', label: 'Access token', type: 'password', hint: 'Use a synthetic token in this preview', required: true},
        {id: 'mode', label: 'Mode', type: 'select', value: 'careful', options: [
          {value: 'careful', label: 'Careful'}, {value: 'fast', label: 'Fast'},
        ]},
        {id: 'enabled', label: 'Enable profile', type: 'toggle', value: false},
      ], actions: [{id: 'save', label: 'Save settings'}, {id: 'cancel', label: 'Cancel'}],
    });
    const receipt = result ? {action: result.action,
      values: {name: result.values.name, endpoint: result.values.endpoint, mode: result.values.mode, enabled: result.values.enabled},
      passwordLength: String(result.values.password).length,
      passwordHash: createHash('sha256').update(String(result.values.password)).digest('hex'),
    } : {cancelled: true};
    await $.storage.set('form-receipt', receipt);
    await $.ui.notify(result ? 'Preview settings saved' : 'Preview settings cancelled');
  },
};
`);
  const paths = storagePaths(cwd, {HOME: home, AGENT_HOME: join(home, '.agent-compositor')});
  return {
    inputPluginDir,
    inputsReceipt: join(home, 'inputs-receipt.jsonl'),
    modelTrace: join(home, 'model-requests.jsonl'),
    formReceipt: join(paths.state, 'plugin-state/preview-inputs/form-receipt.json'),
  };
}
