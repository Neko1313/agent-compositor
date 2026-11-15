import {AgentDrafts} from './agent-drafts.js';
import { agentHistory } from './agent-history.js';
import type { SessionEvent } from '@agent-compositor/session';
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rename, realpath } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HooksApi } from '@agent-compositor/hooks';
import type {
  AgentCore,
  AgentCoreOptions,
  CorePlugin,
} from "@agent-compositor/core";
import type { ToolSpec } from "@agent-compositor/tools";
import { confinedPath } from "@agent-compositor/tools";
type RecordEntry = {
  id: string;
  name: string;
  cwd: string;
  projectCwd?:string;
  sessionId: string;
  branch?: string;
  archived?: boolean;
  maxSteps: number;
  maxTokens: number;
};
type RuntimeEntry = {
  record: RecordEntry;
  core: AgentCore;
  run?: Promise<void>;
  unsubscribe: () => void;
  delta: string;
  activity:string[];
  history:ReturnType<typeof agentHistory>;
  close: (signal?:AbortSignal) => Promise<void>;
  reload?:()=>Promise<string>;
};
type Channels = {
  inputSource?:()=>"user"|"agent";
  resolveWorkspace?:(value:string)=>Promise<string>;
  workspace?:()=>import("@agent-compositor/tools").WorkspaceEntry[];
  approve: NonNullable<AgentCoreOptions["onApproval"]>;
  ask?: AgentCoreOptions["onAsk"];
};
type Factory = (
  record: RecordEntry,
  channels: Channels
) => Promise<{ core: AgentCore; close: (signal?:AbortSignal) => Promise<void>; history:()=>Promise<SessionEvent[]>; reload?:()=>Promise<string> }>;
const exec = promisify(execFile);
export async function agentManager(
  cwd: string,
  factory: Factory,
  maxAgents = 8,
  stateDir = join(cwd, ".agent-compositor")
) {
  const file = join(stateDir, "agents.json");
  const records: RecordEntry[] = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch((e: any) => {
      if (e.code !== "ENOENT") throw e;
      return [];
    });
  if (!Array.isArray(records)) throw new Error("Invalid agent registry");
  const entries = new Map<string, RuntimeEntry>();
  const loading=new Map<string,Promise<RuntimeEntry>>();
  let pluginReloading=false;
  const pluginReloadErrors=new Map<string,string>();
  let priorPluginReloadErrors:Map<string,string>|undefined;
  let controlsInFlight=0;
  const isBusy=()=>controlsInFlight>0||loading.size>0||[...entries.values()].some(entry=>entry.core.isClosed||entry.core.getState()==='running'||entry.core.hasActiveOperations);
  let host: HooksApi|undefined, channels: Channels | undefined;
  const publication=new AsyncLocalStorage<HooksApi>();
  let closePromise:Promise<void>|undefined;
  const closeCancellation=new AbortController();
  let writes = Promise.resolve();
  const drafts=await AgentDrafts.open(stateDir,new Set(records.filter(record=>!record.archived).map(record=>record.id)),error=>{
    if(host&&!host.signal.aborted)void host.ui.notify('Could not save agent reply draft: '+String(error).slice(0,300),'error').catch(()=>{});
  });
  const draftIds=new Map<string,number>();
  const sending=new Set<string>();
  let listVisible=false;
  let listFilter:'all'|'running'|'attention'='all';
  const expanded=new Set<string>();
  const save = () => {
    const operation = writes.then(async () => {
      await mkdir(stateDir, { recursive: true });
      await writeFile(file + ".tmp", JSON.stringify(records, null, 2));
      await rename(file + ".tmp", file);
    });
    writes = operation.catch(() => {});
    return operation;
  };
  const find = (id: string) => {
    const matches = records.filter(
      (r) => r.id.startsWith(id ?? "") || r.name === id
    );
    if (matches.length !== 1) throw new Error("Agent not found or ambiguous");
    return matches[0];
  };
  const conversationNavigation=(id:string)=>{
    const active=records.filter(record=>!record.archived),page=Math.floor(Math.max(0,active.findIndex(record=>record.id===id))/11),start=page*11;
    return{active,page,start,pages:Math.ceil(active.length/11),tabs:[
      {id:'overview',label:'Overview',action:'conversation:overview',selected:false},
      ...active.slice(start,start+11).map(record=>({id:record.id,label:record.name.slice(0,60).replace(/[\uD800-\uDBFF]$/,''),action:'conversation:'+record.id,selected:record.id===id})),
    ]};
  };
  async function refreshConversationTabs(skip?:string){for(const entry of entries.values())if(entry.record.id!==skip)await paint(entry);}
  async function publishUi(run:(api:HooksApi)=>Promise<unknown>,focus=false){
    const scoped=publication.getStore();
    // Completed actions can still produce passive worker updates. Only their
    // foreground publication retains the original action's focus authority.
    const current=scoped&&!scoped.signal.aborted?scoped:focus&&scoped?undefined:host;
    if(!current||current.signal.aborted)return;
    try{await run(current);}catch(error){if(current.signal.aborted)return;throw error;}
  }
  async function paint(entry: RuntimeEntry, focus=false) {
    if (!host||entry.record.archived) return;
    const r = entry.record;
    const navigation=conversationNavigation(r.id);
    const messages = entry.core
      .getMessages()
      .filter((m) => ["user", "assistant"].includes(m.role))
      .slice(-12);
    await publishUi(api=>api.ui.view(
      `agent-${r.id}`,
      r.name,
      {
        tabs:navigation.tabs,scrollKeys:'host',
        input:{id:`message-${draftIds.get(r.id)??0}`,label:'Reply',value:drafts.get(r.id)??'',placeholder:'Type a follow-up',submitAction:`send:${r.id}`},
        hint:'Left/Right switches agents · Enter sends · PgUp/PgDn history · Ctrl+C stops this agent · Alt+i returns to main',
        lines: [
          ...(navigation.pages>1?[
            {text:`Agents ${navigation.start+1}-${Math.min(navigation.active.length,navigation.start+11)}/${navigation.active.length}`,tone:'muted' as const},
            ...(navigation.page>0?[{text:'[ Previous agents · Ctrl+p ]',action:'conversation-page:previous'}]:[]),
            ...(navigation.page+1<navigation.pages?[{text:'[ Next agents · Ctrl+n ]',action:'conversation-page:next'}]:[]),
          ]:[]),
          {
            text: `${entry.core.getState()} · ${
              r.branch ?? "shared workspace"
            } · ${r.maxSteps} steps / ${r.maxTokens} tokens`,
            bold: true,
          },
          { text: "[ Send message ]", action: `send:${r.id}`, tone: "accent" },
          { text: "[ Stop ]", action: `stop:${r.id}` },
          { text: "[ Saved activity ]", action: `history:${r.id}` },
          ...(entry.core.failure
            ? [{ text: entry.core.failure, tone: "danger" as const }]
            : []),
          ...messages.flatMap((m) => [
            { text: m.role === "user" ? "You" : "Agent", bold: true },
            { text: m.content.slice(-8000) },
          ]),
          ...(entry.delta ? [{ text: entry.delta.slice(-8000) }] : []),
        ],
      },
      { site: "split", focus }
    ),focus);
  }
  async function load(record: RecordEntry) {
    if(closePromise)throw Error('The agent manager is closed');
    if(pluginReloading)throw Error('Plugin reload in progress; retry the agent action');
    const existing=loading.get(record.id);if(existing)return existing;
    if (entries.has(record.id)) return entries.get(record.id)!;
    const pending=loadFresh(record).finally(()=>{if(loading.get(record.id)===pending)loading.delete(record.id);});
    loading.set(record.id,pending);return pending;
  }
  async function loadFresh(record:RecordEntry) {
    if (!channels) throw new Error("No interactive host channels");
    const initial=channels;
    if(record.branch)await confinedPath(join(stateDir,"worktrees"),record.cwd);
    else if(record.projectCwd){
      if(await realpath(record.cwd)!==await realpath(record.projectCwd))throw Error("Agent directory does not match its saved project");
    }else await confinedPath(cwd,record.cwd);
    if(closePromise)throw Error('The agent manager is closed');
    const managed = await factory(record,{...initial,
      approve:(request,context)=>channels?.approve(request,context)??Promise.resolve(false),
      ask:(request,context)=>{
        const ask=channels?.ask;return ask?ask(request,context):Promise.reject(Error('No interactive question channel is available'));
      },
    });
    if(closePromise){await managed.close(closeCancellation.signal);throw Error('The agent manager is closed');}
    const core = managed.core;
    const entry: RuntimeEntry = {
      record,
      core,
      unsubscribe: () => {},
      delta: "",
      activity:[],
      history:agentHistory(managed.history,(view,focus)=>publishUi(api=>api.ui.view('history-'+record.id,'Activity: '+record.name,view,{site:'inspector',focus}),focus)),
      close: managed.close,
      reload: managed.reload,
    };
    entries.set(record.id, entry);
    let scheduled = false,overviewDirty=false;
    entry.unsubscribe = core.subscribe((event) => {
      if(event.kind==='catalog'&&['turn.start','turn.complete','turn.failed','turn.interrupted','tool.call','tool.result'].includes(event.event))overviewDirty=true;
      if (
        event.kind === "catalog" &&
        [
          "turn.start",
          "turn.complete",
          "turn.failed",
          "turn.interrupted",
          "tool.call",
          "tool.result",
          "ui.reaction",
        ].includes(event.event)
      ) {
        const input = event.input as Record<string, unknown>;
        if(event.event!=='ui.reaction'){
          const label=event.event==='tool.call'?`Tool started: ${String(input.tool??'tool')}`
            :event.event==='tool.result'?`Tool ${input.ok===false?'failed':'finished'}: ${String(input.tool??'tool')}`
            :event.event==='turn.start'?'Turn started'
            :event.event==='turn.complete'?'Turn completed'
            :event.event==='turn.failed'?'Turn failed':'Turn interrupted';
          entry.activity.push(label);entry.activity=entry.activity.slice(-12);
        }
        const data: Record<string, unknown> = {};
        for (const key of [
          "turnId",
          "callId",
          "tool",
          "ok",
          "source",
          "kind",
          "id",
          "active",
        ])
          if (input?.[key] !== undefined) data[key] = input[key];
        void publishUi(api=>api.emit("agent.activity", {
            agentId: record.id,
            event: event.event,
            data,
          }))
          .catch(() => {});
      }
      if (event.kind === "text") entry.delta += event.delta;
      if (
        event.kind === "catalog" &&
        ["turn.complete", "turn.failed", "turn.interrupted"].includes(
          event.event
        )
      )
        entry.delta = "";
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          const updateOverview=overviewDirty;overviewDirty=false;
          void paint(entry).then(()=>updateOverview?show():undefined).catch(() => {});
        });
      }
    });
    try{await core.start();if(closePromise)throw Error('The agent manager is closed');}
    catch(error){
      if(entries.get(record.id)===entry)entries.delete(record.id);
      entry.unsubscribe();await managed.close(closeCancellation.signal);throw error;
    }
    return entry;
  }
  async function show(reveal=false,focus=false) {
    if(reveal)listVisible=true;
    if(!listVisible)return;
    if (!host) return;
    const active=records.filter(record=>!record.archived);
    const state=(id:string)=>entries.get(id)?.core.getState()??'saved';
    const visible=active.filter(record=>listFilter==='all'||(listFilter==='running'?state(record.id)==='running':state(record.id)==='interrupted'||!!entries.get(record.id)?.core.failure));
    await publishUi(api=>api.ui.view(
      "agents",
      "Agents",
      {
        tabs:[
          {id:'all',label:`All (${active.length})`,action:'filter:all',selected:listFilter==='all'},
          {id:'running',label:`Running (${active.filter(record=>state(record.id)==='running').length})`,action:'filter:running',selected:listFilter==='running'},
          {id:'attention',label:`Attention (${active.filter(record=>state(record.id)==='interrupted'||!!entries.get(record.id)?.core.failure).length})`,action:'filter:attention',selected:listFilter==='attention'},
        ],
        lines: [
          { text: "Independent agents", bold: true },
          { text: "[ New worktree agent ]", action: "create", tone: "accent" },
          {
            text: "[ New shared-workspace agent ]",
            action: "create-shared",
            tone: "accent",
          },
          { text: "[ Use main conversation ]", action: "parent" },
        ],
        hint:'Left/Right switches tabs · Enter or click expands a row · Open conversation enters its Reply field',
        table:{
          columns:[{label:'Agent',width:18},{label:'State',width:12},{label:'Tokens used',width:12}],
          empty:active.length?'No agents match this view. Choose another tab to see the others.':'No independent agents yet. Create one above or use /btw <question>.',
          rows:visible.map(record=>{
            const entry=entries.get(record.id),budget=entry?.core.getBudget();
            return{id:record.id,cells:[record.name,state(record.id),String(budget?.spentTokens??0)],
              action:`expand:${record.id}`,expanded:expanded.has(record.id),
              tone:entry?.core.failure?'danger' as const:state(record.id)==='running'?'accent' as const:undefined,
              details:[
                {text:`Agent: ${record.name}`,bold:true},
                {text:`ID: ${record.id}`},{text:`Workspace: ${record.cwd}`},
                {text:`Branch: ${record.branch??'shared workspace'}`},
                {text:`Limits: ${record.maxSteps} steps/turn · ${record.maxTokens} tokens/turn`},
                ...(entry?.core.failure?[{text:entry.core.failure,tone:'danger' as const}]:[]),
                {text:'Recent activity (this run)',bold:true},
                ...(entry?.activity.length?entry.activity.map(text=>({text})):[{text:'No activity in this run. Open the conversation for saved messages.'}]),
                {text:'[ Open conversation ]',action:`open:${record.id}`,tone:'accent' as const},
                {text:'[ Saved activity ]',action:`history:${record.id}`},
              ]};
          }),
        },
      },
      { site: "inspector", focus }
    ),focus);
  }
  async function control(args: any, provided: Channels,reveal=true) {
    if(closePromise)throw Error('The agent manager is closed');
    if(pluginReloading&&args.action!=='list')throw Error('Plugin reload in progress; retry the agent action');
    const tracked=args.action!=='list';if(tracked)controlsInFlight++;
    try{
    channels = provided;
    if (args.action === "list")
      return (args.id ? [find(args.id)] : records).map((r) => ({
        ...r,
        state: entries.get(r.id)?.core.getState() ?? "saved",
        budget: entries.get(r.id)?.core.getBudget(),
        lastOutput: entries
          .get(r.id)
          ?.core.getMessages()
          .filter((m) => m.role === "assistant" && m.content)
          .at(-1)
          ?.content.slice(-(args.id ? 12000 : 300)),
      }));
    if (args.action === "create") {
      if (records.filter((r) => !r.archived).length >= maxAgents)
        throw new Error("Agent count limit reached");
      const id = randomUUID(),
        worktree = args.worktree !== false;
      const projectCwd=typeof args.cwd==='string'
        ? channels?.resolveWorkspace?await channels.resolveWorkspace(args.cwd):await confinedPath(cwd,args.cwd)
        : cwd;
      let directory = projectCwd,
        branch: string | undefined;
      if (worktree) {
        directory = join(stateDir, "worktrees", id);
        branch = `agent/${id}`;
        await mkdir(join(stateDir, "worktrees"), {
          recursive: true,
        });
        await exec(
          "git",
          [
            "-c",
            "core.hooksPath=/dev/null",
            "worktree",
            "add",
            "-b",
            branch,
            "--",
            directory,
            "HEAD",
          ],
          { cwd:projectCwd, timeout: 30000, maxBuffer: 1000000 }
        );
      }
      const record: RecordEntry = {
        id,
        name: args.name || `Agent ${records.length + 1}`,
        cwd: directory,
        projectCwd,
        branch,
        sessionId: randomUUID(),
        maxSteps: args.maxSteps ?? 12,
        maxTokens: args.maxTokens ?? 50000,
      };
      records.push(record);
      await save();
      const entry = await load(record);
      await paint(entry);
      await refreshConversationTabs(record.id);
      await show(reveal);
      if (args.prompt)
        await control({ action: "send", id, prompt: args.prompt }, provided);
      return record;
    }
    const record = find(args.id);
    if (record.archived) throw new Error("Agent is archived");
    if (args.action === "archive") {
      const existing = entries.get(record.id)??await loading.get(record.id);
      if (existing) {
        existing.history.close();
        await existing.close();
        await existing.run;
        existing.unsubscribe();
        entries.delete(record.id);
      }
      record.archived = true;
      pluginReloadErrors.delete(record.id);
      drafts.set(record.id,'');
      await save();
      try{await drafts.flush();}catch(error){await publishUi(api=>api.ui.notify('Agent archived, but could not clear its saved draft: '+String(error).slice(0,300),'error'));}
      if (target === record.id) {target=undefined;await publishUi(api=>select(undefined,api));}
      await publishUi(async api=>{await api.ui.remove('agent-'+record.id);await api.ui.remove('history-'+record.id);});
      await refreshConversationTabs();
      await show();
      return { archived: record.id, worktreePreserved: record.cwd };
    }
    const entry = await load(record);
    if(pluginReloading)throw Error('Plugin reload in progress; retry the agent action');
    if (args.action === "send") {
      if(pluginReloadErrors.has(record.id))throw Error(`Agent plugin reload failed; retry /reload before sending: ${pluginReloadErrors.get(record.id)}`);
      if (typeof args.prompt !== "string" || !args.prompt.trim())
        throw new Error("Prompt is required");
      // Core queues follow-up messages if another turn is running.
      const previous = entry.run;
      const pending = entry.core.submit(args.prompt,provided.inputSource?.()??"agent");
      entry.run = Promise.all([previous, pending])
        .then(() => {})
        .finally(async () => {
          await paint(entry);
          await show();
        });
      void entry.run.catch(() => {});
      await paint(entry);
      return { queued: true, id: record.id };
    }
    if (args.action === "stop") {
      entry.core.interrupt();
      await entry.run;
      await paint(entry);
      return { stopped: record.id };
    }
    if (args.action === "merge") {
      if (entry.core.getState() === "running")
        throw new Error("Stop the agent before merging");
      if (!record.branch) throw new Error("Agent has no isolated branch");
      const dirty = (
        await exec(
          "git",
          ["status", "--porcelain", "--", ".", ":(exclude).agent-compositor"],
          { cwd: record.cwd }
        )
      ).stdout;
      if (dirty.trim())
        throw new Error(
          "Commit/review the agent worktree changes before merge"
        );
      const result = await exec(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "merge",
          "--no-ff",
          "--no-edit",
          record.branch,
        ],
        { cwd:record.projectCwd??cwd, maxBuffer: 1000000, timeout: 30000 }
      );
      return { merged: record.branch, output: result.stdout };
    }
    throw new Error("Unknown agent action");
    }finally{if(tracked)controlsInFlight--;}
  }
  let target: string | undefined;
  const select = async (id: string | undefined, $: any) => {
    target = id;
    await $.emit("service.ui.inputTarget", {
      plugin: $.plugin,
      surface: id ? `plugin-agent-hub-agent-${id}` : null,
      label: id ? find(id).name : undefined,
    });
  };
  async function focusConversation(id:string,$:any){
    const record=find(id);if(record.archived)throw Error('Agent is archived');
    const entry=await load(record);await select(record.id,$);await paint(entry,true);
  }
  async function handleCommand(text:string,$:any){
        const [command, action, id, ...rest] = text.trim().split(/\s+/);
        if (command === "/agents") {
          if (action === "parent") {
            await select(undefined, $);
            await $.ui.notify("Input target: main conversation");
          } else if (!action) await show(true,true);
          else {
            const r = await $.agent.tool("agent_control", {
              action: action === "create-shared" ? "create" : action,
              id,
              name: ["create", "create-shared"].includes(action)
                ? id
                : undefined,
              worktree: action === "create-shared" ? false : undefined,
              prompt: rest.join(" ") || undefined,
            });
            if (!r.ok)
              await $.ui.notify(r.error ?? "Agent operation failed", "error");
          }
          return true;
        }
    return false;
  }
  const plugin: CorePlugin = {
    manifest: {
      name: "agent-hub",
      version: "1.0.0",
      trust: "trusted",
      hookTimeouts: { "session.start": 30000, 'ui.press':300000,
        'service.agent.control':300000,'service.agent.open':300000 },
    },
    hooks: {
      'service.agent.control':(_event,$)=>$.next(),
      'service.agent.open':(_event,$)=>$.next(),
      "command.invoke":async(e,$)=>{if(e.plugin==='agent-hub'&&e.name==='/agents')await handleCommand(e.text,$);},
      "session.start": async (_e, $) => {
        host = $;
        if(drafts.loadError)await $.ui.notify(drafts.loadError,'warn');
        for (const r of records.filter((r) => !r.archived)) {
          try {
            await paint(await load(r));
          } catch (error) {
            await $.ui.notify(`Agent ${r.name}: ${String(error)}`, "warn");
          }
        }
      },
      'session.reload':async(_e,$)=>{host=$;},
      "prompt.submit": async (e, $) => {
        if(await handleCommand(e.text,$))return{drop:"agent-hub: handled"};
        if (target && !e.text.startsWith("/")) {
          const result = await $.agent.tool("agent_control", {
            action: "send",
            id: target,
            prompt: e.text,
          });
          if (!result.ok)
            await $.ui.notify(
              result.error ?? "Agent operation failed",
              "error"
            );
          return { drop: "agent-hub: message routed" };
        }
      },
      "ui.focus": async (e, $) => {
        const id = e.site.startsWith("plugin-agent-hub-agent-")
          ? e.site.slice("plugin-agent-hub-agent-".length)
          : undefined;
        if (id && entries.has(id)) {
          await select(id, $);
          await $.ui.notify(`Input target: ${entries.get(id)!.record.name}`);
        } else if (e.site === "session"||e.site==='input') await select(undefined, $);
      },
      "ui.press": async (e, $) => {
        if (!e.site.startsWith("plugin-agent-hub-")) return;
        if(e.site==='plugin-agent-hub-agents'&&e.key==='close'){listVisible=false;return;}
        if(e.site==='plugin-agent-hub-agents'&&['filter:all','filter:running','filter:attention'].includes(e.key)){
          listFilter=e.key.slice(7) as typeof listFilter;await show();return;
        }
        if(e.site==='plugin-agent-hub-agents'&&e.key==='filter'){
          listFilter=listFilter==='all'?'running':listFilter==='running'?'attention':'all';await show();return;
        }
        if(e.site==='plugin-agent-hub-agents'&&e.key.startsWith('expand:')){
          const id=e.key.slice('expand:'.length);find(id);
          if(expanded.has(id))expanded.delete(id);else expanded.add(id);
          await show();return;
        }
        if(e.site.startsWith('plugin-agent-hub-history-')){
          const id=e.site.slice('plugin-agent-hub-history-'.length),entry=entries.get(id);if(!entry||entry.record.archived)return;
          if(e.key==='conversation')await focusConversation(id,$);
          else if(e.key==='overview')await show(true,true);
          else await entry.history.press(e.key);
          return;
        }
        if(e.key.startsWith('history:')){const record=find(e.key.slice(8));if(record.archived)throw Error('Agent is archived');await(await load(record)).history.open();return;}
        const paneId=e.site.startsWith('plugin-agent-hub-agent-')?e.site.slice('plugin-agent-hub-agent-'.length):undefined;
        if(paneId&&e.key==='close'){if(target===paneId)await select(undefined,$);return;}
        if(paneId&&e.key==='conversation:overview'){await select(undefined,$);await show(true,true);return;}
        if(paneId&&e.key.startsWith('conversation:')){await focusConversation(e.key.slice('conversation:'.length),$);return;}
        if(paneId&&['conversation-page:next','conversation-page:previous','n','p'].includes(e.key)){
          const navigation=conversationNavigation(paneId),next=['n','conversation-page:next'].includes(e.key);
          const page=Math.max(0,Math.min(navigation.pages-1,navigation.page+(next?1:-1)));
          if(page!==navigation.page)await focusConversation(navigation.active[page*11].id,$);return;
        }
        if(paneId&&['up','down','left','right','pageup','pagedown','tab','escape'].includes(e.key))return;
        if(paneId&&(e.key==='enter'||(e.key===`send:${paneId}`&&drafts.get(paneId)?.trim()))){
          const draft=drafts.get(paneId),prompt=draft?.trim();if(!prompt||sending.has(paneId))return;
          sending.add(paneId);
          try{
            const result=await $.agent.tool('agent_control',{action:'send',id:paneId,prompt});
            if(result.ok){
              let saved:Promise<void>|undefined;
              if(drafts.get(paneId)===draft){drafts.set(paneId,'');draftIds.set(paneId,(draftIds.get(paneId)??0)+1);saved=drafts.flush().catch(async error=>{await $.ui.notify('Message accepted, but could not clear its saved draft: '+String(error).slice(0,300),'error');});}
              await paint(await load(find(paneId)));await saved;
            }
            else await $.ui.notify(result.error??'Agent message failed; your draft was kept','error');
          }finally{sending.delete(paneId);}
          return;
        }
        const [action, id] = e.key.split(":");
        if (action === "parent") {
          await select(undefined, $);
          await $.ui.notify("Input target: main conversation");
          return;
        }
        if (action === "open") {
          await focusConversation(id??'', $);
          return;
        }
        let args: any = { action, id };
        if (action === "create" || action === "create-shared")
          args = {
            action: "create",
            worktree: action !== "create-shared",
            name: `Agent ${records.length + 1}`,
          };
        if (action === "send") {
          const answer: any = await $.emit("service.ui.ask", {
            plugin: $.plugin,
            question: "Message for this agent",
          });
          if (!answer.answer) return;
          args.prompt = String(answer.answer);
        }
        const result = await $.agent.tool("agent_control", args);
        if (!result.ok)
          await $.ui.notify(result.error ?? "Agent operation failed", "error");
      },
      'ui.change':async(e)=>{
        const prefix='plugin-agent-hub-agent-';if(!e.site.startsWith(prefix))return;
        const id=e.site.slice(prefix.length);if(entries.has(id)&&e.id===`message-${draftIds.get(id)??0}`)drafts.set(id,e.value);
      },
    },
  };
  // Service interceptors acquire the agent-hub API under the real caller's
  // scope before the resolver runs; unrelated UI hooks cannot replace it.
  for(const [name,hook] of Object.entries(plugin.hooks))
    plugin.hooks[name]=(event,$)=>publication.run($,()=>hook(event,$));
  const tool: ToolSpec = {
    name: "agent_control",
    description:
      "Manage independent persisted agents with separate conversations in selected attached project directories (cwd), optional Git worktrees and token/step budgets. Send messages asynchronously, list states, stop, archive or merge committed worktree changes.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "send", "stop", "archive", "merge"],
        },
        id: { type: "string" },
        name: { type: "string" },
        cwd:{type:"string",description:"Attached project directory for a new agent. Accepts absolute paths and ~/path. Defaults to the primary project; worktree:false works directly in this directory."},
        prompt: { type: "string" },
        worktree: { type: "boolean" },
        maxSteps: { type: "integer", minimum: 1, maximum: 100 },
        maxTokens: { type: "integer", minimum: 100, maximum: 1000000 },
      },
      required: ["action"],
    },
    describe: (args: any) => ({
      tool: ["list", "send", "stop"].includes(args.action)
        ? "agent_message"
        : "agent_control",
      command: [args.action, args.id ?? ""],
    }),
    execute: async (ctx, args) => {
      try {
        return {
          ok: true,
          data: await ctx.request("service.agent.control", args),
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  };
  return {
    plugin,
    tool,
    control,
    isBusy,
    beginPluginReload:()=>{
      if(pluginReloading||closePromise||isBusy())return false;
      pluginReloading=true;
      priorPluginReloadErrors=new Map(pluginReloadErrors);
      for(const entry of entries.values())pluginReloadErrors.set(entry.record.id,'Reload did not complete');
      return true;
    },
    endPluginReload:(unchanged=false)=>{
      if(unchanged&&priorPluginReloadErrors){pluginReloadErrors.clear();for(const [id,reason] of priorPluginReloadErrors)pluginReloadErrors.set(id,reason);}
      priorPluginReloadErrors=undefined;pluginReloading=false;
    },
    reloadPlugins:async()=>{
      const failures:string[]=[];
      for(const entry of entries.values()){
        try{
          if(!entry.reload)throw Error('Reload is unavailable');
          const result=await entry.reload();
          if(result.startsWith('Wait until'))throw Error(result);
          pluginReloadErrors.delete(entry.record.id);
        }catch(error){const reason=String(error);pluginReloadErrors.set(entry.record.id,reason);failures.push(`${entry.record.name}: ${reason}`);}
      }
      if(failures.length)throw Error(failures.join('; '));
    },
    open:async(args:{id?:string;prompt?:string;name?:string},provided:Channels)=>{
      if(provided.inputSource?.()!=='user')throw Error('Opening a conversation requires explicit user invocation');
      const record:RecordEntry=args.id?find(args.id):await control({action:'create',worktree:false,name:args.name??'Side conversation'},provided,false) as RecordEntry;
      if(record.archived)throw Error('Agent is archived; start a new side conversation');
      channels=provided;
      if(args.prompt)await control({action:'send',id:record.id,prompt:args.prompt},provided);
      await publishUi(async api=>{await select(record.id,api);await paint(await load(record),true);},true);
      return{id:record.id,sessionId:record.sessionId};
    },
    bind: (value: Channels) => {
      if(!closePromise)channels = value;
    },
    close: (signal?:AbortSignal) => {
      let unbind=()=>{};
      if(signal){const source=AbortSignal.any([signal]),abort=()=>closeCancellation.abort(source.reason);source.addEventListener('abort',abort,{once:true});if(source.aborted)abort();unbind=()=>source.removeEventListener('abort',abort);}
      const work=closePromise??=Promise.resolve().then(async () => {
        channels=undefined;
        const current=[...entries.values()];for(const entry of current)entry.history.close();
        // Actual Core closure revokes retained background input before a run is
        // awaited; a foreground interrupt alone deliberately cannot do that.
        await Promise.allSettled([...current.map(entry=>entry.close(closeCancellation.signal)),...loading.values()]);
        await Promise.allSettled(current.map(entry=>entry.run));
        for(const entry of current)entry.unsubscribe();
        await Promise.all([writes,drafts.flush().catch(error=>{if(host&&!host.signal.aborted)void host.ui.notify('Could not save agent reply draft: '+String(error).slice(0,300),'error').catch(()=>{});})]);
      });
      void work.then(unbind,unbind);return work;
    },
  };
}
