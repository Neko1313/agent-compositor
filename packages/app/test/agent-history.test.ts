import {describe,it,expect,vi} from 'vitest';
import {agentHistory} from '../src/agent-history.js';
import {uiTextViewSchema,type UiTextView} from '@agent-compositor/events';
import type {SessionEvent} from '@agent-compositor/session';

describe('saved agent activity',()=>{
 it('reaches old records, filters tools and reconstructs every part of a large Unicode result',async()=>{
  const output='START '+ '👩🏽‍💻'.repeat(5000)+' END_OF_RESULT';
  const events:SessionEvent[]=[{type:'tool.result',tool:'read',ok:true,output},...Array.from({length:63},(_,index)=>({type:'turn.complete',turnId:String(index)}))];
  let view!:UiTextView;const history=agentHistory(async()=>events,async next=>{expect(uiTextViewSchema.safeParse(next).success).toBe(true);view=next;});
  await history.open();expect(view.lines[0].text).toContain('Page 3/3');expect(view.table!.rows.at(-1)!.cells[0]).toBe('64');
  await history.press('previous');await history.press('previous');expect(view.table!.rows[0].cells[0]).toBe('1');expect(view.table!.rows).toHaveLength(25);
  await history.press('filter:tools');expect(view.table!.rows).toHaveLength(1);await history.press('event:0');
  const parts:string[]=[];
  for(let part=0;part<10;part++){
   const details=view.table!.rows[0].details!,body=details.at(-1)!.text;expect(/[\uD800-\uDBFF]$/.test(body)).toBe(false);expect(/^[\uDC00-\uDFFF]/.test(body)).toBe(false);parts.push(body);
   if(!details.some(line=>line.action==='detail:next'))break;
   await history.press('detail:next');
  }
  expect(JSON.parse(parts.join(''))).toEqual(events[0]);expect(parts.join('')).toContain('END_OF_RESULT');
  await history.press('filter:turns');expect(view.table!.rows.every(row=>!row.cells[1].startsWith('tool.'))).toBe(true);
  const before=JSON.stringify(view);await history.press('event:0');expect(JSON.stringify(view)).toBe(before);
 });
 it('keeps the prior snapshot on read failure, retries, and does not reopen after a pending read is closed',async()=>{
  let view!:UiTextView;const publish=vi.fn(async(next:UiTextView)=>{view=next;});
  const read=vi.fn<()=>Promise<SessionEvent[]>>().mockResolvedValueOnce([{type:'turn.failed',error:'BROKEN_TOOL'}]).mockRejectedValueOnce(Error('Storage unavailable')).mockResolvedValueOnce([]);
  const history=agentHistory(read,publish);await history.open();await history.press('event:0');expect(view.table!.rows[0].details!.at(-1)!.text).toContain('BROKEN_TOOL');
  await history.press('refresh');expect(view.lines.some(line=>line.text.includes('Storage unavailable'))).toBe(true);expect(view.table!.rows).toHaveLength(1);
  await history.press('refresh');expect(view.table!.rows).toHaveLength(0);expect(view.lines.some(line=>line.tone==='danger')).toBe(false);
  let resolve!:(events:SessionEvent[])=>void;read.mockReturnValueOnce(new Promise(done=>{resolve=done;}));const pending=history.open();await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(4));history.close();const calls=publish.mock.calls.length;resolve([{type:'turn.start'}]);await pending;expect(publish).toHaveBeenCalledTimes(calls);
 });
});
