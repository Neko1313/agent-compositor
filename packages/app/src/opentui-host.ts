import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {AgentCore, AgentCoreOptions, LoopEvent} from '@agent-compositor/core';
import {uiTextViewSchema, surfacePlacementSchema, type SurfacePlacement, type UiTextView} from '@agent-compositor/events';
import type {ComposerMedia, ConversationSession, UiSurfaceRegistry, UiSurfaceSnapshot, UiSurfaceSource, WindowLayoutSource} from '@agent-compositor/renderer-opentui';
import type {BuiltApp} from './build.js';
import {connectConversation} from './opentui-conversation.js';
import {createInteractionInbox} from './opentui-interactions.js';
import {resolvePlacement, type PlacementConfig} from './placement.js';
import {clean} from './presentation.js';
import {createWindowNavigation, type NavigationWindow} from './opentui-navigation.js';
import type {DynamicWindowLayout} from './opentui-windows.js';
import {createOpenTuiEditor} from './opentui-editor.js';
import {referenceFiles} from './project-context.js';
import type {UiEditorIntent, UiEditorState} from '@agent-compositor/hooks';
import {sessionCommandNames,type SessionHistoryBinding} from './sessions.js';
import {createOpenTuiHistoryController} from './opentui-history-controller.js';
import {createOpenTuiPlacementController} from './opentui-placement-controller.js';
import type {PluginWindow} from './plugin-panel.js';

export {connectConversation, connectPluginTable} from './opentui-conversation.js';

export type OpenTuiWindowLayout = WindowLayoutSource & Pick<DynamicWindowLayout, 'windowIntentRevision' | 'markWindowIntent' | 'actAutomatic'> & {
  register(pane: {id: string; label: string; transient?: boolean}, placement?: SurfacePlacement): void;
  relocate(id: string, placement: SurfacePlacement): void;
  detach(id: string): void;
  forget(id: string): void;
};
type Surface = {
  owner: string;
  source: UiSurfaceSource;
  state: UiSurfaceSnapshot;
  listeners: Set<() => void>;
  active: boolean;
  placement?: SurfacePlacement;
  semantic?: string;
  generation: number;
};
type Operation = {
  id: string;
  owner: string;
  site: string;
  core: AgentCore;
  controller: AbortController;
  active: boolean;
  windowIntent: number;
  placementAnswerIntent?: number;
  kind: 'action' | 'change' | 'request';
  open?: boolean;
  opened: Set<string>;
  published?: Surface;
  navigationSignal?: AbortSignal;
  destination?: string;
  destinations: Set<() => void>;
  done?: Promise<void>;
  surface?: Surface;
  inbox?: ReturnType<typeof createInteractionInbox>;
  off?: () => void;
};
type Inbox = ReturnType<typeof createInteractionInbox>;
type ApprovalRequest = Parameters<NonNullable<AgentCoreOptions['onApproval']>>[0];
type ApprovalResult = Awaited<ReturnType<NonNullable<AgentCoreOptions['onApproval']>>>;
type QuestionRequest = Parameters<NonNullable<AgentCoreOptions['onAsk']>>[0];
type Channels = {
  inbox: Inbox;
  generation: AbortController;
  core?: AgentCore;
  approve(request: ApprovalRequest): Promise<ApprovalResult>;
  ask(request: QuestionRequest): ReturnType<Inbox['askQuestion']>;
};
class ExpiredRequest extends Error {}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) immutable(item);
  }
  return value;
}
function actions(view: UiTextView): Set<string> {
  return new Set([
    ...view.lines.flatMap(line => line.action ? [line.action] : []),
    ...(view.tabs ?? []).flatMap(tab => tab.disabled ? [] : [tab.action]),
    ...(view.table?.rows ?? []).flatMap(row => [
      ...(row.action ? [row.action] : []),
      ...(row.expanded ? row.details ?? [] : []).flatMap(line => line.action ? [line.action] : []),
    ]),
  ]);
}
function legacyView(value: unknown): UiTextView | undefined {
  if (typeof value !== 'string' || value.length > 100000) return;
  const lines: UiTextView['lines'] = [];
  for (const line of clean(value).split('\n')) {
    let start = 0;
    do {
      if (lines.length === 2000) {lines[1999] = {text: '… legacy surface display truncated', tone: 'muted'}; return {lines};}
      let end = Math.min(line.length, start + 10000);
      if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1]) && /[\uDC00-\uDFFF]/.test(line[end])) end--;
      lines.push({text: line.slice(start, end)}); start = end;
    } while (start < line.length);
  }
  return {lines};
}

/** Assemble the actual application behind renderer-neutral conversations and plugin surfaces. */
export function createOpenTuiHost(app: BuiltApp, layout: OpenTuiWindowLayout, options: {onExit?(): void} = {}) {
  const placementConfig: PlacementConfig = structuredClone(app.config.config.ui ?? {});
  const surfaceMap = new Map<string, Surface>();
  const windowTitles = new Map<string, {title: string; owner: string}>();
  let sourceSerial = 0;
  let navigation: ReturnType<typeof createWindowNavigation> | undefined;
  const placementAdmissions = new Map<string, string>();
  const reloadDetached = new Map<string, string>();
  const composerViews = new Map<string, {owner: string; view: UiTextView}>();
  const mediaListeners = new Set<Parameters<ComposerMedia['subscribe']>[1]>();
  const visibility = new Map<string, string>();
  const registryListeners = new Set<() => void>();
  let surfaceList: readonly UiSurfaceSource[] = [];
  const sessionListeners = new Set<() => void>();
  const context = new AsyncLocalStorage<Operation>();
  const operations = new Map<string, Operation>();
  const operationWaiters = new Set<() => void>();
  const privateWindows = new Map<Surface,{close():void}>();
  const changes = new Map<Surface, {field: string; value: string}>();
  let active = true, started = false, switching = false, pendingReload = false, reloading = false;
  let reloadPromise: Promise<boolean> | undefined;
  let reloadFailed: false | 'reload' | 'startup' = false;
  let localNotice: string | undefined;
  let core: AgentCore;
  let channels: Channels | undefined;
  let inbox: ReturnType<typeof createInteractionInbox>;
  let conversation: ReturnType<typeof connectConversation>;
  let sessionState: ReturnType<ConversationSession['snapshot']>;
  let offCore: (() => void) | undefined, offConversation: (() => void) | undefined, offForm: (() => void) | undefined;
  let offOrigin: (() => void) | undefined;
  let offLayout: (() => void) | undefined;
  let offHistory: (() => void) | undefined;
  let editor: ReturnType<typeof createOpenTuiEditor> | undefined, offEditor: (() => void) | undefined;
  let editorDraft: UiEditorState = {text: '', cursor: 0};
  const pending = new Set<Promise<unknown>>();
  const changed = () => {
    sessionState = {...conversation.snapshot(), ...(editor ? {editor: editor.snapshot()} : {}), ...(localNotice ? {notice: localNotice} : {})};
    for (const fn of sessionListeners) fn();
  };
  const registryChanged = () => {
    surfaceList = Object.freeze([...surfaceMap.values()].filter(surface => surface.active).map(surface => surface.source));
    for (const fn of registryListeners) fn();
    navigation?.refresh();
  };
  const surfaces: UiSurfaceRegistry = {
    snapshot: () => surfaceList,
    subscribe(fn) {registryListeners.add(fn); return () => {registryListeners.delete(fn);};},
  };
  function mediaFrame() {
    const raster = [...composerViews.values()].at(-1)?.view.raster;
    return raster ? {width: raster.width, height: raster.height, rgba: new Uint8Array(Buffer.from(raster.rgba, 'base64'))} : undefined;
  }
  const composerMedia: ComposerMedia = {
    dimensions() {
      const attachment = [...composerViews.values()].at(-1)?.view.attachment;
      return {width: attachment?.width ?? 8, height: attachment?.rows ?? 4};
    },
    subscribe(_active, fn) {mediaListeners.add(fn); fn(mediaFrame()); reportVisibility(); return () => {mediaListeners.delete(fn); reportVisibility();};},
  };
  function mediaChanged() {for (const fn of mediaListeners) fn(mediaFrame());}
  function reportVisible(id: string, owner: string, attached: boolean, visible: boolean, columns: number, rows: number) {
    if (!active) return;
    const value = {site: 'plugin:' + owner + '/' + id.slice(('plugin-' + owner + '-').length), attached, visible, columns, rows};
    const signature = JSON.stringify(value);
    if (visibility.get(id) === signature) return;
    visibility.set(id, signature);
    track(core.host.emit('ui.visibility', value).catch(() => {}));
  }
  function reportVisibility() {
    if (!active || !core) return;
    const state = layout.snapshot();
    for (const [id, contribution] of composerViews) {
      const selected = id === [...composerViews.keys()].at(-1) && mediaListeners.size > 0;
      reportVisible(id, contribution.owner, true, selected,
        selected ? contribution.view.attachment?.width ?? 0 : 0,
        selected ? contribution.view.attachment?.rows ?? 4 : 0);
    }
    for (const [id, surface] of surfaceMap) {
      if (!id.startsWith('plugin-' + surface.owner + '-')) continue;
      const frame = state.frames.find(frame => frame.surface === id);
      reportVisible(id, surface.owner, Object.hasOwn(state.locations, id), !!frame,
        frame ? Math.max(0, frame.width - 4) : 0, frame ? Math.max(0, frame.height - 3) : 0);
    }
  }
  function publish(surface: Surface, value: Omit<UiSurfaceSnapshot, 'revision'>) {
    if (!active || !surface.active) return;
    surface.state = immutable({...value, revision: surface.state.revision + 1});
    for (const fn of surface.listeners) fn();
    navigation?.refresh();
  }
  function remove(surface: Surface, retain = false) {
    if (!surface.active) return;
    surface.active = false;
    const controller=privateWindows.get(surface);privateWindows.delete(surface);controller?.close();
    changes.delete(surface);
    // A handler may remove its own view before resuming a chat or opening a form.
    // Its already-admitted operation keeps its independent lifetime.
    for (const op of operations.values()) if (op.site === surface.source.id && op !== context.getStore()) op.controller.abort();
    if (surface.source.id.startsWith('plugin-' + surface.owner + '-'))
      reportVisible(surface.source.id, surface.owner, false, false, 0, 0);
    surfaceMap.delete(surface.source.id);
    if (active) {
      if (retain) layout.detach(surface.source.id);
      else {
        layout.forget(surface.source.id);
        if (placementAdmissions.get(surface.source.id) === surface.owner) placementAdmissions.delete(surface.source.id);
      }
    }
    surface.listeners.clear();
    registryChanged();
  }
  function invalidate(surface: Surface) {
    if (reloading && surface.semantic) {
      reloadDetached.set(surface.source.id, surface.owner);
      remove(surface, true);
    } else remove(surface);
  }
  function track(task: Promise<unknown>) {
    pending.add(task);
    void task.catch(() => {}).finally(() => {pending.delete(task); void reloadIfReady();});
    return task;
  }
  function notice(value: string) {localNotice = value; changed();}
  const retryMessage = () => reloadFailed === 'startup'
    ? 'Session startup did not finish. Retry /reload before continuing.'
    : 'Plugin reload did not finish. Retry /reload before continuing.';
  function createSurface(id: string, owner: string, title: string): Surface {
    const surface: Surface = {
      owner, active: true, generation: ++sourceSerial, listeners: new Set(), state: immutable({revision: 0, title}),
      source: {
        id, snapshot: () => surface.state,
        subscribe(fn) {surface.listeners.add(fn); return () => {surface.listeners.delete(fn);};},
        press(action, revision) {
          if (reloadFailed) {if (active) notice(retryMessage()); return;}
          if (reloading) {if (active) notice('Plugin reload is applying. Try the action again when it finishes.'); return;}
          if (!admitted(surface, revision) || !surface.state.view || !actions(surface.state.view).has(action)) return;
          // Select before admitting the action; the bubbling pane click is then idempotent.
          layout.act({type: 'focus', id: surface.source.id});
          press(surface, action);
        },
        change(field, value, revision) {
          if (reloadFailed) {if (active) notice(retryMessage()); return;}
          if (reloading) {if (active) notice('Plugin reload is applying. Retry this input after it finishes.'); return;}
          if (!admitted(surface, revision) || surface.state.view?.input?.id !== field
            || typeof value !== 'string' || value.length > 4000) return;
          changes.set(surface, {field, value});
          if (!surface.state.busy) publish(surface, {...surface.state, busy: true});
          if (operations.size >= 4) notice('Interface input queued until an operation finishes');
          drainChanges();
        },
      },
    };
    surfaceMap.set(id, surface);
    return surface;
  }
  function admitted(surface: Surface, revision: number): boolean {
    return active && surface.active && surfaceMap.get(surface.source.id) === surface
      && revision === surface.state.revision && core.host.hasPlugin(surface.owner);
  }
  function press(surface: Surface, action: string) {
    const managers: Record<string, string> = {
      'plugin-extension-manager-extensions': 'extension-manager',
      'plugin-marketplace-manager-marketplaces': 'marketplace-manager',
      'plugin-setup-guide-setup': 'setup-guide',
    };
    if (Object.hasOwn(managers, surface.source.id) && managers[surface.source.id] === surface.owner) {
      if (action.startsWith('navigate:')) {
        const name = action.slice('navigate:'.length);
        if (['extensions', 'marketplace', 'reload', 'placement', 'settings'].includes(name))
          track(submit('/' + name).catch(() => {if (active) notice('The navigation action could not finish. Retry /reload if the reload failed.');}));
        return;
      }
      if (action.startsWith('manage:') || action === 'updates') {
        const id = 'plugin-extension-manager-extensions', owner = 'extension-manager';
        const target = surfaceMap.get(id);
        runOperation(owner, id, op => emit(op, 'ui.press', {site: id, key: action}), target?.owner === owner ? target : undefined, 'action', true);
        return;
      }
    }
    runOperation(surface.owner, surface.source.id,
      op => emit(op, 'ui.press', {site: surface.source.id, key: action}), surface);
  }
  function live(op: Operation): boolean {
    return active && op.active && op.core === core && operations.get(op.id) === op && !op.controller.signal.aborted;
  }
  const mayFocus = (op: Operation) => live(op) && op.windowIntent === layout.windowIntentRevision;
  function publicationIntent(owner: string, id: string, ambient?: Operation): {op?: Operation; allowed: boolean} {
    const scope = core.host.currentServiceScope;
    const captured = scope ? scope.origin : ambient;
    const op = captured && typeof captured === 'object' ? captured as Operation : undefined;
    if (!scope?.background) {
      if (captured === undefined) return {allowed: true};
      return op && live(op) ? {op, allowed: mayFocus(op)} : {allowed: false};
    }
    // A retained producer may satisfy only its still-current, matching picker destination.
    const picker = ambient && live(ambient) && ambient.owner === owner && ambient.navigationSignal
      && !ambient.navigationSignal.aborted && ambient.site === id ? ambient : undefined;
    return {op: picker, allowed: !picker || mayFocus(picker)};
  }
  async function emit(op: Operation, event: 'ui.press' | 'ui.change', input: Record<string, unknown>) {
    if (!live(op)) return;
    const result = await op.core.host.emit(event, input, op.controller.signal);
    if (result.faults.length) throw Error('UI action failed');
  }
  function drainChanges() {
    if (reloading) return;
    for (const [surface, change] of changes) {
      if (!admitted(surface, surface.state.revision) || surface.state.view?.input?.id !== change.field) {changes.delete(surface); continue;}
      if (operations.size >= 4 || [...operations.values()].some(op => op.site === surface.source.id && op.kind === 'change')) continue;
      changes.delete(surface);
      runOperation(surface.owner, surface.source.id,
        op => emit(op, 'ui.change', {site: surface.source.id, id: change.field, value: change.value}), surface, 'change');
    }
  }
  function runOperation(owner: string, site: string, run: (op: Operation) => Promise<unknown>, source?: Surface, kind: Operation['kind'] = 'action', open = false, navigationSignal?: AbortSignal, windowIntent = layout.windowIntentRevision): Operation | undefined {
    if (!active || owner !== '@host' && !core.host.hasPlugin(owner)) return;
    if (reloadFailed) {notice(retryMessage()); return;}
    if (reloading) {notice('Plugin reload is applying. Try the action again when it finishes.'); return;}
    if (operations.size >= 4) {notice('Four interface operations are already active'); return;}
    if (navigationSignal?.aborted) return;
    if(localNotice!==undefined){localNotice=undefined;changed();}
    const op: Operation = {id: randomUUID(), owner, site, core, controller: new AbortController(), active: true, kind, open,
      windowIntent, opened: new Set(), destinations: new Set(), navigationSignal};
    const abortNavigation = () => op.controller.abort();
    navigationSignal?.addEventListener('abort', abortNavigation, {once: true});
    operations.set(op.id, op);
    if (source) publish(source, {...source.state, busy: true, error: undefined});
    const task = context.run(op, async () => {
      try {await run(op);}
      catch {if (live(op)) {
        if (source?.active) publish(source, {...source.state, error: 'The UI action failed'});
        else notice('The UI action failed');
      }}
      finally {
        op.active = false;
        operations.delete(op.id);
        op.controller.abort();
        navigationSignal?.removeEventListener('abort', abortNavigation);
        op.inbox?.close(); op.off?.();
        if (op.surface) remove(op.surface);
        drainChanges();
        for(const wake of [...operationWaiters])wake();
        const current = source ?? op.published;
        if (op.core === core && current?.active && surfaceMap.get(current.source.id) === current && current.owner === op.owner)
          publish(current, {...current.state,
            busy: changes.has(current) || [...operations.values()].some(other => other.site === current.source.id)});
      }
    });
    op.done = task;
    track(task);
    return op;
  }
  async function controllerOperation(owner:string,surface:Surface,windowIntent:number,signal:AbortSignal,
    run:(scope:{op:Operation;signal:AbortSignal;current():boolean})=>Promise<void>) {
    const captured=core;
    const available=()=>operations.size<4&&![...operations.values()].some(op=>op.site===surface.source.id);
    while(active&&captured===core&&surface.active&&!signal.aborted){
      if(reloading||reloadFailed)throw Error('Interface input is unavailable during reload');
      if(available()){
        let failed=false,failure:unknown;
        const op=runOperation(owner,surface.source.id,async current=>{
          // A controller may close its own view before an explicit resume. Its
          // admitted operation remains live; an external close still cancels it.
          const abort=()=>{if(context.getStore()!==current)current.controller.abort();};
          signal.addEventListener('abort',abort,{once:true});
          try{signal.throwIfAborted();await run({op:current,signal:current.controller.signal,current:()=>live(current)&&surface.active});}
          catch(error){failed=true;failure=error;throw error;}
          finally{signal.removeEventListener('abort',abort);}
        },surface,'action',false,undefined,windowIntent);
        if(op){await op.done;if(failed)throw failure;return;}
      }
      await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{operationWaiters.delete(wake);signal.removeEventListener('abort',abort);};
        const wake=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(Error('Controller input cancelled'));};
        operationWaiters.add(wake);signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();else if(available())wake();
      });
    }
    throw Error('Controller input has expired');
  }
  function privateInputActive(surface:Surface,owner:AgentCore){
    const state=layout.snapshot();
    return active&&core===owner&&surface.active&&surfaceMap.get(surface.source.id)===surface
      &&navigation?.snapshot().mode==='normal'&&!state.gesture&&state.focused===surface.source.id
      &&state.frames.some(frame=>frame.surface===surface.source.id);
  }
  function openHistoryWindow(owner:AgentCore,binding:SessionHistoryBinding){
    if(!active||core!==owner||binding.lease.signal.aborted)return;
    const old=surfaceMap.get(binding.id);if(old)remove(old);
    const surface=createSurface(binding.id,binding.owner,binding.title);surface.semantic='sessions';
    let controller:ReturnType<typeof createOpenTuiHistoryController>|undefined;
    const current=()=>active&&core===owner&&surface.active&&surfaceMap.get(binding.id)===surface;
    const update=()=>{const frame=controller?.snapshot();if(current()&&frame)publish(surface,{title:binding.title,controller:frame,busy:surface.state.busy});};
    controller=createOpenTuiHistoryController({binding,signal:channels!.generation.signal,current,changed:update,
      captureIntent:()=>{layout.markWindowIntent();return layout.windowIntentRevision;},
      inputScope:(intent,signal,run)=>controllerOperation(binding.owner,surface,intent,signal,
        scope=>owner.host.withPrivateUiInput(binding.owner,scope.signal,run)),
      failed:cancelled=>{if(surface.active)remove(surface);if(!cancelled&&active)notice('Selected history controller is unavailable');},
    });
    if(!surface.active||!controller.snapshot())return;
    privateWindows.set(surface,{close:()=>controller!.close()});
    surface.source.controllerInput=(id,input,revision)=>{
      if(privateInputActive(surface,owner)&&controller!.snapshot()?.id===id)return controller!.input(input,revision);
    };
    surface.source.controllerViewport=(id,columns,rows)=>{if(current()&&controller!.snapshot()?.id===id)controller!.viewport(columns,rows);};
    surface.source.cancelController=id=>{if(privateInputActive(surface,owner)&&controller!.snapshot()?.id===id)track(binding.close());};
    historyBindings.set(binding,{surface,update:()=>controller!.update()});update();
    const placement=resolvePlacement(placementConfig,binding.owner,'sessions',{site:'sidebar',size:.75,focus:true});surface.placement=placement;
    const intent=publicationIntent(binding.owner,binding.id,context.getStore()),op=intent.op?.owner===binding.owner?intent.op:undefined;
    const requested=!!(op?.open&&(op.site===binding.id||op.site.startsWith('command:')));
    layout.register({id:binding.id,label:binding.title},{...placement,focus:intent.allowed&&placement.focus===true});
    windowTitles.set(binding.id,{title:binding.title,owner:binding.owner});
    if(op){
      if(requested){op.open=false;op.site=binding.id;}
      if(intent.allowed&&!op.opened.has(binding.id)&&(requested||placement.focus===true)){op.opened.add(binding.id);layout.actAutomatic({type:'open',id:binding.id});}
      op.published=surface;destination(op,binding.id);
    }
    registryChanged();
  }
  const historyBindings=new Map<SessionHistoryBinding,{surface:Surface;update():void}>();
  function placementWindows():PluginWindow[]{
    return [...surfaceMap.values()].filter(surface=>surface.active&&surface.semantic&&(surface.state.view||surface.state.controller?.kind==='history'))
      .map(surface=>({id:surface.source.id,plugin:surface.owner,surface:surface.semantic!,title:surface.state.title,
        placement:{...resolvePlacement(placementConfig,surface.owner,surface.semantic!,surface.placement),
          workspace:layout.snapshot().locations[surface.source.id]??surface.placement?.workspace??layout.snapshot().workspace}}));
  }
  function openPlacementWindow(op:Operation){
    const id='host-placement',existing=surfaceMap.get(id);
    if(existing?.active){if(mayFocus(op))layout.actAutomatic({type:'open',id});op.published=existing;destination(op,id);return;}
    const owner=op.core,surface=createSurface(id,'@host','Plugins · placement');
    let controller:ReturnType<typeof createOpenTuiPlacementController<{op:Operation;signal:AbortSignal;current():boolean}>>|undefined;
    const current=()=>active&&core===owner&&surface.active&&surfaceMap.get(id)===surface;
    const update=()=>{const frame=controller?.snapshot();if(current()&&frame)publish(surface,{title:'Plugins · placement',controller:frame,busy:surface.state.busy});};
    controller=createOpenTuiPlacementController<{op:Operation;signal:AbortSignal;current():boolean}>({registry:owner.host.controllers,id:randomUUID(),signal:channels!.generation.signal,current,changed:update,
      captureIntent:()=>{layout.markWindowIntent();return layout.windowIntentRevision;},
      inputScope:(intent,signal,run)=>controllerOperation('@host',surface,intent,signal,run),
      windows:placementWindows,anchors:()=>['session',...placementWindows().map(window=>window.id)],
      apply:async(scope,targetId,value,save=false)=>{
        if(!scope.current()||!current())throw Error('Placement input has expired');
        const target=surfaceMap.get(targetId),placement=surfacePlacementSchema.parse(value),neighbor=placement.relativeTo;
        if(!target?.active||!target.semantic||!owner.host.hasPlugin(target.owner)||!placementWindows().some(window=>window.id===targetId))throw Error('Unknown plugin window');
        if(neighbor&&(neighbor===targetId||neighbor!=='session'&&!placementWindows().some(window=>window.id===neighbor)))throw Error('Unknown neighboring window');
        const semantic=target.semantic,rule={...placement,match:{plugin:target.owner,surface:semantic}};
        if(save)await app.savePlacement(rule);
        if(!scope.current()||!current()||surfaceMap.get(targetId)!==target||!target.active||target.semantic!==semantic||!owner.host.hasPlugin(target.owner))throw Error('Placement target has expired');
        if(neighbor&&neighbor!=='session'&&!placementWindows().some(window=>window.id===neighbor))throw Error('Placement neighbor has expired');
        placementConfig.rules=[...(placementConfig.rules??[]).filter(existing=>existing.match.plugin!==target.owner||existing.match.surface!==semantic),rule];
        target.placement=placement;
        layout.relocate(targetId,{...placement,focus:placement.focus===true&&scope.op.windowIntent===layout.windowIntentRevision});
      },
      closed:()=>remove(surface),failed:cancelled=>{if(surface.active)remove(surface);if(!cancelled&&active)notice('Selected placement controller is unavailable');},
    });
    if(!surface.active||!controller.snapshot())return;
    privateWindows.set(surface,{close:()=>controller!.close()});update();
    surface.source.controllerInput=(request,input,revision)=>{
      if(privateInputActive(surface,owner)&&controller!.snapshot()?.id===request)return controller!.input(input,revision);
    };
    surface.source.controllerViewport=(request,columns,rows)=>{if(current()&&controller!.snapshot()?.id===request)controller!.viewport(columns,rows);};
    surface.source.cancelController=request=>{if(privateInputActive(surface,owner)&&controller!.snapshot()?.id===request)remove(surface);};
    layout.register({id,label:surface.state.title,transient:true},{site:'split',focus:mayFocus(op)});
    if(mayFocus(op))layout.actAutomatic({type:'open',id});op.published=surface;destination(op,id);registryChanged();
  }
  function destination(op: Operation, id: string) {
    if (!live(op) || op.navigationSignal?.aborted || layout.snapshot().focused !== id) return;
    op.destination ??= id;
    for (const fn of op.destinations) fn();
  }
  function createChannels(): Channels {
    const binding: Channels = {
      inbox: createInteractionInbox(), generation: new AbortController(),
      async approve(request) {
        try {return await routeRequest(binding, request.signal,
          (target, signal, requester) => target.ask({...request, signal}, requester));}
        catch {return false;}
      },
      ask(request) {
        return routeRequest(binding, request.signal,
          (target, signal, requester) => target.askQuestion({...request, signal}, requester));
      },
    };
    return binding;
  }
  async function routeRequest<T>(binding: Channels, signal: AbortSignal | undefined,
    run: (target: Inbox, signal: AbortSignal, requester?: string) => Promise<T>, formPlugin?: string): Promise<T> {
    const owner = binding.core;
    if (!active || !owner || owner !== core || channels !== binding || binding.generation.signal.aborted)
      throw new ExpiredRequest('The request belongs to an expired application session');
    const scope = owner.host.currentServiceScope;
    if (scope && (scope.lifetime.aborted || scope.signal.aborted || !owner.host.hasPlugin(scope.plugin)
      || formPlugin && scope.plugin !== formPlugin))
      throw new ExpiredRequest('The requesting plugin is no longer active');
    const effective = AbortSignal.any([binding.generation.signal, ...(signal ? [signal] : []),
      ...(scope ? [scope.signal, scope.lifetime] : [])]);
    if (effective.aborted) throw new ExpiredRequest('The request was cancelled');
    if (scope?.background) {
      let result!: T, failure: unknown, failed = false;
      const request = runOperation(scope.plugin, 'request:' + randomUUID(), async op => {
        try {result = await run(ownRequests(op), AbortSignal.any([effective, op.controller.signal]), scope.plugin);}
        catch (error) {failed = true; failure = error;}
      }, undefined, 'request');
      if (!request) throw Error('A request window is unavailable; finish an active interface operation or retry after reload');
      await request.done;
      if (failed) throw failure;
      return result;
    }
    // A captured capability takes precedence over ambient async context. In
    // particular, a stale UI origin must never fall through into Main.
    const origin = scope ? scope.origin : context.getStore();
    if (origin !== undefined) {
      const op = origin as Operation;
      if (!op || typeof op !== 'object' || !live(op))
        throw new ExpiredRequest('The requesting interface operation has finished');
      return run(ownRequests(op), AbortSignal.any([effective, op.controller.signal]), scope?.plugin ?? formPlugin ?? op.owner);
    }
    return run(binding.inbox, effective, scope?.plugin ?? formPlugin);
  }
  function ownRequests(op: Operation) {
    if (op.inbox) return op.inbox;
    const requests = createInteractionInbox();
    requests.bind(op.core, {forms: false});
    const id = 'ui-request-' + op.id;
    const surface = createSurface(id, op.owner, 'Settings');
    op.inbox = requests; op.surface = surface;
    let answeredApproval: string | undefined;
    const current = () => live(op) && surface.active && surfaceMap.get(id) === surface;
    const inputActive = () => current() && navigation?.snapshot().mode === 'normal'
      && layout.snapshot().focused === id && layout.snapshot().frames.some(frame => frame.surface === id);
    const renewIntent = () => {
      const state = layout.snapshot();
      if (op.kind === 'request' || navigation && navigation.snapshot().mode !== 'normal'
        || state.focused !== id || !state.frames.some(frame => frame.surface === id)) return;
      // Capture the human action before its continuation can await or open another request.
      layout.markWindowIntent();
      if (op.owner === '@host' && op.site === 'host:placement') op.placementAnswerIntent = layout.windowIntentRevision;
      else op.windowIntent = layout.windowIntentRevision;
    };
    surface.source.answerApproval = (requestId, allow) => {
      if (!current() || surface.state.approval?.id !== requestId || answeredApproval === requestId) return;
      answeredApproval = requestId;
      renewIntent();
      requests.answer(requestId, allow === true);
    };
    surface.source.answerInteraction = (requestId, value) => {
      if (!current() || surface.state.interaction?.id !== requestId) return;
      renewIntent();
      requests.answerInteraction(requestId, value);
    };
    surface.source.cancelInteraction = requestId => {
      if (!current() || surface.state.interaction?.id !== requestId) return;
      renewIntent();
      requests.cancelInteraction(requestId);
    };
    surface.source.answerForm = (requestId, value) => {
      if (surface.state.form?.id === requestId) surface.source.answerInteraction!(requestId, value);
    };
    surface.source.cancelForm = requestId => {
      if (surface.state.form?.id === requestId) surface.source.cancelInteraction!(requestId);
    };
    surface.source.controllerInput = (requestId, input, revision) => {
      if (inputActive())return requests.controllerInput(requestId, input, revision, renewIntent);
    };
    surface.source.controllerViewport = (requestId, columns, rows) => {
      if (current())requests.controllerViewport(requestId, columns, rows);
    };
    surface.source.cancelController = requestId => {
      if (inputActive() && requests.controllerSnapshot()?.id === requestId) {renewIntent();requests.cancelController(requestId);}
    };
    let shown: string | undefined;
    op.off = requests.subscribe(() => {
      if (!live(op)) return;
      const approval = requests.snapshot(), interaction = requests.interactionSnapshot(), controller = requests.controllerSnapshot();
      const form = interaction?.kind === 'form' ? interaction : undefined;
      const requester = requests.requesterSnapshot() ?? op.owner;
      const kind = controller?.kind ?? (approval ? 'approval' : interaction?.kind);
      const title = kind === 'approval' ? 'Approval · ' + requester : kind === 'question' ? 'Questions · ' + requester
        : form?.request.title ?? (controller ? 'Form · ' + requester : surface.state.title);
      publish(surface, {title, approval, interaction, form, controller, busy: !approval && !interaction && !controller});
      const requestId = approval?.id ?? interaction?.id ?? controller?.id;
      if (requestId && requestId !== shown) {
        shown = requestId;
        const focus = op.kind !== 'request' && mayFocus(op);
        layout.register({id, label: title, transient: true}, {site: 'split', focus});
        if (focus) layout.actAutomatic({type: 'open', id});
        destination(op, id);
      }
    });
    registryChanged();
    return requests;
  }
  async function arrange(op: Operation) {
    let selected: string | undefined, draft: SurfacePlacement | undefined, message: string | undefined;
    while (live(op)) {
      const windows = [...surfaceMap.values()].filter(surface => surface.active && surface.semantic && surface.state.view);
      if (!windows.length) {notice('No plugin windows are available to arrange'); return;}
      if (windows.length > 198) {notice('Placement supports up to 198 plugin windows. Unload a plugin before opening this editor.'); return;}
      const current = windows.find(surface => surface.source.id === selected)
        ?? windows.find(surface => surface.source.id === layout.snapshot().focused) ?? windows[0];
      const value = draft ?? {...current.placement, workspace: layout.snapshot().locations[current.source.id] ?? current.placement?.workspace ?? layout.snapshot().workspace};
      const label = (surface: Surface) => (surface.state.title + ' · ' + surface.owner).slice(0, 200);
      op.placementAnswerIntent = undefined;
      const result = await ownRequests(op).form('@host', {
        title: 'Arrange plugin windows', description: message ?? 'Apply for this run, or save a project rule. Closing this window keeps the operation pending; Cancel ends it.',
        fields: [
          {id: 'window', label: 'Plugin window', type: 'select', value: current.source.id, options: windows.map(surface => ({value: surface.source.id, label: label(surface)}))},
          {id: 'site', label: 'Placement', type: 'select', value: value.site ?? 'split', options: ['split', 'sidebar', 'inspector', 'status-bar'].map(value => ({value, label: value}))},
          {id: 'workspace', label: 'Workspace', type: 'select', value: String(value.workspace ?? layout.snapshot().workspace), options: Array.from({length: 9}, (_, index) => ({value: String(index + 1), label: 'Workspace ' + (index + 1)}))},
          {id: 'size', label: 'Size fraction', type: 'text', value: String(value.size ?? .3), hint: 'A number from 0.1 to 0.8', required: true},
          {id: 'relativeTo', label: 'Neighbor', type: 'select', value: value.relativeTo ?? '', options: [
            {value: '', label: 'Workspace default'}, {value: 'session', label: 'Main'}, ...windows.map(surface => ({value: surface.source.id, label: label(surface)})),
          ]},
          {id: 'focus', label: 'Focus the placed window', type: 'toggle', value: value.focus ?? false},
        ], actions: [{id: 'apply', label: 'Apply'}, {id: 'save', label: 'Save rule'}, {id: 'cancel', label: 'Cancel'}],
      }, op.controller.signal);
      if (!result || result.action === 'cancel' || !live(op)) return;
      selected = String(result.values.window);
      const target = surfaceMap.get(selected);
      if (!target?.active || !target.semantic || !core.host.hasPlugin(target.owner)) {draft = undefined; message = 'The selected window is no longer available'; continue;}
      try {
        const relativeTo = String(result.values.relativeTo);
        if (relativeTo === selected || relativeTo && relativeTo !== 'session' && !surfaceMap.get(relativeTo)?.semantic)
          throw Error('Choose an available neighboring window other than itself');
        const placement = surfacePlacementSchema.parse({site: result.values.site, workspace: Number(result.values.workspace),
          size: Number(result.values.size), ...(relativeTo ? {relativeTo} : {}), focus: result.values.focus});
        const rule = {...placement, match: {plugin: target.owner, surface: target.semantic}};
        if (result.action === 'save') await app.savePlacement(rule);
        if (!live(op)) return;
        placementConfig.rules = [...(placementConfig.rules ?? []).filter(existing =>
          existing.match.plugin !== target.owner || existing.match.surface !== target.semantic), rule];
        target.placement = placement;
        layout.relocate(selected, {...placement, focus: placement.focus === true
          && op.placementAnswerIntent === layout.windowIntentRevision});
        draft = placement;
        message = result.action === 'save' ? 'Rule saved. Placement applied.' : 'Applied for this run. Save the rule to keep it.';
      } catch {message = 'Choose an available neighbor, workspace 1–9 and size from 0.1 to 0.8. Saving must finish before the rule is applied.';}
    }
  }
  function receive(event: LoopEvent) {
    if (!active || event.kind !== 'catalog') return;
    if (event.event === 'ui.pluginRemoved') {
      const owner = String(event.input.plugin);
      for (const [id, contribution] of composerViews) if (contribution.owner === owner) {
        reportVisible(id, owner, false, false, 0, 0); composerViews.delete(id);
      }
      mediaChanged();
      for (const op of operations.values()) if (op.owner === owner) op.controller.abort();
      for (const surface of [...surfaceMap.values()]) if (surface.owner === owner) invalidate(surface);
      if (!reloading) for (const [id, plugin] of placementAdmissions) if (plugin === owner) {
        layout.forget(id); placementAdmissions.delete(id); reloadDetached.delete(id);
      }
      navigation?.refresh();
    }
    if (event.event === 'ui.surfaceRemoved') {
      const media = composerViews.get(String(event.input.id));
      if (media) {reportVisible(String(event.input.id), media.owner, false, false, 0, 0); composerViews.delete(String(event.input.id)); mediaChanged();}
      const surface = surfaceMap.get(String(event.input.id));
      if (surface) invalidate(surface);
    }
    if (event.event === 'ui.surface') {
      const id = String(event.input.id), owner = String(event.input.plugin);
      if (!core.host.hasPlugin(owner) || !id.startsWith('plugin-' + owner + '-')) return;
      const origin = context.getStore();
      // A cancelled picker request cannot create a late window. Existing
      // background views still update; ordinary detached producers are untouched.
      if (origin?.navigationSignal?.aborted && !surfaceMap.has(id) && !composerViews.has(id)) return;
      const parsed = uiTextViewSchema.safeParse(event.input.view === undefined ? legacyView(event.input.text) : event.input.view);
      if (!parsed.success) return;
      if (parsed.data.attachment?.site === 'composer') {
        const existing = surfaceMap.get(id);
        if (existing) remove(existing);
        composerViews.set(id, {owner, view: parsed.data});
        mediaChanged();
        reportVisibility();
        return;
      }
      if (composerViews.delete(id)) mediaChanged();
      let surface = surfaceMap.get(id);
      if (surface && surface.owner !== owner) return;
      const created = !surface;
      surface ??= createSurface(id, owner, String(event.input.title));
      const semantic = String(event.input.surface ?? id);
      const config = placementConfig;
      surface.semantic = semantic;
      const placement = resolvePlacement(config, owner, semantic, surface.placement ?? event.input.placement as SurfacePlacement | undefined);
      const intent = publicationIntent(owner, id, origin);
      const op = intent.op?.owner === owner ? intent.op : undefined;
      const requested = !!(op?.open && (op.site === id || op.site.startsWith('command:') && op.owner === owner));
      const allowed = intent.allowed;
      const admission = {...placement, focus: allowed && (placement.focus ?? false)};
      surface.placement = placement;
      publish(surface, {title: String(event.input.title), view: parsed.data,
        busy: [...operations.values()].some(op => op.site === id)
          || !!(op?.open && op.site.startsWith('command:'))});
      windowTitles.set(id, {title: surface.state.title, owner});
      layout.register({id, label: surface.state.title}, admission);
      if (placementAdmissions.get(id) !== owner) {
        placementAdmissions.set(id, owner);
        if (config.rules?.some(rule =>
          (!rule.match.plugin || rule.match.plugin === owner) && (!rule.match.surface || rule.match.surface === semantic))
          && (layout.snapshot().locations[id] !== undefined || requested && allowed))
          layout.relocate(id, admission);
      }
      if (op) {
        const focus = (event.input.placement as SurfacePlacement | undefined)?.focus === true
          && resolvePlacement(config, owner, semantic, {...placement, focus: true}).focus !== false;
        if (requested) {op.open = false; op.site = id;}
        if (allowed && !op.opened.has(id) && (requested || focus)) {
          op.opened.add(id);
          layout.actAutomatic({type: 'open', id});
        }
        if (op.site === id && op.owner === owner && !op.published) op.published = surface;
        if (op.site === id && op.owner === owner) destination(op, id);
      }
      if (created) registryChanged();
    }
    if (['turn.complete', 'turn.failed', 'turn.interrupted'].includes(event.event)) void reloadIfReady();
  }
  function bind(next: AgentCore, nextChannels: Channels) {
    channels = nextChannels;
    nextChannels.core = next;
    const nextInbox = nextChannels.inbox;
    core = next; inbox = nextInbox;
    inbox.bind(next);
    offOrigin = next.host.setInvocationOriginProvider(() => context.getStore());
    offForm = next.host.setFormHandler(async (plugin, request, signal) => {
      try {return await routeRequest(nextChannels, signal,
        (target, effective, requester) => target.form(requester ?? plugin, request, effective), plugin);}
      catch (error) {if (error instanceof ExpiredRequest) return null; throw error;}
    });
    conversation = connectConversation(next, 'Main', inbox, submit);
    sessionState = conversation.snapshot();
    navigation?.refresh();
    offConversation = conversation.subscribe(changed);
    offCore = next.subscribe(receive);
    bindEditor(next);
    offHistory=next.host.hasPlugin('session-manager','trusted')?app.bindHistoryPresenter(next,{
      show:binding=>openHistoryWindow(next,binding),
      update:binding=>historyBindings.get(binding)?.update(),
      remove:binding=>{const current=historyBindings.get(binding);historyBindings.delete(binding);if(current)remove(current.surface);},
    }):undefined;
    next.runtime.setResolver('service.session.control', async (args: {action: string; id?: string}) => {
      if (args.action !== 'resume') return (await next.host.emit('service.session.store', args)).value;
      const current = context.getStore();
      if (!next.controlsReady || switching || reloading || [...operations.values()].some(op => op !== current)) return {deny: 'Wait until current operations finish'};
      const windowIntent = current?.windowIntent??layout.windowIntentRevision;
      const callerSignal=next.host.currentServiceScope?.signal??next.host.currentSignal;
      switching = true;
      const replacementChannels = createChannels();
      let replacement: AgentCore | undefined;
      try {
        replacement = await app.resume(args.id ?? next.sessionId, replacementChannels.approve, replacementChannels.ask);
        if(!active||core!==next||nextChannels.generation.signal.aborted||callerSignal?.aborted||current&&!live(current)
          ||!next.controlsReady||[...operations.values()].some(op=>op!==current)){
          replacementChannels.generation.abort();replacementChannels.inbox.close();
          await replacement.close();replacement=undefined;
          return {deny:'Session switch cancelled or current work changed'};
        }
        unbind();
        for (const surface of [...surfaceMap.values()]) {
          // Plugin source generations change with Core; the user's retained
          // tiling identity, closed state and ratios belong to the workspace.
          remove(surface,Boolean(surface.semantic&&replacement.host.hasPlugin(surface.owner)));
        }
        composerViews.clear(); visibility.clear(); mediaChanged();
        bind(replacement, replacementChannels);
        await next.close();
        await context.exit(() => replacement!.start());
        if (windowIntent === layout.windowIntentRevision) layout.actAutomatic({type: 'open', id: 'session'});
        changed();
        return {value: true};
      } catch {
        if (replacement === core) {
          // The new session is already committed. Keep its input channels live
          // and require explicit initialization recovery rather than poisoning them.
          reloadFailed = 'startup'; notice(retryMessage());
          return {deny: 'Session opened, but startup failed. Retry /reload before continuing.'};
        }
        if (replacement && replacement !== core) await replacement.close();
        replacementChannels.generation.abort(); replacementChannels.inbox.close(); return {deny: 'Could not resume this session'};
      }
      finally {switching = false;}
    });
  }
  function unbind() {
    offHistory?.();offHistory=undefined;
    offEditor?.();offEditor = undefined;
    if (editor) {editorDraft = editor.checkpoint();editor.close();editor = undefined;}
    channels?.generation.abort(Error('Application input channel replaced'));
    offOrigin?.(); offOrigin = undefined;
    offForm?.(); offForm = undefined;
    offCore?.(); offCore = undefined;
    offConversation?.(); offConversation = undefined;
    conversation?.disconnect();
  }
  async function reloadIfReady(): Promise<boolean | undefined> {
    if (reloadPromise) return reloadPromise;
    if (!active || !pendingReload || reloadFailed || operations.size || changes.size || core.getState() === 'running' || core.hasActiveOperations) return;
    reloading = true;
    for (const [id, plugin] of placementAdmissions) reloadDetached.set(id, plugin);
    const owner = core;
    const work = context.exit(async () => {
      try {
        const result = await owner.host.withoutServiceScope(() => app.reloadPlugins(owner));
        if (result.startsWith('Wait until')) {if (active) notice(result); return false;}
        for (const [id, plugin] of reloadDetached) {
          if (!owner.host.hasPlugin(plugin) && (!surfaceMap.has(id) || surfaceMap.get(id)?.owner === plugin)) {
            layout.forget(id);
            if (placementAdmissions.get(id) === plugin) placementAdmissions.delete(id);
          }
        }
        reloadDetached.clear();
        for (const [id, record] of windowTitles) if (!owner.host.hasPlugin(record.owner)) windowTitles.delete(id);
        pendingReload = false;
        navigation?.refresh();
        if (active) notice(result);
        return true;
      } catch {reloadFailed = 'reload'; if (active) notice('Could not reload plugins. Retry /reload before sending a new request.'); return false;}
      finally {reloading = false;}
    });
    reloadPromise = work;
    pending.add(work);
    try {return await work;}
    finally {pending.delete(work); if (reloadPromise === work) reloadPromise = undefined;}
  }
  function route(text: string): {owner: string; site: string; key?: string; command?: string;host?:'placement'} | undefined {
    const name = text.trim().split(/\s+/)[0];
    if(name==='/placement'&&core.host.controllers.selectedOwner('placement')!=='@host')return {owner:'@host',site:'host-placement',host:'placement'};
    if (['/settings', '/models', '/providers'].includes(name)) return {owner: 'model-selector', site: 'plugin-model-selector-models', key: 'settings'};
    const mapped = name === '/plugins' ? '/extensions' : name;
    const registered = app.commands().find(command => command.name === mapped);
    if(registered?.plugin==='session-manager'&&sessionCommandNames.some(command=>command===name)&&core.host.hasPlugin('session-manager'))
      return {owner:'session-manager',site:registered.ui?.site??'command:'+name,key:'command:'+text.trim()};
    if (registered?.execution === 'immediate' && registered.plugin)
      return {owner: registered.plugin, site: registered.ui?.site ?? 'command:' + mapped, command: text};
    const manager = mapped === '/extensions' ? 'extension-manager-extensions' : mapped === '/marketplace' ? 'marketplace-manager-marketplaces' : undefined;
    if (manager) return {owner: manager === 'extension-manager-extensions' ? 'extension-manager' : 'marketplace-manager', site: 'plugin-' + manager, key: 'command:' + (name === '/plugins' ? text.replace('/plugins', '/extensions') : text.trim())};
    if (registered?.ui && (registered.plugin || name === '/setup')) return {
      owner: registered.plugin ?? 'setup-guide', site: registered.ui.site, key: 'command:' + text.trim(),
    };
  }
  function uiRoutes() {
    const entries = new Map<string, {owner: string; command: string; title: string}>();
    if(core.host.controllers.selectedOwner('placement')!=='@host')entries.set('host-placement',{owner:'@host',command:'/placement',title:'Plugins · placement'});
    for (const command of app.commands()) {
      const owner = command.plugin ?? (command.name === '/setup' ? 'setup-guide' : undefined);
      if (command.ui && owner && core.host.hasPlugin(owner)) entries.set(command.ui.site,
        {owner, command: command.name, title: command.name});
    }
    const history=route('/history');
    if(history?.owner==='session-manager')entries.set(history.site,{owner:history.owner,command:'/history',title:'Chat history'});
    for (const [name, title] of [['/settings', 'Models & providers'], ['/plugins', 'Plugins'], ['/marketplace', 'Marketplaces']] as const) {
      const target = route(name);
      if (target && core.host.hasPlugin(target.owner)) entries.set(target.site, {owner: target.owner, command: name, title});
    }
    return entries;
  }
  function inventory(): NavigationWindow[] {
    const locations = layout.snapshot().locations, routes = uiRoutes();
    const entries = new Map<string, NavigationWindow>([['session', {id: 'session', title: 'Main',
      workspace: locations.session, state: locations.session === undefined ? 'closed' : 'open', version: core.sessionId}]]);
    for (const [id, surface] of surfaceMap) if (surface.active) entries.set(id, {
      id, title: surface.state.title, workspace: locations[id], state: locations[id] === undefined ? 'closed' : 'open',
      command: routes.get(id)?.command, version: surface.generation + ':'
        + (surface.state.approval?.id ?? surface.state.interaction?.id ?? surface.state.form?.id ?? ''),
    });
    for (const [id, record] of windowTitles) if (!entries.has(id) && (record.owner==='@host'||core.host.hasPlugin(record.owner))) entries.set(id, {
      id, title: record.title, state: routes.has(id) ? 'available' : 'unavailable', command: routes.get(id)?.command,
      version: record.owner + ':' + core.sessionId,
    });
    for (const [id, target] of routes) if (!entries.has(id)) entries.set(id, {
      id, title: target.title, state: 'available', command: target.command, version: target.owner + ':' + target.command + ':' + core.sessionId,
    });
    return [...entries.values()];
  }
  function dispatch(command: NonNullable<ReturnType<typeof route>>, signal?: AbortSignal, windowIntent?: number) {
    if (windowIntent === undefined) layout.markWindowIntent();
    return runOperation(command.owner, command.site, op => command.command
      ? op.core.invokeCommand(command.command, op.controller.signal)
      : command.host==='placement'?Promise.resolve(openPlacementWindow(op))
      : emit(op, 'ui.press', {site: command.site, key: command.key}), undefined, 'action', true, signal, windowIntent);
  }
  function waitForDestination(op: Operation, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return; settled = true;
        op.destinations.delete(ready); signal.removeEventListener('abort', abort);
        if (ok) resolve(); else reject(Error('Window opening cancelled or unavailable'));
      };
      const ready = () => {
        const surface = op.destination ? surfaceMap.get(op.destination) : undefined;
        if (active && op.core === core && !signal.aborted && surface?.active
          && (surface === op.published || surface === op.surface) && layout.snapshot().focused === op.destination) finish(true);
      };
      const abort = () => finish(false);
      op.destinations.add(ready); signal.addEventListener('abort', abort, {once: true});
      void op.done?.then(() => {ready(); finish(false);}, () => finish(false));
      ready(); if (signal.aborted) abort();
    });
  }
  function openNavigationWindow(id: string, signal: AbortSignal): void | Promise<void> {
    if (!active || signal.aborted) throw Error('Window is unavailable');
    if (id === 'session') {layout.actAutomatic({type: 'open', id}); return;}
    const source = surfaceMap.get(id);
    if (source?.active) {layout.actAutomatic({type: 'open', id}); return;}
    const candidate = uiRoutes().get(id);
    if (!candidate || candidate.owner!=='@host'&&!core.host.hasPlugin(candidate.owner) || reloadPromise || reloadFailed) throw Error('Window is unavailable');
    const command = route(candidate.command);
    if (!command || command.owner !== candidate.owner || command.site !== id) throw Error('Window route is unavailable');
    const op = dispatch(command, signal);
    if (!op) throw Error('Window route is unavailable');
    return waitForDestination(op, signal);
  }
  function immediate(text: string) {
    const name = text.trim().split(/\s+/)[0];
    return ['/chat', '/reload', '/windows', '/placement'].includes(name) || route(text) !== undefined;
  }
  async function sendEditor(owner: AgentCore, intent: Extract<UiEditorIntent, {type: 'submit' | 'steer'}>, windowIntent: number) {
    if (!active || owner !== core || switching || reloading || reloadPromise) return false as const;
    const text = intent.text, name = text.trim().split(/\s+/)[0];
    if (reloadFailed && name !== '/reload') return false as const;
    if (name === '/chat') {
      if (windowIntent === layout.windowIntentRevision) layout.actAutomatic({type: 'open', id: 'session'});
      return 'command' as const;
    }
    if (name === '/windows') {
      if (windowIntent === layout.windowIntentRevision) navigation?.openFinder();
      return 'command' as const;
    }
    if (name === '/placement') {const command=route(text);return (command?dispatch(command,undefined,windowIntent):runOperation('@host', 'host:placement', arrange, undefined, 'action', false, undefined, windowIntent)) ? 'command' as const : false as const;}
    if (name === '/reload') {
      pendingReload = true;reloadFailed = false;notice('Plugin reload queued until current operations finish');
      track(Promise.resolve().then(() => reloadIfReady()));return 'command' as const;
    }
    const command = route(text);
    if (command) return dispatch(command, undefined, windowIntent) ? 'command' as const : false as const;
    localNotice = undefined;
    const receipt = owner.dispatchInput(text, intent.type);
    track(receipt.completion.finally(() => reloadIfReady()));
    return receipt.admitted;
  }
  function bindEditor(owner: AgentCore) {
    offEditor?.();
    const replace = () => {
      if (editor) {editorDraft = editor.checkpoint();editor.close();editor = undefined;}
      if (!active || owner !== core || owner.host.controllers.selectedOwner('editor') === '@host') {changed();return;}
      editor = createOpenTuiEditor({registry: owner.host.controllers, state: editorDraft, signal: channels!.generation.signal,
        current: () => active && owner === core,
        data: signal => {
          const current = () => {signal.throwIfAborted();if (!active || core !== owner) throw Error('Editor capabilities have expired');};
          return {sessionId: owner.sessionId,
            commands: () => {current();return app.commands().map(({name, description, usage}) => ({name, description, ...(usage ? {usage} : {})}));},
            files: async prefix => {current();const files = await referenceFiles(owner.workspace, prefix);current();return files;},
          };
        },
        changed, captureIntent: () => {layout.markWindowIntent();return layout.windowIntentRevision;},
        send: (intent, windowIntent) => sendEditor(owner, intent, windowIntent),
        interrupt: () => {if (active && core === owner) {if (owner.getState() === 'running') owner.interrupt();else options.onExit?.();}},
      });
      changed();
    };
    replace();offEditor = owner.host.controllers.subscribe(kinds => {if (kinds.includes('editor')) replace();});
  }
  async function submit(text: string): Promise<void> {
    if (!active || !text.trim()) return;
    const name = text.trim().split(/\s+/)[0];
    if (reloadPromise) {
      const completed = await reloadPromise;
      if (!active || name === '/reload') return;
      if (!completed) throw Error('Plugin reload did not finish. Retry /reload before sending this request.');
    }
    if (reloadFailed && name !== '/reload') throw Error(retryMessage());
    if (name === '/chat') {layout.act({type: 'open', id: 'session'}); return;}
    if (name === '/windows') {navigation?.openFinder(); return;}
    if (name === '/placement') {const command=route(text);if(command)dispatch(command);else {layout.markWindowIntent();runOperation('@host', 'host:placement', arrange);}return;}
    if (name === '/reload') {pendingReload = true; reloadFailed = false; notice('Plugin reload queued until current operations finish'); await reloadIfReady(); return;}
    const command = route(text);
    if (command) {
      dispatch(command);
      return;
    }
    localNotice = undefined;
    try {await core.submit(text);}
    finally {await reloadIfReady();}
  }
  const initialChannels = createChannels();
  const initialCore = app.createCore(initialChannels.approve, initialChannels.ask);
  try {bind(initialCore, initialChannels);}
  catch (error) {initialChannels.generation.abort(); initialChannels.inbox.close(); void initialCore.close(); throw error;}
  layout.register({id: 'session', label: 'Main'});
  navigation = createWindowNavigation(layout, {windows: inventory, open: openNavigationWindow, onWindowIntent: layout.markWindowIntent});
  let lastFocus: string | undefined;
  offLayout = layout.subscribe(() => {
    reportVisibility();
    const focused = layout.snapshot().focused;
    if (!active || focused === lastFocus) return;
    lastFocus = focused;
    const site = focused === 'session' ? 'session' : surfaceMap.has(focused) ? focused : undefined;
    if (site) track(core.host.emit('ui.focus', {site}).catch(() => {}));
  });
  const session: ConversationSession = {
    get id() {return core.sessionId;}, paneId: 'session', label: 'Main',
    snapshot: () => sessionState,
    subscribe(fn) {sessionListeners.add(fn); return () => {sessionListeners.delete(fn);};},
    submit(text) {if (active) conversation.submit(text);}, isImmediateCommand: immediate,
    interrupt() {if (active) core.interrupt();},
    answerApproval(id, allow) {if (active) inbox.answer(id, allow);},
    answerInteraction(id, value) {if (active) inbox.answerInteraction(id, value);},
    cancelInteraction(id) {if (active) inbox.cancelInteraction(id);},
    controllerInput(id, input, revision) {
      if (active && navigation?.snapshot().mode === 'normal' && layout.snapshot().focused === 'session'
        && layout.snapshot().frames.some(frame => frame.surface === 'session'))return inbox.controllerInput(id, input, revision);
    },
    controllerViewport(id, columns, rows) {if (active)inbox.controllerViewport(id, columns, rows);},
    cancelController(id) {
      if (active && navigation?.snapshot().mode === 'normal' && layout.snapshot().focused === 'session')inbox.cancelController(id);
    },
    editorInput(id, input, revision) {
      const current = editor;
      if (active && current?.snapshot().id === id && navigation?.snapshot().mode === 'normal'
        && layout.snapshot().focused === 'session' && layout.snapshot().frames.some(frame => frame.surface === 'session'))
        return current?.input(input, revision);
    },
    editorViewport(id, columns, rows, maxRows) {const current = editor;if (active && current?.snapshot().id === id) current?.viewport(columns, rows, maxRows);},
  };
  return {
    session, surfaces, composerMedia, navigation, get core() {return core;}, submit,
    cancelOperation(surfaceId: string): boolean {
      if (!active) return false;
      let cancelled = false;
      for (const op of operations.values()) if (op.site === surfaceId || op.surface?.source.id === surfaceId) {
        const source = surfaceMap.get(op.site); if (source) changes.delete(source);
        op.controller.abort(); cancelled = true;
      }
      return cancelled;
    },
    async start() {if (!active || started) return; started = true; await core.start();},
    async close() {
      if (!active) return;
      active = false;
      navigation?.close();
      changes.clear();
      offLayout?.();
      for (const op of operations.values()) op.controller.abort();
      unbind();
      await reloadPromise;
      core.interrupt();
      await core.close();
      await Promise.allSettled([...pending]);
      for (const surface of [...surfaceMap.values()]) remove(surface);
      composerViews.clear(); mediaChanged(); mediaListeners.clear();
      registryListeners.clear(); sessionListeners.clear();
    },
  };
}
