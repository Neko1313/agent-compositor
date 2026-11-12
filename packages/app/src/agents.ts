import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rename, realpath } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  close: () => Promise<void>;
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
) => Promise<{ core: AgentCore; close: () => Promise<void> }>;
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
  let host: any, channels: Channels | undefined;
  let writes = Promise.resolve();
  const drafts=new Map<string,string>();
  const draftIds=new Map<string,number>();
  const sending=new Set<string>();
  let listVisible=false;
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
  async function paint(entry: RuntimeEntry, focus=false) {
    if (!host) return;
    const r = entry.record;
    const messages = entry.core
      .getMessages()
      .filter((m) => ["user", "assistant"].includes(m.role))
      .slice(-12);
    await host.ui.view(
      `agent-${r.id}`,
      r.name,
      {
        input:{id:`message-${draftIds.get(r.id)??0}`,label:'Reply',value:drafts.get(r.id)??'',placeholder:'Type a follow-up'},
        hint:'Enter sends · Ctrl+C stops this agent · Alt+i, then /chat returns to the main conversation',
        lines: [
          {
            text: `${entry.core.getState()} · ${
              r.branch ?? "shared workspace"
            } · ${r.maxSteps} steps / ${r.maxTokens} tokens`,
            bold: true,
          },
          { text: "[ Send message ]", action: `send:${r.id}`, tone: "accent" },
          { text: "[ Stop ]", action: `stop:${r.id}` },
          ...(entry.core.failure
            ? [{ text: entry.core.failure, tone: "danger" }]
            : []),
          ...messages.flatMap((m) => [
            { text: m.role === "user" ? "You" : "Agent", bold: true },
            { text: m.content.slice(-8000) },
          ]),
          ...(entry.delta ? [{ text: entry.delta.slice(-8000) }] : []),
        ],
      },
      { site: "split", focus }
    );
  }
  async function load(record: RecordEntry) {
    if (entries.has(record.id)) return entries.get(record.id)!;
    if (!channels) throw new Error("No interactive host channels");
    if(record.branch)await confinedPath(join(stateDir,"worktrees"),record.cwd);
    else if(record.projectCwd){
      if(await realpath(record.cwd)!==await realpath(record.projectCwd))throw Error("Agent directory does not match its saved project");
    }else await confinedPath(cwd,record.cwd);
    const managed = await factory(record, channels);
    const core = managed.core;
    const entry: RuntimeEntry = {
      record,
      core,
      unsubscribe: () => {},
      delta: "",
      close: managed.close,
    };
    entries.set(record.id, entry);
    let scheduled = false;
    entry.unsubscribe = core.subscribe((event) => {
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
        void host
          ?.emit("agent.activity", {
            agentId: record.id,
            event: event.event,
            data,
          })
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
          void paint(entry).catch(() => {});
        });
      }
    });
    await core.start();
    return entry;
  }
  async function show(reveal=false) {
    if(reveal)listVisible=true;
    if(!listVisible)return;
    if (!host) return;
    await host.ui.view(
      "agents",
      "Agents",
      {
        lines: [
          { text: "Independent agents", bold: true },
          { text: "[ New worktree agent ]", action: "create", tone: "accent" },
          {
            text: "[ New shared-workspace agent ]",
            action: "create-shared",
            tone: "accent",
          },
          { text: "[ Use main conversation ]", action: "parent" },
          ...records
            .filter((r) => !r.archived)
            .map((r) => ({
              text: `${r.name} · ${
                entries.get(r.id)?.core.getState() ?? "saved"
              } · ${r.id.slice(0, 8)}`,
              action: `open:${r.id}`,
            })),
        ],
      },
      { site: "inspector", focus: false }
    );
  }
  async function control(args: any, provided: Channels,reveal=true) {
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
      await show(reveal);
      if (args.prompt)
        await control({ action: "send", id, prompt: args.prompt }, provided);
      return record;
    }
    const record = find(args.id);
    if (record.archived) throw new Error("Agent is archived");
    if (args.action === "archive") {
      const existing = entries.get(record.id);
      if (existing) {
        existing.core.interrupt();
        await existing.run;
        existing.unsubscribe();
        await existing.close();
        entries.delete(record.id);
      }
      record.archived = true;
      await save();
      if (target === record.id && host) await select(undefined, host);
      await show();
      return { archived: record.id, worktreePreserved: record.cwd };
    }
    const entry = await load(record);
    if (args.action === "send") {
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
  const plugin: CorePlugin = {
    manifest: {
      name: "agent-hub",
      version: "1.0.0",
      trust: "trusted",
      hookTimeouts: { "session.start": 30000, 'ui.press':300000 },
    },
    hooks: {
      "session.start": async (_e, $) => {
        host = $;
        for (const r of records.filter((r) => !r.archived)) {
          try {
            await paint(await load(r));
          } catch (error) {
            await $.ui.notify(`Agent ${r.name}: ${String(error)}`, "warn");
          }
        }
      },
      "prompt.submit": async (e, $) => {
        host = $;
        const [command, action, id, ...rest] = e.text.trim().split(/\s+/);
        if (command === "/agents") {
          if (action === "parent") {
            await select(undefined, $);
            await $.ui.notify("Input target: main conversation");
          } else if (!action) await show(true);
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
          return { drop: "agent-hub: handled" };
        }
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
        host = $;
        if (!e.site.startsWith("plugin-agent-hub-")) return;
        if(e.site==='plugin-agent-hub-agents'&&e.key==='close'){listVisible=false;return;}
        const paneId=e.site.startsWith('plugin-agent-hub-agent-')?e.site.slice('plugin-agent-hub-agent-'.length):undefined;
        if(paneId&&e.key==='close'){if(target===paneId)await select(undefined,$);return;}
        if(paneId&&e.key==='enter'){
          const draft=drafts.get(paneId),prompt=draft?.trim();if(!prompt||sending.has(paneId))return;
          sending.add(paneId);
          try{
            const result=await $.agent.tool('agent_control',{action:'send',id:paneId,prompt});
            if(result.ok){if(drafts.get(paneId)===draft){drafts.delete(paneId);draftIds.set(paneId,(draftIds.get(paneId)??0)+1);}await paint(await load(find(paneId)));}
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
          await select(id, $);
          await paint(await load(find(id ?? "")));
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
    open:async(args:{id?:string;prompt?:string;name?:string},provided:Channels)=>{
      if(provided.inputSource?.()!=='user')throw Error('Opening a conversation requires explicit user invocation');
      const record:RecordEntry=args.id?find(args.id):await control({action:'create',worktree:false,name:args.name??'Side conversation'},provided,false) as RecordEntry;
      if(record.archived)throw Error('Agent is archived; start a new side conversation');
      channels=provided;
      if(args.prompt)await control({action:'send',id:record.id,prompt:args.prompt},provided);
      if(host){await select(record.id,host);await paint(await load(record),true);}
      return{id:record.id,sessionId:record.sessionId};
    },
    bind: (value: Channels) => {
      channels = value;
    },
    close: async () => {
      for (const entry of entries.values()) entry.core.interrupt();
      await Promise.allSettled([...entries.values()].map((e) => e.run));
      for (const e of entries.values()) {
        e.unsubscribe();
        await e.close();
      }
      await writes;
    },
  };
}
