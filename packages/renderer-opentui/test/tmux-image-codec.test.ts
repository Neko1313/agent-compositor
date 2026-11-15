import {randomBytes} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {describe,expect,it} from 'vitest';
import {tmuxDeleteImage,tmuxFeatureQuery,tmuxFeatureReply,tmuxImageColor,tmuxPlaceholderRows,tmuxVirtualImage,tmuxVirtualImageBatch,tmuxWriteAtomic} from '../src/tmux-image-codec.js';

const unwrap=(data:Buffer)=>{
  const text=data.toString('utf8');expect(text.startsWith('\x1bPtmux;')).toBe(true);expect(text.endsWith('\x1b\\')).toBe(true);
  return text.slice(7,-2).replaceAll('\x1b\x1b','\x1b');
};
describe('tmux Kitty virtual image codec',()=>{
  it('accepts only its matching affirmative Unicode feature reply',()=>{
    expect(unwrap(tmuxFeatureQuery(31))).toBe('\x1b_Ga=q,i=31,e=T,U=1,C=1\x1b\\');
    expect(tmuxFeatureReply('\x1b_Gi=31,e=T,C=1,U=1;OK\x1b\\',31)).toBe(true);
    for(const value of ['\x1b_Gi=32,e=T,U=1;OK\x1b\\','\x1b_Gi=31,e=T,U=0;OK\x1b\\',
      '\x1b_Gi=31,e=T,U=1,U=1;OK\x1b\\','\x1b_Gi=31,e=T,U=1;ENOENT\x1b\\','ordinary input'])
      expect(tmuxFeatureReply(value,31)).toBe(false);
  });
  it('encodes explicit independent cell coordinates and validates bounded geometry',()=>{
    const rows=tmuxPlaceholderRows(2,2);
    expect(rows).toEqual(['\u{10eeee}\u0305\u0305\u{10eeee}\u0305\u030d','\u{10eeee}\u030d\u0305\u{10eeee}\u030d\u030d']);
    expect(tmuxImageColor(42)).toBe('#00002a');expect(tmuxImageColor(0xffffff)).toBe('#ffffff');
    expect(tmuxPlaceholderRows(20,8)).toHaveLength(8);
    for(const [columns,height] of [[0,1],[21,1],[1,9],[1.5,2]])expect(()=>tmuxPlaceholderRows(columns,height)).toThrow(RangeError);
  });
  it('round trips multi-chunk RGBA and removes only the owned image',()=>{
    const rgba=randomBytes(64*64*4),chunks=tmuxVirtualImage({width:64,height:64,rgba},42,8,4);
    expect(chunks.length).toBeGreaterThan(1);expect(Math.max(...chunks.map(chunk=>chunk.length))).toBeLessThan(4200);
    expect(tmuxVirtualImageBatch({width:64,height:64,rgba},42,8,4)).toEqual(Buffer.concat(chunks));
    const commands=chunks.map(unwrap);expect(commands[0]).toContain('a=T,U=1,i=42,q=2,f=32,s=64,v=64,c=8,r=4,o=z,m=1;');
    expect(commands.at(-1)).toMatch(/^\x1b_Gm=0;/);
    expect(inflateSync(Buffer.from(commands.map(command=>command.slice(command.indexOf(';')+1,-2)).join(''),'base64'))).toEqual(rgba);
    expect(unwrap(tmuxDeleteImage(42))).toBe('\x1b_Ga=d,d=I,i=42,q=2\x1b\\');
  });
  it('rejects invalid ids and malformed or excessive frames',()=>{
    for(const id of [0,-1,0x1000000,1.1])expect(()=>tmuxFeatureQuery(id)).toThrow(RangeError);
    expect(()=>tmuxVirtualImage({width:2,height:2,rgba:new Uint8Array(15)},1,2,2)).toThrow(RangeError);
    expect(()=>tmuxVirtualImage({width:1025,height:1024,rgba:new Uint8Array(0)},1,2,2)).toThrow(RangeError);
  });
  it('admits a whole batch after pressure clears and rejects stalled or oversized output',async()=>{
    const accepted:Uint8Array[]=[];let calls=0;
    const sink={maxAtomicWriteBytes:10n,write:(data:Uint8Array)=>{calls++;if(calls===1)return false;accepted.push(data);return true;},idle:async()=>{}};
    const bytes=Uint8Array.of(1,2,3);await tmuxWriteAtomic(sink,bytes);expect(calls).toBe(2);expect(accepted).toEqual([bytes]);
    await expect(tmuxWriteAtomic(sink,new Uint8Array(11))).rejects.toThrow('atomic output capacity');expect(calls).toBe(2);
    await expect(tmuxWriteAtomic({...sink,write:()=>false},bytes)).rejects.toThrow('remained unavailable');
  });
  it('cancels a blocked admission before any bytes are accepted',async()=>{
    const controller=new AbortController(),sink={maxAtomicWriteBytes:10n,write:()=>false,idle:()=>new Promise<void>(()=>{})};
    const pending=tmuxWriteAtomic(sink,Uint8Array.of(1),controller.signal);controller.abort(Error('closed'));
    await expect(pending).rejects.toThrow('closed');
  });
  it('keeps an immutable batch while waiting for output capacity',async()=>{
    let release!:()=>void,calls=0,accepted:Uint8Array|undefined;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const sink={maxAtomicWriteBytes:10n,write:(bytes:Uint8Array)=>{if(++calls===1)return false;accepted=bytes;return true;},idle:()=>gate};
    const bytes=Uint8Array.of(1,2,3),pending=tmuxWriteAtomic(sink,bytes);bytes[0]=9;release();await pending;
    expect([...accepted!]).toEqual([1,2,3]);
  });
});
