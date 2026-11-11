import {it,expect,vi} from 'vitest';
import {AgentCore} from '@agent-compositor/core';
import {hello,type WireMessage} from '@agent-compositor/protocol';
import {AppUI} from '../src/ui.js';
import {viewRows} from '../src/presentation.js';

it('coalesces streamed text without losing deltas and flushes the final screen before the turn settles',async()=>{
 const chunks=Array.from({length:240},(_,i)=>`word${i} `);
 const provider={name:'burst-fixture',async *complete(){for(const text of chunks)yield{type:'text_delta' as const,text};yield{type:'finish' as const,reason:'stop' as const};}};
 const messages:WireMessage[]=[],ui=new AppUI(approve=>new AgentCore({cwd:process.cwd(),provider,onApproval:approve}));
 ui.connect(message=>messages.push(message));ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));
 try{
  await ui.core.submit('Stream a burst');await ui.settled();
  expect(ui.core.getMessages().at(-1)?.content).toBe(chunks.join(''));
  const frames=messages.filter(m=>m.type==='render'&&m.surface==='session');
  expect(frames.length).toBeLessThan(chunks.length/2);
  const frame=frames.at(-1)!;expect(frame.type==='render'&&frame.grid?.map(row=>row.map(c=>c.ch).join('')).join('\n')).toContain('word239');
 }finally{ui.close();await ui.core.close();}
});

it('reserves the same native image rectangle while avoiding portable RGBA decoding',()=>{
 const view={lines:[{text:'Caption'}],raster:{width:8,height:8,rgba:Buffer.alloc(8*8*4,255).toString('base64'),alt:'Picture'}};
 const portable=viewRows(view,12,8),decode=vi.spyOn(Buffer,'from');
 try{
  const native=viewRows(view,12,8,true);
  expect(native).toHaveLength(portable.length);expect(native.at(-1)).toEqual(portable.at(-1));
  expect(native.slice(0,-1).every(row=>row.text===''&&!row.cells)).toBe(true);
  expect(decode).not.toHaveBeenCalled();
 }finally{decode.mockRestore();}
});
