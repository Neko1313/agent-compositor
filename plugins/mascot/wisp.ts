// Text frames adapted from the user-supplied WispSoul Ink component.
// Frame data travels over the portable UI contract; the host owns Ink and input.
export type WispState = 'idle' | 'thinking' | 'searching' | 'editing' | 'planning' | 'waiting' | 'question' | 'approval' | 'done' | 'error';

type Frame = readonly string[];
const base = (eyes: string, tip = '  ╱╲   ', mark = '        '): Frame => [
  `${tip}${mark}`,
  '  ╱██╲  ',
  `  █${eyes}█  `,
  '  ╲██╱  ',
];

export const animations: Record<WispState, readonly Frame[]> = {
  idle: [base('••'), base('••', '   ╱╲  '), base('••', '    ╲╱ '), base('••', '   ╱╲  ')],
  thinking: [base('··', '  ╱╲   ', '   ·    '), base('--', '  ╱╲   ', '  ··    '), base('··', '  ╱╲   ', ' ···    ')],
  searching: [base('••', '  ╱╲   ', '   ⌕    '), base('••', '   ╱╲  ', '    ⌕   '), base('••', '  ╱╲   ', '   ⌕    ')],
  editing: [base('••', '  ╱╲   ', '  </>   '), base('^^', '   ╱╲  ', '  </>   ')],
  planning: [base('••', '  ╱╲   ', '  ☷     '), base('••', '  ╱╲   ', '  ☑     ')],
  waiting: [base('••', '  ╱╲   ', '  ·   · '), base('••', '   ╱╲  ', ' ·     ·'), base('••', '  ╱╲   ', '  ·   · ')],
  question: [base('••', '  ╱╲   ', '   ?    '), base('••', '  ╱╲   ', '        ')],
  approval: [base('••', '  ╱╲   ', '   !    '), base('••', '  ╱╲   ', '   ?    ')],
  done: [base('^^', '  ╱╲   ', '   ✓    '), base('^^', '   ╱╲  ', '  ✦     ')],
  error: [base('xx', '  ╱╲   ', '   !    '), base('--', '  ╱╲   ', '        ')],
};

