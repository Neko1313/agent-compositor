import { workflowRequest, engineFor, dispose as disposeEngines } from "./engine.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HooksApi } from "@agent-compositor/hooks";
import type { UiTextView } from "@agent-compositor/events";

type Run = { id: string; steps: { prompt: string; result: string }[] };
async function runs($: HooksApi): Promise<Run[]> {
  const root = join(
    $.storage?.paths?.state ?? join($.session.cwd, ".agent-compositor"),
    "workflows"
  );
  const result: Run[] = [];
  for (const id of await readdir(root).catch(() => [])) {
    if (!/^[a-f0-9]{40}$/.test(id)) continue;
    try {
      const steps = JSON.parse(
        await readFile(join(root, id, "journal.json"), "utf8")
      );
      if (Array.isArray(steps))
        result.push({
          id,
          steps: steps
            .filter(
              (s) =>
                typeof s?.prompt === "string" && typeof s?.result === "string"
            )
            .slice(0, 100),
        });
    } catch {
      /* a partial journal must not hide other runs */
    }
  }
  return result.slice(-100).reverse();
}
async function showLegacy($: HooksApi): Promise<void> {
  const list = await runs($),
    selected = Math.min(
      $.state.get<number>("selected") ?? 0,
      Math.max(0, list.length - 1)
    );
  $.state.set("runs", list);
  $.state.set("selected", selected);
  const run = list[selected];
  const lines: UiTextView["lines"] = [
    { text: "Workflow journal", bold: true },
    { text: String($.state.get("status") ?? "Ready"), tone: "muted" },
    { text: "[ Refresh ]", action: "refresh", tone: "accent" },
    ...(run
      ? [
          {
            text: "[ Replay selected run ]",
            action: "replay",
            tone: "accent" as const,
          },
        ]
      : []),
    { text: "" },
    ...list.map((run, i) => ({
      text: `${run.id.slice(0, 10)} · ${run.steps.length} steps`,
      selected: i === selected,
      action: `select:${i}`,
    })),
    ...(!run
      ? [
          {
            text: "No runs yet. Ask the agent to run a workflow.",
            tone: "muted" as const,
          },
        ]
      : run.steps.flatMap((step, i) => [
          { text: `${i + 1}. ${step.prompt.slice(0, 1000)}`, bold: true },
          { text: step.result.slice(0, 2000), tone: "muted" as const },
        ])),
  ];
  await $.ui.view(
    "runs",
    "Workflows",
    { lines },
    { site: "inspector", size: 0.35, focus: false }
  );
}
const subscriptions=new Map<string,()=>void>();
function context($:HooksApi){return{cwd:$.session.cwd,settings:(name:string)=>$.storage.config(name),stateDir:$.storage?.paths?.state,request:async<T=unknown>(service:string,payload:unknown):Promise<T>=>{
  const res:any=await $.emit(service,payload as any);if(res?.deny)throw Error(res.deny);return (res&&'value'in res?res.value:res)as T;
}};}
async function show($:HooksApi){
  const engine=engineFor(context($));await engine.load();
  const list=[...engine.runs.values()].reverse();
  if(!list.length)return showLegacy($);
  const id=$.state.get<string>('runId'),run=list.find(r=>r.id===id)??list[0];
  $.state.set('runId',run.id);
  const selected=$.state.get<string>('stageId'),stage=run.stages.find(s=>s.id===selected);
  const lines:any[]=[{text:'Dynamic workflows',bold:true},{text:'[ Refresh ]',action:'refresh'},...list.map(r=>({text:`${r.title} · ${r.status} · ${r.stages.filter(s=>s.status==='completed').length}/${r.stages.length}`,action:'run:'+r.id,selected:r.id===run.id})),{text:''},
    {text:`${run.title} · ${run.status}`,bold:true,tone:run.status==='completed'?'success':'text'},
    {text:`${run.stages.reduce((n,s)=>n+(s.tokens??0),0)} accounted tokens · ${run.concurrency} workers max`,tone:'muted'},
    ...(run.error?[{text:run.error,tone:'warning'}]:[]),
    ...(run.status==='completed'?[]:[{text:run.status==='running'?'[ Pause scheduling ]':'[ Resume workflow ]',action:run.status==='running'?'pause':'resume',tone:'accent'},{text:'[ Stop workflow ]',action:'stop',tone:'danger'}]),
    ...run.stages.map(s=>({text:`${s.status==='completed'?'✓':s.status==='failed'?'!':s.status==='running'?'●':'○'} ${s.title??s.id} · ${s.status} · attempt ${s.attempts??0} · ${s.tokens??0} tokens${s.status==='running'&&s.activity?' · '+s.activity:''}`,action:'stage:'+s.id,selected:s.id===selected})),
    ...(stage?[{text:'',},{text:`Stage: ${stage.title??stage.id}`,bold:true},{text:`Agent: ${stage.agentId??'not started'}`,tone:'muted'},{text:`Depends on: ${(stage.dependsOn??[]).join(', ')||'none'}`,tone:'muted'},...(['failed','stopped'].includes(stage.status!)?[{text:'[ Retry selected stage ]',action:'retry',tone:'accent'}]:[]),{text:stage.prompt},{text:stage.error??stage.output??'Waiting for a result',tone:stage.error?'danger':'text'}]:[]),
    {text:'[ Legacy Python journals ]',action:'legacy',tone:'muted'},
  ];
  await $.ui.view('runs','Workflows',{lines},{site:'inspector',size:.4,focus:false});
}
async function watch($:HooksApi){
  const ctx=context($),id=ctx.stateDir??ctx.cwd;
  subscriptions.get(id)?.();subscriptions.set(id,engineFor(ctx).onChange(async()=>{if($.state.get('open'))await show($);}));
}
export async function dispose(){for(const fn of subscriptions.values())fn();subscriptions.clear();await disposeEngines();}
export default {
  "service.workflow.run":async(e:any,$:HooksApi)=>{try{return{value:await workflowRequest(context($),e)};}catch(error){return{deny:error instanceof Error?error.message:String(error)};}},
  "agent.activity":async(e:any,$:HooksApi)=>{await engineFor(context($)).activity(e.agentId,e.event,e.data);},
  "session.start": async (_event: unknown, $: HooksApi) => {
    await watch($);
    const engine=engineFor(context($));await engine.load();
    if ((await runs($)).length || engine.runs.size) {
      $.state.set("open", true);
      await show($);
    }
  },
  "session.reload": async (_event: unknown, $: HooksApi) => {
    await watch($);
    const engine=engineFor(context($));await engine.load();
    if ((await runs($)).length || engine.runs.size) {
      $.state.set("open", true);
      await show($);
    }
  },
  "prompt.submit": async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== "/workflows") return;
    $.state.set("open", true);
    await watch($);
    await show($);
    return { drop: "workflows: journal opened" };
  },
  "ui.press": async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== "plugin-workflows-runs") return;
    const engine=engineFor(context($));await engine.load();
    if(event.key==='refresh')await engine.refresh();
    if(event.key==='legacy'){await showLegacy($);return;}
    if(event.key.startsWith('run:')){$.state.set('runId',event.key.slice(4));$.state.delete('stageId');await show($);return;}
    if(event.key.startsWith('stage:')){$.state.set('stageId',event.key.slice(6));await show($);return;}
    if(['pause','resume','retry','stop'].includes(event.key)){
      try{await engine.control($.state.get<string>('runId')!,event.key as any,$.state.get<string>('stageId'));}catch(e){await $.ui.notify(String(e),'error');}await show($);return;
    }
    if (event.key === "replay") {
      const list = $.state.get<Run[]>("runs") ?? [],
        run = list[$.state.get<number>("selected") ?? 0];
      if (!run) return;
      try {
        const code = await $.fs
          .read(`.agent-compositor/workflows/${run.id}/code.py`)
          .catch(() => {
            throw new Error(
              "This run has no Python source. Legacy JavaScript journals cannot be replayed in the Python sandbox."
            );
          });
        const result = await $.agent.tool("workflow", { code });
        if (!result.ok) $.state.set("status", result.error);
      } catch (error) {
        $.state.set("status", String(error));
      }
    } else if (event.key.startsWith("select:"))
      $.state.set("selected", Number(event.key.slice(7)));
    else if (event.key === "down")
      $.state.set(
        "selected",
        Math.min(
          ($.state.get<Run[]>("runs") ?? []).length - 1,
          ($.state.get<number>("selected") ?? 0) + 1
        )
      );
    else if (event.key === "up")
      $.state.set(
        "selected",
        Math.max(0, ($.state.get<number>("selected") ?? 0) - 1)
      );
    await show($);
  },
  "tool.call": async (event: { tool: string }, $: HooksApi) => {
    if (["workflow","workflow_run"].includes(event.tool)) {
      await watch($);
      $.state.set("open", true);
      $.state.set("status", "Running…");
      await show($);
    }
  },
  "subagent.start": async (_e: unknown, $: HooksApi) => {
    if ($.state.get("open")) {
      $.state.set("status", "A workflow step is running…");
      await show($);
    }
  },
  "tool.result": async (
    event: {
      tool: string;
      ok: boolean;
      output?: { steps?: number; replayed?: number; ran?: number };
      error?: string;
    },
    $: HooksApi
  ) => {
    if (!["workflow","workflow_run"].includes(event.tool)) return;
    $.state.set(
      "status",
      event.ok
        ? `${event.output?.steps ?? 0} steps · ${
            event.output?.replayed ?? 0
          } replayed · ${event.output?.ran ?? 0} executed`
        : event.error
    );
    await show($);
  },
};
