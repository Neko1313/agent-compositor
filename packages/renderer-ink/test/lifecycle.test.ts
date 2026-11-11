import {it,expect,vi} from 'vitest';
import {PassThrough} from 'node:stream';
import {Console} from 'node:console';
import {hello,type WireMessage} from '@agent-compositor/protocol';
import {runInkRenderer} from '../src/run.js';

it('bounds alternate-screen output and restores autowrap for external programs and cleanup',async()=>{
 const stdin=Object.assign(new PassThrough(),{isTTY:true,setRawMode:vi.fn(),ref(){},unref(){}});
 const stdout=Object.assign(new PassThrough(),{isTTY:true,columns:80,rows:24});let output='';stdout.on('data',chunk=>{output+=chunk;});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 async function* source():AsyncGenerator<WireMessage>{yield hello('core',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']});await gate;yield{type:'bye',reason:'fixture complete'};}
 vi.stubGlobal('console',{...console,Console});
 try{
  const renderer=await runInkRenderer({source:source(),send:()=>{},stdin,stdout,stderr:stdout,hostControlsExit:true,graphics:'off',exit:()=>{}});
  await vi.waitFor(()=>expect(renderer.store.suspend).toBeTypeOf('function'));
  const beforeResize=output.length;stdout.columns=60;stdout.emit('resize');await Promise.resolve();
  expect(output.slice(beforeResize).startsWith('\x1b[?2026h')).toBe(true);
  expect(output.slice(beforeResize)).toContain('\x1b[?2026l');
  await renderer.runExternal(async()=>{expect(output.lastIndexOf('\x1b[?7h')).toBeGreaterThan(output.lastIndexOf('\x1b[?7l'));});
  expect(output.lastIndexOf('\x1b[?7l')).toBeGreaterThan(output.lastIndexOf('\x1b[?7h'));
  release();
  await renderer.waitUntilExit;
  expect(output).toContain('\x1b[?1049h\x1b[?7l');expect(output).toContain('\x1b[?7h\x1b[?1049l');
 }finally{release();vi.unstubAllGlobals();stdin.destroy();stdout.destroy();}
});
