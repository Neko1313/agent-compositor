import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../packages/app/src/build.js';
import {AgentCore, type ModelProvider, type ProviderEvent} from '@agent-compositor/core';
import {connectConversation, connectPluginTable} from './opentui-host.js';
import {ghostMedia} from './opentui-mascot.js';
import {runConversationPrototype} from '@agent-compositor/renderer-opentui';

function localProvider(label: string): ModelProvider {
  return { name: 'opentui-preview', async *complete(request): AsyncIterable<ProviderEvent> {
    const prompt = request.messages.findLast(message => message.role === 'user')?.content ?? '';
    if (label === 'Main' && prompt === 'hold main') {
      yield {type: 'text_delta', text: 'Main is working'};
      if (!request.signal.aborted) await new Promise<void>(resolve => {
        request.signal.addEventListener('abort', () => resolve(), {once: true});
      });
      return;
    }
    yield {type: 'text_delta', text: label + ' reply: ' + prompt};
    yield {type: 'finish', reason: 'stop'};
  }};
}

const temp = process.argv[2] ? undefined : await mkdtemp(join(tmpdir(), 'compositor-opentui-'));
const cwd = temp ?? process.argv[2]!;
const labels = ['Main', 'Side'];
const home = await mkdtemp(join(tmpdir(), 'compositor-opentui-home-'));
try {
  await runPreview();
} finally {
  await rm(home, {recursive: true, force: true});
  if (temp) await rm(temp, {recursive: true, force: true});
}

async function runPreview() {
  const mainApp = await buildApp({
    cwd, env: {HOME: home, AGENT_HOME: join(home, '.agent-compositor')},
    fixedConfig: {
      permissions: {rules: [{tool: 'workflow_run', decision: 'allow'}]}, enabledPlugins: ['workflows'],
      agent: {builtinTools: [], controlTools: [], tools: ['workflow_run'], skills: false, projectContext: false, fileReferences: false},
      compaction: {enabled: false},
    },
    pluginDirs: [fileURLToPath(new URL('../../plugins/workflows', import.meta.url))],
    agentHub: false, provider: localProvider('Main'),
  });
  const main = mainApp.createCore(async () => false);
  const side = new AgentCore({cwd, provider: localProvider('Side'), tools: [], controlTools: []});
  const agents = [main, side];
  const sessions = agents.map((core, index) => connectConversation(core, labels[index]));
  const workflowTable = connectPluginTable(main, 'workflows', 'plugin-workflows-runs', 'Workflows');
  try {
    await Promise.all(agents.map(core => core.start()));
    const started = await main.invokeTool('workflow_run', {
      action: 'start', title: 'Preview workflow', completion: 'none',
      stages: [{id: 'preview', title: 'Check conversation', prompt: 'Confirm the local conversation preview.'}],
    });
    if (!started.ok) throw new Error(started.error);
    await main.submit('/workflows');
    await runConversationPrototype(sessions, {
      workflowTable, composerMedia: ghostMedia,
      animations: process.env.AGENT_GRAPHICS !== 'off' && !process.env.NO_COLOR && process.env.AGENT_REDUCED_MOTION !== '1',
    });
  } finally {
    workflowTable.disconnect();
    for (const session of sessions) session.disconnect();
    await Promise.allSettled([mainApp.close(), side.close()]);
  }
}
