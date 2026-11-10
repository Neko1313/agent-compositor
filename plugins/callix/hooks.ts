import { budgetResult, graphIndex } from "./navigation.js";
import { query, indexProject, isIndexInput } from "./adapter.ts";
import { queryProject } from "@agent-compositor/tools";
import { watch, type FSWatcher } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
const watchers = new Map<
  string,
  {
    watcher?: FSWatcher;
    timer?: ReturnType<typeof setTimeout>;
    abort: AbortController;
    running?: Promise<unknown>;
    dirty: boolean;
    $: any;
    config: any;
  }
>();
const queries=new Set<{controller:AbortController;promise:Promise<unknown>;cwd:string;sessionId:string}>();
async function options($: any,cwd=$.session.cwd) {
  const root=await realpath(cwd),primary=await realpath($.session.cwd);
  return {
    settings: $.storage?.config
      ? await $.storage.config("callix.json")
      : undefined,
    cacheDir: $.storage?.paths
      ? join($.storage.paths.state, "cache", "callix",...(root===primary?[]:['projects',createHash('sha256').update(root).digest('hex').slice(0,20)]))
      : undefined,
  };
}
async function warm(entry: NonNullable<ReturnType<typeof watchers.get>>) {
  if(entry.abort.signal.aborted)return;
  if(entry.running){entry.dirty=true;return;}
  entry.dirty=false;
  entry.running=(async()=>{
    const indexed=await indexProject(entry.$.session.cwd,false,entry.abort.signal,await options(entry.$));
    if(!entry.abort.signal.aborted)graphIndex(indexed.graph);
  })();
  try{await entry.running;}catch(error){
    if(!entry.abort.signal.aborted)await entry.$.telemetry.log('callix.index.error',{error:String(error)}).catch(()=>{});
  }finally{entry.running=undefined;if(entry.dirty&&!entry.abort.signal.aborted)schedule(entry);}
}
function schedule(entry: ReturnType<typeof watchers.get>) {
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.dirty = true;
  entry.timer = setTimeout(()=>{void warm(entry);}, Math.max(100, Math.min(Number(entry.config.debounceMs) || 750, 10000)));
  entry.timer.unref?.();
}
async function start(_: unknown, $: any) {
  await endSession(undefined,$);
  const config = $.storage?.config ? await $.storage.config("callix.json") : {};
  if (config.background === false) return;
  const entry = {
    abort: new AbortController(),
    dirty: false,
    $,
    config,
  } as NonNullable<ReturnType<typeof watchers.get>>;
  watchers.set($.session.id, entry);
  try {
    entry.watcher = watch(
      $.session.cwd,
      { recursive: true },
      (_event, path) => {
        if (!path) return;
        if (
          /(^|[\\/])\.git[\\/](HEAD|index|packed-refs|refs[\\/]heads[\\/])/.test(
            path
          ) &&
          !path.endsWith(".lock")
        ) {
          schedule(entry);
          void $.emit("project.changed", {
            cwd: $.session.cwd,
            paths: [path],
            reason: "git",
          }).catch(() => {});
          return;
        }
        if (
          /(^|[\\/])(node_modules|\.agent-compositor|\.git|dist|build|coverage|\.docusaurus|\.content|\.next|\.cache|\.venv|venv|target)([\\/]|$)/.test(
            path
          )
        )
          return;
        if (
          !isIndexInput(path.replaceAll('\\','/'))
        )
          return;
        schedule(entry);
        void $.emit("project.changed", {
          cwd: $.session.cwd,
          paths: [path],
          reason: "watch",
        }).catch(() => {});
      }
    );
    entry.watcher.unref();
    entry.watcher.on("error", () => {
      entry.watcher?.close();
    });
  } catch (e) {
    await $.telemetry.log("callix.watch.unavailable", { error: String(e) });
  }
  // Startup is eager; debounce applies only to subsequent source changes.
  // Keep ownership in entry.running, without blocking the session's first prompt.
  void warm(entry);
}
async function endSession(_:unknown,$:any) {
  const running=watchers.get($.session.id)?.running;
  const retained=[...queries].filter(operation=>operation.sessionId===$.session.id);
  stop($.session.id);
  for(const operation of retained)operation.controller.abort();
  await Promise.allSettled([running,...retained.map(operation=>operation.promise)]);
}
function stop(id: string) {
  const e = watchers.get(id);
  if (e) {
    clearTimeout(e.timer);
    e.watcher?.close();
    e.abort.abort();
    watchers.delete(id);
  }
}
export async function dispose() {
  const pending = [...watchers.values()].map((e) => e.running);
  for(const operation of queries){operation.controller.abort();pending.push(operation.promise);}
  for (const id of watchers.keys()) stop(id);
  await Promise.allSettled(pending);
}
export default {
  "session.start": start,
  "session.reload": start,
  'session.end':endSession,
  "project.changed": async (e: any, $: any) => {
    if (resolve(e.cwd) === resolve($.session.cwd) && (!e.paths?.length || e.paths.some((path:string)=>isIndexInput(path.replaceAll('\\','/'))||path.startsWith('.git/')))) schedule(watchers.get($.session.id));
  },
  'workspace.changed':async(e:any)=>{
    const revoked=[...queries].filter(operation=>operation.sessionId===e.sessionId&&
      !e.roots.some((root:any)=>root.kind==='directory'&&(operation.cwd===root.path||operation.cwd.startsWith(root.path+sep))));
    for(const operation of revoked)operation.controller.abort();
    await Promise.allSettled(revoked.map(operation=>operation.promise));
  },
  "service.project.query": async (e: any, $: any) => {
    try {
      if(["glob","grep"].includes(e.action)){
        const result=await queryProject(e,$.signal),key=e.action==='glob'?'files':'matches';
        const out=budgetResult({...result,provider:'project-text',metrics:{indexUsed:false}},e.maxTokens??2000,32);
        const count=out[key].length;if(!count&&result[key].length)throw Error('One text result exceeds maxTokens; increase the budget');
        out.truncated=out.truncated||count<result[key].length;if(out.truncated)out.nextOffset=(e.offset??0)+count;
        return{value:budgetResult(out,e.maxTokens??2000)};
      }
      const config=await options($,e.cwd);
      if(e.action==='status')return {value:await query({...e,...config},$.signal)};
      const waitMs=config.settings?.queryWaitMs??10000;
      if(!Number.isInteger(waitMs)||waitMs<50||waitMs>600000)throw Error('Callix queryWaitMs must be 50..600000 milliseconds');
      const queryRoot=await realpath(e.cwd);
      const controller=new AbortController(),promise=query({...e,...config},AbortSignal.any([$.signal,controller.signal]));
      const operation={controller,promise,cwd:queryRoot,sessionId:$.session.id};queries.add(operation);
      void promise.finally(()=>queries.delete(operation)).catch(()=>{});
      if(config.settings?.background===false)return {value:await promise};
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const result=await Promise.race([
          promise.then(value=>({finished:true as const,value})),
          new Promise<{finished:false}>(accept=>{timer=setTimeout(()=>accept({finished:false}),waitMs);}),
        ]);
        if(result.finished)return {value:result.value};
        const status=await query({...e,...config,action:'status'},$.signal);
        if(status.state==='error'||status.state==='unavailable')throw Error(status.error);
        return {value:budgetResult({...status,pending:true,complete:false,requestedAction:e.action,
          hint:'The semantic result is not ready; indexing continues in the background. Use glob/grep/read now. Check code_query action:status later and repeat the original query after state:ready. Do not force refresh or busy-poll.'},e.maxTokens??2000)};
      }finally{clearTimeout(timer);}
    } catch (error) {
      return { deny: String(error) };
    }
  },
};
