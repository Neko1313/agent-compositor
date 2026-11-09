// Optional independent codec verification. Requires ImageMagick, not a terminal.
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir}from'node:os';import{join,resolve}from'node:path';
import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
import UPNG from'upng-js';import{sixel}from'../../packages/renderer-ink/src/sixel.ts';
const directory=await mkdtemp(join(tmpdir(),'compositor-sixel-codec-'));
try{
 const rgba=Buffer.alloc(64*64*4),colours=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[0,0,0,0]],background=[16,21,25];
 for(let y=0;y<64;y++)for(let x=0;x<64;x++)rgba.set(colours[(x+y)%4],(y*64+x)*4);
 const encoded=sixel({width:64,height:64,rgba:rgba.toString('base64'),column:0,row:0,columns:8,rows:4},8,4,{width:8,height:16},background);
 const source=join(directory,'image.six'),output=join(directory,'image.png');await writeFile(source,encoded);
 execFileSync('magick',[source,'-depth','8',output],{timeout:10000});
 const png=await readFile(output),image=UPNG.decode(png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength)),pixels=new Uint8Array(UPNG.toRGBA8(image)[0]);
 assert.equal(image.width,64);assert.equal(image.height,64);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const source=colours[(x+y)%4],expected=source[3]?source:background;
  for(let c=0;c<3;c++)assert.ok(Math.abs(pixels[(y*64+x)*4+c]-expected[c])<=2,'SIXEL colour mismatch');
  assert.equal(pixels[(y*64+x)*4+3],255);
 }
 const report={ok:true,decoder:'ImageMagick SIXEL',width:64,height:64,comparedPixels:4096,colourTolerance:2};
 const artifacts=resolve(process.env.VISUAL_OUTPUT??'dist/sixel-reference');await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await rm(directory,{recursive:true,force:true});}
