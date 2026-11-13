import type {WindowLayoutSnapshot} from './layout.js';

/** Describe the saved keyboard target, rather than claiming a visible cell ratio. */
export function splitTargetLabel(layout: WindowLayoutSnapshot, width: number): string {
  const target = layout.splitTarget;
  const wide = width >= 88;
  if (!target) {
    const count = Object.values(layout.locations).filter(space => space === layout.workspace).length;
    if (count > 1) return 'Split target unavailable';
    const axis = layout.axis === 'horizontal' ? wide ? 'columns' : 'cols' : 'rows';
    return `${wide ? 'Next split' : 'Next'}: ${axis} · no resize target`;
  }
  const columns = target.axis === 'horizontal';
  const axis = columns ? wide ? 'columns' : 'cols' : 'rows';
  const first = Math.round(target.ratio * 100), ratio = `${first}/${100 - first}`;
  const side = columns ? target.focusedChild === 0 ? 'left' : 'right'
    : target.focusedChild === 0 ? wide ? 'top' : 'up' : wide ? 'bottom' : 'down';
  const hidden = {
    visible: '',
    'size-limited': wide ? 'hidden by terminal size' : 'small area',
    compact: wide ? 'hidden by narrow view' : 'narrow',
    zoomed: wide ? 'hidden by zoom' : 'zoomed',
    unmeasured: wide ? 'waiting for viewport' : 'wait',
  }[target.visibility];
  return wide ? `Target: ${axis} · saved ${ratio} · + grows ${side}${hidden ? ' · ' + hidden : ''}`
    : `Target: ${axis} ${ratio} · +${side}${hidden ? ' · ' + hidden : ''}`;
}
