import type {UiTextView} from '@agent-compositor/events';

/** Validated data only. Requests, factories and controller leases stay in the host. */
export interface ControllerCell {
  ch: string; fg?: string; bg?: string;
  bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean;
}
export interface ControllerView extends Omit<UiTextView, 'lines'> {
  lines: (UiTextView['lines'][number] & {cells?: ControllerCell[]})[];
}
export type ControllerInput =
  | {kind: 'key'; key: string; modifiers?: string[]}
  | {kind: 'text'; text: string; paste?: true}
  | {kind: 'mouse'; row: number; col: number; button: string; action?: 'press'|'move'|'release'}
  | {kind: 'action'; action: string}
  | {kind: 'change'; id: string; value: string};
export interface ConversationController {
  id: string;
  kind: 'approval'|'question'|'form';
  revision: number;
  /** Last serialized input completed by the host, for native field acknowledgements. */
  inputRevision: number;
  view: ControllerView;
  preferredRows: number;
}

/** Private host windows retain their capabilities outside the renderer. */
export interface WindowController extends Omit<ConversationController,'kind'> {
  kind:'history'|'placement';
}
export const isWindowController=(frame:ConversationController|WindowController|undefined):frame is WindowController=>
  frame?.kind==='history'||frame?.kind==='placement';

/** A selected editor's visible frame, without its private draft or capabilities. */
export interface ConversationEditor {
  id: string;
  kind: 'editor';
  revision: number;
  inputRevision: number;
  available: boolean;
  view: ControllerView;
  preferredRows: number;
  admission?: {sequence: number; type: 'submit'|'steer'; status: 'accepted'|'queued'|'rejected'};
  scroll?: {revision: number; rows: number};
}

/** A local form can coexist with an idle conversation's next model turn. */
export function controllerBlocksInput(controller: Pick<ConversationController,'kind'>|undefined): boolean {
  return controller?.kind==='approval'||controller?.kind==='question';
}

/** Match the existing protocol's key/text split, including modified function keys. */
export function controllerKey(key: {
  name: string; sequence: string; ctrl: boolean; meta: boolean; shift: boolean;
  option?: boolean; super?: boolean; hyper?: boolean;
}): ControllerInput {
  const modifiers = [...(key.ctrl ? ['ctrl'] : []), ...(key.meta || key.option ? ['meta'] : []),
    ...(key.shift ? ['shift'] : []), ...(key.super ? ['super'] : []), ...(key.hyper ? ['hyper'] : [])];
  const name = key.name === 'return' || key.name === 'kpenter' ? 'enter' : key.name;
  if (!key.ctrl && !key.meta && !key.option && !key.super && !key.hyper
    && key.sequence && !/[\p{Cc}\p{Cs}]/u.test(key.sequence))
    return {kind: 'text', text: key.sequence};
  return {kind: 'key', key: name, modifiers};
}
