import { activeReference } from "./project-context.js";
import { ControllerDialog } from "./controller-dialog.js";
import { type UiControllerFactory, UiControllerLease, type UiControllerInput, type UiControllerView, type UiEditorState, type UiEditorIntent } from "@agent-compositor/hooks";
import { ApprovalDialog } from "./approval.js";
import type { UserQuestionAnswer } from "@agent-compositor/events";
import { FormDialog } from "./form.js";
import type { UiForm, UiFormResult } from "@agent-compositor/events";
import type { UiTextView } from "@agent-compositor/events";
import { PluginPanel, type PluginWindow } from "./plugin-panel.js";
import {
  resolvePlacement,
  type PlacementConfig,
  type Placement,
} from "./placement.js";
import { WindowManager, type ResizeHandle, type DropEdge } from "./windows.js";
import {
  hello,
  answerHello,
  type WireMessage,
} from "@agent-compositor/protocol";
import type {
  AgentCore,
  AgentCoreOptions,
  LoopEvent,
} from "@agent-compositor/core";
import {
  surfacePlacementSchema,
  uiAppearanceSchema,
  uiTextViewSchema,
  type UiAppearance,
} from "@agent-compositor/events";
import {
  clean,
  appearanceFrom,
  gridFrom,
  viewRows,
  rowActions,
  actionAt,
  rasterForView,
  textRows,
  transcriptRows,
  wrap,
  type Row,
  type TranscriptBlock,
} from "./presentation.js";
import { QuestionDialog, type QuestionRequest } from "./question.js";

import {
  previousGraphemeBoundary as previousDraftBoundary,
  nextGraphemeBoundary as nextDraftBoundary,
} from "./text-edit.js";

type MouseInput = Extract<
  Extract<WireMessage, { type: "input" }>["data"],
  { kind: "mouse" }
>;
export interface AppCommand {
  name:string;description:string;usage?:string;
  execution?:'immediate';
  plugin?:string;
  /** Fully qualified surface owned by the declaring, loaded plugin. */
  ui?:{site:string};
}
type Drag =
  | { kind: "resize"; handle: ResizeHandle }
  | {
      kind: "move";
      surface: string;
      col: number;
      row: number;
      moved: boolean;
      target?: string;
      edge?: DropEdge;
      workspace?: number;
    };

/** Core-side controller. Renderers see only versioned wire messages. */
export class AppUI {
  core: AgentCore;
  private sink?: (message: WireMessage) => void;
  private transcript: TranscriptBlock[] = [];
  private appearances = new Map<string, UiAppearance>();
  private theme = appearanceFrom([]);
  private viewCache = new Map<string, { key: string; rows?: Row[]; view?: UiTextView }>();
  private hitRows = new Map<string, Row[]>();
  private savedLayout = "";
  private pendingTextDraw?: ReturnType<typeof setTimeout>;
  private pendingOperationDraw?: ReturnType<typeof setTimeout>;
  private reportedFocus = "";
  private activeAgentPane?: string;
  private fileCatalog?: string[];
  private filePrefix?:string;
  private fileRevision=0;
  private loadingFiles = false;
  private draft = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private historyDraft = "";
  private selectedCommand = 0;
  private completionDismissed = false;
  private commandNavigated = false;
  private scroll = new Map<string, number>();
  private get offset(): number {
    return (
      this.scroll.get(
        this.windows.focused === "input" ? "session" : this.windows.focused
      ) ?? 0
    );
  }
  private set offset(value: number) {
    this.scroll.set(
      this.windows.focused === "input" ? "session" : this.windows.focused,
      value
    );
  }
  private tiled = false;
  private columns = 80;
  private rows = 24;
  readonly windows = new WindowManager();
  private serial = 0;
  private tools = "No tools called yet.";
  private panes = new Map<
    string,
    {
      title: string;
      kind: string;
      text?: string;
      view?: import("@agent-compositor/events").UiTextView;
    }
  >([
    ["session", { title: "Conversation", kind: "session" }],
    ["tools", { title: "Tools", kind: "tools" }],
  ]);
  private viewInputs = new Map<string, {id:string;value:string}>();
  private switchingSession = false;
  private visibility = new Map<string, string>();
  private composerViews = new Map<string, {plugin:string;surface:string;view:UiTextView}>();
  private pluginWindows = new Map<string, PluginWindow>();
  private closedPluginWindows = new Map<string, string>();
  private panel?: PluginPanel;
  private placementController?:UiControllerLease;
  private drag?: Drag;
  private editor?:UiControllerLease;
  private controllerUnsubscribe?:()=>void;
  private controllerBypass=false;
  private editorCapture?:UiControllerLease;
  private readonly uiLifetime=new AbortController();
  private lastMouse?: MouseInput;
  private hoveredTitle?: string;
  private pointerSupported = false;
  private pointer?: Extract<WireMessage, { type: "pointer" }>["shape"];
  private contextIndicator = "";
  private status = "Ready";
  private pendingReload = false;
  private reloading = false;
  private inputTitle = "Message";
  private statusNavigationRows = 1;
  private statusActionsVisible = true;
  private approval?: {
    dialog: ControllerDialog<Parameters<NonNullable<AgentCoreOptions["onApproval"]>>[0]>;
    resolve: (
      answer: Awaited<ReturnType<NonNullable<AgentCoreOptions["onApproval"]>>>
    ) => void;
  };
  private approvalQueue: NonNullable<AppUI["approval"]>[] = [];
  private question?: {
    dialog: ControllerDialog<QuestionRequest>;
    resolve: (answer: UserQuestionAnswer) => void;
    reject: (error: Error) => void;
  };
  private questionQueue: NonNullable<AppUI["question"]>[] = [];
  private unsubscribe: () => void;
  private closed = false;
  private actionFocus = new Map<string, string>();
  private form?: { dialog: ControllerDialog<UiForm>; finish: (result: UiFormResult | null) => void };
  private ready = false;
  private nativeRaster = false;
  private tasks = new Set<Promise<void>>();
  private greeting = hello("core", {
    surfaces: ["terminal", "headless"],
    sites: [],
    elements: ["Text", "Box", "Layout", "Pointer", "Raster"],
    encodings: ["jsonl"],
  });

  constructor(
    createCore: (
      approve: NonNullable<AgentCoreOptions["onApproval"]>,
      ask?: NonNullable<AgentCoreOptions["onAsk"]>
    ) => AgentCore,
    private reload?: (core: AgentCore) => Promise<string>,
    notices: string[] = [],
    private commandList: () => AppCommand[] = () => [],
    private placementConfig: PlacementConfig = {},
    private panelOptions: {
      save?: (
        rule: NonNullable<PlacementConfig["rules"]>[number]
      ) => Promise<string>;
      resume?: (
        id: string,
        approve: NonNullable<AgentCoreOptions["onApproval"]>,
        ask: NonNullable<AgentCoreOptions["onAsk"]>
      ) => Promise<AgentCore>;
      edit?: (draft: string) => Promise<string>;
      files?: (prefix?:string) => Promise<string[]>;
      saveLayout?: (layout: unknown) => Promise<void>;
    } = {}
  ) {
    this.core = createCore(
      (req) => this.requestApproval(req),
      (req) => this.askUser(req)
    );
    this.transcript = this.core
      .getMessages()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        kind: m.role === "user" ? "user" : "assistant",
        text: m.content,
      }));
    for (const notice of notices)
      this.transcript.push({ kind: "notice", text: notice });
    this.windows.focused = "tools";
    this.windows.close();
    this.windows.focused = "input";
    this.unsubscribe = this.core.subscribe((event) => this.event(event));
    this.bindForms();
    this.bindControllers();
    this.installResume();
  }
  private editorSnapshot():UiEditorState {
    try {
      const value=this.editor?.snapshot() as UiEditorState|undefined;
      if(value && typeof value.text==='string' && Number.isInteger(value.cursor) && value.cursor>=0 && value.cursor<=value.text.length)
        return structuredClone(value);
    } catch {/* Preserve the last host draft if an extension cannot snapshot. */}
    return {text:this.draft,cursor:this.cursor};
  }
  private bindControllers():void {
    this.controllerUnsubscribe?.();
    const replace=()=>{
      const state=this.editorSnapshot();this.editor?.dispose();this.draft=state.text;this.cursor=state.cursor;
      const fallback:UiControllerFactory=()=>({
        snapshot:()=>({text:this.draft,cursor:this.cursor}),
        render:({columns,rows})=>this.defaultEditorView(columns,rows),
        preferredRows:()=>this.defaultDockHeight()-5,
        pointer:()=>"text",
        handle:input=>{
          if(input.kind==='action'||input.kind==='change')return;
          const data=input.kind==='mouse'?{...input,row:input.row+this.rows-this.dockHeight()+2,col:input.col+2}:input;
          this.controllerBypass=true;try{this.receive({type:'input',surface:'input',data});}finally{this.controllerBypass=false;}
        },
      });
      const capabilities=new AbortController();
      try{this.editor=this.core.host.controllers.create('editor',{
        sessionId:this.core.sessionId,
        commands:()=>{capabilities.signal.throwIfAborted();return structuredClone(this.commandList());},
        files:this.panelOptions.files?async(prefix?:string)=>{capabilities.signal.throwIfAborted();const files=await this.panelOptions.files!(prefix);capabilities.signal.throwIfAborted();return files;}:undefined,
      },fallback,()=>this.draw(),state,this.uiLifetime.signal);
        this.editor.signal.addEventListener('abort',()=>capabilities.abort(),{once:true});
      }
      catch{
        capabilities.abort();
        this.editor=new UiControllerLease('@unavailable','editor',()=>({snapshot:()=>state,
          render:()=>({lines:[{text:'Selected editor is unavailable',tone:'danger'}]}),
          handle:input=>input.kind==='key'&&input.key==='c'&&input.modifiers?.includes('ctrl')?{type:'interrupt'}:undefined,
        }),{kind:'editor',data:null,state},this.uiLifetime.signal,()=>this.draw(),(_owner,fn)=>fn());
      }
    };
    replace();this.controllerUnsubscribe=this.core.host.controllers.subscribe(kinds=>{if(kinds.includes('editor')){replace();this.draw();}});
  }
  private controllerView(lease:UiControllerLease,columns:number,rows:number):UiControllerView {
    try{return lease.render(columns,rows);}catch{lease.dispose();return{lines:[{text:"Selected controller is unavailable",tone:"danger"}]};}
  }
  private dispatchController(lease:UiControllerLease,input:UiControllerInput,accept:(result:unknown)=>void):void {
    const finish=(result:unknown)=>{if(this.closed||lease.signal.aborted)return;accept(result);this.draw();};
    const failed=()=>{if(lease.signal.aborted||this.closed)return;lease.dispose();this.transcript.push({kind:'notice',tone:'danger',text:`${lease.kind} controller failed`});this.draw();};
    try{const value=lease.handle(input);if(value&&typeof(value as PromiseLike<unknown>).then==='function')this.track(Promise.resolve(value).then(finish,failed));else finish(value);}
    catch{failed();}
  }
  private routeEditorInput(data:Extract<WireMessage,{type:'input'}>['data']):boolean {
    if(!this.editor||this.approval||this.question||this.form||this.panel||this.drag)return false;
    if(data.kind==='key'&&data.modifiers?.includes('meta')){
      const key=data.key.toLowerCase();
      const tiling=['h','j','k','l','left','right','up','down','b','v','f','q','i','=','+','-','enter','t','s','o',','];
      if(this.editor.isDefault||tiling.includes(key)||/^[1-9]$/.test(key))return false;
    }
    let input=data;
    if(data.kind==='mouse') {
      const start=this.rows-this.dockHeight()+2;
      const inside=data.row>=start&&data.row<this.rows-2&&data.col>=2&&data.col<this.columns-2;
      if(!inside&&!this.editorCapture)return false;
      if(data.action==='move'&&!this.editorCapture)return false;
      if(data.action==='press'&&data.button==='left'){this.windows.focused='input';this.editorCapture=this.editor;}
      if(data.action==='release')this.editorCapture=undefined;
      input={...data,row:data.row-start,col:data.col-2};
    } else if(this.windows.focused!=='input')return false;
    const editor=this.editor;
    this.dispatchController(editor,input,result=>{if(this.editor===editor)this.editorIntent(result);});return true;
  }
  private editorIntent(result:unknown):void {
    const intent=result as UiEditorIntent|undefined;if(!intent)return;
    if(intent.type==='interrupt'){if(this.core.getState()==='running')this.core.interrupt();else this.close();return;}
    if(intent.type==='scroll'&&Number.isFinite(intent.rows)){this.offset=Math.max(0,this.offset+intent.rows);return;}
    if((intent.type==='submit'||intent.type==='steer')&&typeof intent.text==='string'&&intent.text.trim()) {
      const text=intent.text;this.transcript.push({kind:'user',text});
      if(this.managementCommand(text))return;
      this.track(intent.type==='steer'?this.core.steer(text):this.core.submit(text));
    }
  }
  /** Host management does not enter the model prompt queue or borrow its tool turn. */
  private managementCommand(text:string):boolean {
    const command=text.trim().split(/\s+/)[0];
    if(command==='/reload'&&this.reload){
      this.pendingReload=true;
      if(this.core.getState()==='running')this.transcript.push({kind:'notice',text:'Plugin changes queued. They will apply when the agent and queued prompts finish.'});
      this.applyPendingReload();return true;
    }
    if(command==='/placement'){this.openPanel();return true;}
    if(command==='/chat'){
      if(text.trim()!==command){this.transcript.push({kind:'notice',text:'Usage: /chat'});this.draw();return true;}
      this.openConversation();return true;
    }
    const registered=this.commandList().find(entry=>entry.name===command);
    if(registered?.execution==='immediate'){
      if(registered.plugin)for(const [id,owner]of this.closedPluginWindows)if(owner===registered.plugin)this.closedPluginWindows.delete(id);
      this.track(this.core.invokeCommand(text).then(()=>{}));return true;
    }
    if(['/settings','/models','/providers'].includes(command)){this.openManagement('plugin-model-selector-models','settings');return true;}
    const owner=command==='/plugins'||command==='/extensions'?'extension-manager-extensions':command==='/marketplace'?'marketplace-manager-marketplaces':undefined;
    if(!owner){
      const route=this.commandList().find(entry=>entry.name===command)?.ui;
      if(!route)return false;
      this.openManagement(route.site,'command:'+text.trim());return true;
    }
    for(const id of ['plugin-extension-manager-extensions','plugin-marketplace-manager-marketplaces'])if(id!=='plugin-'+owner)this.windows.forget(id);
    this.openManagement('plugin-'+owner,'command:'+(command==='/plugins'?'/extensions':text));
    return true;
  }
  private openManagement(site:string,key:string):void {
    this.track(this.press(site,key).then(()=>{
      const workspace=this.windows.workspaceOf(site);
      if(workspace===undefined||this.closed)return;
      if(workspace!==this.windows.workspace)this.windows.switchTo(workspace);
      this.windows.focused=site;
      this.draw();
    }));
  }
  private openConversation():void {
    let id=[...this.panes].find(([id,pane])=>pane.kind==='session'&&this.windows.has(id))?.[0];
    if(!id)id=[...this.panes].find(([,pane])=>pane.kind==='session')?.[0];
    if(!id){id=`window-${++this.serial}`;this.panes.set(id,{kind:'session',title:'Conversation'});}
    const workspace=this.windows.workspaceOf(id);
    if(workspace!==undefined)this.windows.switchTo(workspace);
    if(!this.windows.has(id))this.windows.open(id);
    this.windows.focused=id;this.selectMainConversation();this.draw();
  }
  private selectMainConversation():void {
    this.activeAgentPane=undefined;
    // Conversation copies have distinct window IDs, but share the main input
    // destination. Reset routing even if this window was already focused.
    this.track(this.core.host.emit('ui.focus',{site:'session'}).then(()=>{}));
  }
  private dismissPluginWindow(site:string):boolean {
    const owner=this.pluginWindows.get(site)?.plugin;
    if(!owner)return false;
    // Record user intent before cancellation can publish a final result. Keep
    // updates hidden until an explicit action reopens this plugin's views.
    this.closedPluginWindows.set(site,owner);
    this.windows.forget(site);
    if(![...this.pluginWindows.values()].some(view=>view.plugin===owner&&this.windows.has(view.id)))
      this.core.cancelOperations(owner);
    return true;
  }
  private closeFocusedPane():void {
    const site=this.windows.focused;
    if(!this.dismissPluginWindow(site)){this.windows.close();return;}
    this.track(this.core.host.emit('ui.press',{site,key:'close'}).then(result=>{
      if(result.faults.length)throw Error('Plugin close failed: '+JSON.stringify(result.faults));
    }));
  }
  private async press(site:string,key:string):Promise<void> {
    const manager=['plugin-extension-manager-extensions','plugin-marketplace-manager-marketplaces','plugin-setup-guide-setup'].includes(site);
    if(manager&&key.startsWith('navigate:')){
      const target=key.slice(9);
      if(['extensions','marketplace','reload','placement','settings'].includes(target))this.managementCommand('/'+target);
      return;
    }
    // Result views keep the original surface, but management belongs to Extensions.
    if(manager&&(key.startsWith('manage:')||key==='updates')){
      if(site!=='plugin-extension-manager-extensions')this.windows.forget(site);
      site='plugin-extension-manager-extensions';
    }
    if(key==='close')this.dismissPluginWindow(site);
    else if(!['cancel','escape'].includes(key)){
      const owner=this.pluginWindows.get(site)?.plugin??this.closedPluginWindows.get(site);
      this.closedPluginWindows.delete(site);
      if(owner)for(const [id,plugin]of this.closedPluginWindows)if(plugin===owner)this.closedPluginWindows.delete(id);
    }
    const result=await this.core.host.emit('ui.press',{site,key});
    if(result.faults.length)throw Error('Plugin action failed: '+JSON.stringify(result.faults));
  }
  private applyPendingReload():void {
    if(!this.pendingReload||this.reloading||this.closed||this.form||this.core.getState()==='running'||this.core.hasActiveOperations||!this.reload)return;
    this.pendingReload=false;this.reloading=true;
    this.track(this.reload(this.core).then(text=>{
      this.transcript.push({kind:'notice',text});this.viewCache.clear();
    }).finally(()=>{this.reloading=false;this.draw();}));
  }
  private formResult(request:UiForm,value:unknown):UiFormResult|null {
    const result=value as UiFormResult;
    if(!result||!request.actions.some(action=>action.id===result.action)||!result.values||typeof result.values!=='object')return null;
    const values:UiFormResult['values']={};
    for(const field of request.fields){
      const entry=result.values[field.id];
      if(field.type==='toggle'?typeof entry!=='boolean':typeof entry!=='string')return null;
      if(field.required&&!String(entry).trim())return null;
      if(typeof entry==='string'&&entry.length>4096)return null;
      if(field.type==='select'&&!field.options?.some(option=>option.value===entry))return null;
      if(field.type==='url'&&entry){try{if(!['http:','https:'].includes(new URL(String(entry)).protocol))return null;}catch{return null;}}
      values[field.id]=entry;
    }
    return {action:result.action,values};
  }
  private bindForms(): void {
    this.core.host.setFormHandler((_plugin, request: UiForm, signal) => {
      if (this.closed || signal.aborted) return Promise.resolve(null);
      if (this.form) return Promise.reject(new Error('Close the current form first'));
      return new Promise(resolve => {
        const native = new FormDialog(request);
        const dialog = new ControllerDialog(this.core.host.controllers.create("form",request,()=>({
          render:({columns,rows})=>({lines:native.visible(columns,rows)}),
          handle:input=>native.handle(input as Extract<WireMessage,{type:'input'}>['data']),
          preferredRows:(_columns,max)=>max,pointer:()=>['password','text','url'].includes(native.request.fields[native.focus]?.type??'')?'text':'pointer',
          dispose:()=>native.clear(),
        }),()=>this.draw()),request);
        let settled=false;
        const abort = () => finish(null);
        const finish = (result: UiFormResult | null) => {
          if(settled)return;settled=true;
          signal.removeEventListener('abort', abort);dialog.lease.signal.removeEventListener('abort',abort);
          if (this.form?.dialog === dialog) this.form = undefined;
          if(this.windows.focused==='settings-form')this.windows.focused='input';
          dialog.clear(); resolve(result); this.draw();
        };
        this.form = { dialog, finish };
        this.windows.focused='settings-form';
        signal.addEventListener('abort', abort, { once: true });
        dialog.lease.signal.addEventListener('abort',abort,{once:true});
        this.cancelDrag(); this.draw();
      });
    });
  }
  connect(sink: (message: WireMessage) => void): void {
    this.sink = sink;
    sink(this.greeting);
  }
  resize(columns: number, rows: number): void {
    this.cancelDrag();
    this.columns = Math.max(16, columns);
    this.rows = Math.max(12, rows);
    this.draw();
  }
  restoreLayout(value: unknown): void {
    const layout = value as {
      windows?: unknown;
      views?: { id: string; title: string; kind: string }[];
    };
    if (!layout?.windows) return;
    for (const view of (layout.views ?? []).slice(0, 100)) {
      if (
        /^window-\d+$/.test(view.id) &&
        ["session", "tools", "help"].includes(view.kind)
      ) {
        this.panes.set(view.id, { title: view.title, kind: view.kind });
        this.serial = Math.max(this.serial, Number(view.id.slice(7)));
      }
    }
    this.windows.restore(layout.windows, new Set(this.panes.keys()));
    for (const window of this.pluginWindows.values()) {
      if (
        this.placementConfig.rules?.some(
          (rule) =>
            (!rule.match.plugin || rule.match.plugin === window.plugin) &&
            (!rule.match.surface || rule.match.surface === window.surface)
        )
      ) {
        this.windows.relocate(
          window.id,
          resolvePlacement(
            this.placementConfig,
            window.plugin,
            window.surface,
            window.placement
          )
        );
      }
    }
    this.draw();
  }
  private event(event: LoopEvent): void {
    // The subsequent text notification contains the rewritten delta. Rendering
    // its catalog precursor would draw the previous transcript a second time.
    if(event.kind==='catalog'&&event.event==='assistant.text')return;
    if (event.kind === "text") {
      let block = this.transcript.at(-1);
      if (block?.kind !== "assistant") {
        block = { kind: "assistant", text: "" };
        this.transcript.push(block);
      }
      block.text += event.delta;
    } else {
      const { input, event: name } = event;
      if (name === "ui.inputTarget") {
        if(typeof input.surface==='string')this.closedPluginWindows.delete(input.surface);
        this.activeAgentPane =
          typeof input.surface === "string" &&
          input.surface.startsWith("plugin-agent-hub-agent-")
            ? input.surface.slice("plugin-agent-hub-agent-".length)
            : undefined;
        this.inputTitle = input.label ? `Message → ${String(input.label)}` : "Message";
        this.sink?.({
          type: "declare",
          surfaces: [
            {
              id: "input",
              kind: "pane",
              title: input.label
                ? `Message → ${String(input.label)}`
                : "Message",
            },
          ],
        });
      }
      if (name === "context.pressure") this.contextIndicator = ` · ctx ${Math.round(Number(input.pressure)*100)}%/${Math.round(Number(input.contextWindow)/1024)}k${input.source==='fallback'?' ~':''}`;
      if (name === "context.restored" && Array.isArray(input.messages))
        this.transcript = input.messages
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({
            kind: m.role === "user" ? "user" : "assistant",
            text: m.content,
          }));
      if (name === "ui.invalidate") this.viewCache.clear();
      if (name === "subagent.start")
        this.transcript.push({
          kind: "notice",
          text: `Subagent ${input.agentId} · working`,
          tone: "muted",
        });
      if (name === "subagent.complete")
        this.transcript.push({
          kind: "notice",
          text: `Subagent ${input.agentId} · ${
            input.ok ? "completed" : input.error
          }`,
          tone: input.ok ? "success" : "danger",
        });
      if (name === "ui.notification")
        this.transcript.push({
          kind: "notice",
          text: `${input.plugin}: ${input.message}`,
          tone:
            input.level === "error"
              ? "danger"
              : input.level === "warn"
              ? "warning"
              : "muted",
        });
      if (name === "turn.start") {
        this.status = "Working";
      }
      if (name === "ui.appearance" || name === "ui.pluginRemoved") {
        const plugin = String(input.plugin ?? "custom");
        if (name === "ui.pluginRemoved") {
          for(const [id,owner]of this.closedPluginWindows)if(owner===plugin)this.closedPluginWindows.delete(id);
          for(const [id,view] of this.composerViews)if(view.plugin===plugin)this.removeComposer(id);
        }
        if (name === "ui.pluginRemoved")
          for (const window of [...this.pluginWindows.values()]) {
            if (window.plugin !== plugin) continue;
            this.windows.forget(window.id);
            this.panes.delete(window.id);
            this.pluginWindows.delete(window.id);
            this.visibility.delete(window.id);
            this.viewCache.delete(window.id);
            void this.core.host
              .emit("ui.visibility", {
                site: `plugin:${window.plugin}/${window.surface}`,
                attached: false,
                visible: false,
                columns: 0,
                rows: 0,
              })
              .catch(() => {});
          }
        if (name === "ui.pluginRemoved" || input.appearance === null)
          this.appearances.delete(plugin);
        else {
          const parsed = uiAppearanceSchema.safeParse(input.appearance);
          if (parsed.success) {
            this.appearances.delete(plugin);
            this.appearances.set(plugin, parsed.data);
          }
        }
        this.theme = appearanceFrom(this.appearances.values());
        this.viewCache.clear();
        if (
          name === "ui.appearance" &&
          input.appearance &&
          (input.appearance as UiAppearance).presentation?.showTools !==
            undefined
        ) {
          if (this.theme.presentation.showTools)
            this.windows.place("tools", {
              site: "sidebar",
              size: 0.3,
              focus: false,
            });
          else if (this.windows.has("tools")) {
            const focus = this.windows.focused;
            this.windows.focused = "tools";
            this.windows.close();
            this.windows.focused = focus === "tools" ? "input" : focus;
          }
        }
      }
      if (name === "tool.call")
        this.tools += `\n${input.tool} ${JSON.stringify(input.input)}\n`;
      if (name === "tool.result")
        this.tools += `\n${input.tool}: ${input.ok ? "done" : input.error}\n`;
      if (name === "ui.surfaceRemoved") {
        const id = String(input.id);
        this.removeComposer(id);
        const window = this.pluginWindows.get(id);
        if (window)
          void this.core.host
            .emit("ui.visibility", {
              site: `plugin:${window.plugin}/${window.surface}`,
              attached: false,
              visible: false,
              columns: 0,
              rows: 0,
            })
            .catch(() => {});
        this.visibility.delete(id);
        if(this.windows.focused===id&&this.panes.get(id)?.view?.input)this.windows.focused="input";
        this.windows.forget(id);
        this.panes.delete(id);
        this.pluginWindows.delete(id);
        this.viewCache.delete(id);
        this.viewInputs.delete(id);
      }
      if (name === "ui.surface") {
        const id = String(input.id);
        if(this.closedPluginWindows.has(id))return;
        const view = uiTextViewSchema.safeParse(input.view);
        if(view.success&&view.data.attachment){
          this.windows.forget(id); this.panes.delete(id); this.pluginWindows.delete(id);
          this.composerViews.set(id,{plugin:String(input.plugin??"custom"),surface:String(input.surface??input.id),view:view.data});
          this.draw(); return;
        }
        this.removeComposer(id);
        if(!view.success||!view.data.input)this.viewInputs.delete(id);
        if(view.success&&view.data.input&&this.viewInputs.get(id)?.id!==view.data.input.id)
          this.viewInputs.set(id,{id:view.data.input.id,value:view.data.input.value});
        this.panes.set(id, {
          title: String(input.title),
          kind: "plugin",
          text: String(input.text),
          view: view.success ? view.data : undefined,
        });
        const plugin = String(input.plugin ?? "custom"),
          surface = String(input.surface ?? input.id);
        const placement = resolvePlacement(
          this.placementConfig,
          plugin,
          surface,
          this.pluginWindows.get(id)?.placement ??
            ((input.placement ?? {}) as Placement)
        );
        this.pluginWindows.set(id, {
          id,
          plugin,
          surface,
          title: String(input.title),
          placement,
        });
        if (!this.windows.has(id)) this.windows.place(id, placement);
        if((input.placement as Placement|undefined)?.focus===true&&resolvePlacement(this.placementConfig,plugin,surface,{...placement,focus:true}).focus!==false){
          const workspace=this.windows.workspaceOf(id);
          if(workspace!==undefined&&workspace!==this.windows.workspace)this.windows.switchTo(workspace);
          this.windows.focused=id;
        }
      }
      if (name === "tool.call") {
        const args = input.input as Record<string, unknown> | undefined;
        this.transcript.push({
          kind: "tool",
          tool: String(input.tool),
          callId: typeof input.callId==='string'?input.callId:undefined,
          args: JSON.stringify(input.input),
          state: "running",
          text: String(args?.path ?? args?.command ?? "running"),
        });
      }
      if (name === "tool.result") {
        const block = [...this.transcript]
          .reverse()
          .find(
            (b) =>
              b.kind === "tool" &&
              (typeof input.callId==='string'?b.callId===input.callId:b.tool===input.tool) &&
              b.state === "running"
          );
        if (block) {
          block.state = input.ok ? "done" : "error";
          block.text = input.ok
            ? block.text === "running"
              ? "completed"
              : block.text
            : String(input.error);
        } else if (!input.ok)
          this.transcript.push({
            kind: "notice",
            tone: "danger",
            text: `Tool error: ${input.error}`,
          });
      }
      if (name === "prompt.queued")
        this.status = `Working · ${input.depth} queued`;
      if(['tool.operation','command.operation'].includes(name)&&input.phase==='completed'){
        const block=name==='tool.operation'?this.transcript.find(b=>b.kind==='tool'&&b.callId===input.callId&&b.state==='running'):undefined;
        if(block){block.state=input.ok?'done':'error';block.text=String(input.error??'completed');}
        // Completion is broadcast just before the core removes its operation.
        // A normal draw must not cancel this final settlement refresh.
        this.pendingOperationDraw??=setTimeout(()=>{this.pendingOperationDraw=undefined;this.applyPendingReload();this.draw();},16);
      }
      if (name === "turn.complete") {
        this.status = "Ready";
      }
      if (name === "turn.failed" || name === "turn.interrupted") {
        this.status =
          name === "turn.failed"
            ? "Failed — submit to try again"
            : "Interrupted";
        this.transcript.push({
          kind: "notice",
          tone: name === "turn.failed" ? "danger" : "warning",
          text: String(input.error ?? "Interrupted"),
        });
      }
    }
    if(event.kind==='text'){
      this.pendingTextDraw??=setTimeout(()=>{this.pendingTextDraw=undefined;this.draw();},16);
    }else this.draw();
  }
  receive(message: WireMessage): void {
    if (this.closed) return;
    if (message.type === "hello") {
      this.nativeRaster = message.capabilities.elements.includes("Raster");
      this.viewCache.clear();
      this.tiled = message.capabilities.elements.includes("Layout");
      this.pointerSupported = message.capabilities.elements.includes("Pointer");
      const ack = answerHello(this.greeting, message);
      this.sink?.(ack);
      this.ready = ack.ok;
      if (!ack.ok) {
        this.close();
        return;
      }
      this.sink?.({
        type: "declare",
        surfaces: [
          { id: "session", kind: "pane", title: "Conversation" },
          { id: "input", kind: "pane", title: "Message" },
          { id: "status", kind: "status-bar" },
        ],
      });
      this.sink?.({ type: "focus", surface: "input" });
      this.draw();
      return;
    }
    if (message.type === "bye") {
      this.close();
      return;
    }
    if (!this.ready || message.type !== "input") return;
    const data = message.data;
    if(data.kind==='key'&&data.key==='c'&&data.modifiers?.includes('ctrl')&&this.windows.focused!=='input'){
      const owner=this.pluginWindows.get(this.windows.focused)?.plugin;
      if(owner&&this.core.cancelOperations(owner)){this.draw();return;}
    }
    if (data.kind === "mouse") this.lastMouse = data;
    if(!this.controllerBypass && this.routeEditorInput(data))return;
    if (data.kind === "key" && this.drag) {
      this.cancelDrag();
      if (data.key === "escape") {
        this.draw();
        return;
      }
    }
    if (data.kind === 'mouse' && this.compactInteraction() && data.row >= this.rows-this.dockHeight()+2 && data.row < this.rows-2 && data.col >= 2 && data.col < this.columns-2) {
      // Expanding the dock must not also choose an answer or approve a tool.
      if(data.button==='left' && data.action==='press') {this.windows.focused='input';this.draw();}
      return;
    }
    if (this.approval && data.kind==='mouse') {
      const start=this.rows-this.dockHeight()+2;
      if(data.row>=start&&data.row<this.rows-2&&data.col>=2&&data.col<this.columns-2){
        this.windows.focused='input';this.handleApproval({...data,row:data.row-start,col:data.col-2});return;
      }
    }
    if (this.question && !this.approval && data.kind === "mouse") {
      const start = this.rows - this.dockHeight() + 2;
      if (data.row >= start && data.row < this.rows - 2 && data.col >= 2 && data.col < this.columns - 2){
        this.windows.focused='input';this.handleQuestion({ ...data, row: data.row - start, col: data.col - 2 });return;
      }
    }
    if (
      data.kind === "mouse" &&
      (data.action === "move" || data.action === "release")
    ) {
      if (this.drag && !this.approval && !this.panel) this.continueDrag(data);
      else {
        const previous = this.hoveredTitle;
        this.updatePointer();
        if (previous !== this.hoveredTitle) this.draw();
      }
      return;
    }
    if (this.form && (!(this.approval||this.question)||this.windows.focused!=='input'||data.kind==='mouse')) {
      if (data.kind === 'mouse' && (data.row < 2 || data.row >= this.rows - this.dockHeight() - 1 || data.col < 2 || data.col >= this.columns - 2)) return;
      const input = data.kind === 'mouse' ? { ...data, row: data.row - 2, col: data.col - 2 } : data;
      this.windows.focused='settings-form';
      const current=this.form;
      this.dispatchController(current.dialog.lease,input,result=>{
        if(this.form!==current)return;
        if(result)current.finish(result==='cancel'?null:this.formResult(current.dialog.request,result));
      });return;
    }
    if (this.panel) {
      const lease=this.placementController!;
      this.dispatchController(lease,data,result=>{
        if(this.placementController!==lease)return;
        if(result==="close")this.closePanel();
        else if(result==="apply"||result==="save")this.track(this.applyPanel(result==="save"));
      });
      return;
    }
    if (data.kind === "mouse") {
      if (this.drag) this.cancelDrag();
      if (data.button === "left" && data.row >= this.rows - 2) {
        if(data.row>=this.rows-2+this.statusNavigationRows)return;
        const wrap = this.columns - 2;
        if(data.col<0||data.col>=wrap)return;
        const position = (data.row - (this.rows - 2)) * wrap + data.col;
        const tab = this.workspaceTabs().find(
          (tab) =>
            data.col < wrap && position >= tab.start && position < tab.end
        );
        const buttonStart = (this.workspaceTabs().at(-1)?.end ?? 0) + 3;
        if (this.statusActionsVisible && buttonStart+21<=wrap && position >= buttonStart + 11 && position < buttonStart + 21) {
          this.managementCommand('/settings');
          return;
        }
        if (this.statusActionsVisible && buttonStart+9<=wrap && position >= buttonStart && position < buttonStart + 9) {
          this.managementCommand('/plugins');
          this.draw();
          return;
        }
        if (tab) {
          this.windows.switchTo(tab.id);
          this.draw();
        }
        return;
      }
      const dock = this.dockHeight();
      if (
        data.button === "left" &&
        data.row >= this.rows - dock + 3 &&
        data.row < this.rows - 3
      ) {
        const match =
          this.visibleCompletions()[data.row - (this.rows - dock + 3)];
        if (match) {
          this.windows.focused = "input";
          this.complete(match);
          return;
        }
      }
      const separator =
        data.button === "left" && data.action === "press"
          ? this.windows.separator(
              data.col,
              data.row,
              this.columns,
              this.rows - dock
            )
          : undefined;
      if (separator) {
        this.drag = { kind: "resize", handle: separator };
        this.draw();
        return;
      }
      const frames = [
        ...this.windows.frames(this.columns, this.rows - dock),
        {
          surface: "input",
          x: 0,
          y: this.rows - dock,
          width: this.columns,
          height: dock - 2,
        },
      ];
      const hit = frames.find(
        (f) =>
          data.col >= f.x &&
          data.col < f.x + f.width &&
          data.row >= f.y &&
          data.row < f.y + f.height
      );
      if (!hit) return;
      if (data.button === "left") {
        this.windows.focused = hit.surface;
        const action = actionAt(this.hitRows.get(hit.surface)?.[data.row - hit.y - 2],data.col-hit.x-2);
        if (
          action &&
          data.col >= hit.x + 2 &&
          data.col < hit.x + hit.width - 2 &&
          data.action !== "release"
        ) {
          this.actionFocus.set(hit.surface,action);
          this.track(
            this.press(hit.surface,action)
          );
          this.draw();
          return;
        }
        if (
          hit.surface !== "input" &&
          data.row === hit.y + 1 &&
          hit.width >= 14
        ) {
          if (
            data.col >= hit.x + hit.width - 4 &&
            data.col < hit.x + hit.width - 1
          ) {
            this.closeFocusedPane();
            this.draw();
            return;
          }
          if (
            data.col >= hit.x + hit.width - 7 &&
            data.col < hit.x + hit.width - 4
          ) {
            this.windows.fullscreen = !this.windows.fullscreen;
            this.draw();
            return;
          }
        }
        if (
          data.action === "press" &&
          hit.surface !== "input" &&
          data.row <= hit.y + 1
        )
          this.drag = {
            kind: "move",
            surface: hit.surface,
            col: data.col,
            row: data.row,
            moved: false,
          };
      } else if (data.button === "wheel-up" || data.button === "wheel-down") {
        const current = this.scroll.get(hit.surface) ?? 0;
        this.scroll.set(
          hit.surface,
          Math.max(0, current + (data.button === "wheel-up" ? 3 : -3) * (this.panes.get(hit.surface)?.view ? -1 : 1))
        );
      }
      this.draw();
      return;
    }
    if (
      data.kind === "key" &&
      data.key === "c" &&
      data.modifiers?.includes("ctrl")
    ) {
      if (this.approval) {
        this.approval.resolve(false);
        this.approval = undefined;
      }
      for (const approval of this.approvalQueue.splice(0))
        approval.resolve(false);
      this.cancelQuestions();
      if (this.activeAgentPane) {
        this.track(
          this.core.host
            .emit("service.agent.control", {
              action: "stop",
              id: this.activeAgentPane,
            })
            .then(() => {})
        );
        this.draw();
        return;
      }
      if (this.core.getState() === "running") {
        this.core.interrupt();
        this.draw();
      } else this.close();
      return;
    }
    if (this.question && !this.approval && this.windows.focused==='input' && !(data.kind==='key'&&data.modifiers?.includes('meta'))) {
      this.handleQuestion(data);
      return;
    }
    if (
      data.kind === "key" &&
      data.key === "g" &&
      data.modifiers?.includes("ctrl") &&
      this.windows.focused === "input" &&
      this.panelOptions.edit
    ) {
      this.track(
        this.panelOptions.edit(this.draft).then((value) => {
          this.draft = value;
          this.cursor = value.length;
          this.draw();
        })
      );
      return;
    }
    if (this.approval && this.windows.focused==='input' && !(data.kind==='key'&&data.modifiers?.includes('meta'))) {
      this.handleApproval(data);
      return;
    }
    const matches = this.completions();
    if (
      this.windows.focused === "input" &&
      data.kind === "key" &&
      matches.length
    ) {
      if (data.key === "escape") {
        this.completionDismissed = true;
        this.draw();
        return;
      }
      if (data.key === "up" || data.key === "down") {
        this.selectedCommand =
          (this.selectedCommand +
            (data.key === "up" ? -1 : 1) +
            matches.length) %
          matches.length;
        this.commandNavigated = true;
        this.draw();
        return;
      }
      const selected =
        matches[Math.min(this.selectedCommand, matches.length - 1)];
      if (
        data.key === "tab" ||
        (data.key === "enter" &&
          !data.modifiers?.includes("shift") &&
          (this.commandNavigated || (!activeReference(this.draft,this.cursor) && this.draft !== selected.name)))
      ) {
        this.complete(selected);
        return;
      }
    }
    if (data.kind === "key" && data.modifiers?.includes("meta")) {
      const key = data.key.toLowerCase(),
        shift = data.modifiers.includes("shift");
      const direction =
        (
          { h: "left", j: "down", k: "up", l: "right" } as Record<
            string,
            string
          >
        )[key] ?? key;
      if (["left", "right", "up", "down"].includes(direction))
        this.windows.direction(
          direction,
          this.columns,
          this.rows - this.dockHeight(),
          shift
        );
      else if (/^[1-9]$/.test(key)) {
        if (shift) this.windows.moveWorkspace(Number(key));
        else this.windows.switchTo(Number(key));
      } else if (key === "p") this.openPanel();
      else if (key === "o") this.managementCommand('/plugins');
      else if (key === ",") this.managementCommand('/settings');
      else if (key === "b") this.windows.axis = "horizontal";
      else if (key === "v") this.windows.axis = "vertical";
      else if (key === "f") this.windows.fullscreen = !this.windows.fullscreen;
      else if (key === "q") this.closeFocusedPane();
      else if (key === "i") {
        this.windows.focused = "input";
      } else if (key === "=" || key === "+") this.windows.resize(0.05);
      else if (key === "-") this.windows.resize(-0.05);
      else if (["enter", "t", "s", "?", "/"].includes(key)) {
        const kind =
          key === "t"
            ? "tools"
            : key === "s" || key === "enter"
            ? "session"
            : "help";
        const id = `window-${++this.serial}`;
        this.panes.set(id, {
          title:
            kind === "tools"
              ? "Tools"
              : kind === "session"
              ? "Conversation"
              : "Window controls",
          kind,
        });
        this.windows.open(id);
        if(kind==='session')this.selectMainConversation();
      }
      this.draw();
      return;
    }
    const focusedView=this.panes.get(this.windows.focused)?.view;
    const tabs=(this.viewCache.get(this.windows.focused)?.view??focusedView)?.tabs;
    if(this.windows.focused!=='input'&&tabs&&data.kind==='key'&&['left','right'].includes(data.key)&&!data.modifiers?.length){
      const enabled=tabs.filter(tab=>!tab.disabled);
      if(enabled.length){
        let index=enabled.findIndex(tab=>tab.action===this.actionFocus.get(this.windows.focused));
        if(index<0)index=enabled.findIndex(tab=>tab.selected);
        const next=index<0?(data.key==='left'?enabled.length-1:0):(index+(data.key==='left'?-1:1)+enabled.length)%enabled.length;
        this.actionFocus.set(this.windows.focused,enabled[next].action);
        const frame=this.windows.frames(this.columns,this.rows-this.dockHeight()).find(frame=>frame.surface===this.windows.focused);
        const width=Math.max(1,(frame?.width??this.columns)-4),height=Math.max(1,(frame?.height??this.rows)-3);
        const rows=viewRows((this.viewCache.get(this.windows.focused)?.view??focusedView)!,width,height);
        const target=rows.findIndex(row=>rowActions(row).includes(enabled[next].action)),room=Math.max(1,height-(rows.length>height?1:0));
        this.scroll.set(this.windows.focused,Math.max(0,target-room+1));
        this.track(this.press(this.windows.focused,enabled[next].action));
      }
      this.draw();return;
    }
    if(this.windows.focused!=='input'&&focusedView&&data.kind==='key'&&['pageup','pagedown'].includes(data.key)
      &&(focusedView.scrollKeys??(focusedView.input?'plugin':'host'))==='host'){
      const frame=this.windows.frames(this.columns,this.rows-this.dockHeight()).find(frame=>frame.surface===this.windows.focused);
      const width=Math.max(1,(frame?.width??this.columns)-4),height=Math.max(1,(frame?.height??this.rows)-3);
      const view=this.viewCache.get(this.windows.focused)?.view??focusedView;
      const count=viewRows(view,width,height,this.nativeRaster).length+(focusedView.input?1:0);
      const room=Math.max(1,height-(count>height?1:0)),maximum=Math.max(0,count-room);
      this.offset=Math.max(0,Math.min(maximum,Math.min(maximum,this.offset)+(data.key==='pageup'?-1:1)*room));
      this.draw();return;
    }
    const editable = this.panes.get(this.windows.focused)?.view?.input;
    if (this.windows.focused !== "input" && editable) {
      const site = this.windows.focused;
      const field = this.viewInputs.get(site) ?? { id: editable.id, value: editable.value };
      const clear = data.kind === "key" && data.key === "u" && data.modifiers?.includes("ctrl");
      if (clear || data.kind === "text" || (data.kind === "key" && ["backspace", "delete"].includes(data.key))) {
        field.value = clear ? "" : data.kind === "text"
          ? (field.value + data.text.replace(/[\x00-\x1f\x7f]/g, " ")).slice(0, 4000)
          : Array.from(field.value).slice(0, -1).join("");
        this.viewInputs.set(site, field);
        this.scroll.set(site, 0);
        this.track(this.core.host.emit("ui.change", { site, id: field.id, value: field.value }).then(() => {}));
      } else if (data.kind === "key") {
        this.track(this.press(site,data.key));
      }
      this.draw();return;
    }
    if (data.kind === "key" && data.key === "escape") {
      this.windows.focused = this.windows.ids()[0] ?? "input";
      this.draw();
      return;
    }
    if (this.windows.focused !== 'input' && this.panes.get(this.windows.focused)?.kind === 'plugin' && data.kind === 'key' && ['up','down','enter'].includes(data.key)) {
      const site=this.windows.focused,pane=this.panes.get(site)!;
      const frame=this.windows.frames(this.columns,this.rows-this.dockHeight()).find(f=>f.surface===site);
      const width=Math.max(1,(frame?.width??this.columns)-4),height=Math.max(1,(frame?.height??this.rows)-3);
      const view=this.viewCache.get(site)?.view??pane.view;
      const rows=view?viewRows(view,width,height):this.hitRows.get(site)??[];
      const visited=new Set<string>();
      const actions=rows.flatMap((row,index)=>rowActions(row).map(action=>({action,row:index}))).filter(item=>{
        if(visited.has(item.action))return false;visited.add(item.action);return true;
      });
      if (actions.length) {
        const current=actions.findIndex(r=>r.action===this.actionFocus.get(site));
        const index=current<0?(data.key==='up'?actions.length-1:0):(current+(data.key==='up'?-1:data.key==='down'?1:0)+actions.length)%actions.length;
        const action=actions[index].action!;this.actionFocus.set(site,action);
        const target=actions[index].row,room=Math.max(1,height-(rows.length>height?1:0));
        const offset=this.scroll.get(site)??0;
        if(target<offset)this.scroll.set(site,target);
        else if(target>=offset+room)this.scroll.set(site,target-room+1);
        if(data.key==='enter')this.track(this.press(site,action));
        this.draw();return;
      }
    }
    if (this.windows.focused !== "input") {
      if (data.kind === "key" && data.key === "pageup" && focusedView?.scrollKeys!=="plugin")
        this.offset = Math.max(0, this.offset + (this.panes.get(this.windows.focused)?.view ? -1 : 1) * Math.max(1, this.rows - 10));
      else if (data.kind === "key" && data.key === "pagedown" && focusedView?.scrollKeys!=="plugin")
        this.offset = Math.max(0, this.offset + (this.panes.get(this.windows.focused)?.view ? 1 : -1) * Math.max(1, this.rows - 10));
      else if (this.panes.get(this.windows.focused)?.kind === "plugin")
        this.track(
          this.press(this.windows.focused,data.kind === "text" ? data.text : data.key)
        );
      this.draw();
      return;
    }
    if (
      data.kind === "text" ||
      (data.kind === "key" && ["backspace", "delete"].includes(data.key))
    ) {
      this.completionDismissed = false;
      this.selectedCommand = 0;
      this.commandNavigated = false;
    }
    if (data.kind === "text") {
      const text = data.text
        .replace(/\r\n?/g, "\n")
        .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ");
      this.draft =
        this.draft.slice(0, this.cursor) + text + this.draft.slice(this.cursor);
      this.cursor += text.length;

    } else if (
      (data.key === "enter" && data.modifiers?.includes("shift")) ||
      (data.key === "j" && data.modifiers?.includes("ctrl"))
    ) {
      this.draft =
        this.draft.slice(0, this.cursor) + "\n" + this.draft.slice(this.cursor);
      this.cursor++;
    } else if (
      (data.key === "up" || data.key === "down") &&
      (!this.draft.includes("\n") || this.historyIndex >= 0) &&
      this.history.length
    ) {
      if (this.historyIndex === -1) this.historyDraft = this.draft;
      this.historyIndex = Math.max(
        -1,
        Math.min(
          this.history.length - 1,
          this.historyIndex + (data.key === "up" ? 1 : -1)
        )
      );
      this.draft =
        this.historyIndex < 0
          ? this.historyDraft
          : this.history[this.history.length - 1 - this.historyIndex];
      this.cursor = this.draft.length;
    } else if (data.key === "pageup") this.offset += this.rows;
    else if (data.key === "pagedown")
      this.offset = Math.max(0, this.offset - this.rows);
    else if (data.key === "left") this.cursor = previousDraftBoundary(this.draft, this.cursor);
    else if (data.key === "right")
      this.cursor = nextDraftBoundary(this.draft, this.cursor);
    else if (data.key === "home") this.cursor = 0;
    else if (data.key === "end") this.cursor = this.draft.length;
    else if (data.key === "backspace" && this.cursor > 0) {
      const previous = previousDraftBoundary(this.draft, this.cursor);
      this.draft =
        this.draft.slice(0, previous) + this.draft.slice(this.cursor);
      this.cursor = previous;
    } else if (data.key === "delete")
      this.draft =
        this.draft.slice(0, this.cursor) + this.draft.slice(nextDraftBoundary(this.draft, this.cursor));
    else if (
      (data.key === "enter" || data.key === "tab") &&
      this.draft.trim()
    ) {
      const text = this.draft;
      this.draft = "";
      this.cursor = 0;
      this.offset = 0;
      if (this.history.at(-1) !== text) this.history.push(text);
      this.historyIndex = -1;
      this.historyDraft = "";
      this.transcript.push({ kind: "user", text });
      if (this.managementCommand(text)) {this.draw();return;}
      const task = data.key === "tab"
          ? this.core.steer(text)
          : this.core.submit(text);
      this.track(task);
    }
    this.refreshReferenceFiles();
    this.draw();
  }
  private refreshReferenceFiles():void {
    const reference=activeReference(this.draft,this.cursor),prefix=reference?.prefix;
    if(prefix===this.filePrefix)return;
    this.filePrefix=prefix;this.fileCatalog=undefined;const revision=++this.fileRevision,core=this.core;
    if(prefix===undefined||!this.panelOptions.files)return;
    this.loadingFiles=true;
    this.track(this.panelOptions.files(prefix).then(files=>{if(this.core===core&&this.fileRevision===revision)this.fileCatalog=files;},()=>{}).finally(()=>{if(this.fileRevision===revision){this.loadingFiles=false;this.draw();}}));
  }
  private track(task: Promise<void>): void {
    const safe = task.catch((error) => {
      this.transcript.push({
        kind: "notice",
        tone: "danger",
        text: `Error: ${String(error)}`,
      });
      this.status = "Error";
      this.draw();
    });
    this.tasks.add(safe);
    void safe.finally(() => {this.tasks.delete(safe);this.applyPendingReload();});
  }
  private requestApproval(
    req: Parameters<NonNullable<AgentCoreOptions["onApproval"]>>[0]
  ): ReturnType<NonNullable<AgentCoreOptions["onApproval"]>> {
    if (req.signal?.aborted || this.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.cancelDrag();
      const native=new ApprovalDialog(req);
      let dialog:ControllerDialog<typeof req>;
      try{dialog=new ControllerDialog(this.core.host.controllers.create('approval',{...req,signal:undefined},()=>({
        render:({columns,rows})=>({lines:native.visible(columns,rows)}),handle:input=>native.handle(input as Extract<WireMessage,{type:'input'}>['data']),
        preferredRows:columns=>native.rows(columns).length,pointer:row=>native.interactiveRow(row)?'pointer':'default',
      }),()=>this.draw()),req);}catch{resolve(false);return;}
      let settled=false;
      const entry = {
        dialog,
        resolve: (
          value: Awaited<
            ReturnType<NonNullable<AgentCoreOptions["onApproval"]>>
          >
        ) => {
          if(settled)return;settled=true;
          req.signal?.removeEventListener("abort", abort);dialog.lease.signal.removeEventListener('abort',abort);
          dialog.clear();resolve(value);
        },
      };
      const abort = () => {
        if (this.approval === entry) this.approval = this.approvalQueue.shift();
        else
          this.approvalQueue = this.approvalQueue.filter(
            (item) => item !== entry
          );
        entry.resolve(false);
        this.draw();
      };
      req.signal?.addEventListener("abort", abort, { once: true });
      dialog.lease.signal.addEventListener('abort',abort,{once:true});
      if (this.approval || this.question) this.approvalQueue.push(entry);
      else this.approval = entry;
      this.draw();
    });
  }
  private handleApproval(data:Extract<WireMessage,{type:'input'}>['data']):void {
    const current=this.approval;if(!current)return;
    this.dispatchController(current.dialog.lease,data,result=>{
      if(this.approval!==current||!result)return;
      const value=result as {allow?:boolean;scope?:string};
      const valid=typeof value.allow==='boolean'&&['once','session','project'].includes(value.scope??'once');
      this.approval=this.approvalQueue.shift();
      current.resolve(valid?{allow:value.allow!,scope:(value.scope??'once') as 'once'|'session'|'project'}:false);
    });
  }
  private installResume(): void {
    if (!this.panelOptions.resume) return;
    this.core.runtime.setResolver(
      "service.session.control",
      this.sessionResolver()
    );
  }
  private sessionResolver(): (args: any) => Promise<unknown> {
    // Delegate non-resume actions through the original service resolver by
    // retaining it via a private alias installed by the app host.
    return async (args) => {
      if (args.action !== "resume")
        return (await this.core.host.emit("service.session.store", args)).value;
      if (!this.core.controlsReady || this.switchingSession)
        return { deny: "Wait until the current turn finishes" };
      this.switchingSession = true;
      try {
        const next = await this.panelOptions.resume!(
          args.id ?? this.core.sessionId,
          (req) => this.requestApproval(req),
          (req) => this.askUser(req)
        );
        this.unsubscribe();this.closePanel();
        const editorState=this.editorSnapshot();this.controllerUnsubscribe?.();
        this.form?.finish(null);this.cancelQuestions();
        const approvals=[...(this.approval?[this.approval]:[]),...this.approvalQueue];this.approval=undefined;this.approvalQueue=[];
        for(const approval of approvals)approval.resolve(false);
        this.core.host.controllers.disposeAll();
        this.core.host.setFormHandler(undefined);
        this.core = next;
        this.filePrefix=undefined;this.fileCatalog=undefined;this.fileRevision++;
        this.bindForms();
        this.draft=editorState.text;this.cursor=editorState.cursor;this.bindControllers();
        this.unsubscribe = next.subscribe((event) => this.event(event));
        this.installResume();
        this.transcript = next
          .getMessages()
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            kind: m.role === "user" ? "user" : "assistant",
            text: m.content,
          }));
        this.appearances.clear();
        this.theme = appearanceFrom([]);
        this.viewCache.clear();
        this.status = "Ready";
        const chatTitle=String(args.name??next.sessionId.slice(0,8)).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,80);
        const conversation=this.panes.get('session');if(conversation)conversation.title=`Conversation · ${chatTitle}`;
        this.contextIndicator = '';
        this.activeAgentPane = undefined;
        this.inputTitle = 'Message';
        this.offset = 0;
        this.scroll.set('session',0);
        this.tools = '';
        this.windows.focused = 'input';
        await next.start();
        this.draw();
        return { value: true };
      } finally { this.switchingSession = false; }
    };
  }
  private handleQuestion(data:Extract<WireMessage,{type:'input'}>['data']):void {
    const current=this.question;if(!current)return;
    this.dispatchController(current.dialog.lease,data,result=>{
      if(this.question!==current||!result)return;
      this.question=undefined;
      if(result==='cancel')current.reject(new Error('Question cancelled by user'));
      else if(typeof result==='object'&&'answer' in result)current.resolve((result as {answer:UserQuestionAnswer}).answer);
      else current.reject(new Error('Invalid question controller result'));
      this.question=this.questionQueue.shift();if(!this.question)this.approval??=this.approvalQueue.shift();
    });
  }
  private askUser(
    request: QuestionRequest & { signal?: AbortSignal }
  ): Promise<UserQuestionAnswer> {
    return new Promise((resolve, reject) => {
      if (this.closed || request.signal?.aborted) {
        reject(new Error("UI closed or question cancelled"));
        return;
      }
      const native=new QuestionDialog(request);
      let dialog:ControllerDialog<QuestionRequest>;
      try{dialog=new ControllerDialog(this.core.host.controllers.create('question',{...request,signal:undefined},()=>({
        render:({columns,rows})=>({lines:native.visible(columns,rows)}),handle:input=>native.handle(input as Extract<WireMessage,{type:'input'}>['data']),
        snapshot:()=>({review:native.review}),preferredRows:columns=>native.rows(columns).length,
        pointer:row=>native.interactiveRow(row)?'pointer':'default',
      }),()=>this.draw()),request);}catch(error){reject(error);return;}
      let settled=false;
      const cleanup = () => {request.signal?.removeEventListener("abort", abort);dialog.lease.signal.removeEventListener('abort',abort);dialog.clear();};
      const entry = {
        dialog,
        resolve: (value: UserQuestionAnswer) => {
          if(settled)return;settled=true;cleanup();resolve(value);
        },
        reject: (error: Error) => {
          if(settled)return;settled=true;cleanup();reject(error);
        },
      };
      const abort = () => {
        const active = this.question === entry;
        if (active) this.question = this.questionQueue.shift();
        else
          this.questionQueue = this.questionQueue.filter(
            (item) => item !== entry
          );
        if (active && !this.question) this.approval ??= this.approvalQueue.shift();
        entry.reject(new Error("Question cancelled"));
        this.draw();
      };
      request.signal?.addEventListener("abort", abort, { once: true });
      dialog.lease.signal.addEventListener('abort',abort,{once:true});
      this.questionQueue.push(entry);
      this.question ??= this.questionQueue.shift();
      this.cancelDrag();
      this.draw();
    });
  }
  private cancelQuestions(): void {
    const questions = [
      ...(this.question ? [this.question] : []),
      ...this.questionQueue,
    ];
    this.question = undefined;
    this.questionQueue = [];
    for (const question of questions)
      question.reject(new Error("Question cancelled"));
  }
  private lines(text: string, columns = this.columns - 2): string[] {
    return wrap(text, columns);
  }
  private updatePointer(): void {
    const mouse = this.lastMouse;
    this.hoveredTitle = undefined;
    let shape: Extract<WireMessage, { type: "pointer" }>["shape"] = "default";
    if(mouse&&this.compactInteraction()&&mouse.row>=this.rows-this.dockHeight()+2&&mouse.row<this.rows-2){
      shape=mouse.col>=2&&mouse.col<this.columns-2?'pointer':'default';
    } else if(mouse&&this.approval&&mouse.row>=this.rows-this.dockHeight()+2&&mouse.row<this.rows-2){
      const row=mouse.row-(this.rows-this.dockHeight()+2);
      shape=mouse.col>=2&&mouse.col<this.columns-2&&this.approval.dialog.interactiveRow(row)?'pointer':'default';
    } else if (mouse && this.question && !this.approval && mouse.row>=this.rows-this.dockHeight()+2 && mouse.row<this.rows-2) {
      const row = mouse.row - (this.rows - this.dockHeight() + 2);
      shape = mouse.col >= 2 && mouse.col < this.columns - 2 && this.question.dialog.interactiveRow(row)
        ? "pointer" : "default";
    } else if (mouse) {
      if (this.drag?.kind === "resize")
        shape =
          this.drag.handle.node.axis === "horizontal"
            ? "ew-resize"
            : "ns-resize";
      else if (this.drag?.kind === "move")
        shape =
          this.drag.moved &&
          !this.drag.target &&
          this.drag.workspace === undefined
            ? "not-allowed"
            : "grabbing";
      else if (this.form)
        shape = this.form.dialog.lease.pointer(mouse.row-2,mouse.col-2);
      else if (this.panel)
        shape = this.placementController?.pointer(mouse.row,mouse.col)??"default";
      else {
        const { col, row } = mouse,
          dock = this.dockHeight();
        const wrap = this.columns - 2,
          position = (row - (this.rows - 2)) * wrap + col;
        const buttonStart = (this.workspaceTabs().at(-1)?.end ?? 0) + 3;
        if (
          row >= this.rows - 2 && row < this.rows - 2 + this.statusNavigationRows &&
          col < wrap &&
          (this.workspaceTabs().some(
            (tab) => position >= tab.start && position < tab.end
          ) ||
            (this.statusActionsVisible && buttonStart+9<=wrap && position >= buttonStart && position < buttonStart + 9) ||
            (this.statusActionsVisible && buttonStart+21<=wrap && position >= buttonStart + 11 && position < buttonStart + 21))
        )
          shape = "pointer";
        else if (
          row >= this.rows - dock + 3 &&
          row < this.rows - 3 &&
          this.visibleCompletions()[row - (this.rows - dock + 3)]
        )
          shape = "pointer";
        else if (
          row >= this.rows - dock &&
          row < this.rows - 2 &&
          col < this.columns
        )
          shape = this.editor?.pointer(row-(this.rows-dock+2),col-2)??"text";
        else {
          const split = this.windows.separator(
            col,
            row,
            this.columns,
            this.rows - dock
          );
          if (split) {
            this.hoveredTitle=this.windows.frames(this.columns,this.rows-dock).filter(f=>col>=f.x-1&&col<=f.x+f.width&&row>=f.y-1&&row<=f.y+f.height).map(f=>f.surface).join("\0");
            shape = split.node.axis === "horizontal" ? "ew-resize" : "ns-resize";
          }
          else {
            const frame = this.windows
              .frames(this.columns, this.rows - dock)
              .find(
                (f) =>
                  col >= f.x &&
                  col < f.x + f.width &&
                  row >= f.y &&
                  row < f.y + f.height
              );
            if (
              frame &&
              actionAt(this.hitRows.get(frame.surface)?.[row - frame.y - 2],col-frame.x-2)
            )
              shape = "pointer";
            else if (frame && row <= frame.y + 1) {
              this.hoveredTitle = frame.surface;
              shape =
                row === frame.y + 1 &&
                frame.width >= 14 &&
                col >= frame.x + frame.width - 7 &&
                col < frame.x + frame.width - 1
                  ? "pointer"
                  : "grab";
            }
          }
        }
      }
    }
    if (this.pointerSupported && shape !== this.pointer) {
      this.pointer = shape;
      this.sink?.({ type: "pointer", shape });
    }
  }
  private cancelDrag(): void {
    if (this.drag?.kind === "resize")
      this.windows.cancelResize(this.drag.handle);
    this.drag = undefined;
  }
  private continueDrag(data: MouseInput): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === "resize") {
      if (!this.windows.dragResize(drag.handle, data.col, data.row))
        this.cancelDrag();
      else if (data.action === "release") this.drag = undefined;
      this.draw();
      return;
    }
    drag.moved ||=
      Math.abs(data.col - drag.col) + Math.abs(data.row - drag.row) >= 2;
    drag.workspace = undefined;
    drag.target = undefined;
    drag.edge = undefined;
    if (drag.moved) {
      if (data.row >= this.rows - 2) {
        if(data.row>=this.rows-2+this.statusNavigationRows)return;
        const wrap = this.columns - 2,
          position = (data.row - (this.rows - 2)) * wrap + data.col;
        drag.workspace = this.workspaceTabs().find(
          (tab) =>
            data.col < wrap && position >= tab.start && position < tab.end
        )?.id;
      } else {
        const frame = this.windows
          .frames(this.columns, this.rows - this.dockHeight())
          .find(
            (f) =>
              f.surface !== drag.surface &&
              data.col >= f.x &&
              data.col < f.x + f.width &&
              data.row >= f.y &&
              data.row < f.y + f.height
          );
        if (frame) {
          drag.target = frame.surface;
          const x = (data.col - frame.x) / frame.width,
            y = (data.row - frame.y) / frame.height;
          const edges = [
            { edge: "left" as const, distance: x },
            { edge: "right" as const, distance: 1 - x },
            { edge: "top" as const, distance: y },
            { edge: "bottom" as const, distance: 1 - y },
          ].sort((a, b) => a.distance - b.distance);
          drag.edge = edges[0].distance < 0.25 ? edges[0].edge : "center";
        }
      }
    }
    if (data.action === "release") {
      if (
        drag.moved &&
        drag.workspace !== undefined &&
        drag.workspace !== this.windows.workspace
      ) {
        this.windows.focused = drag.surface;
        this.windows.moveWorkspace(drag.workspace);
      } else if (drag.moved && drag.target && drag.edge)
        this.windows.drop(drag.surface, drag.target, drag.edge);
      this.drag = undefined;
    }
    this.draw();
  }
  private dragHint(): string {
    const drag = this.drag;
    if (!drag)
      return "Drag title to move · drag divider to resize · Esc cancels";
    if (drag.kind === "resize")
      return "Resizing split · release to keep · Esc cancels";
    if (drag.workspace !== undefined)
      return `Move to workspace ${drag.workspace} · release to place · Esc cancels`;
    if (drag.target)
      return `${
        drag.edge === "center" ? "Swap with" : `Place ${drag.edge} of`
      } ${
        this.panes.get(drag.target)?.title ?? drag.target
      } · release to place · Esc cancels`;
    return "Drag to an edge to split, center to swap, or workspace number to move";
  }
  private openPanel(): void {
    this.closePanel();
    this.panel = new PluginPanel(
      () =>
        [...this.pluginWindows.values()].map((window) => ({
          ...window,
          placement: {
            ...resolvePlacement(
              this.placementConfig,
              window.plugin,
              window.surface,
              window.placement
            ),
            workspace:
              this.windows.workspaceOf(window.id) ??
              window.placement.workspace ??
              this.windows.workspace,
          },
        })),
      () => [...this.panes.keys()]
    );
    const panel=this.panel;
    try{
      const lease=this.core.host.controllers.create("placement",{
        windows:()=>panel.windows(),anchors:()=>[...this.panes.keys()],
        apply:async(id:string,placement:Placement,save=false)=>{
          lease.signal.throwIfAborted();
          const target=panel.windows().find(window=>window.id===id);
          if(!target)throw new Error("Unknown window");
          const parsed=surfacePlacementSchema.parse(placement);
          panel.selected=id;panel.draft=parsed;
          await this.applyPanel(save);
        },
      },()=>({render:({rows})=>({lines:panel.rows(rows).map(text=>({text}))}),
        handle:input=>input.kind==='action'||input.kind==='change'?undefined:panel.handle(input),
        pointer:row=>panel.interactiveRow(row)?'pointer':'default',
      }),()=>this.draw());
      this.placementController=lease;
      lease.signal.addEventListener("abort",()=>{if(this.placementController===lease){this.closePanel();this.draw();}},{once:true});
    }catch{this.closePanel();this.transcript.push({kind:"notice",tone:"danger",text:"Selected placement controller is unavailable"});}
  }
  private closePanel():void {const lease=this.placementController;this.placementController=undefined;this.panel=undefined;lease?.dispose();}
  private async applyPanel(save: boolean): Promise<void> {
    const panel = this.panel,
      window = panel?.target();
    if (!panel || !window || panel.busy) return;
    const lease=this.placementController;
    lease?.signal.throwIfAborted();
    const placement = { ...panel.draft };
    const rule = {
      ...placement,
      match: { plugin: window.plugin, surface: window.surface },
    };
    const apply = () => {
      lease?.signal.throwIfAborted();
      if(this.panel!==panel)throw new Error("Placement controller closed");
      const rules = (this.placementConfig.rules ?? []).filter(
        (r) =>
          r.match.plugin !== window.plugin || r.match.surface !== window.surface
      );
      this.placementConfig.rules = [...rules, rule];
      this.windows.relocate(window.id, placement);
      panel.message = save
        ? "Rule saved. Placement applied."
        : "Applied for this run. Choose Save to keep it.";
    };
    if (!save) {
      apply();
      return;
    }
    if (!this.panelOptions.save) {
      panel.message = "Saving is unavailable in this host.";
      return;
    }
    panel.busy = true;
    try{await this.panelOptions.save(rule);apply();}
    catch(error){panel.message=`Save failed: ${String(error)}`;throw error;}
    finally{panel.busy=false;this.draw();}
  }
  private completions(): {
    name: string;
    description: string;
    usage?: string;
  }[] {
    if (
      (this.editor && !this.editor.isDefault) ||
      this.panel ||
      this.completionDismissed ||
      this.approval ||
      this.question ||
      this.windows.focused !== "input"
    )
      return [];
    const file=activeReference(this.draft,this.cursor);
    if(file)return(this.fileCatalog??[]).filter(path=>path.startsWith(file.prefix)).slice(0,100).map(path=>({
      name:`@${/[\s"\\]/.test(path)?JSON.stringify(path):path}`,description:path.endsWith('/')?'Attach directory or continue its path':'Attach file',
    }));
    if (!/^\/[^\s]*$/.test(this.draft)) return [];
    return [
      ...this.commandList().filter((command) => !['/plugins','/chat'].includes(command.name)),
      { name: "/plugins", description: "Install, enable and update plugins" },
      { name: "/placement", description: "Arrange plugin windows" },
      { name: "/chat", description: "Return to the main conversation" },
    ].filter((command) => command.name.startsWith(this.draft));
  }
  private visibleCompletions() {
    const matches = this.completions();
    const count = Math.min(5, Math.max(0, this.rows - 12));
    const start = Math.max(
      0,
      Math.min(this.selectedCommand - count + 1, matches.length - count)
    );
    return matches.slice(start, start + count);
  }
  private removeComposer(id:string): void {
    const contribution=this.composerViews.get(id); if(!contribution)return;
    this.composerViews.delete(id); this.visibility.delete(id);
    void this.core.host.emit("ui.visibility",{site:`plugin:${contribution.plugin}/${contribution.surface}`,attached:false,visible:false,columns:0,rows:0}).catch(()=>{});
  }
  private composer() { return [...this.composerViews].at(-1); }
  private composerRows(): number { return this.composer()?.[1].view.attachment?.rows ?? 4; }
  private composerWidth(): number {
    const view=this.composer()?.[1].view;
    return (!this.editor || this.editor.isDefault)&&view&&(view.lines.length>0||!!view.raster)&&(!view.raster||this.nativeRaster)&&!this.approval&&!this.question&&!this.form&&!this.visibleCompletions().length&&this.columns>=60&&this.rows>=24 ? view.attachment!.width+2 : 0;
  }
  private dockHeight():number {
    if(this.compactInteraction())return 6;
    if(!this.approval && !this.question && this.editor && !this.editor.isDefault) {
      try{return Math.min(this.rows-4,Math.max(6,this.editor.preferredRows(this.columns-4,this.rows-9)+5));}
      catch{return 7;}
    }
    return this.defaultDockHeight();
  }
  private compactInteraction():boolean {
    return !!(this.approval||this.question) && this.windows.focused!=='input' && this.rows-this.defaultDockHeight()<8;
  }
  private defaultDockHeight(): number {
    if (this.question && !this.approval)
      return Math.min(
        this.rows - 4,
        Math.max(8, this.question.dialog.rows(this.columns - 4).length + 6)
      );
    const extra = Math.min(
      3,
      Math.max(0, this.rows - 10),
      Math.max(0, wrap(`› ${this.draft}▏`, this.columns - 4 - this.composerWidth()).length - 1)
    );
    if(this.approval)return Math.min(this.rows-4,Math.max(14,Math.min(22,this.approval.dialog.rows(this.columns-4).length+5)));
    return Math.max(6 + extra + this.visibleCompletions().length,this.composerWidth()?this.composerRows()+5:6);
  }
  private complete(command: { name: string; usage?: string }): void {
    if (command.name.startsWith("@")) {
      const reference=activeReference(this.draft,this.cursor);if(!reference)return;
      const quoted=command.name[1]==='"',directory=command.name.endsWith('/')||command.name.endsWith('/"');
      const suffix=directory?'':' ';
      this.draft=this.draft.slice(0,reference.start)+command.name+suffix+this.draft.slice(reference.end);
      this.cursor=reference.start+command.name.length+(directory&&quoted?-1:suffix.length);
      if(directory){this.completionDismissed=false;this.commandNavigated=false;this.refreshReferenceFiles();this.draw();return;}

    } else {
      this.draft = command.name + (command.usage ? " " : "");
      this.cursor = this.draft.length;
    }
    this.completionDismissed = true;
    this.commandNavigated = false;
    this.draw();
  }
  /** Same labels and character offsets drive painting and mouse hit testing. */
  private workspaceTabs(): {
    id: number;
    label: string;
    start: number;
    end: number;
  }[] {
    let offset = 0;
    return this.windows.workspaces().map((id) => {
      const label =
        this.drag?.kind === "move" && this.drag.workspace === id
          ? `<${id}>`
          : id === this.windows.workspace
          ? `[${id}]`
          : ` ${id} `;
      const tab = { id, label, start: offset, end: offset + label.length };
      offset += label.length + 1;
      return tab;
    });
  }
  /** Default view first; cached plugin overrides replace it after the hook settles.
   * A cache-entry identity check discards stale async responses after resize/reload. */
  private paint(
    surface: string,
    site: string,
    rows: Row[],
    width: number,
    height: number,
    props: Record<string, unknown> = {}
  ): void {
    const input = {
      site,
      surface: "terminal" as const,
      props: {
        ...props,
        lines: props.lines ?? rows.map(({ cells,actions, ...row }) => row),
      },
      viewport: { columns: width, rows: height },
    };
    const send = (content: Row[], view?: UiTextView) => {
      this.hitRows.set(surface, content.slice(0, height));
      if (!this.closed)
        this.sink?.({
          type: "render",
          surface,
          mode: "full",
          flush: true,
          grid: gridFrom(content.slice(0, height).map((row) => {
            const selected = this.actionFocus.get(surface);
            if(row.actions)return{...row,actions:row.actions.map(range=>({...range,focused:surface===this.windows.focused&&range.action!==undefined&&range.action===selected}))};
            return row.action && selected !== undefined && surface === this.windows.focused ? {...row,selected:row.action===selected} : row;
          }), this.theme, width, surface==='input'),
          ...(this.nativeRaster && props.attachmentRaster ? {raster:props.attachmentRaster as NonNullable<Extract<WireMessage,{type:"render"}>["raster"]>} : this.nativeRaster && view ? { raster: rasterForView(view, width, height) } : {}),
        });
    };
    // Host-owned input has no ui.render override. In particular, do not stringify
    // the composer's full RGBA image into a cache key on every animation frame.
    if(surface==='input'){send(rows);return;}
    const defaultView = uiTextViewSchema.safeParse({ raster: props.raster, table:props.table,tabs:props.tabs, lines: input.props.lines }).data;
    const key = JSON.stringify(input);
    let cached = this.viewCache.get(surface);
    if (cached?.key === key) {
      send(cached.rows ?? rows, cached.view ?? defaultView);
      return;
    }
    cached = { key };
    this.viewCache.set(surface, cached);
    send(rows, defaultView);
    const entry = cached;
    const task = this.core.host
      .emit("ui.render", input)
      .then((result) => {
        if (this.closed || this.viewCache.get(surface) !== entry) return;
        const parsed = uiTextViewSchema.safeParse(
          (result.value as { tree?: unknown } | undefined)?.tree
        );
        if (!parsed.success) return; // no answer / bad answer: keep the working default
        entry.view = parsed.data;
        const full=[...((props.fieldRows??[]) as Row[]),...viewRows(parsed.data,width,height)];
        const overflow=props.scrollable===true&&full.length>height;
        const room=Math.max(1,height-(overflow?1:0));
        const offset=props.scrollable===true?Math.max(0,Math.min(Number(props.scrollOffset??0),Math.max(0,full.length-room))):0;
        entry.rows=full.slice(offset,offset+room);
        if(overflow)entry.rows.push({text:`${offset>0?'↑ ':''}${offset+1}-${Math.min(full.length,offset+room)}/${full.length} ${offset+room<full.length?'↓ ':''}· ${props.hostScrollKeys?'PgUp/PgDn':'Wheel'} · Alt+f`,tone:'muted'});
        send(entry.rows, parsed.data);
      })
      .catch(() => {});
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }
  private defaultEditorView(inputWidth:number,height:number):UiControllerView {
    const prompt = `› ${this.draft.slice(0, this.cursor)}▏${this.draft.slice(
      this.cursor
    )}`;
    const draftRows = textRows(prompt, inputWidth);
    const caretRow =
      wrap(`› ${this.draft.slice(0, this.cursor)}▏`, inputWidth).length - 1;
    const startRow = Math.max(0, caretRow - height + 1);
    let inputRows: Row[] = draftRows.slice(startRow, startRow + height);
    if (!this.approval && !this.draft)
      inputRows = [{ text: "› ▏Describe your task…", tone: "muted" }];
    if (!this.approval && this.visibleCompletions().length) {
      const selected =
        this.completions()[
          Math.min(this.selectedCommand, this.completions().length - 1)
        ];
      inputRows = [
        ...textRows(prompt, inputWidth).slice(-1),
        ...this.visibleCompletions().map((command) => ({
          text: `${command.name === selected?.name ? "›" : " "} ${
            command.usage ?? command.name
          } — ${command.description}`,
          tone:
            command.name === selected?.name
              ? ("accent" as const)
              : ("muted" as const),
          bold: command.name === selected?.name,
          selected: command.name === selected?.name,
        })),
      ];
    }
    return {lines:inputRows};
  }
  private draw(): void {
    clearTimeout(this.pendingTextDraw);this.pendingTextDraw=undefined;
    if (this.windows.focused.startsWith("plugin-agent-hub-agent-"))
      this.activeAgentPane = this.windows.focused.slice(
        "plugin-agent-hub-agent-".length
      );
    else if (this.windows.focused === "session")
      this.activeAgentPane = undefined;
    if (this.reportedFocus !== this.windows.focused) {
      this.reportedFocus = this.windows.focused;
      void this.core.host
        .emit("ui.focus", { site: this.windows.focused })
        .catch(() => {});
    }
    if (!this.ready || this.closed) return;
    if (this.panelOptions.saveLayout) {
      const layout = {
        windows: this.windows.snapshot(),
        views: [...this.panes]
          .filter(([id]) => id.startsWith("window-"))
          .map(([id, pane]) => ({ id, title: pane.title, kind: pane.kind })),
      };
      const signature = JSON.stringify(layout);
      if (signature !== this.savedLayout) {
        this.savedLayout = signature;
        this.track(this.panelOptions.saveLayout(layout));
      }
    }
    this.updatePointer();
    const dock = this.dockHeight();
    const formActive = this.form;
    const panelActive = !formActive && this.panel;
    const frames = formActive ? [{surface:"settings-form",x:0,y:0,width:this.columns,height:this.rows-dock}] : panelActive
      ? [
          {
            surface: "plugin-placement",
            x: 0,
            y: 0,
            width: this.columns,
            height: this.rows - dock,
          },
        ]
      : this.windows.frames(this.columns, this.rows - dock);
    const allFrames = [
      ...frames,
      {
        surface: "input",
        x: 0,
        y: this.rows - dock,
        width: this.columns,
        height: dock - 2,
      },
      {
        surface: "status",
        x: 0,
        y: this.rows - 2,
        width: this.columns,
        height: 2,
      },
    ];
    const chrome = { ...this.theme.chrome, ...this.theme.colors };
    this.sink?.({
      type: "declare",
      surfaces: [...[...this.panes].map(([id, pane]) => ({id,kind:'pane' as const,title:pane.title})),
        {id:'input',kind:'pane' as const,title:this.approval?'Approval required':this.question?(this.question.dialog.request.questions?'Questionnaire':'Your answer'):`${this.inputTitle}${this.composer()?" · "+clean(this.composer()![1].view.attachment!.label)+(this.composer()![1].view.raster&&!this.nativeRaster?" · images unavailable":""):""}`}],
    });
    if (formActive) this.sink?.({ type: 'declare', surfaces: [{ id: 'settings-form', kind: 'pane', title: this.form!.dialog.request.title }] });
    if (panelActive)
      this.sink?.({
        type: "declare",
        surfaces: [
          {
            id: "plugin-placement",
            kind: "pane",
            title: "Plugins · placement",
          },
        ],
      });
    if (this.tiled)
      this.sink?.({
        type: "layout",
        width: this.columns,
        height: this.rows,
        frames: allFrames.map((frame) => ({
          ...frame,
          chrome,
          controls: this.windows.ids().includes(frame.surface),
          hovered: this.hoveredTitle?.split("\0").includes(frame.surface) ?? false,
          ...(this.drag?.kind === "move" && this.drag.target === frame.surface
            ? { drop: this.drag.edge }
            : {}),
        })),
      });
    this.sink?.({
      type: "focus",
      surface: formActive && !(this.windows.focused==='input'&&(this.approval||this.question)) ? "settings-form" : panelActive ? "plugin-placement" : this.windows.focused,
    });
    for(const [id,contribution] of this.composerViews){
      const selected=this.composer()?.[0]===id;
      const data={site:`plugin:${contribution.plugin}/${contribution.surface}`,attached:true,visible:selected,columns:selected?(this.composerWidth()?contribution.view.attachment!.width:0):0,rows:selected?(this.composerWidth()?this.composerRows():1):0};
      const signature=JSON.stringify(data);if(this.visibility.get(id)!==signature){this.visibility.set(id,signature);void this.core.host.emit("ui.visibility",data).catch(()=>{});}
    }
    for (const window of this.pluginWindows.values()) {
      const frame = frames.find((frame) => frame.surface === window.id);
      const data = {
        site: `plugin:${window.plugin}/${window.surface}`,
        attached: this.windows.has(window.id),
        visible: !!frame,
        columns: frame ? Math.max(1, frame.width - 4) : 0,
        rows: frame ? Math.max(1, frame.height - 3) : 0,
      };
      const signature = JSON.stringify(data);
      if (this.visibility.get(window.id) !== signature) {
        this.visibility.set(window.id, signature);
        void this.core.host.emit("ui.visibility", data).catch(() => {});
      }
    }
    for (const frame of frames) {
      const width = Math.max(1, frame.width - 4),
        height = Math.max(1, frame.height - 3);
      if (frame.surface === 'settings-form' && this.form) {
        this.sink?.({type:'render',surface:'settings-form',mode:'full',flush:true,grid:gridFrom(this.form.dialog.visible(width,height),this.theme,width,true)});
        continue;
      }
      if (frame.surface === "plugin-placement" && this.panel) {
        // Panel click rows retain their existing coordinates; no interior padding.
        this.sink?.({
          type: "render",
          surface: frame.surface,
          mode: "full",
          flush: true,
          grid: gridFrom(
            this.controllerView(this.placementController!,frame.width-2,frame.height).lines,
            this.theme,
            frame.width - 2
          ),
        });
        continue;
      }
      const pane = this.panes.get(frame.surface);
      let rows: Row[];
      if (pane?.kind === "session") {
        rows = transcriptRows(this.transcript, width, this.theme);
        if (!this.transcript.some((block) => block.kind !== "notice"))
          rows = [
            { text: "" },
            ...textRows(this.theme.presentation.welcome, width).map((row) => ({
              ...row,
              bold: true,
            })),
            { text: "" },
            ...textRows(
              "Describe a task, ask a question, or type / for commands.",
              width,
              "muted"
            ),
            { text: "" },
            ...rows,
          ];
      } else {
        rows = pane?.view
          ? viewRows(this.viewCache.get(frame.surface)?.view??pane.view, width, height)
          : textRows(
              pane?.kind === "tools"
                ? this.tools
                : pane?.kind === "help"
                ? HELP
                : pane?.text ?? "",
              width
            );
        if (pane?.kind === "plugin" && !pane.view)
          rows = rows.map((row) => ({
            ...row,
            tone: row.text.startsWith("[x]")
              ? "success"
              : row.text.startsWith("[~]")
              ? "accent"
              : "text",
          }));
      }
      let fieldRows:Row[]=[];
      if (pane?.view?.input) {
        const field = this.viewInputs.get(frame.surface) ?? pane.view.input;
        const label=`${pane.view.input.label??'Search'}: `;
        const available=Math.max(1,width-Array.from(label).length-1);
        const value=Array.from(field.value||pane.view.input.placeholder||'');
        const shown=field.value?value.slice(-available).join(''):value.length>available?value.slice(0,Math.max(0,available-1)).join('')+'…':value.join('');
        const line=label+shown+(this.windows.focused===frame.surface?'▏':'');
        const search:Row[]=[{text:line,cells:Array.from(line).map(ch=>({ch,fg:this.theme.colors.accent}))}];
        fieldRows=search;
        rows = [...search, ...rows];
      }
      const overflow=!!pane?.view&&rows.length>height;
      const room=Math.max(1,height-(overflow?1:0));
      const offset = Math.min(
        this.scroll.get(frame.surface) ?? 0,
        Math.max(0, rows.length - room)
      );
      const end = rows.length - offset;
      const visible =
        pane?.view
          ? rows.slice(offset, offset + room)
          : pane?.kind === "help"
          ? rows.slice(0, height)
          : rows.slice(Math.max(0, end - height), end);
      if(overflow)visible.push({text:`${offset>0?'↑ ':''}${offset+1}-${Math.min(rows.length,offset+room)}/${rows.length} ${offset+room<rows.length?'↓ ':''}· ${(pane?.view?.scrollKeys??(pane?.view?.input?'plugin':'host'))==='host'?'PgUp/PgDn':'Wheel'} · Alt+f`,tone:'muted'});
      const plugin = this.pluginWindows.get(frame.surface);
      this.paint(
        frame.surface,
        pane?.kind === "session"
          ? "conversation"
          : pane?.kind === "tools"
          ? "tools"
          : plugin
          ? `plugin:${plugin.plugin}/${plugin.surface}`
          : pane?.kind ?? "pane",
        visible,
        width,
        height,
        {
          title: pane?.title,
          status: this.status,
          ...(pane?.view?{lines:pane.view.lines,table:pane.view.table,tabs:pane.view.tabs,scrollable:true,scrollOffset:offset,fieldRows,hostScrollKeys:(pane.view.scrollKeys??(pane.view.input?'plugin':'host'))==='host'}:{}),
          ...(pane?.view?.raster
            ? { raster: pane.view.raster, lines: pane.view.lines }
            : {}),
          ...(plugin ? { plugin: plugin.plugin, surface: plugin.surface } : {}),
        }
      );
    }
    const attachmentWidth=this.composerWidth();
    const inputWidth = Math.max(1, this.columns - 4 - attachmentWidth);
    let inputRows:Row[];
    try{inputRows=this.editor?.render(inputWidth,dock-5).lines??this.defaultEditorView(inputWidth,dock-5).lines;}
    catch{inputRows=[{text:"Selected editor is unavailable",tone:"danger"}];}
    if (this.approval)
      inputRows = this.approval.dialog.visible(inputWidth,dock-5);
    else if (this.question)
      inputRows = this.question.dialog.visible(inputWidth, dock - 5);
    if(this.compactInteraction()) inputRows=[{text:this.approval?'Approval needed · Alt+i to review':'Answer needed · Alt+i to answer',tone:'warning'}];
    if (formActive && !this.approval && !this.question) inputRows = [{text:"Settings form active · Esc cancels without saving",tone:"muted"}];
    if(attachmentWidth){
      const art=this.composer()![1].view;
      const left=gridFrom(viewRows(art,attachmentWidth-2,this.composerRows(),this.nativeRaster),this.theme,attachmentWidth-2,true);
      // Solid blocks use cell backgrounds so font baselines cannot stripe the art.
      for(const row of left)for(const cell of row)if(cell.ch==="█"){cell.ch=" ";cell.bg=cell.fg;}
      const right=gridFrom(inputRows,this.theme,inputWidth,true);
      inputRows=Array.from({length:Math.max(this.composerRows(),right.length)},(_,i)=>{
        const cells=[...(left[i]??[])];while(cells.length<attachmentWidth)cells.push({ch:" "});
        cells.push(...(right[i]??[]));return{text:"",cells};
      });
    }
    const art=this.composer()?.[1].view;
    this.paint("input", "input", inputRows, this.columns-4, dock - 5,attachmentWidth&&art?.raster?{attachmentRaster:rasterForView(art,attachmentWidth-2,this.composerRows())}:{});
    const barWidth = this.columns - 2;
    const waiting=this.approval?'Approval needed':this.question?'Answer needed':formActive?'Settings form':this.status;
    const protectedInput=!!(this.approval||this.question||formActive);
    const tabs=this.workspaceTabs().map(tab=>tab.label).join(' ');
    const showControls=!formActive&&!panelActive&&tabs.length+3+23+waiting.length<=barWidth;
    let bar=`${tabs} | ${showControls?'[Plugins]  [Settings]  ':''}${waiting}${this.pendingReload?' · plugins pending':''}`;
    const operations=this.core.getOperations();
    if(operations.length&&bar.length+12<=barWidth)bar+=` · ${operations.length} UI tools`;
    const hidden=Math.max(0,this.windows.ids().length-frames.filter(f=>this.windows.ids().includes(f.surface)).length);
    for(const part of [this.contextIndicator,this.windows.fullscreen?' · FULLSCREEN':'',!protectedInput&&hidden?` · ${hidden} hidden`:''])if(bar.length+part.length<=barWidth)bar+=part;
    const pane=this.panes.get(this.windows.focused),narrow=this.columns<70;
    const hint=operations.some(op=>op.owner===this.pluginWindows.get(this.windows.focused)?.plugin)?'Ctrl+C cancel tool · Alt+i return to agent'
      :this.windows.focused==='input'&&this.approval?this.approval.dialog.hint??(narrow?'Y once · N deny · PgDn details':'↑↓ scopes · Enter select · PgUp/PgDn details · Esc deny')
      :this.windows.focused==='input'&&this.question?this.question.dialog.hint??(this.question.dialog.review?'↑↓ edit · Enter select/submit · Esc cancel':narrow?'↑↓ choose · Space toggle · Tab · Enter next · Esc cancel':'↑↓ choose · Space toggle · Tab fields · Enter next · Esc cancel')
      :formActive?this.form?.dialog.hint??'Tab / Shift+Tab fields · Enter next · Esc cancel'
      :this.panel?this.placementController?.lastView?.hint??'Tab / ↑↓ fields · ←→ change · Esc close'
      :this.drag?this.dragHint()
      :(this.windows.focused==='input'?this.editor?.lastView?.hint:undefined)??pane?.view?.hint??(pane?.view?.input?'Type search · ↑↓ select · Enter resume · Esc close'
      :pane?.kind==='plugin'?narrow?'↑↓ actions · Enter · PgDn scroll · Esc leave':'↑↓ actions · Enter activate · PgUp/PgDn scroll · Esc leave'
      :!frames.some(frame=>this.panes.get(frame.surface)?.kind==='session')?'Alt+Enter or /chat: restore conversation'
      :this.status.startsWith('Working')?'Ctrl+C stop · Tab steer · Enter queue'
      :narrow?'/ commands · Ctrl+J newline':'/ commands · Ctrl+J newline · Alt+t tools · Alt+? shortcuts');
    this.statusNavigationRows=tabs.length>barWidth?2:1;
    this.statusActionsVisible=showControls&&this.statusNavigationRows===1;
    const barRows:Row[]=this.statusNavigationRows===2?[{text:tabs.slice(0,barWidth),tone:'accent'},{text:tabs.slice(barWidth,barWidth*2),tone:'accent'}]:[{text:bar.slice(0,barWidth),tone:'accent'}];
    if(this.statusNavigationRows===1&&this.theme.presentation.hints)barRows.push({text:hint,tone:'muted'});
    this.paint('status','status',barRows,barWidth,2,{status:waiting,workspace:this.windows.workspace});
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.pendingTextDraw);this.pendingTextDraw=undefined;
    clearTimeout(this.pendingOperationDraw);this.pendingOperationDraw=undefined;
    this.closePanel();
    this.uiLifetime.abort(new Error("UI closed"));this.editor?.dispose();this.controllerUnsubscribe?.();
    for(const id of this.composerViews.keys())this.removeComposer(id);
    this.form?.finish(null);
    this.core.host.setFormHandler(undefined);
    this.cancelDrag();
    for (const window of this.pluginWindows.values())
      void this.core.host
        .emit("ui.visibility", {
          site: `plugin:${window.plugin}/${window.surface}`,
          visible: false,
          attached: false,
          columns: 0,
          rows: 0,
        })
        .catch(() => {});
    this.approval?.resolve(false);
    for (const approval of this.approvalQueue.splice(0))
      approval.resolve(false);
    this.core.interrupt();
    this.unsubscribe();
    this.cancelQuestions();
    this.core.host.controllers.disposeAll();
    this.sink?.({ type: "bye", reason: "closed" });
  }
  async settled(): Promise<void> {
    while (this.tasks.size) await Promise.all([...this.tasks]);
  }
}

const HELP = `WINDOW CONTROLS
Alt+h/j/k/l or Alt+arrows: directional focus
Alt+Shift+direction: move window
Alt+b: next split side by side
Alt+v: next split top/bottom
Alt+Enter / Alt+s: open conversation view; /chat: return or restore
Alt+t: open tools view
Alt+q: close focused window
Alt+f: toggle fullscreen
Alt+= / Alt+-: resize focused split
Alt+1..9: switch workspace
Alt+Shift+1..9: move window to workspace
Alt+i: focus message input
Alt+o: open plugin management
Alt+,: open settings
Alt+p or /placement: place plugin windows
/plugins: install, enable and update plugins
Escape: focus first window
PageUp/PageDown: scroll window content
Enter: send or queue · Tab: steer
Ctrl+C: interrupt work / exit when idle`;
