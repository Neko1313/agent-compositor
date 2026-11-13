/** @jsxImportSource @opentui/react */
import { MouseButton, RGBA, TextAttributes, type KeyBinding, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Ghost, type ComposerMedia } from './ghost.js';
import type { ConversationSession } from './session.js';
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
  const running = useSyncExternalStore(useSessionSubscription(session), () => session.snapshot().running);
  return <Tab {...tab} label={running ? `${session.label} · Running` : session.label} />;
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
  const inputHint = state.running ? 'Draft while running · Ctrl+J newline' : 'Enter send · Ctrl+J newline';
  const fullHint = `${inputHint} · PgUp/PgDn history · Ctrl+C quit`;

  useKeyboard(key => {
    if (visible && (key.name === 'pageup' || key.name === 'pagedown')) {
      key.preventDefault();
      history.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport');
    }
  });

  function send() {
    const input = editor.current;
    if (!input || selected.snapshot().running) return;
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
        contentOptions={{ paddingX: 1, paddingY: 1, gap: 1 }}>
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

      <box border={['top']} borderColor={color.rule} titleColor={state.running ? color.running : color.accent}
        title={` ${selected.label} · ${state.running ? 'Running' : 'Ready'} `}
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
        <box height={1} paddingX={1} backgroundColor={state.running ? color.panel : color.accent}
          onMouseDown={event => {
            if (event.button === MouseButton.LEFT) send();
          }}>
          <text selectable={false} fg={state.running ? color.muted : color.background}
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
      <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0} border={['bottom']} borderColor={color.rule}>
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
