/** @jsxImportSource @opentui/react */
import { MouseButton, TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { color } from './colors.js';

export type PluginManagerAction = 'install' | 'enable' | 'disable' | 'update' | 'remove';

export interface PluginManagerRow {
  id: string;
  name: string;
  marketplace?: string;
  description?: string;
  catalogVersion?: string;
  installedVersion?: string;
  enabled: boolean;
  loadedVersion?: string;
  pending?: string;
  actions: readonly PluginManagerAction[];
}

export interface PluginManagerSnapshot {
  rows: readonly PluginManagerRow[];
  revision: number;
  working: boolean;
  status?: string;
  error?: string;
}

/** The host owns catalog access, project storage, activation and the running plugin list. */
export interface PluginManagerSource {
  snapshot(): PluginManagerSnapshot;
  subscribe(listener: () => void): () => void;
  act(id: string, action: PluginManagerAction, revision: number): void;
  refresh(): void;
}

const labels: Record<PluginManagerAction, string> = {
  install: 'Install', enable: 'Enable', disable: 'Disable', update: 'Update', remove: 'Remove',
};

function Button({ label, onPress, selected, disabled, danger }: {
  label: string;
  onPress(): void;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  const highlight = danger ? color.error : color.accent;
  const background = selected && !disabled ? highlight : color.panel;
  return <box height={1} flexShrink={0} paddingX={1} backgroundColor={background} onMouseDown={event => {
    if (!disabled && event.button === MouseButton.LEFT) onPress();
  }}>
    <text selectable={false} fg={disabled ? color.muted : selected ? color.background : color.text}>
      {label}
    </text>
  </box>;
}

export function Plugins({ source, visible, focused, width, height }: {
  source: PluginManagerSource; visible: boolean; focused: boolean; width: number; height: number;
}) {
  const state = useSyncExternalStore(source.subscribe, source.snapshot);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedAction, setSelectedAction] = useState<PluginManagerAction>();
  const [searching, setSearching] = useState(false);
  const [removeIntent, setRemoveIntent] = useState<{ id: string; revision: number }>();
  const scroller = useRef<ScrollBoxRenderable>(null);
  const narrow = width < 70;
  const short = height < 15;
  const filter = query.trim().toLowerCase();
  const rows = state.rows.filter(row => {
    const name = row.marketplace ? row.name + '@' + row.marketplace : row.name;
    return name.toLowerCase().includes(filter) || row.description?.toLowerCase().includes(filter);
  });
  const index = Math.max(0, rows.findIndex(row => row.id === selectedId));
  const row = rows[index];
  const action = selectedAction && row?.actions.includes(selectedAction) ? selectedAction : row?.actions[0];
  const confirming = removeIntent !== undefined && removeIntent.id === row?.id && removeIntent.revision === state.revision;
  useLayoutEffect(() => {
    if (visible && row) scroller.current?.scrollChildIntoView('plugin-row-' + row.id);
  }, [visible, row?.id, query, state.revision, width]);
  useLayoutEffect(() => {
    if (!focused) {
      setSearching(false);
      setRemoveIntent(undefined);
    }
  }, [focused]);

  function choose(id: string) {
    setSelectedId(id);
    setSelectedAction(undefined);
    setRemoveIntent(undefined);
    setSearching(false);
  }
  function refresh() {
    setRemoveIntent(undefined);
    setSearching(false);
    if (!state.working) source.refresh();
  }
  function run(chosen: PluginManagerAction) {
    if (!row || state.working || !row.actions.includes(chosen)) return;
    setSelectedId(row.id);
    setSelectedAction(chosen);
    setSearching(false);
    if (chosen === 'remove') setRemoveIntent({ id: row.id, revision: state.revision });
    else source.act(row.id, chosen, state.revision);
  }
  function confirmRemoval() {
    if (confirming && !state.working) source.act(removeIntent.id, 'remove', removeIntent.revision);
    setRemoveIntent(undefined);
  }

  useKeyboard(key => {
    if (!focused || key.ctrl || key.meta || key.super || key.hyper) return;
    const enter = key.name === 'return' || key.name === 'kpenter';
    if (confirming) {
      if (key.name === 'escape') setRemoveIntent(undefined);
      else if (key.name === 'y' && !key.repeated) confirmRemoval();
      else return;
    } else if (searching) {
      if (!enter && key.name !== 'escape' && key.name !== 'down') return;
      if (row) choose(row.id);
      else setSearching(false);
    } else if (key.sequence === '/' || key.name === '/') {
      setSearching(true);
    } else if (key.name === 'r') {
      if (!key.repeated) refresh();
    } else if (row && (key.name === 'up' || key.name === 'down')) {
      choose(rows[Math.max(0, Math.min(rows.length - 1, index + (key.name === 'up' ? -1 : 1)))].id);
    } else if (row && action && (key.name === 'left' || key.name === 'right')) {
      const current = row.actions.indexOf(action);
      setSelectedAction(row.actions[(current + (key.name === 'left' ? -1 : 1) + row.actions.length) % row.actions.length]);
    } else if (enter && action && !key.repeated) {
      run(action);
    } else return;
    key.preventDefault();
  });

  const resultCount = rows.length + (rows.length === 1 ? ' result' : ' results');
  return <box visible={visible} flexGrow={1} flexBasis={0} minHeight={0} flexDirection="column" paddingX={1}>
    <box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
      <text attributes={TextAttributes.BOLD} fg={color.text}>{width < 40 ? 'Project' : 'Project plugins'}</text>
      <text flexGrow={1} fg={color.muted} truncate>{resultCount}</text>
      <Button label="Refresh" onPress={refresh} disabled={state.working} />
    </box>
    <box flexDirection="row" marginBottom={narrow || short ? 0 : 1} gap={1}
      backgroundColor={color.panel} onMouseDown={event => {
        if (event.button === MouseButton.LEFT) { setRemoveIntent(undefined); setSearching(true); }
      }}>
      <text fg={searching ? color.accent : color.muted} selectable={false}>Search</text>
      <input flexGrow={1} flexBasis={0} minWidth={1} scrollMargin={0} focused={focused && searching} placeholder="Filter plugins…"
        value={query} onInput={setQuery} backgroundColor={color.panel} focusedBackgroundColor={color.panel}
        textColor={color.text} focusedTextColor={color.text} cursorColor={color.accent} placeholderColor={color.muted} />
    </box>
    <box flexDirection={narrow ? 'column' : 'row'} flexGrow={1} flexBasis={0} minHeight={0} columnGap={1}>
      <scrollbox ref={scroller} flexGrow={1} flexBasis={0} minWidth={1} minHeight={1}
        focusable={false} scrollX={false} scrollY>
        {rows.map(item => (
          <box key={item.id} id={'plugin-row-' + item.id} flexDirection="row" height={1}
            backgroundColor={item === row ? color.panel : undefined} onMouseDown={event => {
              if (event.button === MouseButton.LEFT) choose(item.id);
            }}>
            <text flexGrow={1} flexBasis={0} selectable={false} truncate wrapMode="none" fg={item === row ? color.accent : color.text}>
              {(item === row ? '› ' : '  ') + item.name + (item.marketplace ? '@' + item.marketplace : '')}
            </text>
          </box>
        ))}
        {!rows.length && <text fg={color.muted}>{state.working ? 'Loading plugins…' : 'No matching plugins'}</text>}
      </scrollbox>
      {row && <box flexDirection="column" border={narrow ? ['top'] : ['left']} borderColor={color.rule}
        {...(narrow ? { flexShrink: 0 } : { width: '55%', paddingLeft: 1 })}>
        {!short && <text fg={color.text} attributes={TextAttributes.BOLD} truncate>{row.name}</text>}
        {!short && row.description && <text fg={color.muted} wrapMode="word" maxHeight={narrow ? 2 : 4}>{row.description}</text>}
        <box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {row.catalogVersion && <text fg={color.text}>{'Catalog v' + row.catalogVersion}</text>}
          <text fg={color.text}>{row.installedVersion === 'unlocked' ? 'Installed (unlocked)' :
            row.installedVersion ? 'Installed v' + row.installedVersion : 'Not installed here'}</text>
        </box>
        <box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <text fg={color.text}>{row.enabled ? 'Saved on' : 'Saved off'}</text>
          <text fg={color.text}>{row.loadedVersion ? 'Loaded v' + row.loadedVersion : 'Not loaded'}</text>
        </box>
        {row.pending && <text fg={color.running} wrapMode="word">{row.pending}</text>}
        {confirming
          ? <box flexDirection="column">
              <text fg={color.error} wrapMode="word">{'Remove ' + row.name + ' from this project?'}</text>
              <box flexDirection="row" columnGap={1}>
                <Button label="Confirm remove" selected danger onPress={confirmRemoval} disabled={state.working} />
                <Button label="Cancel" onPress={() => setRemoveIntent(undefined)} />
              </box>
            </box>
          : <box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {row.actions.map(item => <Button key={item} label={labels[item]} selected={item === action && !searching}
                disabled={state.working} onPress={() => run(item)} />)}
            </box>}
      </box>}
    </box>
    {state.working ? <text fg={color.running}>Working…</text> :
      state.status && <text wrapMode="word" fg={color.muted}>{state.status}</text>}
    {state.error && <text wrapMode="word" fg={color.error}>{state.error}</text>}
    {focused && <text fg={color.muted} wrapMode="word">
      {confirming ? 'Y confirm removal · Esc cancel' : searching ? 'Enter or Esc returns to results' :
        narrow ? '/ search · ↑↓ rows · ←→ action · Enter run' : '/ search · ↑↓ select plugin · ←→ select action · Enter run · R refresh'}
    </text>}
  </box>;
}
