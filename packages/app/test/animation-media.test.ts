import{mkdtemp,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import UPNG from'upng-js';
import{it,expect}from'vitest';
import{GifWriter}from'omggif';
import{decodeGif,decode}from'../../../plugins/mascot/animations.js';
import{Timeline}from'../../../plugins/mascot/timeline.js';

function gif(disposal:number){
 const buffer=Buffer.alloc(4096),writer=new GifWriter(buffer,2,1,{palette:[0,0xff0000,0x00ff00,0x0000ff],loop:0});
 writer.addFrame(0,0,2,1,[1,1],{delay:2});
 writer.addFrame(0,0,1,1,[2],{delay:3,disposal,transparent:0});
 writer.addFrame(1,0,1,1,[3],{delay:4,transparent:0});
 return buffer.subarray(0,writer.end());
}
it('decodes transparent GIF patches, source timing, disposal background and previous, and loops',()=>{
 const previous=decodeGif(gif(3)),cleared=decodeGif(gif(2));
 expect(previous.map(f=>f.delay)).toEqual([20,30,40]);expect(previous.plays).toBe(0);
 expect([...Buffer.from(previous[2].rgba,'base64')]).toEqual([255,0,0,255,0,0,255,255]);
 expect([...Buffer.from(cleared[2].rgba,'base64')]).toEqual([0,0,0,0,0,0,255,255]);
 const opaque=Buffer.alloc(4096),writer=new GifWriter(opaque,2,1,{palette:[0xff0000,0x00ff00]});writer.addFrame(1,0,1,1,[1],{delay:1});
 const frames=decodeGif(opaque.subarray(0,writer.end()));expect(frames.plays).toBe(1);expect([...Buffer.from(frames[0].rgba,'base64')]).toEqual([255,0,0,255,0,255,0,255]);
});
it('preserves long source holds and permits longer small-canvas GIFs within the pixel budget',()=>{
 const bytes=Buffer.alloc(32768),writer=new GifWriter(bytes,1,1,{palette:[0,0xff0000],loop:1});
 for(let i=0;i<200;i++)writer.addFrame(0,0,1,1,[i%2],{delay:i?2:2000});
 const frames=decodeGif(bytes.subarray(0,writer.end()));expect(frames).toHaveLength(200);expect(frames[0].delay).toBe(20000);expect(frames.plays).toBe(2);
});
it('rejects oversized GIF canvases before allocating decoded buffers',()=>{
 const bad=Buffer.from(gif(1));bad.writeUInt16LE(65535,6);bad.writeUInt16LE(65535,8);
 expect(()=>decodeGif(bad)).toThrow('budget');expect(()=>decodeGif(Buffer.alloc(2*1024*1024+1))).toThrow('2 MiB');
});
it('keeps source time despite rendering delay, skips late frames, pauses and honors finite playback',()=>{
 const frames=[20,30,40].map(delay=>({width:1,height:1,rgba:'AAAAAA==',delay})),clock=new Timeline();
 clock.select(frames,0);clock.play(true,0);
 expect(clock.sample([frames[0]],0,10)).toEqual({index:0,wait:0,done:true});
 expect(clock.sample(frames,0,10)).toEqual({index:0,wait:10,done:false});
 expect(clock.sample(frames,0,65)).toEqual({index:2,wait:25,done:false});
 clock.play(false,65);expect(clock.sample(frames,0,1000)).toEqual({index:2,wait:25,done:false});
 clock.play(true,1000);expect(clock.sample(frames,0,1030)).toEqual({index:0,wait:15,done:false});
 expect(clock.sample(frames,1,1030)).toEqual({index:2,wait:0,done:true});
 clock.select([...frames],1030);expect(clock.sample(frames,0,1040).index).toBe(0);
});

it('never applies legacy outline repair to a clean replacement PNG automatically',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'new-ghost-alpha-'));
 try{const rgba=new Uint8Array([165,243,252,255,0,0,0,0,0,0,0,0,0,0,0,0]),file=join(directory,'clean.png');
 await writeFile(file,Buffer.from(UPNG.encode([rgba.buffer],2,2,0)));
 expect((await decode(file,'legacy'))[0].rgba).toBe((await decode(file,false))[0].rgba);
 expect((await decode(file,true))[0].rgba).not.toBe((await decode(file,false))[0].rgba);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('supports longer small APNG sequences while preserving original timing',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'long-ghost-apng-'));
 try{const frames=Array.from({length:200},(_,i)=>{const rgba=new Uint8Array(8*8*4);for(let pixel=0;pixel<64;pixel++)rgba.set([i%2?255:0,100,200,255],pixel*4);return rgba.buffer;}),file=join(directory,'long.apng');
 await writeFile(file,Buffer.from(UPNG.encode(frames,8,8,0,frames.map((_,i)=>i?20:20000))));
 const decoded=await decode(file);expect(decoded).toHaveLength(200);expect(decoded[0].delay).toBe(20000);expect(decoded[1].delay).toBe(20);
 }finally{await rm(directory,{recursive:true,force:true});}
});
