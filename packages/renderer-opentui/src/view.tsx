/** @jsxImportSource @opentui/react */
import { MouseButton, RGBA, TextAttributes, type BoxRenderable, type KeyBinding, type MouseEvent, type OptimizedBuffer, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import { flushSync, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { color } from './colors.js';
import { Ghost, type ComposerMedia } from './ghost.js';
import { Interaction } from './interaction.js';
import { isWindowGestureCancelKey, windowActionForKey, type WindowFrame, type WindowLayoutAction, type WindowLayoutSource } from './layout.js';
import { Plugins, type PluginManagerSource } from './plugins.js';
import type { ConversationApproval, ConversationSession } from './session.js';
import { PluginTable, type PluginTableSource } from './table.js';
import {SurfaceView} from './surface-view.js';
import type {UiSurfaceRegistry,UiSurfaceSource} from './surface.js';
import type {WindowNavigationSource,WindowNavigationSnapshot} from './navigation.js';
import {WindowFinder} from './navigation-view.js';
import {splitTargetLabel} from './split-target.js';

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

function SessionTab({ session, ...tab }: Omit<TabProps, 'label'> & { session: ConversationSession }) {
  const status = useSyncExternalStore(useSessionSubscription(session), () => {
    const { approval, interaction, running } = session.snapshot();
    return approval ? ' · Approval' : interaction ? interaction.kind === 'form' ? ' · Form' + (running ? ' · Running' : '') : ' · Question' : running ? ' · Running' : '';
  });
  return <Tab {...tab} label={session.label + status} />;
}

// Keep control and bidirectional formatting characters visible in the action being reviewed.
function approvalText(value: string) {
  return value.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu, char =>
    '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

const approvalActions = [
  { key: 'y', label: 'Alt+Y Allow once', allow: true },
  { key: 'n', label: 'Alt+N Deny', allow: false },
] as const;

function ApprovalCard({ request, session, height, isActive }: {
  request: ConversationApproval;
  session: ConversationSession;
  height: number;
  isActive(): boolean;
}) {
  const scroller = useRef<ScrollBoxRenderable>(null);
  useKeyboard(key => {
    if (key.defaultPrevented || !isActive()) return;
    if (key.name === 'pageup' || key.name === 'pagedown') {
      key.preventDefault();
      scroller.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport');
      return;
    }
    if (!key.meta || key.ctrl || key.shift || key.super || key.hyper) return;
    const action = approvalActions.find(action => action.key === key.name);
    if (!action || !session.answerApproval) return;
    key.preventDefault();
    if (!key.repeated) session.answerApproval(request.id, action.allow);
  });
  return (
    <box flexDirection="column" flexShrink={0} paddingX={1} border borderColor={color.running}
      backgroundColor={color.panel} title=" Approval required " titleColor={color.running}>
      <scrollbox ref={scroller} maxHeight={Math.max(1, Math.min(12, Math.floor(height / 3)))}
        focusable={false} scrollX={false} scrollY contentOptions={{ minHeight: 0 }}>
        <text wrapMode="word" fg={color.text} attributes={TextAttributes.BOLD}>{`Tool: ${approvalText(request.tool)}`}</text>
        {request.reason && <text wrapMode="word" fg={color.text}>{`Reason: ${approvalText(request.reason)}`}</text>}
        {request.details.map(({ label, value }, index) =>
          <text key={index} wrapMode="word" fg={color.text}>{`${approvalText(label)}: ${approvalText(value)}`}</text>
        )}
      </scrollbox>
      <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
        {session.answerApproval ? approvalActions.map(action => (
          <box key={action.key} height={1} paddingX={1} backgroundColor={color.rule} onMouseDown={event => {
            if (event.button === MouseButton.LEFT && isActive()) session.answerApproval?.(request.id, action.allow);
          }}>
            <text selectable={false} fg={color.text} attributes={TextAttributes.BOLD}>{action.label}</text>
          </box>
        )) : <text fg={color.muted}>Waiting for host decision</text>}
      </box>
    </box>
  );
}

function Conversation({ selected, animations, composerMedia, focused, width, height, isActive }: {
  selected: ConversationSession;
  animations: boolean;
  composerMedia?: ComposerMedia;
  focused: boolean;
  width: number;
  height: number;
  isActive(): boolean;
}) {
  const state = useSyncExternalStore(useSessionSubscription(selected), () => selected.snapshot());
  const editor = useRef<TextareaRenderable>(null);
  const history = useRef<ScrollBoxRenderable>(null);
  const [inputMode, setInputMode] = useState<{id: string; editing: boolean}>();
  const [immediate, setImmediate] = useState(false);
  const editing = Boolean(state.interaction && inputMode?.id === state.interaction.id && inputMode.editing);
  const setEditing = (value: boolean) => {
    const interaction = selected.snapshot().interaction;
    if (interaction && isActive()) flushSync(() => setInputMode({id: interaction.id, editing: value}));
  };
  const wide = width >= 60;
  const editorHeight = height >= 20 ? 4 : 2;
  const busy = state.running || Boolean(state.approval) || state.interaction?.kind === 'question';
  const canSend = !busy || immediate;
  const inputHint = state.interaction ? 'Alt+I answer or draft · Ctrl+J newline' : state.approval ? 'PgUp/PgDn details · Ctrl+J newline' :
    busy ? 'Draft while running · Ctrl+J newline' : 'Enter send · Ctrl+J newline';
  const fullHint = state.approval ? `${inputHint} · Ctrl+C quit` : `${inputHint} · PgUp/PgDn history · Ctrl+C quit`;

  useLayoutEffect(() => {
    if (focused && state.approval) history.current?.scrollTo(Infinity);
  }, [focused, selected.id, state.approval?.id]);

  useKeyboard(key => {
    if (key.defaultPrevented || !isActive()) return;
    if (key.meta && !key.ctrl && key.name === 'i') {
      key.preventDefault();
      if (!key.repeated && selected.snapshot().interaction) setEditing(!editing);
      return;
    }
    if (key.ctrl && !key.meta && key.name === 'x' && selected.interrupt && selected.snapshot().running) {
      key.preventDefault();
      if (!key.repeated) flushSync(() => selected.interrupt?.());
      return;
    }
    if (!editing && !state.approval && (key.name === 'pageup' || key.name === 'pagedown')) {
      key.preventDefault();
      history.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport');
    }
  });

  function send() {
    const input = editor.current;
    const current = selected.snapshot();
    if (!isActive() || editing || !input) return;
    const text = input.plainText;
    if (!text.trim()) return;
    if ((current.running || current.approval || current.interaction?.kind === 'question') && !selected.isImmediateCommand?.(text)) return;
    selected.submit(text);
    input.setText('');
    setImmediate(false);
    input.focus();
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <scrollbox ref={history} visible={!editing} flexGrow={1} flexBasis={0} minHeight={0}
        focusable={false} scrollX={false} stickyScroll stickyStart="bottom"
        contentOptions={{ paddingX: 1, paddingY: state.approval ? 0 : 1, gap: 1 }}>
        {state.messages.length === 0 && !state.error && <text fg={color.muted}>No messages yet</text>}
        {state.messages.map((message, index) => (
          <box key={index} flexShrink={0} flexDirection="column">
            <text attributes={TextAttributes.BOLD} fg={message.role === 'user' ? color.muted : color.accent}>
              {message.role === 'user' ? 'You' : selected.label}
            </text>
            <text wrapMode="word" fg={color.text}>{message.text}</text>
          </box>
        ))}
        {state.error && <text wrapMode="word" fg={color.error}>{`Error: ${state.error}`}</text>}
      </scrollbox>

      {!editing && state.notice && <text fg={color.muted} wrapMode="word">{state.notice}</text>}
      {state.interaction && <Interaction key={state.interaction.id} interaction={state.interaction}
        session={selected} editing={editing} focused={focused} width={width} height={height} isActive={isActive} setEditing={setEditing} />}
      {!focused && state.approval && <text fg={color.running}>Approval pending</text>}
      {focused && state.approval && <ApprovalCard key={`${selected.id}:${state.approval.id}`}
        request={state.approval} session={selected} height={height} isActive={isActive} />}
      <box visible={!editing} border={['top']} borderColor={color.rule} titleColor={state.running ? color.running : color.accent}
        title={` ${selected.label} · ${state.approval ? 'Draft' : state.running ? 'Running' : 'Ready'} `}
        backgroundColor={composerBackground} flexShrink={0} flexDirection="row" paddingX={1} gap={1}>
        <textarea ref={editor} focused={focused && !editing}
            height={editorHeight} flexGrow={1} flexBasis={0} minWidth={1} wrapMode="word"
            textColor={composerForeground} focusedTextColor={composerForeground} cursorColor={composerForeground}
            placeholder={`Message ${selected.label}…`} placeholderColor={color.muted}
            onKeyDown={key => { if (!isActive() || editing) key.preventDefault(); }}
            onPaste={event => { if (!isActive() || editing) event.preventDefault(); }}
            onContentChange={() => setImmediate(Boolean(selected.isImmediateCommand?.(editor.current?.plainText ?? '')))}
            keyBindings={editorKeys} onSubmit={send} />
        <Ghost media={composerMedia} enabled={!editing && focused && animations && wide && height >= 20} active={state.running} />
        {focused && <box height={1} paddingX={1} backgroundColor={canSend ? color.accent : color.panel}
          onMouseDown={event => {
            if (event.button === MouseButton.LEFT) send();
          }}>
          <text selectable={false} fg={canSend ? color.background : color.muted}
            attributes={TextAttributes.BOLD}>Send</text>
        </box>}
      </box>
      {focused && <box flexDirection="row" columnGap={1} height={1}>
        <text flexGrow={1} truncate fg={color.muted}>{editing ? 'Alt+I draft' + (state.running && selected.interrupt ? ' · Ctrl+X stop agent' : '') : width >= fullHint.length + 2 ? fullHint : inputHint}</text>
        {state.running && selected.interrupt && <box height={1} paddingX={1} backgroundColor={color.panel} onMouseDown={event => {
          if (event.button === MouseButton.LEFT && isActive()) flushSync(() => selected.interrupt?.());
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

function SurfaceTab({source,...tab}:Omit<TabProps,'label'>&{source:UiSurfaceSource}){
  const state=useSyncExternalStore(source.subscribe,source.snapshot);
  return <Tab {...tab} label={state.title+(state.form?' · Form':state.busy?' · Working':'')} />;
}

export function ConversationView({ sessions, animations = true, composerMedia, workflowTable, pluginManager, windowLayout, surfaces=emptyRegistry,navigation }: {
  sessions: ConversationSession[];
  animations?: boolean;
  composerMedia?: ComposerMedia;
  workflowTable?: PluginTableSource;
  pluginManager?: PluginManagerSource;
  windowLayout: WindowLayoutSource;
  surfaces?:UiSurfaceRegistry;
  navigation?:WindowNavigationSource;
}) {
  const navigationState=useSyncExternalStore((navigation??emptyNavigation).subscribe,(navigation??emptyNavigation).snapshot);
  const published=useSyncExternalStore(surfaces.subscribe,surfaces.snapshot);
  const panes: Pane[] = sessions.map(session => ({ id: session.paneId ?? 'session:' + session.id, label: session.label, session }));
  if (workflowTable) panes.push({ id: 'workflows', label: 'Workflows' });
  if (pluginManager) panes.push({ id: 'plugins', label: 'Plugins' });
  for(const surface of published)if(!panes.some(pane=>pane.id===surface.id))
    panes.push({id:surface.id,label:surface.snapshot().title,surface});
  const layout = useSyncExternalStore(windowLayout.subscribe, windowLayout.snapshot);
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
  const workspaceStatus=layout.error??(layout.gesture?'Drag · Esc cancel':layout.saving?'Saving layout…':navigation
    ?width>=48?`WS ${layout.workspace} · ${navigationState.focusedLabel??'Empty workspace'}`:'* open':'');
  const workspaceBar=<box flexDirection="row" columnGap={navigation?0:1} height={1} flexShrink={0} paddingX={1}>
    <text fg={color.muted}>{navigation?'WS ':'WS'}</text>
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
    <text flexGrow={1} minWidth={0} truncate fg={layout.error?color.error:color.muted}>{workspaceStatus}</text>
  </box>;
  const tabs=stripPanes.map((pane,index)=>{
    const props={index,id:'window-tab-'+pane.id,showShortcut:!navigation,
      selected:layout.focused===pane.id&&layout.locations[pane.id]===layout.workspace,
      onSelect:()=>act({type:'open',id:pane.id})};
    return pane.session?<SessionTab key={pane.id} session={pane.session} {...props}/>
      :pane.surface?<SurfaceTab key={pane.id} source={pane.surface} {...props}/>
      :<Tab key={pane.id} label={pane.label} {...props}/>;
  });
  return <box width="100%" height="100%" backgroundColor={color.background} flexDirection="column">
    {navigation&&workspaceBar}
    {navigation&&<box flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1} flexShrink={0}>
      {navigationButton(width>=42?(navigationState.mode==='arrange'?'Alt+W Type':'Alt+W Arrange'):(navigationState.mode==='arrange'?'Type':'Arrange'),navigationState.mode==='arrange',()=>navigation.toggleArrange())}
      {navigationButton(width>=42?'F2 Windows':'Windows',navigationState.mode==='finder',()=>navigation.openFinder())}
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
      {/* Keep one resident native editor per stable pane, independent of tree topology and workspace. */}
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
            ? <Conversation selected={pane.session} animations={animations} composerMedia={composerMedia}
                focused={focused} width={width} height={height} isActive={isActive} />
            :pane.surface?<SurfaceView source={pane.surface} focused={focused} width={width} height={height}
              isActive={isActive} isVisible={isVisible}/>
            : pane.id === 'workflows' && workflowTable
              ? <PluginTable source={workflowTable} width={width} focused={focused} isActive={isActive} isVisible={isVisible} />
              : pluginManager && <Plugins source={pluginManager} visible={Boolean(frame)} focused={focused}
                  width={width} height={height} isActive={isActive} isVisible={isVisible} />}
        </Tile>;
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
        <text fg={color.accent} attributes={TextAttributes.BOLD} truncate>{'WINDOW MODE · '+(layout.fullscreen?'Zoomed':'Tiled')+' · '+(navigationState.focusedLabel??'Empty workspace')}</text>
        <text fg={color.running} truncate>{layout.gesture
          ? (layout.gesture === 'resize' ? 'Mouse resize · Esc cancel' : 'Move window · Esc cancel')
          : splitTargetLabel(layout, width)}</text>
        <text fg={color.text} truncate>{width>=88?'h/j/k/l focus · Shift move · b columns · v rows · +/− resize · f zoom · q close · 1–9 workspace · w windows · i type · Esc exit':width>=48?'h/j/k/l focus · Shift move · b/v split · +/− size · w windows · i type · Esc exit':'Esc exit · i type · w windows'}</text>
      </>:<text fg={color.muted} truncate>{navigationState.mode==='finder'?'WINDOWS · Esc cancel':width>=88?'Alt+W Arrange · F2 Windows · Alt+0 Main · Alt+Tab cycle · Alt+arrows focus · Alt+1…9 workspace':'Alt+W Arrange · F2 Windows · Alt+0 Main'}</text>}
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
