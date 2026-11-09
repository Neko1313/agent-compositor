import{it,expect,vi}from'vitest';
import{TerminalGraphics}from'../src/graphics.js';
import{MouseDecoder}from'../src/mouse.js';
import{RendererState}from'../src/state.js';
import{sixel}from'../src/sixel.js';
const raster={width:1,height:2,rgba:Buffer.from([255,0,0,255,0,0,0,0]).toString('base64'),column:0,row:0,columns:1,rows:1};
it('detects SIXEL only with advertised support, cell geometry and background; responses never become input',async()=>{
 vi.useFakeTimers();try{
  const output:string[]=[],graphics=new TerminalGraphics(s=>output.push(s)),decoder=new MouseDecoder((c,p)=>graphics.response(c,p));
  const result=graphics.detect('auto',true);expect(output.join('')).toContain('\x1b[16t');
  expect(decoder.push('typed\x1b[?62;4').text).toBe('typed');
  expect(decoder.push('c\x1b[6;16;8t\x1b]11;rgb:1010/1515/1919\x1b').text).toBe('');
  expect(decoder.push('\\next').text).toBe('next');
  await vi.advanceTimersByTimeAsync(351);expect(await result).toBe(true);expect(graphics.backend).toBe('sixel');expect(graphics.cell).toEqual({width:8,height:16});expect(graphics.background).toEqual([16,21,25]);
  const vte=new TerminalGraphics(()=>{}),vp=vte.detect('auto',true);vte.response('da1','62;4');vte.response('areaPixels','480;640');vte.response('areaCells','30;80');vte.response('background','rgb:1010/1515/1919');await vi.advanceTimersByTimeAsync(351);expect(await vp).toBe(true);expect(vte.cell).toEqual({width:8,height:16});
  const unknown=new TerminalGraphics(()=>{}),pending=unknown.detect('auto',true);unknown.response('da1','62;4');await vi.advanceTimersByTimeAsync(351);expect(await pending).toBe(false);
 }finally{vi.useRealTimers();}
});
it('encodes exact geometry, alpha-composited colours and bounded palette runs',()=>{
 const encoded=sixel(raster,1,1,{width:1,height:2},[16,21,25]);
 expect(encoded).toContain('\x1bP0;1q"1;1;1;2');
 expect(encoded).toContain(';2;100;0;0');expect(encoded).toContain(';2;6;8;10');expect(encoded.endsWith('\x1b\\')).toBe(true);
 expect(()=>sixel({...raster,rgba:'AAAA'},1,1,{width:8,height:16},[0,0,0])).toThrow('pixels');
});
it('clears non-addressable images before Ink repaints and preserves the cursor on draw and cleanup',()=>{
 const writes:string[]=[],graphics=new TerminalGraphics(s=>writes.push(s));graphics.enabled=true;graphics.backend='sixel';
 const state=new RendererState(true);state.apply({type:'layout',width:30,height:15,frames:[{surface:'input',x:0,y:2,width:30,height:10}]});
 state.apply({type:'render',surface:'input',mode:'full',flush:true,grid:[[{ch:' '}]],raster});
 graphics.paint(state);expect(writes.join('')).toContain('\x1b7\x1b[5;3H');expect(writes.join('')).toContain('\x1bP0;1q');expect(writes.join('')).toContain('\x1b8');
 writes.length=0;graphics.beforeUpdate();expect(writes.join('')).toContain('\x1b[5;3H ');expect(writes.join('')).not.toContain('\x1bP');
 writes.length=0;graphics.beforeUpdate();expect(writes).toHaveLength(0);graphics.dispose();
});

it('keeps all parts of a gradient represented when more than 256 colours have equal frequencies',()=>{
 const rgba=Buffer.alloc(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++)rgba.set([x*4,y*4,0,255],(y*64+x)*4);
 const encoded=sixel({...raster,width:64,height:64,rgba:rgba.toString('base64')},8,4,{width:8,height:16},[16,21,25]);
 const colours=[...encoded.matchAll(/#(\d+);2;(\d+);(\d+);(\d+)/g)].map(m=>m.slice(2).map(Number));
 expect(colours.length).toBeLessThanOrEqual(256);expect(Math.max(...colours.map(c=>c[1]))).toBeGreaterThan(85);expect(Math.max(...colours.map(c=>c[0]))).toBeGreaterThan(85);
});
