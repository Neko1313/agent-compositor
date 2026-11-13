import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../packages/app/src/build.js';
import {AgentCore, type ModelProvider, type ProviderEvent} from '@agent-compositor/core';
import {createApprovalInbox} from './opentui-approvals.js';
import {connectConversation, connectPluginTable} from './opentui-host.js';
import {ghostMedia} from './opentui-mascot.js';
import {seedOpenTuiPlugin} from './opentui-plugin-fixture.js';
import {connectPluginManager} from './opentui-plugins.js';
import {runConversationPrototype} from '@agent-compositor/renderer-opentui';

function localProvider(label: string): ModelProvider {
  return { name: 'opentui-preview', async *complete(request): AsyncIterable<ProviderEvent> {
    const prompt = request.messages.findLast(message => message.role === 'user')?.content ?? '';
    // A real native write exercises permission review without external services.
    if (prompt === 'request write') {
      const last = request.messages.at(-1);
      if (last?.role !== 'tool') {
        yield {type: 'tool_call', id: crypto.randomUUID(), name: 'write', args: {
          path: label.toLowerCase() + '-note.txt', content: 'Approved by ' + label + '\n',
        }};
        yield {type: 'finish', reason: 'tool_calls'};
        return;
      }
      let succeeded = false;
      try { succeeded = JSON.parse(last.content)?.fileAction === 'wrote'; } catch { /* normal denied result is text */ }
      const reply = succeeded ? 'Write completed' : last.content.includes('Permission denied:') ? 'Write denied' : 'Write failed';
      yield {type: 'text_delta', text: reply};
      yield {type: 'finish', reason: 'stop'};
      return;
    }
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
  const fixture = await seedOpenTuiPlugin(cwd, home);
  const mainApp = await buildApp({
    cwd, env: {HOME: home, AGENT_HOME: join(home, '.agent-compositor')},
    fixedConfig: {
      permissions: {rules: [{tool: 'workflow_run', decision: 'allow'}, {tool: 'write', decision: 'ask', reason: 'Write the requested preview note'}]}, enabledPlugins: ['workflows', 'preview-notes'],
      agent: {builtinTools: ['write'], controlTools: [], tools: ['workflow_run', 'write'], skills: false, projectContext: false, fileReferences: false},
      compaction: {enabled: false},
    },
    pluginDirs: [fileURLToPath(new URL('../../plugins/workflows', import.meta.url))],
    agentHub: false, provider: localProvider('Main'),
  });
  const inboxes = labels.map(() => createApprovalInbox());
  const main = mainApp.createCore(inboxes[0].ask);
  const side = new AgentCore({
    cwd, provider: localProvider('Side'), toolNames: ['write'], controlTools: [], onApproval: inboxes[1].ask,
    rules: [{tool: 'write', decision: 'ask', reason: 'Write the requested preview note'}],
  });
  const agents = [main, side];
  const workflowTable = connectPluginTable(main, 'workflows', 'plugin-workflows-runs', 'Workflows');
  let pluginManager: Awaited<ReturnType<typeof connectPluginManager>> | undefined;
  let sessions: ReturnType<typeof connectConversation>[] = [];
  try {
    await Promise.all(agents.map(core => core.start()));
    const registered = await main.host.emit('service.marketplace.control', {
      action: 'add', source: fixture.catalogRoot, scope: 'project',
    });
    if (registered.faults.length || (registered.value as {deny?: string} | undefined)?.deny)
      throw new Error('Cannot register the local preview marketplace');
    const started = await main.invokeTool('workflow_run', {
      action: 'start', title: 'Preview workflow', completion: 'none',
      stages: [{id: 'preview', title: 'Check conversation', prompt: 'Confirm the local conversation preview.'}],
    });
    if (!started.ok) throw new Error(started.error);
    await main.submit('/workflows');
    pluginManager = await connectPluginManager(mainApp, main);
    sessions = agents.map((core, index) => connectConversation(core, labels[index], inboxes[index],
      index === 0 ? text => pluginManager!.submit(text) : undefined));
    await runConversationPrototype(sessions, {
      workflowTable, pluginManager, composerMedia: ghostMedia,
      animations: process.env.AGENT_GRAPHICS !== 'off' && !process.env.NO_COLOR && process.env.AGENT_REDUCED_MOTION !== '1',
    });
  } finally {
    workflowTable.disconnect();
    for (const session of sessions) session.disconnect();
    await pluginManager?.disconnect();
    await Promise.allSettled([mainApp.close(), side.close()]);
  }
}
