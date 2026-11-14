import {describe,expect,it} from 'vitest';
import {decodeLine,encodeMessage,RendererState,type RenderMessage,type WireMessage} from '@agent-compositor/protocol';
import {RendererState as InkRendererState} from '../../renderer-ink/src/state.js';
import {OpenTuiWireStore} from '../../renderer-opentui/src/wire-store.js';
import {SessionPane} from './pane.js';

function capture(columns=12,rows=3){
  const messages:WireMessage[]=[],shared=new RendererState(),ink=new InkRendererState(),open=new OpenTuiWireStore();
  const pane=new SessionPane('conversation',message=>{
    const decoded=decodeLine(encodeMessage(message));messages.push(decoded);
    shared.apply(decoded);ink.apply(decoded);open.apply(decoded);
  });
  pane.declarePane(columns,rows);
  const text=()=>shared.grid('session')!.toLines();
  function parity(){
    expect(ink.grid('session')!.toLines()).toEqual(text());
    const grid=open.snapshot().text.grids.get('session')!;
    expect(grid.rows.map(row=>row.map(segment=>segment.text).join('').trimEnd())).toEqual(text());
    expect(grid.cursor).toEqual(shared.grid('session')!.cursor);
  }
  return{pane,messages,shared,ink,open,text,parity};
}
const diffs=(messages:WireMessage[])=>messages.filter((message):message is RenderMessage=>message.type==='render'&&message.mode==='diff');

describe('SessionPane wire contract',()=>{
  it('emits a canonical declaration, dimensioned full grid and cursor initialization through both frontend stores',()=>{
    const t=capture();
    expect(t.messages[0]).toEqual({type:'declare',surfaces:[{id:'session',kind:'pane',site:'conversation',title:'conversation'}]});
    expect(t.messages[1]).toMatchObject({type:'render',surface:'session',mode:'full',flush:true});
    expect(t.shared.grid('session')!.width).toBe(12);expect(t.shared.grid('session')!.height).toBe(3);
    expect(t.shared.grid('session')!.cursor).toEqual({row:0,col:0});t.parity();
  });

  it('streams typed cell deltas with flush and rewrites only the unfinished row',()=>{
    const t=capture();t.pane.append('line1\nlin');t.pane.flush();t.pane.append('e2\ndone');t.pane.flush();
    const [initial,first,second]=diffs(t.messages);
    expect(initial.ops).toEqual([{op:'cursor',row:0,col:0}]);
    expect(first.ops).toEqual([{op:'set',row:0,col:0,cells:Array.from('line1',ch=>({ch}))},
      {op:'set',row:1,col:0,cells:Array.from('lin',ch=>({ch}))},{op:'cursor',row:1,col:3}]);
    expect(second.ops).toEqual([{op:'set',row:1,col:0,cells:Array.from('line2',ch=>({ch}))},
      {op:'set',row:2,col:0,cells:Array.from('done',ch=>({ch}))},{op:'cursor',row:2,col:4}]);
    expect(first.flush).toBe(true);expect(second.flush).toBe(true);expect(t.text()).toEqual(['line1','line2','done']);t.parity();
  });

  it('keeps multiple deltas, blank lines and tool text without clearing completed content',()=>{
    const t=capture(5,2);t.pane.append('hello');t.pane.append(' world');t.pane.flush();
    t.pane.append('\n\n');t.pane.flush();t.pane.toolLine('exec finished');t.pane.flush();
    expect(t.text()).toEqual(['hello world','','  [tool] exec finished']);
    expect(t.shared.grid('session')!.cursor).toEqual({row:3,col:0});
    expect(diffs(t.messages).flatMap(message=>message.ops??[]).some(op=>op.op==='clear')).toBe(false);t.parity();
  });

  it('uses Unicode scalar cells and cell-based cursor columns, including split surrogate deltas',()=>{
    const t=capture(2,1);t.pane.append('窗🙂');t.pane.flush();expect(t.shared.grid('session')!.cursor).toEqual({row:0,col:2});
    t.pane.append('\ud83d');t.pane.flush();t.pane.append('\ude80');t.pane.flush();
    expect(t.text()).toEqual(['窗🙂🚀']);expect(t.shared.grid('session')!.cursor).toEqual({row:0,col:3});t.parity();
  });

  it('redraws existing text on redeclaration without losing buffered or completed lines',()=>{
    const t=capture();t.pane.append('first\nunfinished');t.pane.flush();t.pane.append(' tail');t.pane.declarePane(4,2);
    expect(t.text()).toEqual(['first','unfinished tail']);expect(t.shared.grid('session')!.cursor).toEqual({row:1,col:15});
    const count=t.messages.length;t.pane.flush();t.pane.append('');t.pane.flush();expect(t.messages).toHaveLength(count);t.parity();
  });

  it('bounds dimension hints without allocating a rectangular blank grid',()=>{
    const t=capture(10000,10000),full=t.messages.find((message):message is RenderMessage=>message.type==='render'&&message.mode==='full')!;
    expect(full.grid).toHaveLength(10000);expect(full.grid!.reduce((count,row)=>count+row.length,0)).toBe(10000);
    expect(t.shared.grid('session')!.width).toBe(10000);expect(t.shared.grid('session')!.height).toBe(10000);
    const count=t.messages.length;
    for(const [columns,rows] of [[0,2],[2,-1],[2,NaN],[Infinity,2],[1.5,2],[10001,2],[2,10001]])expect(()=>t.pane.declarePane(columns,rows)).toThrow('integers from 1 to 10000');
    expect(t.messages).toHaveLength(count);
  });
});
