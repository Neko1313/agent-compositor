import { budgetResult } from "./navigation.js";
import { query, indexProject } from "./adapter.ts";
import { queryProject } from "@agent-compositor/tools";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
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
async function options($: any) {
  return {
    settings: $.storage?.config
      ? await $.storage.config("callix.json")
      : undefined,
    cacheDir: $.storage?.paths
      ? join($.storage.paths.state, "cache", "callix")
      : undefined,
  };
}
function schedule(entry: ReturnType<typeof watchers.get>) {
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.dirty = true;
  entry.timer = setTimeout(async () => {
    if (entry.abort.signal.aborted) return;
    if (entry.running) {
      schedule(entry);
      return;
    }
    entry.dirty = false;
    entry.running = (async () =>
      indexProject(
        entry.$.session.cwd,
        false,
        entry.abort.signal,
        await options(entry.$)
      ))();
    try {
      await entry.running;
    } catch (e) {
      if (!entry.abort.signal.aborted)
        await entry.$.telemetry.log("callix.index.error", { error: String(e) });
    } finally {
      entry.running = undefined;
      if (entry.dirty) schedule(entry);
    }
  }, Math.max(100, Math.min(Number(entry.config.debounceMs) || 750, 10000)));
  entry.timer.unref?.();
}
async function start(_: unknown, $: any) {
  stop($.session.id);
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
          /(^|[\\/])(node_modules|\.agent-compositor|\.git|dist|build|coverage)([\\/]|$)/.test(
            path
          )
        )
          return;
        if (
          !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|cs|rb|php|json)$/.test(
            path
          )
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
  schedule(entry);
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
  for (const id of watchers.keys()) stop(id);
  await Promise.allSettled(pending);
}
export default {
  "session.start": start,
  "session.reload": start,
  "project.changed": async (e: any, $: any) => {
    if (e.cwd === $.session.cwd) schedule(watchers.get($.session.id));
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
      return {value:await query({ ...e, ...(await options($)) }, $.signal)};
    } catch (error) {
      return { deny: String(error) };
    }
  },
};
