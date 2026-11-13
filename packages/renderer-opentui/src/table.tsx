/** @jsxImportSource @opentui/react */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useKeyboard} from '@opentui/react';
import {MouseButton, TextAttributes, type ScrollBoxRenderable} from '@opentui/core';
import type {UiTextView} from '@agent-compositor/events';

export interface PluginTableSource {
  snapshot(): {title: string; table?: UiTextView['table']; error?: string};
  subscribe(callback: () => void): () => void;
  press(action: string): void;
}

export function PluginTable({source, width, focused}: {source: PluginTableSource; width: number; focused: boolean}) {
  const state = useSyncExternalStore(source.subscribe, source.snapshot);
  const [selectedId, select] = useState<string>();
  const narrow = width < 60;
  const rows = state.table?.rows ?? [];
  const index = Math.max(0, rows.findIndex(row => row.id === selectedId));
  const scroller = useRef<ScrollBoxRenderable>(null);
  const activeRow = rows[index];
  useEffect(() => {
    if (activeRow) scroller.current?.scrollChildIntoView('table-row-' + activeRow.id);
  }, [activeRow?.id]);
  useKeyboard(key => {
    if (!focused || !rows.length) return;
    if (key.name === 'up' || key.name === 'down') {
      key.preventDefault();
      select(rows[Math.max(0, Math.min(rows.length - 1, index + (key.name === 'up' ? -1 : 1)))].id);
    } else if (key.name === 'return' && rows[index]?.action) {
      key.preventDefault();
      source.press(rows[index].action);
    }
  });
  const columns = state.table?.columns ?? [];
  return <box flexGrow={1} flexDirection="column" paddingX={1} minHeight={0}>
    <text fg="#e6e9ed" attributes={TextAttributes.BOLD}>{state.title}</text>
    <scrollbox ref={scroller} flexGrow={1} minHeight={1} scrollY>
      {!narrow && <box flexDirection="row">{columns.map((column, i) =>
        <text key={i} flexBasis={0} flexGrow={column.width ?? 1} fg="#a8b2bd" truncate>{column.label}</text>
      )}</box>}
      {!rows.length && <text fg="#a8b2bd">{state.table?.empty ?? 'No workflow rows.'}</text>}
      {rows.map((row, i) => <box id={'table-row-' + row.id} key={row.id} flexDirection="column" backgroundColor={i === index ? '#22272f' : undefined}>
        <box flexDirection={narrow ? 'column' : 'row'} onMouseDown={event => {
          if (event.button !== MouseButton.LEFT) return;
          select(row.id);
          if (row.action) source.press(row.action);
        }}>
          {row.cells.map((cell, j) => <text key={j} selectable={false} truncate
            {...(narrow ? {} : {flexBasis: 0, flexGrow: columns[j]?.width ?? 1})}
            fg={i === index ? '#a6dfd4' : '#e6e9ed'}>
            {(j === 0 && row.action ? row.expanded ? '▾ ' : '▸ ' : '') + (narrow ? columns[j].label + ': ' : '') + cell}
          </text>)}
        </box>
        {row.expanded && row.details?.filter(line => !line.action).map((line, j) =>
          <text key={j} fg="#a8b2bd" wrapMode="word">{line.text}</text>
        )}
      </box>)}
    </scrollbox>
    {state.error && <text fg="#ffa7a0">{state.error}</text>}
    {focused && <text fg="#a8b2bd">↑↓ select · Enter or click to expand</text>}
  </box>;
}
