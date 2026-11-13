/** @jsxImportSource @opentui/react */
import { MouseButton, RGBA, TextAttributes, type BoxRenderable, type KeyBinding, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { color } from './colors.js';
import { Ghost, type ComposerMedia } from './ghost.js';
import { initialLayout, isPaneVisible, updateLayout, type LayoutAction } from './layout.js';
import { Plugins, type PluginManagerSource } from './plugins.js';
import type { ConversationApproval, ConversationSession } from './session.js';
import { PluginTable, type PluginTableSource } from './table.js';

// Kitty clears its placement cells to the terminal background on each frame.
const composerBackground = RGBA.defaultBackground();
const composerForeground = RGBA.defaultForeground();

const editorKeys: KeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'j', ctrl: true, action: 'newline' },
  { name: 'return', shift: true, action: 'newline' },
];

interface TabProps {
  label: string;
  index: number;
  selected: boolean;
  onSelect(): void;
}

function Tab({ label, index, selected, onSelect }: TabProps) {
  const shortcut = index < 11 ? `F${index + 2} ` : '';
  return (
    <box
      paddingX={1} height={1} maxWidth="100%"
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
    const { approval, running } = session.snapshot();
    return approval ? ' · Approval' : running ? ' · Running' : '';
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

function ApprovalCard({ request, session, height }: {
  request: ConversationApproval;
  session: ConversationSession;
  height: number;
}) {
  const scroller = useRef<ScrollBoxRenderable>(null);
  useKeyboard(key => {
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
            if (event.button === MouseButton.LEFT) session.answerApproval?.(request.id, action.allow);
          }}>
            <text selectable={false} fg={color.text} attributes={TextAttributes.BOLD}>{action.label}</text>
          </box>
        )) : <text fg={color.muted}>Waiting for host decision</text>}
      </box>
    </box>
  );
}

function Conversation({ selected, animations, composerMedia, focused, width, height }: {
  selected: ConversationSession;
  animations: boolean;
  composerMedia?: ComposerMedia;
  focused: boolean;
  width: number;
  height: number;
}) {
  const state = useSyncExternalStore(useSessionSubscription(selected), () => selected.snapshot());
  const editor = useRef<TextareaRenderable>(null);
  const history = useRef<ScrollBoxRenderable>(null);
  const wide = width >= 60;
  const editorHeight = height >= 20 ? 4 : 2;
  const busy = state.running || Boolean(state.approval);
  const inputHint = state.approval ? 'PgUp/PgDn details · Ctrl+J newline' :
    busy ? 'Draft while running · Ctrl+J newline' : 'Enter send · Ctrl+J newline';
  const fullHint = state.approval ? `${inputHint} · Ctrl+C quit` : `${inputHint} · PgUp/PgDn history · Ctrl+C quit`;

  useLayoutEffect(() => {
    if (focused && state.approval) history.current?.scrollTo(Infinity);
  }, [focused, selected.id, state.approval?.id]);

  useKeyboard(key => {
    if (focused && !state.approval && (key.name === 'pageup' || key.name === 'pagedown')) {
      key.preventDefault();
      history.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport');
    }
  });

  function send() {
    const input = editor.current;
    const current = selected.snapshot();
    if (!focused || !input || current.running || current.approval) return;
    const text = input.plainText;
    if (!text.trim()) return;
    selected.submit(text);
    input.setText('');
    input.focus();
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <scrollbox ref={history} flexGrow={1} flexBasis={0} minHeight={0}
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

      {state.notice && <text fg={color.muted} wrapMode="word">{state.notice}</text>}
      {!focused && state.approval && <text fg={color.running}>Approval pending</text>}
      {focused && state.approval && <ApprovalCard key={`${selected.id}:${state.approval.id}`}
        request={state.approval} session={selected} height={height} />}
      <box border={['top']} borderColor={color.rule} titleColor={state.running ? color.running : color.accent}
        title={` ${selected.label} · ${state.approval ? 'Draft' : state.running ? 'Running' : 'Ready'} `}
        backgroundColor={composerBackground} flexShrink={0} flexDirection="row" paddingX={1} gap={1}>
        <textarea ref={editor} focused={focused}
            height={editorHeight} flexGrow={1} flexBasis={0} minWidth={1} wrapMode="word"
            textColor={composerForeground} focusedTextColor={composerForeground} cursorColor={composerForeground}
            placeholder={`Message ${selected.label}…`} placeholderColor={color.muted}
            keyBindings={editorKeys} onSubmit={send} />
        <Ghost media={composerMedia} enabled={focused && animations && wide && height >= 20} active={state.running} />
        {focused && <box height={1} paddingX={1} backgroundColor={busy ? color.panel : color.accent}
          onMouseDown={event => {
            if (event.button === MouseButton.LEFT) send();
          }}>
          <text selectable={false} fg={busy ? color.muted : color.background}
            attributes={TextAttributes.BOLD}>Send</text>
        </box>}
      </box>
      {focused && <text height={1} truncate fg={color.muted}>
        {width >= fullHint.length + 2 ? fullHint : inputHint}
      </text>}
    </box>
  );
}

interface Pane {
  id: string;
  label: string;
  session?: ConversationSession;
}

function Tile({ pane, focused, visible, share, onFocus, children }: {
  pane: Pane;
  focused: boolean;
  visible: boolean;
  share: number;
  onFocus(): void;
  children(width: number, height: number): React.ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measure = useCallback(function (this: BoxRenderable) {
    const { width, height } = this;
    setSize(old => old.width === width && old.height === height ? old : { width, height });
  }, []);
  return <box visible={visible} flexBasis={0} flexGrow={share} minWidth={0} minHeight={0}
    flexDirection="column" border borderColor={focused ? color.accent : color.rule}
    title={' ' + pane.label + (focused ? ' · focused ' : ' ')} titleColor={focused ? color.accent : color.muted}
    onMouseDown={event => { if (event.button === MouseButton.LEFT) onFocus(); }}>
    <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="column" onSizeChange={measure}>
      {children(size.width, size.height)}
    </box>
  </box>;
}

const controlLabels = ['Focus', 'Split', 'Swap', 'Zoom'] as const;
const controls = ['focus', 'orient', 'swap', 'zoom'] as const;

export function ConversationView({ sessions, animations = true, composerMedia, workflowTable, pluginManager }: {
  sessions: ConversationSession[];
  animations?: boolean;
  composerMedia?: ComposerMedia;
  workflowTable?: PluginTableSource;
  pluginManager?: PluginManagerSource;
}) {
  const panes: Pane[] = sessions.map(session => ({ id: 'session:' + session.id, label: session.label, session }));
  if (workflowTable) panes.push({ id: 'workflows', label: 'Workflows' });
  if (pluginManager) panes.push({ id: 'plugins', label: 'Plugins' });
  const [layout, dispatch] = useReducer(updateLayout, panes, initial => initialLayout(initial[0].id, initial[1]?.id));
  const { width } = useTerminalDimensions();
  const compact = width < 70;
  const controlStart = Math.max(6, panes.length + 2);
  const split = Boolean(layout.secondary) && !layout.zoomed && !compact;
  const direction = layout.swapped ? layout.direction === 'row' ? 'row-reverse' : 'column-reverse' : layout.direction;

  useKeyboard(key => {
    if (key.ctrl || key.shift || key.super || key.hyper) return;
    if (key.meta) {
      if (!split || (key.name !== 'left' && key.name !== 'right')) return;
      key.preventDefault();
      dispatch({ type: 'resize', delta: key.name === 'left' ? -5 : 5 });
      return;
    }
    const shortcut = /^f(\d+)$/.exec(key.name);
    if (!shortcut) return;
    const number = Number(shortcut[1]);
    const pane = panes[number - 2];
    const control = controls[number - controlStart];
    if (!pane && !control) return;
    key.preventDefault();
    if (pane) dispatch({ type: 'open', id: pane.id });
    else if (!key.repeated) dispatch({ type: control });
  });

  function layoutButton(label: string, action: LayoutAction) {
    return <box key={label} height={1} onMouseDown={event => {
      if (event.button === MouseButton.LEFT) dispatch(action);
    }}>
      <text selectable={false} fg={color.muted}>{label}</text>
    </box>;
  }
  return <box width="100%" height="100%" backgroundColor={color.background} flexDirection="column">
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
      {panes.map((pane, index) => {
        const props = { index, selected: layout.focused === pane.id, onSelect: () => dispatch({ type: 'open', id: pane.id }) };
        return pane.session ? <SessionTab key={pane.id} session={pane.session} {...props} />
          : <Tab key={pane.id} label={pane.label} {...props} />;
      })}
    </box>
    <box flexDirection={direction} flexBasis={0} flexGrow={1} minHeight={0}>
      {panes.map(pane => {
        const focused = layout.focused === pane.id;
        const visible = isPaneVisible(layout, pane.id, compact);
        const first = layout.swapped ? pane.id === layout.secondary : pane.id === layout.primary;
        return <Tile key={pane.id} pane={pane} visible={visible} focused={focused}
          share={first ? layout.firstShare : 100 - layout.firstShare} onFocus={() => dispatch({ type: 'open', id: pane.id })}>
          {(width, height) => pane.session
            ? <Conversation selected={pane.session} animations={animations} composerMedia={composerMedia}
                focused={focused} width={width} height={height} />
            : pane.id === 'workflows' && workflowTable
              ? <PluginTable source={workflowTable} width={width} focused={focused} />
              : pluginManager && <Plugins source={pluginManager} visible={visible} focused={focused} width={width} height={height} />}
        </Tile>;
      })}
    </box>
    {layout.secondary && <box flexDirection="row" columnGap={1} paddingX={1} flexShrink={0}>
      {controls.map((type, index) => layoutButton('F' + (controlStart + index) + ' ' +
        (type === 'zoom' && layout.zoomed ? 'Unzoom' : controlLabels[index]), { type }))}
      {split && <>
        <text fg={color.rule}>│</text>
        <text fg={color.muted}>{layout.direction === 'row' ? 'Columns' : 'Rows'}</text>
        {layoutButton('−', { type: 'resize', delta: -5 })}
        <text fg={color.text}>{layout.firstShare + '%'}</text>
        {layoutButton('+', { type: 'resize', delta: 5 })}
        {width >= 88 && <text fg={color.muted}>Alt+←/→ resize</text>}
      </>}
    </box>}
  </box>;
}
