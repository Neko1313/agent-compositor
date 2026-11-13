import {appendFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp} from '../../packages/app/src/build.js';
import {AgentCore, type ModelProvider, type ProviderEvent} from '@agent-compositor/core';
import {createInteractionInbox} from './opentui-interactions.js';
import {connectConversation, connectPluginTable} from './opentui-host.js';
import {ghostMedia} from './opentui-mascot.js';
import {seedOpenTuiPlugin} from './opentui-plugin-fixture.js';
import {seedOpenTuiInputs} from './opentui-input-fixture.js';
import {connectPluginManager} from './opentui-plugins.js';
import {connectWindowLayout} from './opentui-windows.js';
import {runConversationPrototype} from '@agent-compositor/renderer-opentui';

function localProvider(label: string, receipts: {inputsReceipt: string; modelTrace: string}): ModelProvider {
  return { name: 'opentui-preview', async *complete(request): AsyncIterable<ProviderEvent> {
    const prompt = request.messages.findLast(message => message.role === 'user')?.content ?? '';
    await appendFile(receipts.modelTrace, JSON.stringify({agent: label, messages: request.messages}) + '\n');
    if (['request question', 'request custom', 'request questionnaire'].includes(prompt)) {
      const last = request.messages.at(-1);
      if (last?.role !== 'tool') {
        const questionnaire = prompt === 'request questionnaire';
        yield {type: 'tool_call', id: crypto.randomUUID(), name: questionnaire ? 'ask_questions' : 'ask_user', args: questionnaire ? {
          title: 'Setup choices for ' + label, questions: [
            {id: 'environment', header: 'Target', question: 'Choose environment', options: ['Preview', 'Production'], allowOther: false},
            {id: 'checks', header: 'Checks', question: 'Which checks should run?', multi: true, options: ['Unit tests', 'Browser tests'], allowOther: true},
            {id: 'owner', header: 'Owner', question: 'Who owns this setup?'},
          ],
        } : {
          question: (prompt === 'request custom' ? 'Choose custom destination for ' : 'Choose destination for ') + label,
          options: [{label: 'Preview', description: 'Local preview only', recommended: true},
            {label: 'Production', description: 'External deployment target'}], allowOther: prompt === 'request custom',
        }};
        yield {type: 'finish', reason: 'tool_calls'};
        return;
      }
      let reply: unknown;
      try { reply = JSON.parse(last.content); } catch { reply = {error: last.content}; }
      await appendFile(receipts.inputsReceipt, JSON.stringify({agent: label, prompt, reply}) + '\n');
      const answered = reply && typeof reply === 'object' && ('answer' in reply || 'answers' in reply);
      yield {type: 'text_delta', text: label + (answered ? ' received human answer' : ' question cancelled')};
      yield {type: 'finish', reason: 'stop'};
      return;
    }
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
// The visual server owns this temporary workspace across PTY restarts.
const persistentBench = process.env.VISUAL_OPENTUI === '1';
const home = persistentBench ? join(cwd, '.opentui-home') : await mkdtemp(join(tmpdir(), 'compositor-opentui-home-'));
try {
  await runPreview();
} finally {
  if (!persistentBench) await rm(home, {recursive: true, force: true});
  if (temp) await rm(temp, {recursive: true, force: true});
}

async function runPreview() {
  const fixture = await seedOpenTuiPlugin(cwd, home);
  const inputs = await seedOpenTuiInputs(cwd, home);
  await writeFile(join(cwd, 'opentui-fixture.json'), JSON.stringify({...fixture, ...inputs}, null, 2));
  const mainApp = await buildApp({
    cwd, env: {HOME: home, AGENT_HOME: join(home, '.agent-compositor')},
    fixedConfig: {
      permissions: {rules: [{tool: 'workflow_run', decision: 'allow'}, {tool: 'write', decision: 'ask', reason: 'Write the requested preview note'}]}, enabledPlugins: ['workflows', 'preview-notes', 'preview-inputs'],
      agent: {builtinTools: ['write'], controlTools: ['ask_user', 'ask_questions'], tools: ['workflow_run', 'write', 'ask_user', 'ask_questions'], skills: false, projectContext: false, fileReferences: false},
      compaction: {enabled: false},
    },
    pluginDirs: [fileURLToPath(new URL('../../plugins/workflows', import.meta.url)), inputs.inputPluginDir],
    agentHub: false, provider: localProvider('Main', inputs),
  });
  const inboxes = labels.map(() => createInteractionInbox());
  const main = mainApp.createCore(inboxes[0].ask, inboxes[0].askQuestion);
  const side = new AgentCore({
    cwd, provider: localProvider('Side', inputs), toolNames: ['write', 'ask_user', 'ask_questions'],
    controlTools: ['ask_user', 'ask_questions'], onApproval: inboxes[1].ask, onAsk: inboxes[1].askQuestion,
    rules: [{tool: 'write', decision: 'ask', reason: 'Write the requested preview note'}],
  });
  const agents = [main, side];
  agents.forEach((core, index) => inboxes[index].bind(core));
  const workflowTable = connectPluginTable(main, 'workflows', 'plugin-workflows-runs', 'Workflows');
  let pluginManager: Awaited<ReturnType<typeof connectPluginManager>> | undefined;
  let sessions: ReturnType<typeof connectConversation>[] = [];
  let windowLayout: Awaited<ReturnType<typeof connectWindowLayout>> | undefined;
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
    sessions = agents.map((core, index) => ({...connectConversation(core, labels[index], inboxes[index],
      index === 0 ? text => pluginManager!.submit(text) : undefined), paneId: index === 0 ? 'main' : 'side',
      interrupt: () => core.interrupt(),
      isImmediateCommand: (text: string) => index === 0 && mainApp.commands().some(command =>
        command.execution === 'immediate' && command.name === text.trim().split(/\s+/)[0]),
    }));
    windowLayout = await connectWindowLayout(mainApp, {
      panes: [...sessions.map(session => ({id: session.paneId!, label: session.label})),
        {id: 'workflows', label: 'Workflows'}, {id: 'plugins', label: 'Plugins'}],
      initial: ['main', 'side'],
    });
    await runConversationPrototype(sessions, {
      workflowTable, pluginManager, windowLayout, composerMedia: ghostMedia,
      animations: process.env.AGENT_GRAPHICS !== 'off' && !process.env.NO_COLOR && process.env.AGENT_REDUCED_MOTION !== '1',
    });
  } finally {
    workflowTable.disconnect();
    for (const session of sessions) session.disconnect();
    await windowLayout?.disconnect();
    await pluginManager?.disconnect();
    await Promise.allSettled([mainApp.close(), side.close()]);
  }
}
