import {describe,it,expect} from 'vitest';
import {hello,wireMessage,RendererState,SurfaceGrid,type WireMessage} from '@agent-compositor/protocol';
import {RendererState as InkState} from '../../renderer-ink/src/state.js';
import {SurfaceGrid as InkGrid} from '../../renderer-ink/src/grid.js';
import {OpenTuiWireStore} from '../src/wire-store.js';
import {wirePaints,wireRasterFrames,wireTextFrame} from '../src/wire-frame.js';

const raster={width:1,height:1,rgba:'/wAA/w==',column:1,row:0,columns:1,rows:1};
const cells=(text:string)=>Array.from(text,ch=>({ch}));
function log():WireMessage[]{return[
 {...hello('core',{surfaces:['terminal'],sites:[],elements:['Text','Box','Layout','Raster'],encodings:['jsonl']}),version:'0.6.0'},
 {type:'declare',surfaces:[{id:'main',kind:'pane',title:'Main'},{id:'status',kind:'status-bar'}]},
 {type:'layout',width:30,height:12,frames:[{surface:'main',x:0,y:0,width:30,height:10,controls:true,chrome:{border:'gray',accent:'cyan',text:'white',muted:'gray',titleBackground:'black',warning:'yellow',borderStyle:'double',controls:'focus'}},{surface:'status',x:0,y:10,width:30,height:2}]},
 {type:'render',surface:'main',mode:'full',flush:false,focused:true,grid:[[{ch:'A',fg:'#123456',bg:'#abcdef',bold:true,dim:true,italic:true,underline:true},...cells('bc')],cells('row2')]},
 {type:'render',surface:'status',mode:'full',flush:true,grid:[cells('Ready')]},
 {type:'render',surface:'main',mode:'diff',flush:false,ops:[{op:'set',row:0,col:1,cells:cells('X')},{op:'cursor',row:0,col:1}]},
 {type:'focus',surface:'status'},
 {type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'scroll',rows:1},{op:'set',row:1,col:2,cells:cells('Y')}]},
 {type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'scroll',rows:-1}]},
 {type:'render',surface:'main',mode:'full',flush:true,grid:[cells('raster')],raster},
 {type:'render',surface:'main',mode:'diff',flush:false,ops:[{op:'set',row:0,col:0,cells:cells('P')}]},
 {type:'render',surface:'main',mode:'full',flush:true,grid:[cells('raster')],raster:{...raster,rgba:'AP8A/w=='}},
 {type:'invalidate',surface:'main',regions:[{row:0,col:0,rows:1,cols:1}]},
 {type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'clear'},{op:'set',row:2,col:1,cells:cells('last')}]},
 {type:'render',surface:'implicit',mode:'full',flush:true,grid:[cells('implicit')]},
 {type:'focus',surface:'missing'},{type:'pointer',shape:'text'},{type:'bye',reason:'done'},
];}

const state=(s:RendererState)=>({focused:s.focused,layout:s.layout,surfaces:s.surfaceList(),rasters:[...s.rasters],
 grids:[...s.grids].map(([id,g])=>({id,width:g.width,height:g.height,cursor:g.cursor,rows:Array.from({length:g.height},(_,row)=>g.segments(row,g.cursor))}))});

describe('complete legacy wire state',()=>{
 it('keeps Ink public class exports and every same-log state/checkpoint intact',()=>{
  expect(InkState).toBe(RendererState);expect(InkGrid).toBe(SurfaceGrid);
  const reference=new InkState(true),native=new OpenTuiWireStore(true);
  for(const message of log()){
   expect(wireMessage.safeParse(message).success).toBe(true);reference.apply(message);native.apply(message);
   expect(state(native.state)).toEqual(state(reference));
   if(reference.textChanged){const published=native.snapshot().text;
    expect(published.focused).toBe(reference.focused);expect(published.layout).toEqual(reference.layout);
    for(const[id,grid]of reference.grids)expect(published.grids.get(id)?.rows).toEqual(Array.from({length:grid.height},(_,row)=>grid.segments(row,grid.cursor)));
   }
  }
 });
 it('holds unflushed text across pixel-only updates but exposes it on another text checkpoint',()=>{
  const store=new OpenTuiWireStore(true);store.apply({type:'render',surface:'a',mode:'full',flush:true,grid:[cells('abc')],raster});
  const before=store.snapshot().text;
  store.apply({type:'render',surface:'a',mode:'diff',flush:false,ops:[{op:'set',row:0,col:0,cells:cells('X')}]});
  expect(store.snapshot().text).toBe(before);
  store.apply({type:'render',surface:'a',mode:'full',flush:true,grid:[cells('Xbc')],raster:{...raster,rgba:'AP8A/w=='}});
  expect(store.snapshot().text).toBe(before);expect(store.snapshot().rasters.get('a')?.rgba).toBe('AP8A/w==');
  store.apply({type:'render',surface:'a',mode:'diff',flush:false,ops:[{op:'set',row:0,col:0,cells:cells('Y')}]});
  store.apply({type:'declare',surfaces:[{id:'another',kind:'site',site:'help',placement:'inline'}]});
  expect(store.snapshot().text.grids.get('a')?.rows[0][0].text).toBe('Y c');
 });
 it('draws resolved chrome, borderless status, clipping and literal cell styles without a second layout',()=>{
  const store=new OpenTuiWireStore();for(const m of log().slice(0,5))store.apply(m);
  const snapshot=store.snapshot().text,frame=wireTextFrame(snapshot);
  expect(frame.split('\n')[0]).toBe('╔'+'═'.repeat(28)+'╗');expect(frame.split('\n')[1]).toContain('[F][x]');
  expect(frame.split('\n')[2]).toContain('Abc');expect(frame.split('\n')[10]).toBe('Ready');
  const paint=wirePaints(snapshot).find(p=>p.text==='A');expect(paint?.style).toEqual({fg:'#123456',bg:'#abcdef',bold:true,dim:true,italic:true,underline:true});
  expect(paint?.x).toBe(2);expect(paint?.y).toBe(2);expect(paint?.clip.width).toBe(26);
 });
 it('preserves raster cell placement, clips tiny/moved surfaces and clears text-only replacements',()=>{
  const store=new OpenTuiWireStore(true);for(const m of log().slice(0,10))store.apply(m);
  expect(wireRasterFrames(store.snapshot())).toEqual([{surface:'main',image:raster,rect:{x:3,y:2,width:1,height:1}}]);
  store.apply({type:'layout',width:30,height:12,frames:[{surface:'main',x:5,y:3,width:4,height:3}]});expect(wireRasterFrames(store.snapshot())).toEqual([]);
  store.apply({type:'render',surface:'main',mode:'full',flush:true,grid:[cells('text')]});expect(store.snapshot().rasters.size).toBe(0);
 });
 it('supports declared-order fallback, implicit panes and wide Unicode in redirected output',()=>{
  const store=new OpenTuiWireStore();store.apply({type:'render',surface:'implicit',mode:'full',flush:true,grid:[cells('窗A😀')]});
  expect(wireTextFrame(store.snapshot().text,20)).toContain('窗A😀');
  store.apply({type:'declare',surfaces:[{id:'bar',kind:'status-bar',placement:'dock'}]});store.apply({type:'render',surface:'bar',mode:'full',flush:true,grid:[cells('END')]});
  expect(wireTextFrame(store.snapshot().text,20).indexOf('窗A😀')).toBeLessThan(wireTextFrame(store.snapshot().text,20).indexOf('END'));
 });
});
