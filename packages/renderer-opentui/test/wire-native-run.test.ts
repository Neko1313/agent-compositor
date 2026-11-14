import {PassThrough} from 'node:stream';
import {describe,it,expect,vi} from 'vitest';
import {decodeLine,encodeMessage,hello,type WireMessage} from '@agent-compositor/protocol';
import {runOpenTuiWireRenderer} from '../src/wire-run.js';

function tty(){const raw:boolean[]=[],stdin=Object.assign(new PassThrough(),{isTTY:true,setRawMode(value:boolean){raw.push(value);return this;},ref(){return this;},unref(){return this;}}),stdout=Object.assign(new PassThrough(),{isTTY:true,columns:44,rows:14});let text='';stdout.on('data',chunk=>{text+=chunk;});return{stdin:stdin as NodeJS.ReadStream,stdout:stdout as NodeJS.WriteStream,raw,text:()=>text};}
function queue(){const values:WireMessage[]=[];let wake:(()=>void)|undefined,ended=false;return{push(value:WireMessage){values.push(decodeLine(encodeMessage(value)));wake?.();},end(){ended=true;wake?.();},source:{async *[Symbol.asyncIterator](){while(!ended||values.length){if(values.length)yield values.shift()!;else await new Promise<void>(resolve=>{wake=resolve;});}}}};}
const peer=()=>hello('core',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']});
const declare:WireMessage={type:'declare',surfaces:[{id:'main',kind:'pane',title:'Main'},{id:'other',kind:'status-bar'}]};
const layout:WireMessage={type:'layout',width:44,height:14,frames:[{surface:'main',x:0,y:0,width:44,height:12},{surface:'other',x:0,y:12,width:44,height:2}]};

// The SDK's native Node FFI requires Node 26.4; pure wire-client lifecycle runs on Node 22 too.
describe.skipIf(Number(process.versions.node.split('.')[0])<26)('real native wire source/send client',()=>{
 it('gates pre-ACK input, forwards keys/paste/global mouse to current focus, applies pointer, and restores terminal',async()=>{
  const streams=tty(),pending=queue(),sent:WireMessage[]=[];
  const before=streams.stdin.listenerCount('data');
  const handle=await runOpenTuiWireRenderer({...streams,source:pending.source,send:m=>{sent.push(decodeLine(encodeMessage(m)));},hostControlsExit:true,graphics:'off',environment:{TERM:'xterm-256color',AGENT_POINTER:'x11'}});
  try{
   pending.push(declare);pending.push(layout);pending.push({type:'render',surface:'main',mode:'full',flush:true,grid:[[{ch:'A'}]]});
   await vi.waitFor(()=>expect(handle.store.state.grids.get('main')?.width).toBe(1));
   streams.stdin.push('x');await new Promise<void>(resolve=>setImmediate(resolve));expect(sent.filter(m=>m.type==='input')).toEqual([]);
   pending.push(peer());await vi.waitFor(()=>expect(sent.some(m=>m.type==='hello-ack'&&m.ok)).toBe(true));
   pending.push({type:'focus',surface:'other'});await vi.waitFor(()=>expect(handle.store.state.focused).toBe('other'));
   streams.stdin.push('q');await vi.waitFor(()=>expect(sent).toContainEqual({type:'input',surface:'other',data:{kind:'text',text:'q'}}));
   streams.stdin.push('\x1b[200~😀窗\nq\x1b[201~');await vi.waitFor(()=>expect(sent).toContainEqual({type:'input',surface:'other',data:{kind:'text',text:'😀窗\nq',paste:true}}));
   streams.stdin.push('\r');await vi.waitFor(()=>expect(sent).toContainEqual({type:'input',surface:'other',data:{kind:'key',key:'enter',modifiers:[]}}));
   streams.stdin.push('\x1b[<0;6;5M\x1b[<0;6;5m');await vi.waitFor(()=>expect(sent).toContainEqual({type:'input',surface:'other',data:{kind:'mouse',row:4,col:5,button:'left',action:'release'}}));
   streams.stdin.push('\x03');await vi.waitFor(()=>expect(sent).toContainEqual({type:'input',surface:'other',data:{kind:'key',key:'c',modifiers:['ctrl']}}));expect(sent.some(m=>m.type==='bye')).toBe(false);
   pending.push({type:'pointer',shape:'ew-resize'});await vi.waitFor(()=>expect(streams.text()).toContain('\x1b]22;sb_h_double_arrow\x1b\\'));
   let external=false;await handle.runExternal(async()=>{external=true;expect(streams.raw.at(-1)).toBe(false);});expect(external).toBe(true);expect(streams.raw.at(-1)).toBe(true);
   pending.push({type:'bye'});await handle.waitUntilExit;expect(streams.raw.at(-1)).toBe(false);expect(streams.text()).toContain('\x1b[?1049l');expect(streams.text()).toContain('\x1b]22;left_ptr\x1b\\');
   expect(streams.stdin.listenerCount('data')).toBe(before);
  }finally{await handle.stop();pending.end();streams.stdin.destroy();streams.stdout.destroy();}
 });
 it('forwards Ctrl+C then emits bye and cleans up when the renderer owns exit',async()=>{
  const streams=tty(),pending=queue(),sent:WireMessage[]=[];
  const handle=await runOpenTuiWireRenderer({...streams,source:pending.source,send:m=>sent.push(m),graphics:'off',environment:{TERM:'xterm-256color'}});
  try{pending.push(peer());pending.push(declare);await vi.waitFor(()=>expect(handle.store.state.focused).toBe('main'));streams.stdin.push('\x03');await handle.waitUntilExit;
   expect(sent.slice(-2)).toEqual([{type:'input',surface:'main',data:{kind:'key',key:'c',modifiers:['ctrl']}},{type:'bye',reason:'ctrl+c'}]);expect(streams.raw.at(-1)).toBe(false);
  }finally{await handle.stop();pending.end();streams.stdin.destroy();streams.stdout.destroy();}
 });
 it('rejects a bad handshake while restoring raw mode and alternate screen',async()=>{
  const streams=tty(),pending=queue(),handle=await runOpenTuiWireRenderer({...streams,source:pending.source,send(){},hostControlsExit:true,graphics:'off'});
  try{pending.push({type:'hello-ack',ok:false,reason:'incompatible'});await expect(handle.waitUntilExit).rejects.toThrow('incompatible');expect(streams.raw.at(-1)).toBe(false);expect(streams.text()).toContain('\x1b[?1049l');}
  finally{await handle.stop();pending.end();streams.stdin.destroy();streams.stdout.destroy();}
 });
});
