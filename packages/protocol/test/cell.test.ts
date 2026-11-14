import {it,expect} from 'vitest';
import {literalCellText} from '../src/cell.js';
import {SurfaceGrid} from '../src/grid.js';

it('escapes control, unpaired surrogate and directional display text while retaining raw cells',()=>{
 const raw='A\n\x1b\u202e\u2066\u2028\u2029\ud800😀窗é';
 expect(literalCellText(raw)).toBe('A\\u000a\\u001b\\u202e\\u2066\\u2028\\u2029\\ud800😀窗é');
 const grid=new SurfaceGrid();grid.applyFull([[{ch:'A\n'},{ch:'\u202e'},{ch:'\ud800'},{ch:'窗'}]]);
 expect(grid.toLines()).toEqual(['A\n\u202e\ud800窗']);expect(grid.segments(0).map(segment=>segment.text).join('')).toBe('A\n\u202e\ud800窗');
});
