import {randomBytes} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {describe,expect,it} from 'vitest';
import {TmuxFeatureProbe,TmuxFramePlayer,tmuxDeleteImage,tmuxFeatureQuery,tmuxFeatureReply,tmuxImageColor,tmuxPlaceholderRows,tmuxVirtualImage,tmuxVirtualImageBatch,tmuxWriteAtomic} from '../src/tmux-image-codec.js';

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
  it('requires a matching feature reply and keeps late replies from enabling graphics',async()=>{
    const sink={maxAtomicWriteBytes:1000n,write:()=>true,idle:async()=>{}};
    const probe=new TmuxFeatureProbe(sink,31,10),pending=probe.start();expect(probe.start()).toBe(pending);
    expect(probe.accept('\x1b_Gi=32,e=T,U=1;OK\x1b\\')).toBe(false);
    expect(probe.accept('\x1b_Gi=31,e=T,U=1;OK\x1b\\')).toBe(true);expect(await pending).toBe(true);
    const timeout=new TmuxFeatureProbe(sink,32,10),expired=timeout.start();
    await new Promise(resolve=>setTimeout(resolve,20));expect(await expired).toBe(false);
    expect(timeout.accept('\x1b_Gi=32,e=T,U=1;OK\x1b\\')).toBe(true);expect(await timeout.start()).toBe(false);
    timeout.dispose();expect(timeout.accept('\x1b_Gi=32,e=T,U=1;OK\x1b\\')).toBe(false);
  });
  it('stops a blocked probe and rejects malformed or negative feature responses',async()=>{
    const sink={maxAtomicWriteBytes:1000n,write:()=>false,idle:()=>new Promise<void>(()=>{})};
    const probe=new TmuxFeatureProbe(sink,31,1000),pending=probe.start();probe.dispose();expect(await pending).toBe(false);
    const negative=new TmuxFeatureProbe({...sink,write:()=>true},33,1000),response=negative.start();
    expect(negative.accept('\x1b_Gi=33,e=T,U=0;OK\x1b\\')).toBe(true);expect(await response).toBe(false);
    expect(()=>new TmuxFeatureProbe(sink,0)).toThrow(RangeError);
  });
  it('coalesces pending frames and deletes only the owned image on disposal',async()=>{
    let release!:()=>void,calls=0,painted=0;const gate=new Promise<void>(resolve=>{release=resolve;}),writes:Uint8Array[]=[];
    const sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{if(++calls===1)return false;writes.push(bytes);return true;},idle:()=>gate};
    const errors:unknown[]=[],player=new TmuxFramePlayer(sink,42,2,2,()=>painted++,error=>errors.push(error));
    const frame=(red:number)=>({width:1,height:1,rgba:Uint8Array.of(red,0,0,255)});
    const first=frame(1);player.present(first);await Promise.resolve();first.rgba[0]=99;player.present(frame(2));player.present(frame(3));release();await player.idle();
    expect(writes.map(value=>Buffer.from(value))).toEqual([tmuxVirtualImageBatch(frame(1),42,2,2),tmuxVirtualImageBatch(frame(3),42,2,2)]);
    expect(painted).toBe(2);expect(errors).toEqual([]);await player.dispose();
    expect(Buffer.from(writes.at(-1)!)).toEqual(tmuxDeleteImage(42));expect(writes).toHaveLength(3);
    await player.dispose();expect(writes).toHaveLength(3);expect(()=>player.present(frame(4))).toThrow('closed');
  });
  it('cancels a blocked unadmitted frame without deleting an unowned image',async()=>{
    let writes=0;const sink={maxAtomicWriteBytes:100000n,write:()=>{writes++;return false;},idle:()=>new Promise<void>(()=>{})};
    const errors:unknown[]=[],player=new TmuxFramePlayer(sink,42,2,2,()=>{},error=>errors.push(error));
    player.present({width:1,height:1,rgba:Uint8Array.of(1,2,3,255)});await Promise.resolve();await player.dispose();
    expect(writes).toBe(1);expect(errors).toEqual([]);
  });
  it('permits retrying deletion after temporary output failure',async()=>{
    let allow=true;const accepted:Uint8Array[]=[];
    const sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{if(!allow)return false;accepted.push(bytes);return true;},idle:async()=>{}};
    const player=new TmuxFramePlayer(sink,42,2,2,()=>{},()=>{});
    player.present({width:1,height:1,rgba:Uint8Array.of(1,2,3,255)});await player.idle();allow=false;
    await expect(player.dispose()).rejects.toThrow('remained unavailable');allow=true;await player.dispose();
    expect(Buffer.from(accepted.at(-1)!)).toEqual(tmuxDeleteImage(42));expect(accepted).toHaveLength(2);
  });
  it('does not lose a frame queued as the previous pump completes',async()=>{
    const accepted:Uint8Array[]=[];let player!:TmuxFramePlayer,frames=0;
    const sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{accepted.push(bytes);return true;},idle:async()=>{}};
    player=new TmuxFramePlayer(sink,42,2,2,()=>{if(++frames===1)queueMicrotask(()=>player.present({width:1,height:1,rgba:Uint8Array.of(2,0,0,255)}));},()=>{});
    player.present({width:1,height:1,rgba:Uint8Array.of(1,0,0,255)});await player.idle();
    expect(frames).toBe(2);expect(accepted).toHaveLength(2);await player.dispose();
  });
  it('cleans up when disposal re-enters during successful output admission',async()=>{
    let player!:TmuxFramePlayer,closing!:Promise<void>,calls=0;const accepted:Uint8Array[]=[];
    const sink={maxAtomicWriteBytes:100000n,write:(bytes:Uint8Array)=>{accepted.push(bytes);if(++calls===1)closing=player.dispose();return true;},idle:async()=>{}};
    player=new TmuxFramePlayer(sink,42,2,2,()=>{},()=>{});
    player.present({width:1,height:1,rgba:Uint8Array.of(1,2,3,255)});await Promise.resolve();await closing;
    expect(accepted).toHaveLength(2);expect(Buffer.from(accepted[1])).toEqual(tmuxDeleteImage(42));
  });
});
