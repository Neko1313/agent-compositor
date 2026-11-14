/** @jsxImportSource @opentui/react */
import React,{act} from 'react';
import {beforeAll,describe,it,expect} from 'vitest';
import {render as renderInk} from 'ink-testing-library';
import {decodeLine,encodeMessage,type WireMessage} from '@agent-compositor/protocol';
import {RendererStore as InkStore} from '../../renderer-ink/src/run.js';
import {RendererApp} from '../../renderer-ink/src/app.js';
import {OpenTuiWireStore} from '../src/wire-store.js';
import {wireMouse} from '../src/wire-input.js';

const cells=(text:string)=>Array.from(text,ch=>({ch}));
const clean=(text:string)=>text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').split('\n').map(row=>row.trimEnd()).join('\n').trimEnd();
const initial:WireMessage[]=[
 {type:'declare',surfaces:[{id:'main',kind:'pane',title:'Main'},{id:'side',kind:'pane',title:'Other'},{id:'status',kind:'status-bar'}]},
 {type:'layout',width:44,height:14,frames:[{surface:'main',x:0,y:0,width:30,height:10,controls:true,chrome:{border:'gray',accent:'cyan',text:'white',muted:'gray',titleBackground:'black',warning:'yellow',borderStyle:'double',controls:'focus'}},{surface:'side',x:30,y:0,width:14,height:10,controls:true,chrome:{border:'gray',accent:'cyan',text:'white',muted:'gray',titleBackground:'black',warning:'yellow',borderStyle:'round',controls:'focus'}},{surface:'status',x:0,y:10,width:44,height:2}]},
 {type:'render',surface:'main',mode:'full',flush:true,grid:[[{ch:'A',fg:'#123456',bg:'#abcdef',bold:true,dim:true,italic:true,underline:true},...cells('bc')],cells('row2'),cells('row3')]},
 {type:'render',surface:'side',mode:'full',flush:true,grid:[cells('Right')]},
 {type:'render',surface:'status',mode:'full',flush:true,grid:[cells('Ready'),cells('Hint')]},
];
const decoded=(message:WireMessage)=>decodeLine(encodeMessage(message));
let testRender:typeof import('@opentui/react/test-utils')['testRender'];
let OpenTuiWireView:typeof import('../src/wire-view.js')['OpenTuiWireView'];
let ImageRenderable:typeof import('@opentui/core')['ImageRenderable'];
let TextAttributes:typeof import('@opentui/core')['TextAttributes'];

// The SDK's native Node FFI requires Node 26.4; the pure/client tests also run on Node 22.
describe.skipIf(Number(process.versions.node.split('.')[0])<26)('native legacy wire presentation',()=>{
 beforeAll(async()=>{const modules=await Promise.all([import('@opentui/react/test-utils'),import('@opentui/core'),import('../src/wire-view.js')]);testRender=modules[0].testRender;({ImageRenderable,TextAttributes}=modules[1]);OpenTuiWireView=modules[2].OpenTuiWireView;});
 it('paints the actual Ink same-log checkpoints, focus chrome and batched diffs in OpenTUI',async()=>{
  const native=new OpenTuiWireStore(),reference=new InkStore(),ink=renderInk(React.createElement(RendererApp,{store:reference,onKey(){}}));
  const setup=await testRender(<OpenTuiWireView store={native}/>,{width:44,height:14});
  const checkpoint=async(messages:WireMessage[])=>{act(()=>{for(const raw of messages){const m=decoded(raw);reference.apply(m);native.apply(m);}});await setup.flush();expect(clean(setup.captureCharFrame())).toBe(clean(ink.lastFrame()!));};
  try{
   await checkpoint(initial);
   const styled=setup.captureSpans().lines[2].spans.find(span=>span.text.includes('A'))!;
   expect(styled.fg.toInts().slice(0,3)).toEqual([0x12,0x34,0x56]);expect(styled.bg.toInts().slice(0,3)).toEqual([0xab,0xcd,0xef]);
   expect(styled.attributes&(TextAttributes.BOLD|TextAttributes.DIM|TextAttributes.ITALIC|TextAttributes.UNDERLINE)).toBe(TextAttributes.BOLD|TextAttributes.DIM|TextAttributes.ITALIC|TextAttributes.UNDERLINE);
   await checkpoint([{type:'focus',surface:'side'}]);
   const before=clean(setup.captureCharFrame());await checkpoint([{type:'render',surface:'main',mode:'diff',flush:false,ops:[{op:'set',row:0,col:1,cells:cells('X')},{op:'cursor',row:0,col:1}]}]);expect(clean(setup.captureCharFrame())).toBe(before);
   await checkpoint([{type:'render',surface:'main',mode:'diff',flush:true,ops:[]}]);
   const cursor=setup.captureSpans().lines[2].spans.find(span=>span.text.includes('X'))!;expect(cursor.attributes&TextAttributes.INVERSE).toBe(TextAttributes.INVERSE);
   await checkpoint([{type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'scroll',rows:1},{op:'set',row:2,col:0,cells:cells('last')}]},{type:'focus',surface:'main'}]);
   await checkpoint([{type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'scroll',rows:-1},{op:'clear'},{op:'cursor',row:0,col:0}]}]);
   await checkpoint([{type:'declare',surfaces:[{id:'main',kind:'pane',title:'Main\u001b\u202e'}]},
    {type:'render',surface:'main',mode:'full',flush:true,grid:[[{ch:'A\n',fg:'#13579b'},{ch:'\u202e',bg:'#224466'},{ch:'\ud800'},{ch:'窗'}]]},
    {type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'cursor',row:0,col:1}]}]);
   const literalFrame=clean(setup.captureCharFrame());expect(literalFrame).toContain('Main\\u001b\\u202e');expect(literalFrame).toContain('A\\u000a\\u202e\\ud800窗');
   const literalSpan=setup.captureSpans().lines[2].spans.find(span=>span.text.includes('\\u202e'))!;expect(literalSpan.bg.toInts().slice(0,3)).toEqual([0x22,0x44,0x66]);expect(literalSpan.attributes&TextAttributes.INVERSE).toBe(TextAttributes.INVERSE);
   expect(native.state.grid('main')?.toLines()).toEqual(['A\n\u202e\ud800窗']);
  }finally{ink.unmount();await setup.dispose();}
 });
 it('delivers real native pointer events as global coordinates without local hit testing',async()=>{
  const store=new OpenTuiWireStore();for(const m of initial)store.apply(decoded(m));const events:unknown[]=[];
  const setup=await testRender(<OpenTuiWireView store={store} onMouse={event=>{const data=wireMouse(event);if(data)events.push(data);}}/>,{width:44,height:14,useMouse:true});
  try{await setup.flush();await setup.mockMouse.click(33,2);await setup.mockMouse.scroll(5,4,'down');
   expect(events).toContainEqual({kind:'mouse',row:2,col:33,button:'left',action:'press'});expect(events).toContainEqual({kind:'mouse',row:2,col:33,button:'left',action:'release'});expect(events).toContainEqual({kind:'mouse',row:4,col:5,button:'wheel-down',action:'press'});
  }finally{await setup.dispose();}
 });
 it('uses native raster resources and removes them on text replacement',async()=>{
  const store=new OpenTuiWireStore(true);for(const m of initial)store.apply(decoded(m));
  const setup=await testRender(<OpenTuiWireView store={store} protocol="blocks"/>,{width:44,height:14});
  try{
   store.apply(decoded({type:'render',surface:'main',mode:'full',flush:true,grid:[cells('abcdefgh')],raster:{width:1,height:1,rgba:'/wAA/w==',column:1,row:0,columns:2,rows:1}}));await setup.flush();
   expect(setup.captureCharFrame()).toContain('defgh');
   const image=setup.renderer.root.getChildren()[0].getChildren()[0];expect(image).toBeInstanceOf(ImageRenderable);expect([image.x,image.y,image.width,image.height]).toEqual([3,2,2,1]);
   const pixels=setup.captureSpans().lines[2].spans.find(span=>span.bg.toInts()[0]===255);expect(pixels).toBeDefined();
   store.apply(decoded({type:'render',surface:'main',mode:'full',flush:true,grid:[cells('replaced')]}));await setup.flush();expect(setup.renderer.root.getChildren()[0].getChildren()).toHaveLength(0);expect(setup.captureCharFrame()).toContain('replaced');
  }finally{await setup.dispose();}
 });
});
