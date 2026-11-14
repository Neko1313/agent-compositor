import type { CorePlugin, AgentCore } from "@agent-compositor/core";
import {AsyncLocalStorage} from 'node:async_hooks';
import type { HooksApi, UiControllerInput, UiControllerLease } from "@agent-compositor/hooks";
import type { SessionRepository, SessionMeta } from "@agent-compositor/session";
import type { UiTextView } from "@agent-compositor/events";

/** App-private presentation; no lease or invocation API enters a catalog payload. */
export interface SessionHistoryBinding {
  readonly id: string;
  readonly owner: string;
  readonly title: string;
  readonly lease: UiControllerLease;
  input(input: UiControllerInput, api: HooksApi): Promise<void>;
  close(): Promise<void>;
}
export interface SessionHistoryPresenter {
  show(binding: SessionHistoryBinding): void;
  update(binding: SessionHistoryBinding): void;
  remove(binding: SessionHistoryBinding): void;
}
export const sessionCommandNames = ['/sessions', '/history', '/resume', '/fork', '/rename', '/archive', '/unarchive'] as const;
export function installSessionServices(
  core: AgentCore,
  store: SessionRepository,
  cwd: string,
): void {
  const resolver = async (args: {
    action: string;
    id?: string;
    name?: string;
    search?: string;
    includeArchived?: boolean;
    signal?: AbortSignal;
  }) => {
    if (args.action === "list")
      return {
        value: await store.search(cwd, args.search ?? "", {
          includeArchived: args.includeArchived,
          signal: args.signal,
        }),
      };
    if (!core.controlsReady)
      return { deny: "Wait until the current turn finishes" };
    const meta = args.id ? await store.findByPrefix(args.id, cwd) : undefined;
    const id = meta?.id ?? core.sessionId;
    if (args.id && !meta) return { deny: "Session not found or ambiguous" };
    await store.create(cwd, { id: core.sessionId });
    if (args.action === "rename")
      return { value: await store.rename(id, args.name ?? "", cwd) };
    if (args.action === "archive")
      return { value: await store.archive(id, cwd) };
    if (args.action === "unarchive")
      return { value: await store.unarchive(id, cwd) };
    if (args.action === "fork")
      return { value: await store.fork(id, { name: args.name }, cwd) };
    return {
      deny: "Session switching is unavailable in this host; use --resume",
    };
  };
  core.runtime.setResolver("service.session.control", resolver);
  core.runtime.setResolver("service.session.store", resolver);
}
async function service(
  $: HooksApi,
  action: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const result = (await $.emit("service.session.control", {
    ...args,
    action,
  })) as { value?: unknown; deny?: string };
  if (result.deny) throw new Error(result.deny);
  return result.value;
}
export const sessionTitle = (meta: SessionMeta) =>
  meta.name || meta.firstPrompt || (meta.messageCount ? `Chat ${meta.id.slice(0, 8)}` : "New chat");
export function sessionControls(): CorePlugin & {bindPresenter(presenter: SessionHistoryPresenter): () => void} {
  const site = "plugin-session-manager-sessions";
  let controller:UiControllerLease|undefined;
  const inputApi = new AsyncLocalStorage<HooksApi>();
  let openingApi: HooksApi | undefined, presenter: SessionHistoryPresenter | undefined;
  let presentation: {binding: SessionHistoryBinding; presenter: SessionHistoryPresenter} | undefined;
  let lifetime = 0;
  const api = () => {
    const current = inputApi.getStore() ?? openingApi;
    if (!current)throw new Error('History closed');
    current.signal.throwIfAborted();return current;
  };
  let defaultView:UiTextView={lines:[]};
  let state:
    | {
        sessionId: string;
        query: string;
        archived: boolean;
        matches: SessionMeta[];
        selected: number;
        columns: number;
        rows: number;
        revision: number;
        changes: number;
        pending: boolean;
        busy: boolean;
        search?: AbortController;
      }
    | undefined;
  const close = async ($?: HooksApi) => {
    lifetime++;
    state?.search?.abort();
    state = undefined;
    openingApi = undefined;
    const shown = presentation;presentation = undefined;
    const previous=controller;controller=undefined;previous?.dispose();
    if (shown)shown.presenter.remove(shown.binding);
    else if ($)await $.ui.remove("sessions");
  };
  const publish = async ($: HooksApi) => {
    const s = state;
    if (!s || s.sessionId !== $.session.id) return;
    if (presenter && controller?.isDefault !== true) {
      if (presentation)presentation.presenter.update(presentation.binding);
      return;
    }
    const cut = (value: string) =>
      Array.from(value).slice(0, Math.max(12, s.columns)).join("");
    const lines: UiTextView["lines"] = [
      {
        text: cut(
          s.pending
            ? "Searching chats…"
            : `History · ${s.matches.length} chats · ${s.matches.length ? s.selected + 1 : 0}/${s.matches.length}`,
        ),
        bold: true,
      },
      { text: cut("↑↓ select · Enter resume · Esc close"), tone: "muted" },
    ];
    const count = Math.max(1, Math.min(6, Math.floor((s.rows - 10) / 2)));
    const start = Math.floor(s.selected / count) * count;
    for (const meta of s.matches.slice(start, start + count)) {
      const index = s.matches.indexOf(meta);
      const date = new Date(meta.updatedAt);
      const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      lines.push({
        text: cut(
          `${meta.id === s.sessionId ? "● " : ""}${sessionTitle(meta)}`,
        ),
        selected: index === s.selected,
        action: `select:${meta.id}`,
        bold: true,
      });
      lines.push({
        text: cut(
          `${stamp} · ${meta.messageCount ?? 0} messages${meta.archived ? " · archived" : ""}`,
        ),
        tone: "muted",
        action: `select:${meta.id}`,
      });
    }
    const selected = s.matches[s.selected];
    if (!selected) lines.push({ text: "No matching chats.", tone: "muted" });
    else {
      lines.push({
        text: cut(
          `Preview · ${selected.id.slice(0, 8)}${selected.id === s.sessionId ? " · current" : ""}${selected.parentId ? " · fork" : ""}`,
        ),
        tone: "accent",
      });
      lines.push({
        text: cut(`You: ${selected.firstPrompt ?? "No messages yet"}`),
        tone: "muted",
      });
      lines.push({
        text: cut(`Agent: ${selected.lastResponse ?? "No completed response"}`),
        tone: "muted",
      });
      lines.push({
        text:
          selected.id === s.sessionId
            ? "[ Return to current chat ]"
            : "[ Resume selected chat ]",
        action: "resume",
        tone: "accent",
      });
      lines.push({ text: "[ Rename selected chat ]", action: "rename" });
    }
    lines.push(
      {
        text: `[ Archived: ${s.archived ? "shown" : "hidden"} ]`,
        action: "archived",
        tone: "muted",
      },
      { text: "[ Close history ]", action: "escape", tone: "muted" },
    );
    defaultView={hint:'Type search · ↑↓ select · Enter resume · Esc close',
      input:{id:"search",value:s.query,placeholder:"Title, ID or conversation text"},lines};
    const view=controller?.render(s.columns,s.rows)??defaultView;
    await $.ui.view("sessions","Chat history",view,{site:"sidebar",size:0.75,focus:true});
  };
  const refresh = async ($: HooksApi) => {
    const s = state;
    if (!s) return;
    const revision = ++s.revision;
    s.search?.abort();
    const abort = new AbortController();
    s.search = abort;
    let matches: SessionMeta[];
    try {
      matches = (await service($, "list", {
        search: s.query,
        includeArchived: s.archived,
        signal: abort.signal,
      })) as SessionMeta[];
    } catch (error) {
      if (abort.signal.aborted) return;
      throw error;
    }
    matches = matches.filter(
      (m) => m.id === s.sessionId || m.name || m.messageCount || m.firstPrompt,
    );
    if (state !== s || revision !== s.revision) return;
    const id = s.matches[s.selected]?.id;
    s.pending = false;
    s.matches = matches;
    s.selected = Math.max(
      0,
      matches.findIndex((m) => m.id === id),
    );
    await publish($);
  };
  const open = async ($: HooksApi, query = "") => {
    const closing = close($), attempt = lifetime;await closing;
    if (attempt !== lifetime || $.signal.aborted)return;
    state = {
      sessionId: $.session.id,
      query,
      archived: false,
      matches: [],
      selected: 0,
      columns: 70,
      rows: 22,
      revision: 0,
      changes: 0,
      pending: true,
      busy: false,
    };
    openingApi=$;const openedState=state;
    let opened: UiControllerLease | undefined;
    const capabilityApi = () => {
      const current = api();
      if (state !== openedState || controller !== opened)throw new Error('History closed');
      opened?.signal.throwIfAborted();return current;
    };
    try {
    controller=inputApi.run($, () => $.ui.controller("history",{
      sessionId:$.session.id,query,
      control:async(action:string,args:Record<string,unknown>={})=>{
        if(!["list","rename","fork","archive","unarchive"].includes(action))throw new Error("Unsupported history control");
        const current = capabilityApi();
        const result = await service(current,action,args);
        current.signal.throwIfAborted();
        if(state!==openedState || controller!==opened)throw new Error('History closed');
        opened?.signal.throwIfAborted();return result;
      },
      form:async(request:Parameters<HooksApi["ui"]["form"]>[0])=>{
        const current = capabilityApi(), result = await current.ui.form(request);
        current.signal.throwIfAborted();
        if(state!==openedState || controller!==opened)throw new Error('History closed');
        opened?.signal.throwIfAborted();return result;
      },
    },()=>({
      render:()=>defaultView,
      handle:input=>input.kind==="change"
        ? defaultChange({site,id:input.id,value:input.value},api())
        : input.kind==="action"?defaultPress({site,key:input.action},api()):undefined,
    }),()=>{const current = inputApi.getStore() ?? openingApi;if(current)void publish(current).catch(()=>{}); }));
    opened=controller;
    const active = opened;
    active.signal.addEventListener("abort",()=>{if(controller===active)void close(openingApi).catch(()=>{});},{once:true});
    if (active.signal.aborted) {await close($);return;}
    if (presenter && !active.isDefault) {
      const binding: SessionHistoryBinding = {id: site, owner: 'session-manager', title: 'Chat history', lease: active,
        input: (input, current) => handle(input, current, active),
        close: async () => {if (controller === active)await close();},
      };
      presentation = {binding, presenter};presenter.show(binding);
    }
    if(active.isDefault)await refresh($);
    else {await handle({kind:"action",action:"open"}, $, active);}
    } catch (error) {
      await close($);
      if(presenter)throw new Error('History controller failed');
      throw error;
    }
  };
  async function command(text: string, $: HooksApi) {
    const [name, ...rest] = text.trim().split(/\s+/), value = rest.join(' ');
    if (!sessionCommandNames.some(command => command === name))return false;
    try {
      if (['/sessions', '/history'].includes(name) || name === '/resume' && !value)await open($, value);
      else if (name === '/resume') {await close($);await service($, 'resume', {id: value});}
      else if (name === '/rename') {await service($, 'rename', {name: value});await open($);}
      else if (name === '/fork') {
        const meta = await service($, 'fork', {name: value});await $.ui.notify(`Fork created: ${meta.id}`);await open($);
      } else {await service($, name.slice(1), value ? {id: value} : {});await open($);}
    } catch (error) {await $.ui.notify(String(error), 'error');}
    return true;
  }
  const plugin:CorePlugin={
    manifest: {
      name: "session-manager",
      version: "1.1.0",
      trust: "trusted",
      hookTimeouts: {
        "prompt.submit": 30000,
        "ui.change": 30000,
        "ui.press": 600000,
      },
    },
    hooks: {
      "prompt.submit": async (event, $) => {
        if (await command(event.text, $))return {drop: 'session-manager: handled'};
      },
      "ui.change": async (event, $) => {
        const s = state;
        if (
          event.site !== site ||
          event.id !== "search" ||
          !s ||
          s.sessionId !== $.session.id
        )
          return;
        s.query = event.value;
        s.selected = 0;
        s.pending = true;
        s.revision++;
        s.search?.abort();
        const change = ++s.changes;
        await publish($);
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (state !== s || change !== s.changes) return;
        try {
          await refresh($);
        } catch (error) {
          if (state === s && change === s.changes) {
            s.pending = false;
            s.matches = [];
            await publish($);
            await $.ui.notify(String(error), "error");
          }
        }
      },
      "ui.visibility": async (event, $) => {
        const s = state;
        if (
          event.site !== "plugin:session-manager/sessions" ||
          !s ||
          s.sessionId !== $.session.id
        )
          return;
        if (presentation)return;
        if (!event.attached) {
          s.search?.abort();
          state = undefined;const previous=controller;controller=undefined;previous?.dispose();
          return;
        }
        if (!event.visible) return;
        if (s.columns === event.columns && s.rows === event.rows) return;
        s.columns = event.columns;
        s.rows = event.rows;
        await publish($);
      },
      "ui.press": async (event, $) => {
        const s = state;
        if (event.site !== site || !s || s.sessionId !== $.session.id || s.busy)
          return;
        try {
          if (event.key === "escape") {
            await close($);
            return;
          }
          if (s.pending) return;
          if (["up", "down", "pageup", "pagedown"].includes(event.key)) {
            const step = event.key.startsWith("page")
              ? Math.max(1, Math.floor((s.rows - 10) / 2))
              : 1;
            s.selected = Math.max(
              0,
              Math.min(
                s.matches.length - 1,
                s.selected +
                  (event.key === "up" || event.key === "pageup" ? -step : step),
              ),
            );
            await publish($);
            return;
          }
          if (event.key.startsWith("select:")) {
            const index = s.matches.findIndex(
              (m) => m.id === event.key.slice(7),
            );
            if (index >= 0) s.selected = index;
            await publish($);
            return;
          }
          if (event.key === "archived") {
            s.archived = !s.archived;
            s.selected = 0;
            await refresh($);
            return;
          }
          const selected = s.matches[s.selected];
          if (!selected) return;
          s.busy = true;
          if (event.key === "enter" || event.key === "resume") {
            if (selected.id === s.sessionId) {
              await close($);
              return;
            }
            await close($);
            try {
              await service($, "resume", {
                id: selected.id,
                name: sessionTitle(selected),
              });
            } catch (error) {
              await open($,s.query);
              throw error;
            }
          } else if (event.key === "rename") {
            const result = await $.ui.form({
              title: "Rename chat",
              fields: [
                {
                  id: "name",
                  label: "Chat title",
                  type: "text",
                  value: selected.name ?? selected.firstPrompt ?? "",
                  required: true,
                },
              ],
              actions: [
                { id: "save", label: "Save" },
                { id: "cancel", label: "Cancel" },
              ],
            });
            if (result?.action === "save")
              await service($, "rename", {
                id: selected.id,
                name: String(result.values.name),
              });
            await refresh($);
          }
        } catch (error) {
          await $.ui.notify(String(error), "error");
        } finally {
          if (state === s) s.busy = false;
        }
      },
    },
  };
  const defaultPress=plugin.hooks["ui.press"]!;
  const defaultChange=plugin.hooks["ui.change"]!;
  async function handle(input: UiControllerInput, $: HooksApi, active = controller) {
    if (!active || controller !== active || !state || state.sessionId !== $.session.id
      || active.signal.aborted || $.signal.aborted || !['action', 'change'].includes(input.kind))return;
    let privateResume = false;
    try {
      const result=await inputApi.run($, () => active.handle(input));
      if(controller!==active || active.signal.aborted || $.signal.aborted)return;
      if(result==="close")await close($);
      else if(result&&typeof result==="object"&&(result as {type?:string}).type==="resume"){
        const {id,name}=result as {id?:unknown;name?:unknown};
        if(typeof id!=="string"||!id)throw new Error("Invalid session selection");
        privateResume = presentation?.binding.lease === active;
        if (!privateResume)await close($);
        $.signal.throwIfAborted();
        await service($,"resume",{id,...(typeof name==="string"?{name}:{})});
      }else await publish($);
    }catch(error){if(!active.signal.aborted && !$.signal.aborted){
      if(privateResume && controller===active){await $.ui.notify("Could not resume this session","error");await publish($);}
      else {await close($);await $.ui.notify("History controller failed","error");}
    }}
  }
  plugin.hooks["ui.press"]=async(event,$)=>{
    if (event.key.startsWith('command:')) {
      const text = event.key.slice('command:'.length), name = text.trim().split(/\s+/)[0];
      if (event.site === site || event.site === 'command:' + name) {await command(text, $);return;}
    }
    if(event.site===site && !presentation)await handle({kind:"action",action:event.key}, $);
  };
  plugin.hooks["ui.change"]=async(event,$)=>{
    if(event.site===site && !presentation)await handle({kind:"change",id:event.id,value:event.value}, $);
  };
  return Object.assign(plugin, {bindPresenter(next: SessionHistoryPresenter) {
    if (presentation)void close().catch(()=>{});
    presenter = next;
    return () => {if(presenter===next){presenter=undefined;if(presentation)void close().catch(()=>{});}};
  }});
}
