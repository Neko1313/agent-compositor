export interface PaneLayout {
  primary: string;
  secondary?: string;
  focused: string;
  direction: 'row' | 'column';
  swapped: boolean;
  zoomed: boolean;
  firstShare: number;
}

export type LayoutAction =
  | { type: 'open'; id: string }
  | { type: 'focus' | 'orient' | 'swap' | 'zoom' }
  | { type: 'resize'; delta: number };

export function initialLayout(primary: string, secondary?: string): PaneLayout {
  return { primary, secondary: primary === secondary ? undefined : secondary, focused: primary,
    direction: 'row', swapped: false, zoomed: false, firstShare: 65 };
}

export function updateLayout(layout: PaneLayout, action: LayoutAction): PaneLayout {
  if (action.type === 'open') {
    if (action.id === layout.focused) return layout;
    return { ...layout, focused: action.id, secondary: action.id === layout.primary ? layout.secondary : action.id };
  }
  if (!layout.secondary) return layout;
  switch (action.type) {
    case 'focus': return { ...layout, focused: layout.focused === layout.primary ? layout.secondary : layout.primary };
    case 'orient': return { ...layout, direction: layout.direction === 'row' ? 'column' : 'row' };
    case 'swap': return { ...layout, swapped: !layout.swapped };
    case 'zoom': return { ...layout, zoomed: !layout.zoomed };
    case 'resize': return { ...layout, firstShare: Math.min(75, Math.max(25, layout.firstShare + action.delta)) };
  }
}

export function isPaneVisible(layout: PaneLayout, id: string, compact: boolean) {
  return id === layout.focused || (!layout.zoomed && !compact && (id === layout.primary || id === layout.secondary));
}
