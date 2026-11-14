/** @jsxImportSource @opentui/react */
import { MouseButton, RGBA, TextAttributes, type BoxRenderable, type KeyBinding, type MouseEvent, type OptimizedBuffer, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import { flushSync, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { color } from './colors.js';
import { Ghost, type ComposerMedia } from './ghost.js';
import { Interaction } from './interaction.js';
import { isWindowGestureCancelKey, windowActionForKey, type WindowFrame, type WindowLayoutAction, type WindowLayoutSource } from './layout.js';
import { Plugins, type PluginManagerSource } from './plugins.js';
import type { ConversationSession } from './session.js';
import {ApprovalCard} from './approval-card.js';
import { PluginTable, type PluginTableSource } from './table.js';
import {SurfaceView} from './surface-view.js';
import type {UiSurfaceRegistry,UiSurfaceSource} from './surface.js';
import {surfaceRequestStatus} from './surface.js';
import type {WindowNavigationSource,WindowNavigationSnapshot} from './navigation.js';
import {WindowFinder} from './navigation-view.js';
import {splitTargetLabel} from './split-target.js';
import {handleActionMouseDown} from './mouse-action.js';
import {ControllerFrame} from './controller-view.js';
import {controllerBlocksInput} from './controller.js';
import type {EditorInputOwnership} from './editor-ownership.js';
import {conversationInputWindow,groupConversationWindows,type ConversationWindowRegistry,type ConversationWindow} from './conversation-windows.js';
import {createConversationScrollMemory} from './conversation-scroll.js';

// Kitty clears its placement cells to the terminal background on each frame.
const composerBackground = RGBA.defaultBackground();
const composerForeground = RGBA.defaultForeground();
const targetForeground = RGBA.fromHex(color.running);
const targetBackground = RGBA.fromHex(color.background);

const editorKeys: KeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'j', ctrl: true, action: 'newline' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'z', ctrl: true, action: 'undo' },
  { name: 'y', ctrl: true, action: 'redo' },
  { name: 'z', ctrl: true, shift: true, action: 'redo' },
];

interface TabProps {
  label: string;
  index: number;
  selected: boolean;
  onSelect(): void;
  showShortcut?:boolean;
  id?:string;
}

function Tab({ label, index, selected, onSelect,showShortcut=true,id }: TabProps) {
  const shortcut = showShortcut&&index < 11 ? `F${index + 2} ` : '';
  return (
    <box
      id={id} paddingX={1} height={1} maxWidth="100%"
      backgroundColor={selected ? color.accent : color.panel}
      onMouseDown={event => {
        if (event.button === MouseButton.LEFT) onSelect();
      }}
    >
      <text selectable={false} truncate fg={selected ? color.background : color.text}
        attributes={selected ? TextAttributes.BOLD : TextAttributes.NONE}>
        {`${shortcut}${label}`}
      </text>
    </box>
  );
}

function useSessionSubscription(session: ConversationSession) {
  return useCallback((listener: () => void) => session.subscribe(listener), [session]);
}

function SessionTab({ session, label, ...tab }: Omit<TabProps, 'label'> & { session: ConversationSession;label?:string }) {
  const status = useSyncExternalStore(useSessionSubscription(session), () => {
    const { approval, interaction, controller, running } = session.snapshot();
    return controller ? ' · '+{approval:'Approval',question:'Question',form:'Form'}[controller.kind]
      : approval ? ' · Approval' : interaction ? interaction.kind === 'form' ? ' · Form' + (running ? ' · Running' : '') : ' · Question' : running ? ' · Running' : '';
  });
  return <Tab {...tab} label={(label??session.label) + status} />;
}

type ScrollMemory=ReturnType<typeof createConversationScrollMemory>;

function useConversationScroll(history:React.RefObject<ScrollBoxRenderable|null>,paneId:string,visible:boolean,epoch:string|number,memory:ScrollMemory){
  useLayoutEffect(()=>{
    const box=history.current;
    memory.reset(epoch);
    if(!box||!visible)return;
    const cancel=memory.restore(paneId,box);
    return()=>{cancel();if(!box.isDestroyed)memory.capture(paneId,box);};
  },[paneId,visible,epoch,memory]);
}

function TranscriptMessages({session}: {session:ConversationSession}){
  const state=useSyncExternalStore(useSessionSubscription(session),()=>session.snapshot());
  return <>
    {state.messages.length===0&&!state.error&&<text fg={color.muted}>No messages yet</text>}
    {state.messages.map((message,index)=><box key={index} flexShrink={0} flexDirection="column">
      <text attributes={TextAttributes.BOLD} fg={message.role==='user'?color.muted:color.accent}>{message.role==='user'?'You':session.label}</text>
      <text wrapMode="word" fg={color.text}>{message.text}</text>
    </box>)}
    {state.error&&<text wrapMode="word" fg={color.error}>{`Error: ${state.error}`}</text>}
  </>;
}

/** Inactive copies have their own history, without another editor or request controller. */
function ConversationCopy({window,visible,memory}: {window:ConversationWindow;visible:boolean;memory:ScrollMemory}){
  const history=useRef<ScrollBoxRenderable>(null),session=window.session;
  const state=useSyncExternalStore(useSessionSubscription(session),()=>session.snapshot());
  useConversationScroll(history,window.id,visible,session.generation??session.id,memory);
  const pending=state.controller?.kind??(state.approval?'approval':state.interaction?.kind);
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <scrollbox ref={history} flexGrow={1} flexBasis={0} minHeight={0} focusable={false} scrollX={false} scrollY
      stickyScroll stickyStart="bottom" contentOptions={{paddingX:1,paddingY:1,gap:1}}>
      <TranscriptMessages session={session}/>
    </scrollbox>
    {pending&&<text fg={color.running} truncate>{pending[0].toUpperCase()+pending.slice(1)+' pending · focus this window to answer'}</text>}
  </box>;
}

function Conversation({ selected, paneId, visible, scrollMemory, animations, composerMedia, focused, width, height, isActive, isVisible,editorOwnership }: {
  selected: ConversationSession;
  paneId:string;
  visible:boolean;
  scrollMemory:ScrollMemory;
  animations: boolean;
  composerMedia?: ComposerMedia;
  focused: boolean;
  width: number;
  height: number;
  isActive(): boolean;
  isVisible(): boolean;
  editorOwnership?:EditorInputOwnership;
}) {
  const state = useSyncExternalStore(useSessionSubscription(selected), () => selected.snapshot());
  const editor = useRef<TextareaRenderable>(null);
  const history = useRef<ScrollBoxRenderable>(null);
  const [inputMode, setInputMode] = useState<{id: string; epoch:string|number; editing: boolean}>();
  const [immediate, setImmediate] = useState(false);
  const [editorWidth,setEditorWidth]=useState(Math.max(1,width-2));
  const owner=useRef({});
  const currentInput=useRef({inputMode,isActive});
  currentInput.current={inputMode,isActive};
  const requestId=state.controller?.id??state.interaction?.id;
  const requestEpoch=selected.generation??selected.id;
  const editing = Boolean(requestId && inputMode?.id === requestId && inputMode.epoch===requestEpoch && inputMode.editing);
  useConversationScroll(history,paneId,visible&&!editing,selected.generation??selected.id,scrollMemory);
  const ownsEditor=()=>{
    const current=selected.snapshot(),request=current.controller?.id??current.interaction?.id;
    const mode=currentInput.current.inputMode;
    return selected.isCurrent?.()!==false&&Boolean(current.editor?.available)&&currentInput.current.isActive()
      &&!(request&&mode?.id===request&&mode.epoch===(selected.generation??selected.id)&&mode.editing);
  };
  useLayoutEffect(()=>editorOwnership?.register(owner.current,ownsEditor),[selected,editorOwnership]);
  useLayoutEffect(()=>editorOwnership?.refresh());
  const setEditing = (value: boolean) => {
    const current = selected.snapshot(),id=current.controller?.id??current.interaction?.id;
    if (id && isActive()) flushSync(() => setInputMode({id,epoch:requestEpoch,editing:value}));
  };
  const wide = width >= 60;
  const editorHeight = height >= 20 ? 4 : 2;
  const busy = state.running || controllerBlocksInput(state.controller) || Boolean(state.approval) || state.interaction?.kind === 'question';
  const canSend = !busy || immediate;
  const inputHint = state.controller ? 'Alt+I answer · Ctrl+J newline' : state.interaction ? 'Alt+I answer or draft · Ctrl+J newline' : state.approval ? 'PgUp/PgDn details · Ctrl+J newline' :
    busy ? 'Draft while running · Ctrl+J newline' : 'Enter send · Ctrl+J newline';
  const fullHint = state.controller ? `${inputHint} · Ctrl+C cancel request`
    : state.approval ? `${inputHint} · Ctrl+C quit` : `${inputHint} · PgUp/PgDn history · Ctrl+C quit`;
  const admission=state.editor?.admission?.status;
  const selectedHint=[state.interaction||state.controller?'Alt+I answer':'',
    admission==='rejected'?'Not sent · draft restored':admission==='queued'?'Queued':admission==='accepted'?'Accepted':'',
    'Alt+W w windows'].filter(Boolean).join(' · ');
  const customEditorMaxRows=Math.max(1,Math.floor(height/2)-1);
  const customEditorRows=Math.max(1,Math.min((state.editor?.preferredRows??1)+Number(Boolean(state.editor?.view.hint)),customEditorMaxRows));

  useLayoutEffect(() => {
    if (focused && state.approval) history.current?.scrollTo(Infinity);
  }, [focused, selected.id, state.approval?.id]);
  useLayoutEffect(()=>{
    if(state.editor?.scroll)history.current?.scrollBy(-state.editor.scroll.rows);
  },[selected.id,state.editor?.id,state.editor?.scroll?.revision]);

  useKeyboard(key => {
    if (key.defaultPrevented || !isActive()) return;
    if (key.meta && !key.ctrl && key.name === 'i') {
      key.preventDefault();
      if (!key.repeated && (selected.snapshot().interaction||selected.snapshot().controller)) setEditing(!editing);
      return;
    }
    if (key.ctrl && !key.meta && key.name === 'x' && selected.interrupt && selected.snapshot().running) {
      key.preventDefault();
      if (!key.repeated) flushSync(() => selected.interrupt?.());
      return;
    }
    if (!editing && !selected.snapshot().editor && !state.approval && (key.name === 'pageup' || key.name === 'pagedown')) {
      key.preventDefault();
      history.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport');
    }
  });

  function messageInput() {
    const input = editor.current;
    const current = selected.snapshot();
    if (!isActive() || editing || current.editor || !input) return;
    const text = input.plainText;
    if (!text.trim()) return;
    if ((current.running || controllerBlocksInput(current.controller) || current.approval || current.interaction?.kind === 'question') && !selected.isImmediateCommand?.(text)) return;
    return {input, text};
  }
  function send() {
    const pending = messageInput();
    if (!pending) return;
    const {input, text} = pending;
    if(selected.submit(text)===false)return;
    input.setText('');
    setImmediate(false);
    if (isActive()) input.focus();
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <scrollbox ref={history} visible={!editing} flexGrow={1} flexBasis={0} minHeight={0}
        focusable={false} scrollX={false} stickyScroll stickyStart="bottom"
        contentOptions={{ paddingX: 1, paddingY: state.approval ? 0 : 1, gap: 1 }}>
        <TranscriptMessages session={selected}/>
      </scrollbox>

      {!editing && state.notice && <text fg={color.muted} wrapMode="word">{state.notice}</text>}
      {state.controller&&<ControllerFrame key={requestEpoch+':'+state.controller.id} controller={state.controller} session={selected} main
        width={width} height={editing?Math.max(1,height-1):Math.max(1,Math.min(state.controller.preferredRows+Number(Boolean(state.controller.view.hint)),Math.floor(height/2)))}
        maxRows={editing?Math.max(1,height-1):Math.max(1,Math.floor(height/2))} focused={focused&&editing}
        isActive={()=>isActive()&&editing} isVisible={isVisible}/>}
      {state.interaction && <Interaction key={requestEpoch+':'+state.interaction.id} interaction={state.interaction}
        session={selected} editing={editing} focused={focused} width={width} height={height} isActive={isActive} setEditing={setEditing} />}
      {!focused && state.approval && <text fg={color.running}>Approval pending</text>}
      {state.approval&&<box visible={focused} flexShrink={0}>
        <ApprovalCard key={requestEpoch+':'+state.approval.id} request={state.approval} session={selected} height={height} isActive={isActive}/>
      </box>}
      <box visible={!editing&&!state.editor} border={['top']} borderColor={color.rule} titleColor={state.running ? color.running : color.accent}
        title={` ${selected.label} · ${state.approval||controllerBlocksInput(state.controller) ? 'Draft' : state.running ? 'Running' : 'Ready'} `}
        backgroundColor={composerBackground} flexShrink={0} flexDirection="row" paddingX={1} gap={1}>
        <textarea ref={editor} focused={focused && !editing && !state.editor}
            height={editorHeight} flexGrow={1} flexBasis={0} minWidth={1} wrapMode="word"
            textColor={composerForeground} focusedTextColor={composerForeground} cursorColor={composerForeground}
            placeholder={`Message ${selected.label}…`} placeholderColor={color.muted}
            onKeyDown={key => { if (!isActive() || editing || selected.snapshot().editor) key.preventDefault(); }}
            onPaste={event => { if (!isActive() || editing || selected.snapshot().editor) event.preventDefault(); }}
            onContentChange={() => setImmediate(Boolean(selected.isImmediateCommand?.(editor.current?.plainText ?? '')))}
            keyBindings={editorKeys} onSubmit={send} />
        <Ghost media={composerMedia} enabled={!editing && focused && animations && wide && height >= 20} active={state.running} />
        {focused && <box height={1} paddingX={1} backgroundColor={canSend ? color.accent : color.panel}
          onMouseDown={event => {
            handleActionMouseDown(event, Boolean(messageInput()), send);
          }}>
          <text selectable={false} fg={canSend ? color.background : color.muted}
            attributes={TextAttributes.BOLD}>Send</text>
        </box>}
      </box>
      {state.editor&&<box visible={!editing} border={['top']} borderColor={color.rule}
        titleColor={state.running?color.running:color.accent}
        title={` ${selected.label} · ${state.running?'Running':'Ready'} `}
        flexShrink={0} flexDirection="row" paddingX={1} gap={1}>
        <box flexGrow={1} flexBasis={0} minWidth={1} height={customEditorRows}
          onSizeChange={function(this:BoxRenderable){if(this.width>0)setEditorWidth(this.width);}}>
          <ControllerFrame key={state.editor.id} controller={state.editor} session={selected} main
            width={editorWidth} height={customEditorRows} maxRows={customEditorMaxRows}
            focused={focused&&!editing&&state.editor.available} isActive={ownsEditor}
            isVisible={()=>!editing&&isVisible()}/>
        </box>
        <Ghost media={composerMedia} enabled={!editing&&focused&&animations&&wide&&height>=20} active={state.running}/>
      </box>}
      {focused && <box flexDirection="row" columnGap={1} height={1}>
        <text flexGrow={1} truncate fg={color.muted}>{editing ? 'Alt+I draft' + (state.controller?' · Ctrl+C cancel request':'') + (state.running && selected.interrupt ? ' · Ctrl+X stop agent' : '') : state.editor?selectedHint:width >= fullHint.length + 2 ? fullHint : inputHint}</text>
        {state.controller&&<box height={1} paddingX={1} backgroundColor={color.panel} onMouseDown={event=>{
          handleActionMouseDown(event,isActive()&&selected.snapshot().controller?.id===state.controller?.id,()=>setEditing(!editing));
        }}><text selectable={false} fg={color.accent}>{editing?'Draft':'Answer'}</text></box>}
        {state.running && selected.interrupt && <box height={1} paddingX={1} backgroundColor={color.panel} onMouseDown={event => {
          handleActionMouseDown(event, isActive() && selected.snapshot().running && !!selected.interrupt,
            () => flushSync(() => selected.interrupt?.()));
        }}><text selectable={false} fg={color.running}>Stop</text></box>}
      </box>}
    </box>
  );
}

interface Pane {
  id: string;
  label: string;
  session?: ConversationSession;
  surface?:UiSurfaceSource;
}

function Tile({ pane, frame, focused, drop, children }: {
  pane: Pane;
  frame?: WindowFrame;
  focused: boolean;
  drop?: string;
  children(width: number, height: number): React.ReactNode;
}) {
  return <box visible={Boolean(frame)} position="absolute" left={frame?.x ?? 0} top={frame?.y ?? 0}
    width={frame?.width ?? 1} height={frame?.height ?? 1} minWidth={0} minHeight={0}
    flexDirection="column" border backgroundColor={color.background}
    borderColor={drop ? color.running : focused ? color.accent : color.rule}
    title={' ' + pane.label + (drop ? ' · drop ' + drop + ' ' : focused ? ' · focused ' : ' ')}
    titleColor={drop ? color.running : focused ? color.accent : color.muted}>
    {children(Math.max(1, (frame?.width ?? 3) - 2), Math.max(1, (frame?.height ?? 3) - 2))}
  </box>;
}

const controlLabels = ['Focus', 'Split', 'Swap', 'Zoom', 'Close'] as const;
const controls = ['cycle', 'orient', 'swap', 'zoom', 'close'] as const;

const noSurfaces:readonly UiSurfaceSource[]=[];
const emptyRegistry:UiSurfaceRegistry={snapshot:()=>noSurfaces,subscribe:()=>()=>{}};
const normalNavigation:WindowNavigationSnapshot={revision:0,mode:'normal',query:'',entries:[]};
const emptyNavigation:Pick<WindowNavigationSource,'snapshot'|'subscribe'>={snapshot:()=>normalNavigation,subscribe:()=>()=>{}};
const noConversationWindows:readonly ConversationWindow[]=[];
const emptyConversationWindows:ConversationWindowRegistry={snapshot:()=>noConversationWindows,subscribe:()=>()=>{}};

function SurfaceTab({source,...tab}:Omit<TabProps,'label'>&{source:UiSurfaceSource}){
  const state=useSyncExternalStore(source.subscribe,source.snapshot);
  const status=surfaceRequestStatus(state);
  return <Tab {...tab} label={state.title+(status?' · '+status:'')} />;
}

export function ConversationView({ sessions, animations = true, composerMedia, workflowTable, pluginManager, windowLayout, surfaces=emptyRegistry,navigation,editorOwnership,conversationWindows }: {
  sessions: ConversationSession[];
  animations?: boolean;
  composerMedia?: ComposerMedia;
  workflowTable?: PluginTableSource;
  pluginManager?: PluginManagerSource;
  windowLayout: WindowLayoutSource;
  surfaces?:UiSurfaceRegistry;
  navigation?:WindowNavigationSource;
  editorOwnership?:EditorInputOwnership;
  conversationWindows?:ConversationWindowRegistry;
}) {
  const editorOwns=useSyncExternalStore(editorOwnership?.subscribe??(()=>()=>{}),editorOwnership?.snapshot??(()=>false));
  const navigationState=useSyncExternalStore((navigation??emptyNavigation).subscribe,(navigation??emptyNavigation).snapshot);
  const published=useSyncExternalStore(surfaces.subscribe,surfaces.snapshot);
  const declaredWindows=useSyncExternalStore((conversationWindows??emptyConversationWindows).subscribe,(conversationWindows??emptyConversationWindows).snapshot);
  const windows:readonly ConversationWindow[]=conversationWindows?declaredWindows:sessions.map(session=>({id:session.paneId??'session:'+session.id,label:session.label,session}));
  const groups=groupConversationWindows(windows);
  const panes:Pane[]=windows.map(window=>({id:window.id,label:window.label,session:window.session}));
  if (workflowTable) panes.push({ id: 'workflows', label: 'Workflows' });
  if (pluginManager) panes.push({ id: 'plugins', label: 'Plugins' });
  for(const surface of published)if(!panes.some(pane=>pane.id===surface.id))
    panes.push({id:surface.id,label:surface.snapshot().title,surface});
  const layout = useSyncExternalStore(windowLayout.subscribe, windowLayout.snapshot);
  const inputWindows=useRef(new Map<string,string>());
  const histories=useRef(new Map<string,ScrollMemory>());
  const residences=groups.map(group=>{
    const window=conversationInputWindow(group,layout.focused,inputWindows.current.get(group.id));
    inputWindows.current.set(group.id,window.id);
    let memory=histories.current.get(group.id);
    if(!memory){memory=createConversationScrollMemory();histories.current.set(group.id,memory);}
    return{id:group.id,window,memory,frame:layout.frames.find(frame=>frame.surface===window.id)};
  });
  const residentByPane=new Map(residences.map(residence=>[residence.window.id,residence]));
  useLayoutEffect(()=>{
    const current=new Set(groups.map(group=>group.id));
    for(const[id,memory]of histories.current)if(!current.has(id)){
      memory.reset(Symbol('removed conversation'));histories.current.delete(id);inputWindows.current.delete(id);
    }
  });
  const renderer = useRenderer();
  const viewport = useRef<BoxRenderable>(null);
  const tabStrip=useRef<ScrollBoxRenderable>(null);
  const workspaceButtons = useRef(new Map<number, BoxRenderable>());
  const nativeGestureHeld = useRef(false);
  const normalPointerUp = useRef(false);
  const { width, height } = useTerminalDimensions();
  const controlStart = Math.max(6, panes.length + 2);
  // Commit native widget focus before the parser delivers the next key in a batch.
  const act = useCallback((action: WindowLayoutAction) => {
    if(navigation?.snapshot().mode==='finder')return;
    flushSync(() => windowLayout.act(action));
  }, [windowLayout,navigation]);
  useLayoutEffect(()=>{
    if(navigation)tabStrip.current?.scrollChildIntoView('window-tab-'+layout.focused);
  },[navigation,layout.workspace,layout.focused,published.length]);
  useLayoutEffect(() => windowLayout.subscribe(() => {
    if (windowLayout.snapshot().gesture) {nativeGestureHeld.current = true; return;}
    if (!nativeGestureHeld.current) return;
    nativeGestureHeld.current = false;
    if (normalPointerUp.current || !renderer.useMouse) return;
    // Keyboard and viewport cancellation may have no matching native mouse-up.
    // Cycling the public mode releases SDK capture and preserves its motion mode.
    renderer.useMouse = false;
    renderer.useMouse = true;
    renderer.requestRender();
  }), [renderer, windowLayout]);
  useLayoutEffect(() => {
    renderer.setMousePointer(layout.pointer);
  }, [renderer, layout.pointer]);
  useLayoutEffect(() => () => { renderer.setMousePointer('default'); }, [renderer]);
  const measure = useCallback(function (this: BoxRenderable) {
    if (this.width > 0 && this.height > 0) windowLayout.resize(this.width, this.height);
  }, [windowLayout]);
  useLayoutEffect(() => {
    if (!navigation) return;
    const paintSplit = (buffer: OptimizedBuffer) => {
      const current = windowLayout.snapshot(), bounds = viewport.current;
      const target = current.splitTarget, divider = target?.divider;
      if (navigation.snapshot().mode !== 'arrange' || current.gesture || !bounds
        || target?.visibility !== 'visible' || !divider) return;
      const x = Math.max(0, divider.x), y = Math.max(0, divider.y);
      // The final frame pass follows all native child composition. Reuse an
      // existing border cell, preserving titles and native mouse hit testing.
      if (target.axis === 'horizontal' && x < bounds.width) {
        const end = Math.min(bounds.height, divider.y + divider.height);
        for (let row = y; row < end; row++)
          buffer.drawText('┃', bounds.x + x, bounds.y + row, targetForeground, targetBackground, TextAttributes.BOLD);
      } else if (target.axis === 'vertical' && y < bounds.height) {
        const length = Math.min(bounds.width, divider.x + divider.width) - x;
        if (length > 0) buffer.drawText('━'.repeat(length), bounds.x + x, bounds.y + y, targetForeground, targetBackground, TextAttributes.BOLD);
      }
    };
    renderer.addPostProcessFn(paintSplit);
    renderer.requestRender();
    return () => renderer.removePostProcessFn(paintSplit);
  }, [renderer, windowLayout, navigation]);
  useLayoutEffect(() => {
    const bounds = viewport.current;
    if (bounds && bounds.width > 0 && bounds.height > 0) windowLayout.resize(bounds.width, bounds.height);
  }, [windowLayout, width, height]);

  useKeyboard(key => {
    if(key.defaultPrevented||navigation)return;
    if (windowLayout.snapshot().gesture && isWindowGestureCancelKey(key)) {
      key.preventDefault();
      act({type: 'pointer', phase: 'cancel', x: 0, y: 0});
      return;
    }
    const action = windowActionForKey(key, panes.map(pane => pane.id));
    if (!action) return;
    key.preventDefault();
    if (!key.repeated || action.type === 'resize' || action.type === 'direction') act(action);
  });

  function pointer(phase: 'down' | 'move' | 'up', event: MouseEvent) {
    if(navigation?.snapshot().mode==='finder')return;
    const bounds = viewport.current;
    if (!bounds || (phase !== 'move' && event.button !== MouseButton.LEFT)) return;
    const state = windowLayout.snapshot();
    const x = event.x - bounds.x, y = event.y - bounds.y;
    const frame = state.frames.find(frame => x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height);
    const workspace = phase === 'up' ? [...workspaceButtons.current].find(([, button]) =>
      event.x >= button.x && event.x < button.x + button.width && event.y >= button.y && event.y < button.y + button.height)?.[0] : undefined;
    normalPointerUp.current = phase === 'up';
    try {
      act({type: 'pointer', phase, x, y,
        ...(phase === 'down' ? {kind: frame && y === frame.y ? 'title' : 'pane', revision: state.revision} : {}),
        ...(workspace ? {workspace} : {}),
      });
    } finally {normalPointerUp.current = false;}
    if (state.gesture || windowLayout.snapshot().gesture) event.preventDefault();
  }

  function layoutButton(label: string, action: WindowLayoutAction) {
    return <box key={label} height={1} onMouseDown={event => {
      if (event.button === MouseButton.LEFT) act(action);
    }}>
      <text selectable={false} fg={color.muted}>{label}</text>
    </box>;
  }
  function navigationButton(label:string,active:boolean,run:()=>void){
    return <box height={1} paddingX={1} backgroundColor={active?color.accent:color.panel}
      onMouseDown={event=>{if(event.button===MouseButton.LEFT)flushSync(run);}}>
      <text selectable={false} fg={active?color.background:color.text}>{label}</text>
    </box>;
  }
  const stripPanes=navigation?panes.filter(pane=>layout.locations[pane.id]===layout.workspace):panes;
  const occupied=new Set(Object.values(layout.locations));
  const workspaceStatus=layout.error??navigationState.error??(layout.gesture?'Drag · Esc cancel':layout.saving?'Saving layout…':navigation
    ?width>=48?`WS ${layout.workspace}${layout.fullscreen?' · Zoomed':''} · ${navigationState.focusedLabel??'Empty workspace'}`:layout.fullscreen?'Zoomed':'* open':'');
  const workspaceBar=<box flexDirection="row" columnGap={navigation?0:1} height={1} flexShrink={0} paddingX={1}>
    <text fg={color.muted} width={navigation?3:undefined} flexShrink={0} wrapMode="none">{navigation?'WS ':'WS'}</text>
    {layout.workspaces.map(id=>{
      const selected=id===layout.workspace,hasWindows=occupied.has(id);
      return <box key={id} height={1} width={navigation?3:undefined} flexShrink={0}
        paddingLeft={navigation?1:undefined} paddingX={navigation?undefined:1}
        ref={button=>{if(button)workspaceButtons.current.set(id,button);else workspaceButtons.current.delete(id);}}
        backgroundColor={selected?color.accent:navigation&&hasWindows?color.panel:undefined}
        onMouseDown={event=>{
          if(event.button===MouseButton.LEFT&&!windowLayout.snapshot().gesture)act({type:'workspace',id});
        }}>
        <text selectable={false} attributes={selected||navigation&&hasWindows?TextAttributes.BOLD:TextAttributes.NONE}
          fg={selected?color.background:navigation&&hasWindows?color.text:color.muted}>
          {String(id)+(navigation?(hasWindows?'*':' '):'')}
        </text>
      </box>;
    })}
    <text flexGrow={1} flexBasis={0} minWidth={0} height={1} wrapMode="none" truncate fg={layout.error||navigationState.error?color.error:color.muted}>{workspaceStatus}</text>
  </box>;
  const tabs=stripPanes.map((pane,index)=>{
    const props={index,id:'window-tab-'+pane.id,showShortcut:!navigation,
      selected:layout.focused===pane.id&&layout.locations[pane.id]===layout.workspace,
      onSelect:()=>act({type:'open',id:pane.id})};
    return pane.session?<SessionTab key={pane.id} session={pane.session} label={pane.label} {...props}/>
      :pane.surface?<SurfaceTab key={pane.id} source={pane.surface} {...props}/>
      :<Tab key={pane.id} label={pane.label} {...props}/>;
  });
  return <box width="100%" height="100%" backgroundColor={color.background} flexDirection="column">
    {navigation&&workspaceBar}
    {navigation&&<box flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1} flexShrink={0}>
      {navigationButton(width>=42?(navigationState.mode==='arrange'?'Alt+W Type':'Alt+W Arrange'):(navigationState.mode==='arrange'?'Type':'Arrange'),navigationState.mode==='arrange',()=>navigation.toggleArrange())}
      {navigationButton(width>=42?(editorOwns?'Alt+W w Windows':'F2 Windows'):'Windows',navigationState.mode==='finder',()=>navigation.openFinder())}
      {navigationButton(width>=42?'Alt+0 Main':'Main',false,()=>{navigation.handle({kind:'key',key:'0',modifiers:['alt']});})}
    </box>}
    {navigation?<scrollbox ref={tabStrip} height={1} flexShrink={0} scrollX scrollY={false} focusable={false}
      horizontalScrollbarOptions={{visible:false}}
      contentOptions={{flexDirection:'row',columnGap:1}}>{tabs.length?tabs:<text fg={color.muted}>No open windows · F2 Windows</text>}</scrollbox>
      :<box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>{tabs}</box>}
    {!navigation&&workspaceBar}
    <box ref={viewport} onSizeChange={measure} flexBasis={0} flexGrow={1} minHeight={0} minWidth={0}
      onMouseDown={event => pointer('down', event)} onMouseMove={event => pointer('move', event)}
      onMouseDrag={event => pointer('move', event)} onMouseUp={event => pointer('up', event)}
      onMouseOut={event => pointer('move', event)}>
      {/* Window histories stay separate; one resident native input owner serves every copy of a conversation. */}
      {panes.map(pane => {
        const frame = layout.frames.find(frame => frame.surface === pane.id);
        const focused = Boolean(frame) && layout.focused === pane.id && !layout.gesture&&navigationState.mode==='normal';
        // The host can change focus before React has committed the next widget tree.
        const isVisible = () => {
          const current = windowLayout.snapshot();
          return (!navigation||navigation.snapshot().mode==='normal')&&!current.gesture&&current.frames.some(frame=>frame.surface===pane.id);
        };
        const isActive = () => windowLayout.snapshot().focused === pane.id && isVisible();
        return <Tile key={pane.id} pane={pane} frame={frame}
          focused={Boolean(frame)&&layout.focused===pane.id&&!layout.gesture&&navigationState.mode!=='finder'}
          drop={layout.drop?.surface === pane.id ? layout.drop.edge : undefined}>
          {(width, height) => pane.session
            ? residentByPane.has(pane.id)||!frame?null:<ConversationCopy window={{id:pane.id,label:pane.label,session:pane.session}}
                visible memory={histories.current.get(pane.session.conversationId??pane.session.id)!}/>
            :pane.surface?<SurfaceView source={pane.surface} focused={focused} width={width} height={height}
              isActive={isActive} isVisible={isVisible}/>
            : pane.id === 'workflows' && workflowTable
              ? <PluginTable source={workflowTable} width={width} focused={focused} isActive={isActive} isVisible={isVisible} />
              : pluginManager && <Plugins source={pluginManager} visible={Boolean(frame)} focused={focused}
                  width={width} height={height} isActive={isActive} isVisible={isVisible} />}
        </Tile>;
      })}
      {residences.map(({id,window,memory,frame})=>{
        const isVisible=()=>{
          const current=windowLayout.snapshot();
          return (!navigation||navigation.snapshot().mode==='normal')&&!current.gesture
            &&window.session.isCurrent?.()!==false&&inputWindows.current.get(id)===window.id&&current.frames.some(frame=>frame.surface===window.id);
        };
        const isActive=()=>windowLayout.snapshot().focused===window.id&&isVisible();
        // A newly created opaque Tile can be registered after this retained
        // subtree. Keep the input above tile backgrounds and below the Finder.
        return <box key={'conversation-input:'+id} visible={Boolean(frame)} position="absolute" zIndex={1}
          left={(frame?.x??0)+1} top={(frame?.y??0)+1} width={Math.max(1,(frame?.width??3)-2)} height={Math.max(1,(frame?.height??3)-2)}
          backgroundColor={color.background} flexDirection="column" minHeight={0} minWidth={0}>
          <Conversation selected={window.session} paneId={window.id} visible={Boolean(frame)} scrollMemory={memory}
            animations={animations} composerMedia={composerMedia} focused={Boolean(frame)&&layout.focused===window.id&&!layout.gesture&&navigationState.mode==='normal'}
            width={Math.max(1,(frame?.width??3)-2)} height={Math.max(1,(frame?.height??3)-2)} isActive={isActive} isVisible={isVisible} editorOwnership={editorOwnership}/>
        </box>;
      })}
      {!layout.frames.length&&<text fg={color.muted}>{navigation?'Empty workspace · F2 Windows opens or restores a window':'Empty workspace · open a pane above'}</text>}
      {navigation&&navigationState.mode==='finder'&&<box position="absolute" left={0} top={0} width={layout.width} height={layout.height} zIndex={100}
        onMouseDown={event=>{event.preventDefault();event.stopPropagation();}}
        onMouseUp={event=>event.stopPropagation()} onMouseMove={event=>event.stopPropagation()} onMouseDrag={event=>event.stopPropagation()}>
        <WindowFinder source={navigation} width={layout.width} height={layout.height}/>
      </box>}
    </box>
    {navigation?<box flexDirection="column" paddingX={1} flexShrink={0}>
      {navigationState.mode==='arrange'?<>
        <text height={1} wrapMode="none" fg={color.accent} attributes={TextAttributes.BOLD} truncate>{'WINDOW MODE · '+(layout.fullscreen?'Zoomed':'Tiled')+' · '+(navigationState.focusedLabel??'Empty workspace')}</text>
        <text height={1} wrapMode="none" fg={color.running} truncate>{layout.gesture
          ? (layout.gesture === 'resize' ? 'Mouse resize · Esc cancel' : 'Move window · Esc cancel')
          : splitTargetLabel(layout, width)}</text>
        <text height={1} wrapMode="none" fg={color.text} truncate>{width>=176?'hjkl focus · Shift swap · Ctrl+arrows edge · b/v split · +/− size · f zoom · q close · n Main · t Tools · ? Help · 1–9 workspace · w windows · i type · Esc exit':width>=140?'Esc exit · i type · n Main · t Tools · ? Help · hjkl focus · Shift swap · Ctrl+arrows edge · b/v split · +/− size':width>=88?'Esc exit · i type · hjkl focus · Shift swap · Ctrl+arrows edge · n Main':width>=48?'Esc exit · i type · n new · Ctrl+arrows edge':'Esc exit · i type · n new Main'}</text>
      </>:<text height={1} wrapMode="none" fg={color.muted} truncate>{navigationState.mode==='finder'?'WINDOWS · Esc cancel':layout.fullscreen&&width<60?'Zoomed · Alt+W f tiles':(layout.fullscreen?'Zoomed · Alt+W f tiles · ':'')+`Alt+W Arrange · ${editorOwns?'Alt+W w Windows':'F2 Windows'} · Alt+0 Main`+(width>=88?' · Alt+Tab cycle · Alt+arrows focus · Alt+1…9 workspace':'')}</text>}
    </box>:<box flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1} flexShrink={0}>
      {controls.map((type, index) => layoutButton('F' + (controlStart + index) + ' ' +
        (type === 'zoom' && layout.fullscreen ? 'Unzoom' : controlLabels[index]), { type }))}
      {width >= 88 && <>
        <text fg={color.rule}>│</text>
        <text fg={color.muted}>{layout.axis === 'horizontal' ? 'Columns' : 'Rows'}</text>
        {layoutButton('−', { type: 'resize', delta: -.05 })}
        {layoutButton('+', { type: 'resize', delta: .05 })}
        <text fg={color.muted}>Alt+←/→ resize</text>
      </>}
    </box>}
  </box>;
}
