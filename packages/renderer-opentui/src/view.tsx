/** @jsxImportSource @opentui/react */
import { MouseButton, RGBA, TextAttributes, type KeyBinding, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Ghost, type ComposerMedia } from './ghost.js';
import type { ConversationApproval, ConversationSession } from './session.js';
import { PluginTable, type PluginTableSource } from './table.js';

const color = {
  background: '#171a20',
  panel: '#22272f',
  text: '#e6e9ed',
  muted: '#a8b2bd',
  accent: '#a6dfd4',
  rule: '#49545e',
  running: '#eac280',
  error: '#ffa7a0',
};
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

function Conversation({ sessions, selected, animations, composerMedia, visible }: {
  sessions: ConversationSession[];
  selected: ConversationSession;
  animations: boolean;
  composerMedia?: ComposerMedia;
  visible: boolean;
}) {
  const state = useSyncExternalStore(useSessionSubscription(selected), () => selected.snapshot());
  const editor = useRef<TextareaRenderable>(null);
  const history = useRef<ScrollBoxRenderable>(null);
  const { width, height } = useTerminalDimensions();
  const wide = width >= 60;
  const editorHeight = height >= 20 ? 4 : 2;
  const busy = state.running || Boolean(state.approval);
  const inputHint = state.approval ? 'PgUp/PgDn details · Ctrl+J newline' :
    busy ? 'Draft while running · Ctrl+J newline' : 'Enter send · Ctrl+J newline';
  const fullHint = state.approval ? `${inputHint} · Ctrl+C quit` : `${inputHint} · PgUp/PgDn history · Ctrl+C quit`;

  useLayoutEffect(() => {
    if (visible && state.approval) history.current?.scrollTo(Infinity);
  }, [visible, selected.id, state.approval?.id]);

  useKeyboard(key => {
    if (visible && !state.approval && (key.name === 'pageup' || key.name === 'pagedown')) {
      key.preventDefault();
      history.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport');
    }
  });

  function send() {
    const input = editor.current;
    const current = selected.snapshot();
    if (!input || current.running || current.approval) return;
    const text = input.plainText;
    if (!text.trim()) return;
    selected.submit(text);
    input.setText('');
    input.focus();
  }

  return (
    <box visible={visible} flexDirection="column" flexGrow={1} minHeight={0}>
      <scrollbox key={selected.id} ref={history} flexGrow={1} flexBasis={0} minHeight={0}
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

      {visible && state.approval && <ApprovalCard key={`${selected.id}:${state.approval.id}`}
        request={state.approval} session={selected} height={height} />}
      <box border={['top']} borderColor={color.rule} titleColor={state.running ? color.running : color.accent}
        title={` ${selected.label} · ${state.approval ? 'Draft' : state.running ? 'Running' : 'Ready'} `}
        backgroundColor={composerBackground} flexShrink={0} flexDirection="row" paddingX={1} gap={1}>
        {/* Keeping each native editor mounted preserves its draft, cursor, selection and undo stack. */}
        {sessions.map(session => (
          <textarea key={session.id} ref={session === selected ? editor : undefined}
            visible={session === selected} focused={visible && session === selected}
            height={editorHeight} flexGrow={1} flexBasis={0} minWidth={1} wrapMode="word"
            textColor={composerForeground} focusedTextColor={composerForeground} cursorColor={composerForeground}
            placeholder={`Message ${session.label}…`} placeholderColor={color.muted}
            keyBindings={editorKeys} onSubmit={session === selected ? send : undefined} />
        ))}
        <Ghost media={composerMedia} enabled={visible && animations && wide && height >= 20} active={state.running} />
        <box height={1} paddingX={1} backgroundColor={busy ? color.panel : color.accent}
          onMouseDown={event => {
            if (event.button === MouseButton.LEFT) send();
          }}>
          <text selectable={false} fg={busy ? color.muted : color.background}
            attributes={TextAttributes.BOLD}>Send</text>
        </box>
      </box>
      <text height={1} truncate fg={color.muted}>
        {width >= fullHint.length + 2 ? fullHint : inputHint}
      </text>
    </box>
  );
}

export function ConversationView({ sessions, animations = true, composerMedia, workflowTable }: {
  sessions: ConversationSession[];
  animations?: boolean;
  composerMedia?: ComposerMedia;
  workflowTable?: PluginTableSource;
}) {
  const [selectedId, setSelectedId] = useState(sessions[0]?.id);
  const [showTable, setShowTable] = useState(false);
  const tableVisible = showTable && workflowTable !== undefined;
  const selected = sessions.find(session => session.id === selectedId) ?? sessions[0];
  function selectSession(session: ConversationSession) {
    setSelectedId(session.id);
    setShowTable(false);
  }
  useKeyboard(key => {
    const shortcut = /^f(\d+)$/.exec(key.name);
    if (!shortcut || key.ctrl || key.shift || key.meta) return;
    const index = Number(shortcut[1]) - 2;
    const session = sessions[index];
    if (session) {
      key.preventDefault();
      selectSession(session);
    } else if (index === sessions.length && workflowTable) {
      key.preventDefault();
      setShowTable(true);
    }
  });
  return (
    <box width="100%" height="100%" backgroundColor={color.background} paddingX={1} flexDirection="column">
      <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0} border={['bottom']} borderColor={color.rule}>
        {sessions.map((session, index) => (
          <SessionTab key={session.id} session={session} index={index}
            selected={!tableVisible && session === selected} onSelect={() => selectSession(session)} />
        ))}
        {workflowTable && <Tab label="Workflows" index={sessions.length} selected={tableVisible}
          onSelect={() => setShowTable(true)} />}
      </box>
      {selected
        ? <Conversation sessions={sessions} selected={selected} animations={animations}
            composerMedia={composerMedia} visible={!tableVisible} />
        : <text fg={color.muted}>No conversations available</text>}
      {tableVisible && <PluginTable source={workflowTable} />}
    </box>
  );
}
