import { describe, it, expect, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { TerminalGraphics } from '../src/graphics.js';
import { MouseDecoder } from '../src/mouse.js';
import { RendererState } from '../src/state.js';
import { rasterMessage } from '@agent-compositor/protocol';

const raster = {width:2,height:2,rgba:Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,0]).toString('base64'),column:0,row:0,columns:2,rows:1};
function fixture() {
 const writes:string[]=[];const graphics=new TerminalGraphics(text=>writes.push(text));graphics.enabled=true;
 const state=new RendererState(true);
 state.apply({type:'layout',width:30,height:15,frames:[{surface:'pet',x:5,y:2,width:12,height:10}]});
 state.apply({type:'render',surface:'pet',mode:'full',flush:true,grid:[[{ch:'▀'},{ch:'▀'}],[{ch:'P'}]],raster});
 return {writes,graphics,state};
}
const commands=(text:string)=>[...text.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/g)];

describe('native terminal graphics',()=>{
 it('negotiates support and strips fragmented responses without losing keyboard or mouse input',async()=>{
  const writes:string[]=[];const graphics=new TerminalGraphics(text=>writes.push(text));
  const result=graphics.detect('auto',true);
  const decoder=new MouseDecoder((control,payload)=>graphics.response(control,payload));
  expect(decoder.push(`a\x1b_Gi=${graphics.queryId};O`).text).toBe('a');
  expect(decoder.push('K\x1b\\b\x1b[<0;3;4M')).toEqual({text:'b',events:[{kind:'mouse',row:3,col:2,button:'left',action:'press'}]});
  expect(await result).toBe(true);expect(writes[0]).toContain('a=q');graphics.dispose();
 });
 it('uses a bounded timeout and leaves unsupported/non-TTY/multiplexed terminals portable',async()=>{
  vi.useFakeTimers();try{
   const writes:string[]=[];const graphics=new TerminalGraphics(text=>writes.push(text));
   expect(await graphics.detect('off',true)).toBe(false);
   expect(await graphics.detect('auto',false)).toBe(false);
   expect(await graphics.detect('auto',true,true)).toBe(false);expect(writes).toHaveLength(0);
   const pending=graphics.detect('auto',true);await vi.advanceTimersByTimeAsync(351);expect(await pending).toBe(false);
   const rejected=graphics.detect('auto',true);graphics.response(`i=${graphics.queryId}`,'ENOTSUP');expect(await rejected).toBe(false);
   const cancelled=graphics.detect('auto',true);graphics.dispose();expect(await cancelled).toBe(false);
   expect(await graphics.detect('kitty',true)).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it('transmits lossless compressed RGBA and reserves only the image cells',()=>{
  const {writes,graphics,state}=fixture();graphics.paint(state);
  expect(state.grid('pet')!.segments(0).map(s=>s.text).join('')).toBe('  ');
  expect(state.grid('pet')!.segments(1).map(s=>s.text).join('')).toBe('P');
  const upload=commands(writes.join('')).find(c=>c[1].includes('a=t'))!;
  expect(inflateSync(Buffer.from(upload[2],'base64'))).toEqual(Buffer.from(raster.rgba,'base64'));
  expect(writes.join('')).toContain('\x1b7\x1b[5;8H');expect(writes.join('')).toContain('c=2,r=1,C=1');expect(writes.join('')).toContain('\x1b8');
  const portable=new RendererState();portable.apply({type:'render',surface:'pet',mode:'full',flush:true,grid:[[{ch:'▀'}]],raster});
  expect(portable.rasters.size).toBe(0);expect(portable.grid('pet')!.segments(0)[0].text).toBe('▀');
 });
 it('reuses frame uploads, follows movement and removes stale placements on workspace changes',()=>{
  const {writes,graphics,state}=fixture();graphics.paint(state);writes.length=0;
  state.layout!.frames[0].x=8;graphics.paint(state);
  expect(writes.join('')).not.toContain('a=t');expect(writes.join('')).toContain('\x1b[5;11H');writes.length=0;
  const next={...raster,rgba:Buffer.alloc(16,100).toString('base64')};state.rasters.set('pet',next);graphics.paint(state);
  expect(writes.join('')).toContain('a=d,d=i');expect(writes.join('')).toContain('a=t');writes.length=0;
  state.rasters.set('pet',raster);graphics.paint(state);expect(writes.join('')).not.toContain('a=t');writes.length=0;
  state.layout!.frames[0].width=4;graphics.paint(state);expect(writes.join('')).toContain('a=d,d=i');writes.length=0;
  state.layout!.frames[0].width=12;graphics.paint(state);writes.length=0;
  state.layout!.frames=[];graphics.paint(state);expect(writes.join('')).toContain('a=d,d=i');writes.length=0;
  graphics.dispose();expect(writes.join('')).toContain('a=d,d=I');writes.length=0;graphics.paint(state);expect(writes).toHaveLength(0);
 });
 it('chunks full-resolution images, bounds its cache and clears text-only replacements',()=>{
  const {writes,graphics,state}=fixture();
  const random=Buffer.alloc(228*228*4);for(let i=0;i<random.length;i++)random[i]=(i*123+i*i*7+(i>>4))%256;
  state.rasters.set('pet',{...raster,width:228,height:228,rgba:random.toString('base64')});graphics.paint(state);
  const chunks=commands(writes.join('')).filter(c=>c[2]);expect(chunks.every(c=>c[2].length<=4096)).toBe(true);
  expect(inflateSync(Buffer.from(chunks.map(c=>c[2]).join(''),'base64'))).toEqual(random);
  writes.length=0;
  for(let i=0;i<70;i++){state.rasters.set('pet',{...raster,rgba:Buffer.alloc(16,i).toString('base64')});graphics.paint(state);}
  expect(writes.join('')).toContain('a=d,d=I');
  state.apply({type:'render',surface:'pet',mode:'full',flush:true,grid:[[{ch:'T'}]]});expect(state.rasters.size).toBe(0);
  writes.length=0;graphics.paint(state);expect(writes.join('')).toContain('a=d,d=i');
 });
 it('rejects malformed payload sizes and avoids drawing outside tiny surfaces',()=>{
  expect(rasterMessage.safeParse({...raster,rgba:'AAAA'}).success).toBe(false);
  expect(rasterMessage.safeParse({...raster,width:513}).success).toBe(false);
  const {writes,graphics,state}=fixture();state.layout!.frames[0].width=4;graphics.paint(state);expect(writes).toHaveLength(0);
  state.layout!.frames[0].width=12;state.rasters.set('pet',{...raster,rgba:'AAAA'});graphics.paint(state);expect(writes).toHaveLength(0);
  state.rasters.set('pet',{...raster,column:100});graphics.paint(state);expect(writes).toHaveLength(0);
 });
});
