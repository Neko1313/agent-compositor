import type {UiAppearance, UiTextView} from '@agent-compositor/events';
import type {ConversationSnapshot, Message, PublicRenderMeasurement} from '@agent-compositor/renderer-opentui';
import {clean, textRows, type Row} from './presentation.js';

type Presentation = NonNullable<UiAppearance['presentation']>;
const literal = (value: string, multiline = false) => value.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,
  point => multiline && point === '\n' ? '\n' : '\\u' + point.charCodeAt(0).toString(16).padStart(4, '0'));

function toolRows(message: Extract<Message, {role: 'tool'}>, columns: number, details: boolean): Row[] {
  const {tool} = message;
  const symbol = {running: '…', done: '✓', error: '!', complete: '·'}[tool.state];
  const tone = tool.state === 'error' ? 'danger' : tool.state === 'done' ? 'success' : 'muted';
  return [
    ...textRows(symbol + ' ' + literal(tool.name) + (message.text ? ' · ' + literal(message.text, true) : ''), columns, tone),
    ...(details && tool.args ? textRows(literal(tool.args, true), columns, 'muted') : []),
  ];
}

/** Only the positively admitted Main projection enters public render input. */
export function publicConversationView(state: Pick<ConversationSnapshot, 'messages' | 'error'>,
  presentation: Presentation, metrics: PublicRenderMeasurement, label = 'Main'): UiTextView {
  const columns = Math.max(1, Math.min(10000, metrics.columns)), rows: Row[] = [];
  if (!state.messages.length && !state.error)
    rows.push(...textRows(literal(presentation.welcome ?? 'No messages yet', true), columns, 'muted'));
  for (const message of state.messages) {
    if (rows.length) rows.push({text: ''});
    if (message.role === 'tool') rows.push(...toolRows(message, columns, presentation.toolDetails === true));
    else {
      rows.push({text: literal(message.role === 'user' ? presentation.userLabel ?? 'You' : presentation.agentLabel ?? label),
        tone: message.role === 'user' ? 'muted' : 'accent', bold: true});
      rows.push(...textRows(message.text, columns));
    }
  }
  if (state.error) rows.push(...textRows('Error: ' + clean(state.error), columns, 'danger'));
  const height = Math.max(1, Math.min(2000, metrics.rows));
  const offset = Math.min(metrics.scrollOffset, Math.max(0, rows.length - height));
  return {lines: rows.slice(offset, offset + height)};
}

/** UI-operation diagnostics stay local; their raw aggregate is never hook input. */
export function publicToolsView(messages: readonly Message[], metrics: PublicRenderMeasurement): UiTextView {
  const columns = Math.max(1, Math.min(10000, metrics.columns));
  const chunks: Row[][] = [];let count = 0;
  for (let index = messages.length - 1; index >= 0 && count < 2000; index--) {
    const message = messages[index];if (message.role !== 'tool') continue;
    const chunk = toolRows(message, columns, true).slice(-(2000 - count));chunks.unshift(chunk);count += chunk.length;
  }
  const rows = chunks.flat();
  return {lines: rows.length ? rows.slice(-2000) : [{text: 'No tools called yet.', tone: 'muted'}]};
}

export function publicWaiting(state: ConversationSnapshot | undefined): string {
  return state?.approval || state?.controller?.kind === 'approval' ? 'Approval needed'
    : state?.interaction || state?.controller ? 'Answer needed' : state?.running ? 'Working' : 'Ready';
}

export function publicStatusView(state: ConversationSnapshot | undefined, workspace: number, fullscreen: boolean,
  presentation: Presentation, columns: number): UiTextView {
  let hint = presentation.hints === false ? '' : (fullscreen ? 'Zoomed · Alt+W f tiles · ' : '')
    + 'Alt+W Arrange · Alt+W w Windows · Alt+0 Main'
    + (columns >= 88 ? ' · Alt+Tab cycle · Alt+arrows focus · Alt+1…9 workspace' : '');
  // A short zoom hint is more useful than clipping its actual restore shortcut.
  if (fullscreen && columns < 60 && presentation.hints !== false) hint = 'Zoomed · Alt+W f tiles';
  return {lines: [{text: publicWaiting(state) + ' · WS ' + workspace, tone: 'accent'}, {text: hint, tone: 'muted'}]};
}
