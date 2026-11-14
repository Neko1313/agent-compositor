import type {MouseEvent} from '@opentui/core';

type ActionMouseEvent = Pick<MouseEvent, 'button' | 'defaultPrevented' | 'preventDefault' | 'stopPropagation'>;

/** Handled controls must not refocus their old coordinates after opening another pane. */
export function handleActionMouseDown(event: ActionMouseEvent, admitted: boolean, run: () => void): boolean {
  if (event.button !== 0 || event.defaultPrevented || !admitted) return false;
  event.stopPropagation();
  event.preventDefault();
  run();
  return true;
}
